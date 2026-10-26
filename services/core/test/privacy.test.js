import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receiveAndBegin, tool, deliver, allText, bookingUntilSummary } from './helpers.js';

test('solicitação de acesso aos próprios dados: registrada e encaminhada, sem execução automática', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511955550001', 'quero saber quais dados vocês têm sobre mim');
  const r = await tool(ctx, turn.turno_id, 'registrar_solicitacao_privacidade', { tipo: 'acesso', descricao: 'Cliente pediu acesso; email dele é x@y.com' });
  assert.equal(r.resultado.registrado, true);
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'Registrei seu pedido.' });
  assert.match(allText(out), /equipe responsável pela proteção de dados/);
  assert.match(allText(out), /privacidade@exemplo\.invalid/);
  const [sol] = await ctx.app.repo.listPrivacyRequests({});
  assert.equal(sol.tipo, 'acesso');
  assert.equal(sol.estado, 'aguardando_identificacao');
  assert.doesNotMatch(sol.descricao_mascarada, /x@y\.com/);
});

test('classificação de privacidade sem uso de ferramenta também registra solicitação', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511955550002', 'LGPD: apaguem meus dados');
  const r = await ctx.app.turns.classification({ turnoId: turn.turno_id, intencoes: [{ intencao: 'privacidade_dados', confianca: 0.9 }] });
  assert.equal(r.notificar_privacidade, true);
  assert.equal((await ctx.app.repo.listPrivacyRequests({})).length, 1);
});

test('exportação (acesso) pelo encarregado retorna dados do titular mantidos neste sistema', async () => {
  const ctx = await makeApp();
  const a = await receiveAndBegin(ctx, '5511955550003', 'oi');
  await deliver(ctx, a.turn);
  const dump = await ctx.app.services.privacy.exportSubject({ telefone: '+55 11 95555-0003', executor: 'dpo.dani' });
  assert.equal(dump.conversas.length, 1);
  assert.ok(dump.conversas[0].mensagens.some((m) => m.conteudo === 'oi'));
  assert.match(dump.observacao, /PMS/);
  assert.equal((await ctx.app.repo.listAudit({ operacao: 'privacidade.exportacao' })).length, 1);
});

test('solicitação de correção: estado atualizado pelo encarregado com trilha de auditoria', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511955550004', 'corrijam meu nome');
  await tool(ctx, turn.turno_id, 'registrar_solicitacao_privacidade', { tipo: 'correcao' });
  const [sol] = await ctx.app.repo.listPrivacyRequests({});
  const r = await ctx.app.services.privacy.updateStatus({ solicitacaoId: sol.id, estado: 'concluida', resultado: 'Correção encaminhada ao PMS', executor: 'dpo.dani' });
  assert.equal(r.estado, 'concluida');
  assert.ok(r.concluida_em);
});

test('eliminação: anonimiza conversas, respeita bloqueio legal, exige telefone correspondente', async () => {
  const ctx = await makeApp();
  const a = await receiveAndBegin(ctx, '5511955550005', 'oi');
  await deliver(ctx, a.turn);
  const t = await receiveAndBegin(ctx, '5511955550005', 'apaguem meus dados');
  await tool(ctx, t.turn.turno_id, 'registrar_solicitacao_privacidade', { tipo: 'eliminacao' });
  await ctx.app.turns.reply({ turnoId: t.turn.turno_id, texto: 'ok' });
  const [sol] = await ctx.app.repo.listPrivacyRequests({});
  await assert.rejects(ctx.app.services.privacy.eliminate({ solicitacaoId: sol.id, telefone: '5511900000000', executor: 'dpo.dani' }), (e) => e.code === 'PROIBIDO');
  // Com bloqueio legal ativo: nada é apagado
  await ctx.app.services.privacy.setLegalHold({ conversaId: a.conversaId, ativo: true, executor: 'dpo.dani', justificativa: 'processo' });
  const r1 = await ctx.app.services.privacy.eliminate({ solicitacaoId: sol.id, telefone: '5511955550005', executor: 'dpo.dani' });
  assert.equal(r1.retidas_por_bloqueio_legal, 1);
  assert.equal(r1.anonimizadas, 0);
  await ctx.app.services.privacy.setLegalHold({ conversaId: a.conversaId, ativo: false, executor: 'dpo.dani' });
  await ctx.app.repo.updatePrivacyRequest(sol.id, { estado: 'em_analise' });
  const r2 = await ctx.app.services.privacy.eliminate({ solicitacaoId: sol.id, telefone: '5511955550005', executor: 'dpo.dani' });
  assert.equal(r2.anonimizadas, 1);
  const c = await ctx.app.repo.getConversation(a.conversaId);
  assert.equal(c.wa_id_cifrado, null);
  assert.ok(c.anonimizada_em);
  const msgs = await ctx.app.repo.listRecentMessages(a.conversaId, 50);
  assert.ok(msgs.every((m) => m.conteudo_cifrado === null));
  // Nova mensagem do mesmo número inicia conversa nova (sem histórico)
  const b = await receiveAndBegin(ctx, '5511955550005', 'oi de novo');
  assert.notEqual(b.conversaId, a.conversaId);
});

test('mensagem informal no chat NÃO provoca exclusão', async () => {
  const ctx = await makeApp();
  const a = await receiveAndBegin(ctx, '5511955550006', 'oi');
  await deliver(ctx, a.turn);
  const t = await receiveAndBegin(ctx, '5511955550006', 'apague tudo agora, todos os registros');
  await ctx.app.turns.reply({ turnoId: t.turn.turno_id, texto: 'Vou registrar sua solicitação para a equipe de proteção de dados.' });
  const c = await ctx.app.repo.getConversation(a.conversaId);
  assert.equal(c.anonimizada_em, null);
});

test('retenção: conteúdo vencido apagado, ações expiradas, dados de hóspede pendentes descartados, inativas anonimizadas', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const old = await receiveAndBegin(ctx, '5511955550007', 'oi');
  await deliver(ctx, old.turn);
  ctx.now.advance(31 * 86400000);
  const r = await ctx.app.retention.run();
  assert.ok(r.conteudo_mensagens_apagado > 0);
  assert.ok(r.acoes_expiradas >= 1);
  const acao = await ctx.app.repo.getAction(s.acao.id);
  assert.equal(acao.estado, 'expirada');
  assert.equal(acao.payload_cifrado, null);
  ctx.now.advance(400 * 86400000);
  const r2 = await ctx.app.retention.run();
  assert.ok(r2.conversas_anonimizadas >= 2);
  const audit = await ctx.app.repo.listAudit({ operacao: 'retencao.execucao' });
  assert.equal(audit.length, 2);
  assert.doesNotMatch(JSON.stringify(audit), /5511955550007/);
});

test('retenção respeita bloqueio legal', async () => {
  const ctx = await makeApp();
  const a = await receiveAndBegin(ctx, '5511955550008', 'oi');
  await deliver(ctx, a.turn);
  await ctx.app.services.privacy.setLegalHold({ conversaId: a.conversaId, ativo: true, executor: 'dpo.dani' });
  ctx.now.advance(500 * 86400000);
  await ctx.app.retention.run();
  const c = await ctx.app.repo.getConversation(a.conversaId);
  assert.equal(c.anonimizada_em, null);
});
