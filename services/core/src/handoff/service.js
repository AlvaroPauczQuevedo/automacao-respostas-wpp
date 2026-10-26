import { newId } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { redactText } from '../security/redact.js';
import { assertTransition } from '../conversation/stateMachine.js';
import { Catalog, humanAvailability } from '../whatsapp/catalog.js';

export const HANDOFF_MOTIVOS = [
  'solicitacao_cliente',
  'reclamacao_grave',
  'suspeita_fraude',
  'falha_integracao',
  'divergencia_informacao',
  'situacao_excepcional',
  'disputa_cobranca',
  'decisao_comercial',
  'juridico_privacidade',
  'baixa_confianca',
  'insatisfacao_persistente',
  'verificacao_reforcada',
  'pagamento',
  'configuracao_pendente',
];

const PRIORIDADE = { suspeita_fraude: 'alta', reclamacao_grave: 'alta', disputa_cobranca: 'alta', juridico_privacidade: 'alta', falha_integracao: 'normal' };
const FILA_PADRAO = { juridico_privacidade: 'privacidade', disputa_cobranca: 'financeiro', pagamento: 'financeiro', suspeita_fraude: 'seguranca', reclamacao_grave: 'qualidade' };

export function createHandoffService({ repo, cfg, audit, metrics, now = () => new Date() }) {
  const nowIso = () => now().toISOString();
  const filas = { ...FILA_PADRAO, ...(cfg.filasAtendimento || {}) };

  return {
    async create({ conversaId, motivo, resumo, prioridade, ator = 'agente', correlacao }) {
      if (!HANDOFF_MOTIVOS.includes(motivo)) throw Errors.validation('Motivo de encaminhamento inválido');
      const conversa = await repo.getConversation(conversaId);
      if (!conversa) throw Errors.notFound('Conversa');
      const { solicitacao, criada } = await repo.insertHandoff({
        id: newId('atd'),
        conversa_id: conversaId,
        categoria: motivo,
        motivo,
        prioridade: prioridade || PRIORIDADE[motivo] || 'normal',
        fila: filas[motivo] || 'reservas',
        estado: 'aberta',
        responsavel: null,
        // Resumo operacional sem dados pessoais desnecessários.
        resumo_mascarado: resumo ? redactText(String(resumo)).slice(0, 1000) : null,
        criada_em: nowIso(),
        assumida_em: null,
        encerrada_em: null,
      });
      if (conversa.estado !== 'em_atendimento_humano') {
        assertTransition(conversa.estado, 'em_atendimento_humano');
        await repo.updateConversation(conversaId, { estado: 'em_atendimento_humano', responsavel_atual: `fila:${solicitacao.fila}`, atualizada_em: nowIso() });
      }
      // Ações pendentes de confirmação são canceladas: a equipe humana assume.
      for (const a of await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente'])) {
        await repo.updateAction(a.id, { estado: 'cancelada', resultado_codigo: 'encaminhado', atualizado_em: nowIso() });
      }
      if (criada) {
        metrics.inc('atendimentos_humanos_total', { motivo, fila: solicitacao.fila });
        await audit({ ator, operacao: 'atendimento.encaminhado', recurso: solicitacao.id, resultado: motivo, correlacao });
      }
      const disponibilidade = humanAvailability(cfg.negocio.horarioAtendimento, now());
      return { solicitacao, criada, mensagem: { tipo: 'texto', texto: Catalog.encaminhamento(disponibilidade) } };
    },

    async list({ estado, fila }) {
      const hs = await repo.listHandoffs({ estado, fila });
      return hs.map((h) => ({ id: h.id, conversa_id: h.conversa_id, motivo: h.motivo, prioridade: h.prioridade, fila: h.fila, estado: h.estado, responsavel: h.responsavel, resumo: h.resumo_mascarado, criada_em: h.criada_em }));
    },

    async assign({ id, atendente }) {
      const h = await repo.getHandoff(id);
      if (!h || h.estado === 'encerrada') throw Errors.notFound('Solicitação de atendimento');
      if (h.estado === 'em_atendimento' && h.responsavel !== atendente) throw Errors.conflict('Solicitação já assumida por outro atendente');
      const upd = await repo.updateHandoff(id, { estado: 'em_atendimento', responsavel: atendente, assumida_em: h.assumida_em || nowIso() });
      await repo.updateConversation(h.conversa_id, { responsavel_atual: `humano:${atendente}`, atualizada_em: nowIso() });
      await audit({ ator: atendente, operacao: 'atendimento.assumido', recurso: id, resultado: 'ok' });
      return upd;
    },

    // Encerramento: retoma a automação somente por decisão explícita do atendente.
    async close({ id, atendente, retomarAutomacao }) {
      const h = await repo.getHandoff(id);
      if (!h || h.estado === 'encerrada') throw Errors.notFound('Solicitação de atendimento');
      if (h.responsavel && h.responsavel !== atendente) throw Errors.forbidden('Apenas o responsável pode encerrar este atendimento');
      await repo.updateHandoff(id, { estado: 'encerrada', encerrada_em: nowIso(), responsavel: h.responsavel || atendente });
      const conversa = await repo.getConversation(h.conversa_id);
      const destino = retomarAutomacao ? 'ativa' : 'encerrada';
      assertTransition(conversa.estado, destino, { porAtendente: true });
      await repo.updateConversation(h.conversa_id, { estado: destino, responsavel_atual: 'agente', atualizada_em: nowIso() });
      await audit({ ator: atendente, operacao: 'atendimento.encerrado', recurso: id, resultado: retomarAutomacao ? 'automacao_retomada' : 'conversa_encerrada' });
      metrics.inc('atendimentos_humanos_encerrados_total', {});
      return { conversa_id: h.conversa_id, estado_conversa: destino, mensagem: retomarAutomacao ? { tipo: 'texto', texto: Catalog.retornoAutomacao() } : null };
    },

    async assertAssigned({ id, atendente }) {
      const h = await repo.getHandoff(id);
      if (!h || h.estado !== 'em_atendimento' || h.responsavel !== atendente) throw Errors.forbidden('Atendimento não atribuído a este atendente');
      return h;
    },
  };
}
