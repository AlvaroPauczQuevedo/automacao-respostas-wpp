import { newId } from '../util/ids.js';
import { redactText } from '../security/redact.js';

// Monitoramento e recuperação (WF11).
export function createOpsService({ repo, hotel, booking, cfg, metrics, logger, audit, now = () => new Date() }) {
  const nowIso = () => now().toISOString();

  return {
    async reportError({ origem, codigo, workflow, no, mensagem, correlacao }) {
      const rec = {
        id: newId('err'),
        origem: String(origem || 'n8n').slice(0, 40),
        codigo: codigo ? String(codigo).slice(0, 60) : null,
        workflow: workflow ? String(workflow).slice(0, 80) : null,
        no: no ? String(no).slice(0, 80) : null,
        mensagem_mascarada: mensagem ? redactText(String(mensagem)).replace(/(Bearer|token|key|secret)\s*[:=]?\s*\S+/gi, '$1 [REDACTED]').slice(0, 500) : null,
        correlacao: correlacao ? String(correlacao).slice(0, 80) : null,
        instante: nowIso(),
      };
      await repo.insertOpError(rec);
      metrics.inc('erros_operacionais_total', { origem: rec.origem, workflow: rec.workflow || 'n/a' });
      logger.error('erro_operacional_reportado', { origem: rec.origem, workflow: rec.workflow, no: rec.no, codigo: rec.codigo });
      return { id: rec.id };
    },

    async health() {
      const out = { instante: nowIso(), componentes: {} };
      try {
        await repo.ping();
        out.componentes.banco = { ok: true };
      } catch {
        out.componentes.banco = { ok: false };
      }
      out.componentes.integracao_hoteleira = { ...(await hotel.health()), driver: hotel.name, simulado: hotel.simulated };
      out.componentes.whatsapp = { modo: cfg.whatsapp.mode, simulado: cfg.whatsapp.mode !== 'cloud' };
      out.ok = Object.values(out.componentes).every((c) => c.ok !== false);
      metrics.set('componente_disponivel', { componente: 'banco' }, out.componentes.banco.ok ? 1 : 0);
      metrics.set('componente_disponivel', { componente: 'integracao_hoteleira' }, out.componentes.integracao_hoteleira.ok ? 1 : 0);
      return out;
    },

    // Varredura periódica: reconciliação de reservas pendentes, eventos travados, filas acumuladas.
    async sweep() {
      const lease = cfg.limites.lockLeaseMs;
      const staleBefore = new Date(now().getTime() - lease).toISOString();
      const stale = await repo.listStaleEvents(staleBefore);
      const conversas = new Set();
      for (const e of stale) {
        if (e.tentativas >= 3) {
          await repo.updateEvents([e.id], { estado: 'falhou', payload_cifrado: null, atualizado_em: nowIso() });
          continue;
        }
        await repo.updateEvents([e.id], { estado: 'pendente', tentativas: e.tentativas + 1, atualizado_em: nowIso() });
        conversas.add(e.conversa_id);
      }
      const reconciliacao = await booking.reconcilePending({ olderThanMin: cfg.limites.reconciliacaoAposMin });
      const pendRec = (await repo.listActionsByState(['pendente_reconciliacao'], new Date(now().getTime() - 30 * 60000).toISOString())).length;
      const abertas = await repo.listHandoffs({ estado: 'aberta' });
      const antigas = abertas.filter((h) => h.criada_em < new Date(now().getTime() - 30 * 60000).toISOString()).length;
      const erros1h = await repo.countOpErrorsSince(new Date(now().getTime() - 3600000).toISOString());
      metrics.set('atendimentos_abertos', {}, abertas.length);
      metrics.set('operacoes_pendentes_reconciliacao', {}, pendRec);
      const alertas = [];
      if (antigas > 0) alertas.push({ tipo: 'fila_atendimento_acumulada', quantidade: antigas });
      if (pendRec > 0) alertas.push({ tipo: 'operacoes_pendentes_antigas', quantidade: pendRec });
      if (erros1h >= (cfg.alertaErrosPorHora ?? 20)) alertas.push({ tipo: 'taxa_de_erros_elevada', quantidade: erros1h });
      if (stale.length) await audit({ ator: 'job_monitoramento', operacao: 'ops.eventos_reprocessados', recurso: null, resultado: 'ok', detalhes: { quantidade: stale.length } });
      return {
        conversas_para_reprocessar: [...conversas],
        notificacoes_reserva: reconciliacao.filter((r) => r.mensagem && r.conversa_id).map((r, i) => ({ conversa_id: r.conversa_id, chave_deduplicacao: `reconc:${r.reserva_id}:${r.situacao}`, origem: 'sistema', finalidade: 'operacional', mensagem: r.mensagem, indice: i })),
        reconciliacao: reconciliacao.map(({ mensagem, ...rest }) => rest),
        alertas,
      };
    },
  };
}
