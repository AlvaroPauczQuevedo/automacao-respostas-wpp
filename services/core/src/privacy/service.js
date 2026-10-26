import { newId } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { redactText } from '../security/redact.js';
import { Catalog } from '../whatsapp/catalog.js';

export const PRIVACY_TYPES = ['confirmacao', 'acesso', 'correcao', 'compartilhamento', 'eliminacao', 'anonimizacao', 'bloqueio', 'revogacao_consentimento', 'oposicao', 'portabilidade', 'outro'];

/**
 * Direitos dos titulares (LGPD art. 18). O assistente apenas REGISTRA e encaminha; a execução
 * (acesso, eliminação etc.) é feita por pessoa com papel encarregado_dados, após verificação de identidade.
 * Nenhuma mensagem informal no chat provoca exclusão automática.
 */
export function createPrivacyService({ repo, crypto, hasher, cfg, audit, metrics, now = () => new Date() }) {
  const nowIso = () => now().toISOString();
  const prazoDias = cfg.prazoInternoPrivacidadeDias ?? 15; // PROVISÓRIO: confirmar com o encarregado

  return {
    async register({ conversaId, titularHash, tipo, descricao, ator = 'agente' }) {
      if (!PRIVACY_TYPES.includes(tipo)) throw Errors.validation('Tipo de solicitação inválido');
      const r = await repo.insertPrivacyRequest({
        id: newId('priv'),
        titular_hash: titularHash,
        conversa_id: conversaId,
        tipo,
        estado: 'aguardando_identificacao',
        descricao_mascarada: descricao ? redactText(String(descricao)).slice(0, 1000) : null,
        prazo_interno: new Date(now().getTime() + prazoDias * 86400000).toISOString(),
        responsavel: null,
        resultado: null,
        criada_em: nowIso(),
        atualizada_em: nowIso(),
        concluida_em: null,
      });
      metrics.inc('solicitacoes_privacidade_total', { tipo });
      await audit({ ator, operacao: 'privacidade.solicitacao_registrada', recurso: r.id, resultado: tipo });
      return { solicitacao_id: r.id, mensagem: { tipo: 'texto', texto: Catalog.privacidadeRecebida(cfg.negocio.canalPrivacidade) } };
    },

    list: (filtro) => repo.listPrivacyRequests(filtro),

    // Localiza os dados mantidos por ESTE sistema para um titular (o PMS tem processo próprio).
    async exportSubject({ telefone, executor, solicitacaoId }) {
      const titularHash = hasher(normalizePhone(telefone));
      const conversas = await repo.findConversationsByTitular(titularHash);
      const out = { gerado_em: nowIso(), observacao: 'Dados de reservas e hóspedes são mantidos no sistema de reservas (PMS) e devem ser solicitados ao responsável por esse sistema.', conversas: [], preferencias: await repo.listPreferencesByTitular(titularHash) };
      for (const c of conversas) {
        const msgs = await repo.listRecentMessages(c.id, 500);
        out.conversas.push({
          id: c.id,
          criada_em: c.criada_em,
          estado: c.estado,
          mensagens: msgs.map((m) => ({ direcao: m.direcao, criado_em: m.criado_em, tipo: m.tipo, conteudo: m.conteudo_cifrado ? crypto.decrypt(m.conteudo_cifrado) : '(conteúdo não retido)' })),
        });
      }
      await audit({ ator: executor, operacao: 'privacidade.exportacao', recurso: solicitacaoId || titularHash.slice(0, 12), resultado: 'ok', detalhes: { conversas: conversas.length } });
      return out;
    },

    // Eliminação/anonimização respeitando bloqueios legais. Registro de opt-out de marketing é mantido
    // (necessário para continuar respeitando a oposição do titular) — documentado no inventário.
    async eliminate({ solicitacaoId, telefone, executor }) {
      const sol = await repo.getPrivacyRequest(solicitacaoId);
      if (!sol || !['eliminacao', 'anonimizacao'].includes(sol.tipo)) throw Errors.validation('Solicitação inexistente ou de tipo incompatível');
      const titularHash = hasher(normalizePhone(telefone));
      if (sol.titular_hash !== titularHash) throw Errors.forbidden('Telefone não corresponde à solicitação');
      const conversas = await repo.findConversationsByTitular(titularHash);
      let anonimizadas = 0;
      let retidas = 0;
      for (const c of conversas) {
        if (c.bloqueio_legal) {
          retidas++;
          continue;
        }
        await repo.anonymizeConversation(c.id, nowIso());
        anonimizadas++;
      }
      const resultado = `anonimizadas=${anonimizadas}; retidas_por_bloqueio_legal=${retidas}`;
      await repo.updatePrivacyRequest(sol.id, { estado: 'concluida', responsavel: executor, resultado, atualizada_em: nowIso(), concluida_em: nowIso() });
      await audit({ ator: executor, operacao: 'privacidade.eliminacao', recurso: sol.id, resultado: 'ok', detalhes: { anonimizadas, retidas } });
      return { anonimizadas, retidas_por_bloqueio_legal: retidas };
    },

    async updateStatus({ solicitacaoId, estado, resultado, executor }) {
      const allowed = ['aguardando_identificacao', 'em_analise', 'concluida', 'indeferida'];
      if (!allowed.includes(estado)) throw Errors.validation('Estado inválido');
      const r = await repo.updatePrivacyRequest(solicitacaoId, { estado, resultado: resultado ? redactText(resultado).slice(0, 500) : null, responsavel: executor, atualizada_em: nowIso(), concluida_em: ['concluida', 'indeferida'].includes(estado) ? nowIso() : null });
      if (!r) throw Errors.notFound('Solicitação');
      await audit({ ator: executor, operacao: 'privacidade.estado_alterado', recurso: solicitacaoId, resultado: estado });
      return r;
    },

    async setLegalHold({ conversaId, ativo, executor, justificativa }) {
      const c = await repo.updateConversation(conversaId, { bloqueio_legal: Boolean(ativo) });
      if (!c) throw Errors.notFound('Conversa');
      await audit({ ator: executor, operacao: 'privacidade.bloqueio_legal', recurso: conversaId, resultado: ativo ? 'ativado' : 'desativado', detalhes: { justificativa: String(justificativa || '').slice(0, 200) } });
      return { conversa_id: conversaId, bloqueio_legal: Boolean(ativo) };
    },
  };
}

export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) throw Errors.validation('Telefone inválido');
  return d;
}
