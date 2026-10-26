import { newId } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { normalizeWebhook } from '../whatsapp/normalize.js';
import { verifyMetaSignature } from '../security/signature.js';

/**
 * Recepção (WF01): valida assinatura, normaliza, aplica idempotência por wamid e registra eventos.
 * Retorna as conversas com eventos novos para que o n8n acione o gerenciador de conversas (WF02).
 */
export function createInboundService({ repo, crypto, hasher, outbound, cfg, metrics, logger, now = () => new Date() }) {
  const nowIso = () => now().toISOString();
  const exigirAssinatura = cfg.webhookAssinaturaObrigatoria !== false;

  return {
    async process({ rawBody, assinatura }) {
      if (!Buffer.isBuffer(rawBody)) throw Errors.validation('Corpo bruto ausente');
      if (exigirAssinatura && !verifyMetaSignature(rawBody, assinatura, cfg.whatsapp.appSecret)) {
        metrics.inc('webhook_eventos_total', { resultado: 'assinatura_invalida' });
        logger.warn('webhook_assinatura_invalida', {});
        throw Errors.unauthorized();
      }
      let body;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        metrics.inc('webhook_eventos_total', { resultado: 'json_invalido' });
        throw Errors.validation('JSON inválido');
      }
      const norm = normalizeWebhook(body, { expectedPhoneNumberId: cfg.whatsapp.phoneNumberId, maxTextLength: cfg.limites.maxTamanhoMensagem });
      const conversas = new Set();
      let duplicados = 0;
      let novos = 0;

      for (const m of norm.mensagens) {
        const titularHash = hasher(m.wa_id);
        const { conversa } = await repo.getOrCreateConversation({
          id: newId('conv'),
          titular_hash: titularHash,
          wa_id_cifrado: crypto.encrypt(m.wa_id),
          canal: 'whatsapp',
          estado: 'nova',
          responsavel_atual: 'agente',
          idioma: 'pt-BR',
          contexto: {},
          ultima_entrada_cliente_em: null,
          lock_dono: null,
          lock_ate: null,
          bloqueio_legal: false,
          anonimizada_em: null,
          criada_em: nowIso(),
          atualizada_em: nowIso(),
        });
        const payload = { wamid: m.wamid, tipo: m.tipo, texto: m.texto, resposta_id: m.resposta_id, instante: m.instante, truncada: m.truncada, tipo_original: m.tipo_original || null };
        const inserted = await repo.insertInboundEvent({
          id: m.wamid,
          tipo: 'mensagem',
          conversa_id: conversa.id,
          estado: m.tipo === 'reacao' ? 'descartado' : 'pendente',
          payload_cifrado: crypto.encryptJson(payload),
          tentativas: 0,
          recebido_em: nowIso(),
          atualizado_em: nowIso(),
        });
        if (!inserted) {
          duplicados++;
          metrics.inc('whatsapp_duplicidades_evitadas_total', { direcao: 'entrada' });
          continue;
        }
        novos++;
        metrics.inc('whatsapp_mensagens_recebidas_total', { tipo: m.tipo });
        if (m.tipo === 'reacao') continue;
        try {
          await repo.insertMessage({
            id: newId('msg'),
            conversa_id: conversa.id,
            identificador_externo: m.wamid,
            direcao: 'entrada',
            tipo: m.tipo,
            finalidade: 'atendimento',
            estado: 'recebida',
            conteudo_cifrado: m.texto ? crypto.encrypt(m.texto) : null,
            conteudo_expira_em: m.texto ? new Date(now().getTime() + cfg.retencao.conteudoMensagensDias * 86400000).toISOString() : null,
            chave_deduplicacao: null,
            modelo_nome: null,
            erro_codigo: null,
            criado_em: m.instante,
            atualizado_em: nowIso(),
          });
        } catch (err) {
          if (err.code !== '23505') throw err;
        }
        // Janela de atendimento: reiniciada pela mensagem do cliente (carimbo de tempo da própria mensagem).
        const atual = await repo.getConversation(conversa.id);
        if (!atual.ultima_entrada_cliente_em || atual.ultima_entrada_cliente_em < m.instante) {
          await repo.updateConversation(conversa.id, { ultima_entrada_cliente_em: m.instante, atualizada_em: nowIso() });
        }
        conversas.add(conversa.id);
      }

      let statusProcessados = 0;
      for (const s of norm.status) {
        const inserted = await repo.insertInboundEvent({ id: s.evento_id, tipo: 'status', conversa_id: null, estado: 'processado', payload_cifrado: null, tentativas: 0, recebido_em: nowIso(), atualizado_em: nowIso() });
        if (!inserted) {
          duplicados++;
          continue;
        }
        await outbound.applyStatus(s);
        statusProcessados++;
      }
      metrics.inc('webhook_eventos_total', { resultado: 'ok' });
      return { conversas: [...conversas], mensagens_novas: novos, duplicados, status_processados: statusProcessados, descartados: norm.descartados.length };
    },
  };
}
