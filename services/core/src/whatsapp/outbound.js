import { newId } from '../util/ids.js';
import { withRetry } from '../util/retry.js';
import { evaluateSendPolicy } from './policy.js';
import { containsCardNumber } from '../security/redact.js';

// Serviço de saída: única porta para enviar mensagens ao WhatsApp.
// Ordem: deduplicação → política → limites → registro "enviando" → envio com retentativa controlada → registro final.
export function createOutboundService({ repo, client, crypto, cfg, logger, metrics, audit, now = () => new Date(), sleep }) {
  const w = cfg.whatsapp;

  async function rateLimited(titularHash) {
    const t = now().getTime();
    const sec = new Date(Math.floor(t / 1000) * 1000).toISOString();
    const min = new Date(Math.floor(t / 60000) * 60000).toISOString();
    const g = await repo.incrementCounter('wa:global', sec, new Date(t + 5000).toISOString());
    if (g > w.maxSendPerSecond) return { limitado: true, tentar_apos_ms: 1000 };
    const d = await repo.incrementCounter(`wa:dest:${titularHash}`, min, new Date(t + 120000).toISOString());
    if (d > w.maxPerRecipientPerMinute) return { limitado: true, tentar_apos_ms: 60000 - (t % 60000) };
    return { limitado: false };
  }

  function retentionExpiry() {
    return new Date(now().getTime() + cfg.retencao.conteudoMensagensDias * 86400000).toISOString();
  }

  return {
    /**
     * @param {{conversaId:string, mensagem:object, finalidade:string, origem:'agente'|'sistema'|'atendente', chaveDeduplicacao:string, correlacao?:string}} cmd
     */
    async send(cmd) {
      const { conversaId, mensagem, finalidade, origem, chaveDeduplicacao, correlacao } = cmd;
      if (!chaveDeduplicacao) throw new Error('chaveDeduplicacao obrigatória');

      // 10. Duplicidade: mesma chave → não reenviar.
      const dup = await repo.getMessageByDedupe(chaveDeduplicacao);
      if (dup) {
        metrics.inc('whatsapp_duplicidades_evitadas_total', { direcao: 'saida' });
        return { status: dup.estado === 'falhou' || dup.estado === 'bloqueada' ? dup.estado : 'duplicada', mensagem_id: dup.id, wamid: dup.identificador_externo };
      }

      const conversa = await repo.getConversation(conversaId);
      if (!conversa) return { status: 'bloqueada', motivo: 'conversa_inexistente' };

      // Defesa adicional: jamais enviar número de cartão completo.
      const texto = mensagem.texto || '';
      if (containsCardNumber(texto)) {
        logger.warn('saida_bloqueada_dado_cartao', { conversa_id: conversaId });
        return { status: 'bloqueada', motivo: 'conteudo_sensivel' };
      }

      const modelo = mensagem.tipo === 'modelo' ? await repo.getTemplate(mensagem.modelo.nome, mensagem.modelo.idioma) : null;
      const preferenciaMarketing = finalidade === 'marketing' ? await repo.getPreference(conversa.titular_hash, 'marketing') : null;
      const decisao = evaluateSendPolicy({
        conversa,
        mensagem,
        finalidade,
        origem,
        modelo,
        preferenciaMarketing,
        marketingHabilitado: cfg.marketingHabilitado === true,
        now: now(),
        windowHours: w.serviceWindowHours,
      });
      if (!decisao.permitido) {
        metrics.inc('whatsapp_envios_bloqueados_total', { motivo: decisao.motivo });
        await repo.insertMessage({
          id: newId('msg'),
          conversa_id: conversaId,
          identificador_externo: null,
          direcao: 'saida',
          tipo: mensagem.tipo,
          finalidade,
          estado: 'bloqueada',
          conteudo_cifrado: null,
          conteudo_expira_em: null,
          chave_deduplicacao: chaveDeduplicacao,
          modelo_nome: mensagem.modelo?.nome || null,
          erro_codigo: decisao.motivo,
          criado_em: now().toISOString(),
          atualizado_em: now().toISOString(),
        });
        await audit({ ator: origem, operacao: 'whatsapp.envio_bloqueado', recurso: conversaId, resultado: decisao.motivo, correlacao });
        return { status: 'bloqueada', motivo: decisao.motivo, exige_modelo: Boolean(decisao.exigeModelo) };
      }

      // 9. Limites de envio (aplicados sem contornar limites da plataforma: apenas adiamos).
      const rl = await rateLimited(conversa.titular_hash);
      if (rl.limitado) {
        metrics.inc('whatsapp_envios_adiados_total', { motivo: 'limite_local' });
        return { status: 'adiada', motivo: 'limite_envio', tentar_apos_ms: rl.tentar_apos_ms };
      }

      const msgId = newId('msg');
      try {
        await repo.insertMessage({
          id: msgId,
          conversa_id: conversaId,
          identificador_externo: null,
          direcao: 'saida',
          tipo: mensagem.tipo,
          finalidade,
          estado: 'enviando',
          conteudo_cifrado: crypto.encrypt(mensagem.tipo === 'modelo' ? `[modelo:${mensagem.modelo.nome}]` : texto),
          conteudo_expira_em: retentionExpiry(),
          chave_deduplicacao: chaveDeduplicacao,
          modelo_nome: mensagem.modelo?.nome || null,
          erro_codigo: null,
          criado_em: now().toISOString(),
          atualizado_em: now().toISOString(),
        });
      } catch (err) {
        if (err.code === '23505') {
          metrics.inc('whatsapp_duplicidades_evitadas_total', { direcao: 'saida' });
          return { status: 'duplicada' };
        }
        throw err;
      }

      const to = crypto.decrypt(conversa.wa_id_cifrado);
      const started = Date.now();
      try {
        const { wamid } = await withRetry(() => client.send(to, mensagem), {
          retries: w.sendMaxRetries,
          baseMs: 500,
          maxMs: 8000,
          sleep,
          onRetry: (err, attempt) => logger.warn('retentativa_envio_whatsapp', { codigo: err.code, attempt }),
        });
        await repo.updateMessage(msgId, { estado: 'enviada', identificador_externo: wamid, atualizado_em: now().toISOString() });
        metrics.inc('whatsapp_mensagens_enviadas_total', { tipo: mensagem.tipo, finalidade });
        metrics.observe('whatsapp_envio_duracao_segundos', { tipo: mensagem.tipo }, (Date.now() - started) / 1000);
        return { status: 'enviada', mensagem_id: msgId, wamid };
      } catch (err) {
        const classe = err.classe || 'permanente';
        await repo.updateMessage(msgId, { estado: 'falhou', erro_codigo: String(err.waCode ?? err.code ?? 'erro'), atualizado_em: now().toISOString() });
        metrics.inc('whatsapp_falhas_envio_total', { classe });
        if (classe === 'opt_out_marketing') {
          await repo.upsertPreference({
            id: newId('pref'),
            titular_hash: conversa.titular_hash,
            finalidade: 'marketing',
            estado: 'revogada',
            origem: 'whatsapp:erro_131050',
            evidencia: msgId,
            registrado_em: now().toISOString(),
            atualizado_em: now().toISOString(),
          });
        }
        if (classe === 'modelo_invalido' && mensagem.modelo) {
          await repo.upsertTemplate({ ...(modelo || {}), id: modelo?.id || newId('tpl'), nome: mensagem.modelo.nome, idioma: mensagem.modelo.idioma, estado: 'pausado', atualizado_em: now().toISOString() });
        }
        if (classe === 'alerta') logger.error('alerta_conta_whatsapp', { codigo: err.code });
        await audit({ ator: origem, operacao: 'whatsapp.envio_falhou', recurso: msgId, resultado: classe, correlacao, detalhes: { codigo: err.code } });
        return { status: 'falhou', mensagem_id: msgId, classe, exige_modelo: classe === 'fora_janela', retentavel: classe === 'transitorio' };
      }
    },

    async applyStatus({ wamid, estado, erro_codigo }) {
      // Estados só avançam (enviada → entregue → lida); 'falhou' sempre registra.
      const ordem = { enviando: 0, enviada: 1, entregue: 2, lida: 3 };
      const msgs = await repo.getMessageByExternalId(wamid);
      if (!msgs) return false;
      if (estado !== 'falhou' && (ordem[estado] ?? 0) <= (ordem[msgs.estado] ?? 0)) return true;
      await repo.updateMessageByExternalId(wamid, { estado, erro_codigo: erro_codigo || msgs.erro_codigo, atualizado_em: now().toISOString() });
      metrics.inc('whatsapp_status_total', { estado });
      return true;
    },
  };
}
