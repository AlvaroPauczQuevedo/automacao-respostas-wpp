// Retenção e descarte (WF12). Prazos vêm da configuração e são PROVISÓRIOS até aprovação formal.
// Registros com bloqueio legal são preservados. O resultado registra apenas contagens.
export function createRetentionJob({ repo, cfg, audit, metrics, logger, now = () => new Date() }) {
  return {
    async run({ executor = 'job_retencao' } = {}) {
      const n = now();
      const iso = n.toISOString();
      const daysAgo = (d) => new Date(n.getTime() - d * 86400000).toISOString();
      const R = cfg.retencao;
      const res = {};
      res.conteudo_mensagens_apagado = await repo.purgeMessageContent(iso);
      res.mensagens_metadados_removidas = await repo.deleteMessagesBefore(daysAgo(R.metadadosMensagensDias));
      res.eventos_removidos = await repo.deleteEventsBefore(daysAgo(R.eventosEntradaDias));
      res.acoes_expiradas = await repo.expireActions(iso);
      res.dados_hospede_pendentes_apagados = await repo.purgeActionPayloads(new Date(n.getTime() - R.dadosHospedePendentesHoras * 3600000).toISOString());
      res.contadores_removidos = await repo.deleteExpiredCounters(iso);
      res.cotacoes_removidas = await repo.deleteQuotesBefore(daysAgo(R.cotacoesDias));
      const inativas = await repo.listInactiveConversations(daysAgo(R.conversasInativasDias));
      for (const id of inativas) await repo.anonymizeConversation(id, iso);
      res.conversas_anonimizadas = inativas.length;
      for (const [k, v] of Object.entries(res)) metrics.inc('retencao_registros_total', { tipo: k }, v);
      await audit({ ator: executor, operacao: 'retencao.execucao', recurso: null, resultado: 'ok', detalhes: res });
      logger.info('retencao_executada', res);
      return res;
    },
  };
}
