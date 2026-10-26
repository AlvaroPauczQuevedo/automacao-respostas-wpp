import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receiveAndBegin, tool, allText, signed, waTextPayload } from './helpers.js';

test('indisponibilidade do PMS: orientação segura; 3 falhas seguidas → encaminhamento automático', async () => {
  const ctx = await makeApp();
  ctx.hotelDriver.setScenario('indisponivel');
  const from = '5511966660001';
  let r;
  let conversaId;
  for (let i = 0; i < 3; i++) {
    const t = await receiveAndBegin(ctx, from, `tem quarto? ${i}`);
    conversaId = t.conversaId;
    r = await tool(ctx, t.turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.erro.codigo, 'INTEGRACAO_INDISPONIVEL');
    assert.match(r.erro.orientacao, /Não informe preços/);
    await ctx.app.turns.reply({ turnoId: t.turn.turno_id, texto: 'No momento não consegui consultar o sistema.' });
  }
  assert.equal(r.encaminhado, true);
  assert.equal((await ctx.app.repo.getConversation(conversaId)).estado, 'em_atendimento_humano');
});

test('timeout do PMS é tratado como indisponibilidade (com retentativa controlada)', async () => {
  const ctx = await makeApp();
  ctx.hotelDriver.setScenario('timeout');
  const t = await receiveAndBegin(ctx, '5511966660002', 'quarto');
  const r = await tool(ctx, t.turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  assert.equal(r.erro.codigo, 'INTEGRACAO_INDISPONIVEL');
  assert.equal(ctx.app.metrics.get('hotel_integracao_chamadas_total', { driver: 'simulado', op: 'disponibilidade', resultado: 'INTEGRACAO_INDISPONIVEL' }), 1);
});

test('indisponibilidade do modelo de IA: n8n chama /falha → resposta de contingência, sem fingir conclusão', async () => {
  const ctx = await makeApp();
  const t = await receiveAndBegin(ctx, '5511966660003', 'quero reservar em SP');
  const out = await ctx.app.turns.fail({ turnoId: t.turn.turno_id, motivo: 'llm_timeout' });
  assert.match(allText(out), /tive um problema técnico/);
  assert.match(allText(out), /"atendente"/);
  const again = await ctx.app.turns.fail({ turnoId: t.turn.turno_id, motivo: 'repetido' });
  assert.equal(again.acao, 'nada_a_fazer');
  // Trava liberada: próxima mensagem é processada
  const t2 = await receiveAndBegin(ctx, '5511966660003', 'tentando de novo');
  assert.equal(t2.turn.acao, 'interpretar');
});

test('indisponibilidade do banco: erro propagado sem dados sensíveis', async () => {
  const ctx = await makeApp();
  ctx.app.repo._failNext(Object.assign(new Error('connection refused postgres://app:SENHA@db/hotel'), { code: 'ECONNREFUSED' }));
  await assert.rejects(ctx.app.inbound.process(signed(waTextPayload('5511966660004', 'oi'))));
  const h = await (async () => {
    ctx.app.repo._failNext(new Error('db down'));
    return ctx.app.ops.health();
  })();
  assert.equal(h.ok, false);
  assert.equal(h.componentes.banco.ok, false);
});

test('mensagens concorrentes do mesmo cliente: uma trava por conversa, nenhuma resposta duplicada', async () => {
  const ctx = await makeApp();
  const from = '5511966660005';
  const payloads = [1, 2, 3, 4, 5].map((i) => waTextPayload(from, `msg ${i}`, { ts: ctx.now().getTime() }));
  const results = await Promise.all(payloads.map((p) => ctx.app.inbound.process(signed(p))));
  const conversaId = results[0].conversas[0];
  const turns = await Promise.all([1, 2, 3].map(() => ctx.app.turns.begin({ conversaId })));
  const ativos = turns.filter((t) => t.acao === 'interpretar' || t.acao === 'responder');
  assert.equal(ativos.length, 1);
  assert.ok(turns.filter((t) => t.acao === 'enfileirado').length === 2);
});

test('rate limit da Cloud API: erro transitório classificado como retentável', async () => {
  const ctx = await makeApp();
  const t = await receiveAndBegin(ctx, '5511966660006', 'oi');
  ctx.waClient.failNext(80007, 10);
  const r = await ctx.app.outbound.send({ conversaId: t.conversaId, mensagem: { tipo: 'texto', texto: 'x' }, finalidade: 'atendimento', origem: 'sistema', chaveDeduplicacao: 'rl1' });
  assert.equal(r.status, 'falhou');
  assert.equal(r.retentavel, true);
});

test('erro de token expirado (190) gera alerta operacional', async () => {
  const ctx = await makeApp();
  const t = await receiveAndBegin(ctx, '5511966660007', 'oi');
  ctx.waClient.failNext(190);
  const r = await ctx.app.outbound.send({ conversaId: t.conversaId, mensagem: { tipo: 'texto', texto: 'x' }, finalidade: 'atendimento', origem: 'sistema', chaveDeduplicacao: 'tk1' });
  assert.equal(r.classe, 'alerta');
  assert.ok(ctx.logs.some((l) => l.msg === 'alerta_conta_whatsapp'));
});

test('varredura sinaliza fila de atendimento acumulada e reprocessa eventos travados no máximo 3 vezes', async () => {
  const ctx = await makeApp();
  const t = await receiveAndBegin(ctx, '5511966660008', 'atendente');
  ctx.now.advance(31 * 60000);
  const sw = await ctx.app.ops.sweep();
  assert.ok(sw.alertas.some((a) => a.tipo === 'fila_atendimento_acumulada'));
  assert.ok(t);
});

test('erro reportado pelo n8n é mascarado antes de ser registrado', async () => {
  const ctx = await makeApp();
  await ctx.app.ops.reportError({ origem: 'n8n', workflow: 'WF03', no: 'Agente', mensagem: 'Falha Bearer sk-ant-abc123 para cliente a@b.com tel 11 98888-7777', codigo: 'X' });
  const rec = ctx.app.repo._tables.erro.at(-1);
  assert.doesNotMatch(rec.mensagem_mascarada, /sk-ant-abc123|a@b\.com|98888/);
});
