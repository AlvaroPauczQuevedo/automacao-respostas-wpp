import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receive, receiveAndBegin, deliver, allText, signed, waMediaPayload, tool } from './helpers.js';

test('cliente inicia conversa com saudação: resposta determinística identifica assistente virtual', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511911110001', 'Oi');
  assert.equal(turn.acao, 'responder');
  assert.equal(turn.mensagens.length, 1);
  assert.match(turn.mensagens[0].mensagem.texto, /assistente virtual automatizado — não sou uma pessoa/);
  assert.match(turn.mensagens[0].mensagem.texto, /Rede Exemplo \(SIMULADA\)/);
  assert.match(turn.mensagens[0].mensagem.texto, /"atendente"/);
  const sent = await deliver(ctx, turn);
  assert.equal(sent[0].status, 'enviada');
});

test('nome da rede não configurado → saudação neutra (sem inventar)', async () => {
  const ctx = await makeApp({ negocio: { nomeRede: null } });
  const { turn } = await receiveAndBegin(ctx, '5511911110002', 'Bom dia');
  assert.match(turn.mensagens[0].mensagem.texto, /da nossa rede de hotéis/);
});

test('pergunta genérica na primeira mensagem → saudação + interpretação pela IA com contexto mínimo', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511911110003', 'Vocês têm hotel em Gramado?');
  assert.equal(turn.acao, 'interpretar');
  assert.equal(turn.contexto.saudacao_ja_enviada, true);
  assert.equal(turn.contexto.data_hoje, '2026-11-02');
  assert.equal(turn.mensagem_cliente, 'Vocês têm hotel em Gramado?');
  const c = await ctx.app.turns.classification({ turnoId: turn.turno_id, intencoes: [{ intencao: 'busca_hoteis_cidade', confianca: 0.9 }] });
  assert.equal(c.acao, 'invocar_agente');
  const h = await tool(ctx, turn.turno_id, 'buscar_hoteis_por_cidade', { cidade: 'Gramado' });
  assert.equal(h.resultado.encontrados, 1);
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'Sim! Temos a Pousada Exemplo Serra em Gramado.' });
  assert.equal(out.mensagens.length, 2); // saudação + resposta
  assert.equal(out.mensagens[1].origem, 'agente');
});

test('dados incompletos: contexto preserva o que já foi informado (atualizar_contexto)', async () => {
  const ctx = await makeApp();
  const from = '5511911110004';
  const a = await receiveAndBegin(ctx, from, 'Quero ir para Florianópolis');
  await tool(ctx, a.turn.turno_id, 'atualizar_contexto', { destino: 'Florianópolis' });
  await deliver(ctx, await ctx.app.turns.reply({ turnoId: a.turn.turno_id, texto: 'Ótimo! Quais as datas de entrada e saída?' }));
  const b = await receiveAndBegin(ctx, from, 'de 20 a 23 de dezembro');
  assert.deepEqual(b.turn.contexto.dados_ja_informados, { destino: 'Florianópolis' });
  assert.equal(b.turn.contexto.historico.length, 3); // cliente, saudação, resposta
  assert.equal(b.turn.contexto.historico[0].autor, 'cliente');
  assert.equal(b.turn.contexto.historico.at(-1).texto, 'Ótimo! Quais as datas de entrada e saída?');
});

test('mensagens consecutivas são agregadas em um único turno; concorrência respeita a trava', async () => {
  const ctx = await makeApp();
  const from = '5511911110005';
  const r1 = await receive(ctx, from, 'Olá');
  await ctx.app.turns.begin({ conversaId: r1.conversas[0] }).then((t) => deliver(ctx, t));
  await receive(ctx, from, 'quero um quarto');
  await receive(ctx, from, 'em São Paulo');
  const t = await ctx.app.turns.begin({ conversaId: r1.conversas[0] });
  assert.equal(t.acao, 'interpretar');
  assert.equal(t.mensagem_cliente, 'quero um quarto\nem São Paulo');
  // Nova mensagem chega durante o processamento → enfileirada
  await receive(ctx, from, 'para 2 pessoas');
  const concorrente = await ctx.app.turns.begin({ conversaId: r1.conversas[0] });
  assert.equal(concorrente.acao, 'enfileirado');
  const fim = await ctx.app.turns.reply({ turnoId: t.turno_id, texto: 'Quais datas?' });
  assert.equal(fim.ha_pendentes, true); // WF02 processa o próximo turno
  const prox = await ctx.app.turns.begin({ conversaId: r1.conversas[0] });
  assert.equal(prox.mensagem_cliente, 'para 2 pessoas');
});

test('cliente solicita atendimento humano (determinístico, sem depender da IA)', async () => {
  const ctx = await makeApp();
  const { turn, conversaId } = await receiveAndBegin(ctx, '5511911110006', 'quero falar com um atendente');
  assert.equal(turn.acao, 'responder');
  assert.equal(turn.notificar_equipe, true);
  assert.match(allText(turn), /encaminhar sua solicitação para nossa equipe/);
  assert.doesNotMatch(allText(turn), /minutos|horas|prazo/i); // nunca inventa prazo
  const conv = await ctx.app.repo.getConversation(conversaId);
  assert.equal(conv.estado, 'em_atendimento_humano');
  const sent = await deliver(ctx, turn);
  assert.ok(sent.every((s) => s.status === 'enviada')); // mensagem de sistema da transferência é permitida
});

test('com horário configurado e fora do expediente, informa o horário real (sem prazo inventado)', async () => {
  const ctx = await makeApp({ negocio: { horarioAtendimento: { fuso: 'America/Sao_Paulo', descricao: 'de segunda a sexta, das 8h às 18h', dias: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'] } } } });
  ctx.now.set('2026-11-07T15:00:00.000Z'); // sábado
  const { turn } = await receiveAndBegin(ctx, '5511911110007', 'atendente por favor');
  assert.match(allText(turn), /de segunda a sexta, das 8h às 18h/);
});

test('em atendimento humano a automação fica em silêncio e não envia respostas', async () => {
  const ctx = await makeApp();
  const from = '5511911110008';
  const a = await receiveAndBegin(ctx, from, 'atendente');
  await deliver(ctx, a.turn);
  const b = await receiveAndBegin(ctx, from, 'qual o preço?');
  assert.equal(b.turn.acao, 'silencio');
  assert.equal(b.turn.mensagens.length, 0);
  assert.equal(b.turn.notificar_equipe, true);
  // tentativa de a IA enviar algo é bloqueada pela política
  const r = await ctx.app.outbound.send({ conversaId: a.conversaId, mensagem: { tipo: 'texto', texto: 'oi' }, finalidade: 'atendimento', origem: 'agente', chaveDeduplicacao: 'x1' });
  assert.equal(r.status, 'bloqueada');
  assert.equal(r.motivo, 'conversa_em_atendimento_humano');
});

test('atendente assume, responde e devolve a conversa para a automação', async () => {
  const ctx = await makeApp();
  const a = await receiveAndBegin(ctx, '5511911110009', 'atendente');
  const h = await ctx.app.repo.getOpenHandoffByConversation(a.conversaId);
  await ctx.app.services.handoff.assign({ id: h.id, atendente: 'atendente.ana' });
  await assert.rejects(ctx.app.services.handoff.assign({ id: h.id, atendente: 'atendente.bruno' }), /já assumida/);
  await assert.rejects(ctx.app.services.handoff.close({ id: h.id, atendente: 'atendente.bruno', retomarAutomacao: true }), /Apenas o responsável/);
  const fim = await ctx.app.services.handoff.close({ id: h.id, atendente: 'atendente.ana', retomarAutomacao: true });
  assert.equal(fim.estado_conversa, 'ativa');
  const b = await receiveAndBegin(ctx, '5511911110009', 'obrigado, e o café da manhã?');
  assert.equal(b.turn.acao, 'interpretar');
});

test('fluxo automatizado não consegue tirar a conversa do atendimento humano', async () => {
  const { canTransition } = await import('../src/conversation/stateMachine.js');
  assert.equal(canTransition('em_atendimento_humano', 'ativa'), false);
  assert.equal(canTransition('em_atendimento_humano', 'ativa', { porAtendente: true }), true);
});

test('mensagem ambígua repetida → após 3 turnos sem intenção, encaminha (confiança insuficiente)', async () => {
  const ctx = await makeApp();
  const from = '5511911110010';
  let last;
  for (let i = 0; i < 3; i++) {
    const { turn } = await receiveAndBegin(ctx, from, `hmm ${i}`);
    last = await ctx.app.turns.classification({ turnoId: turn.turno_id, intencoes: [{ intencao: 'sem_intencao_identificada', confianca: 0.3 }] });
    if (last.acao === 'invocar_agente') await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'Pode me explicar melhor como posso ajudar?' });
  }
  assert.equal(last.acao, 'responder');
  assert.equal(last.notificar_equipe, true);
});

test('múltiplas intenções: principal atendida e demais ficam pendentes no contexto', async () => {
  const ctx = await makeApp();
  const from = '5511911110011';
  const a = await receiveAndBegin(ctx, from, 'quero saber de check-in e também reservar');
  await ctx.app.turns.classification({ turnoId: a.turn.turno_id, intencoes: [{ intencao: 'checkin_checkout', confianca: 0.9 }, { intencao: 'nova_reserva', confianca: 0.8 }] });
  await ctx.app.turns.reply({ turnoId: a.turn.turno_id, texto: 'O check-in é às 14h. Vamos à reserva?' });
  const b = await receiveAndBegin(ctx, from, 'sim');
  assert.deepEqual(b.turn.contexto.intencoes_pendentes, ['nova_reserva']);
});

test('mídia não suportada (áudio/documento) recebe orientação e não é processada', async () => {
  const ctx = await makeApp();
  const r = await ctx.app.inbound.process(signed(waMediaPayload('5511911110012', 'document', { ts: ctx.now().getTime() })));
  const t = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  assert.match(allText(t), /apenas mensagens de texto/);
});

test('opt-out de marketing por palavra-chave é registrado sem IA', async () => {
  const ctx = await makeApp();
  const from = '5511911110013';
  const a = await receiveAndBegin(ctx, from, 'oi');
  await deliver(ctx, a.turn);
  const b = await receiveAndBegin(ctx, from, 'PARAR');
  assert.match(allText(b.turn), /não receberá mais mensagens promocionais/);
  const conv = await ctx.app.repo.getConversation(a.conversaId);
  const pref = await ctx.app.repo.getPreference(conv.titular_hash, 'marketing');
  assert.equal(pref.estado, 'revogada');
});

test('recuperação após reinício: eventos presos em processamento são reenfileirados pela varredura', async () => {
  const ctx = await makeApp();
  const from = '5511911110014';
  const r = await receive(ctx, from, 'quero um quarto em SP');
  const t = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  assert.equal(t.acao, 'interpretar');
  // "processo caiu": nenhum reply/fail. Lease expira.
  ctx.now.advance(5 * 60000);
  const sw = await ctx.app.ops.sweep();
  assert.deepEqual(sw.conversas_para_reprocessar, [r.conversas[0]]);
  const t2 = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  assert.equal(t2.acao, 'interpretar');
  assert.equal(t2.mensagem_cliente, 'quero um quarto em SP');
});

test('mensagem longa é truncada e o cliente é avisado', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511911110015', 'a'.repeat(5000));
  assert.equal(turn.mensagem_cliente.length, 2000);
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'Como posso ajudar?' });
  assert.match(allText(out), /considerei apenas os primeiros 2000 caracteres/);
});
