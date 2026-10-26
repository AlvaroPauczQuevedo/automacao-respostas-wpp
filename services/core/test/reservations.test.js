import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receiveAndBegin, tool, pressButton, allText } from './helpers.js';

function seed(ctx, over = {}) {
  ctx.hotelDriver.seedBooking({
    codigo_confirmacao: 'SIM-ABC123',
    hotel_codigo: 'SIM-SP-01',
    entrada: '2026-12-20',
    saida: '2026-12-22',
    status: 'confirmada',
    acomodacao_nome: 'Standard (SIMULADO)',
    quantidade_hospedes: 2,
    titular_sobrenome: 'Sintético',
    contato_verificacao_email: 'titular@exemplo.invalid',
    valor_total: '640.00',
    moeda: 'BRL',
    politica_cancelamento: 'SIMULADO',
    ...over,
  });
}

test('consulta de reserva exige verificação (código + sobrenome + data); telefone sozinho não basta', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const { turn } = await receiveAndBegin(ctx, '5511933330001', 'quero ver minha reserva SIM-ABC123');
  const sem = await tool(ctx, turn.turno_id, 'consultar_reserva', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(sem.erro.codigo, 'PROIBIDO');
  const v = await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'sim-abc123', sobrenome: 'sintetico', data_entrada: '2026-12-20' });
  assert.equal(v.resultado.verificado, true);
  const c = await tool(ctx, turn.turno_id, 'consultar_reserva', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(c.ok, true);
  assert.equal(c.resultado.hotel, 'Hotel Exemplo Centro (SIMULADO)');
  // Não expõe contato, documentos, acompanhantes
  assert.equal(JSON.stringify(c.resultado).includes('titular@'), false);
  assert.equal(c.resultado.titular_sobrenome, undefined);
});

test('tentativa de acessar reserva de terceiro: resposta genérica, sem revelar existência', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const { turn } = await receiveAndBegin(ctx, '5511933330002', 'reserva SIM-ABC123');
  const errado = await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Outro', data_entrada: '2026-12-20' });
  const inexistente = await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ZZZ999', sobrenome: 'Outro', data_entrada: '2026-12-20' });
  assert.equal(errado.resultado.verificado, false);
  assert.equal(inexistente.resultado.verificado, false);
  // Mesmo formato de resposta nos dois casos (sem oráculo de existência)
  assert.deepEqual(Object.keys(errado.resultado).sort(), Object.keys(inexistente.resultado).sort());
  const c = await tool(ctx, turn.turno_id, 'consultar_reserva', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(c.erro.codigo, 'PROIBIDO');
});

test('enumeração de reservas é bloqueada após o limite de tentativas (inclusive trocando de conversa no mesmo número)', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const from = '5511933330003';
  let r;
  for (let i = 0; i < 4; i++) {
    const { turn } = await receiveAndBegin(ctx, from, `tentativa ${i}`);
    r = await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: `SIM-00000${i}`, sobrenome: 'Chute', data_entrada: '2026-12-20' });
    await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'Não consegui verificar.' });
  }
  assert.equal(r.resultado.bloqueado, true);
  // Mesmo com dados corretos, segue bloqueado na janela
  const { turn } = await receiveAndBegin(ctx, from, 'agora certo');
  const ok = await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Sintético', data_entrada: '2026-12-20' });
  assert.equal(ok.resultado.bloqueado, true);
  assert.ok((await ctx.app.repo.listAudit({ operacao: 'reserva.verificacao_bloqueada' })).length >= 1);
});

test('verificação é vinculada à conversa: outra conversa não herda a autorização', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const a = await receiveAndBegin(ctx, '5511933330004', 'reserva');
  await tool(ctx, a.turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Sintético', data_entrada: '2026-12-20' });
  const b = await receiveAndBegin(ctx, '5511933330005', 'reserva SIM-ABC123');
  const c = await tool(ctx, b.turn.turno_id, 'consultar_reserva', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(c.erro.codigo, 'PROIBIDO');
});

test('verificação expira', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const from = '5511933330006';
  const a = await receiveAndBegin(ctx, from, 'reserva');
  await tool(ctx, a.turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Sintético', data_entrada: '2026-12-20' });
  await ctx.app.turns.reply({ turnoId: a.turn.turno_id, texto: 'ok' });
  ctx.now.advance(31 * 60000);
  const b = await receiveAndBegin(ctx, from, 'e a reserva?');
  const c = await tool(ctx, b.turn.turno_id, 'consultar_reserva', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(c.erro.codigo, 'PROIBIDO');
});

test('conhecer o código não permite cancelar: modo padrão encaminha para atendente', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const { turn, conversaId } = await receiveAndBegin(ctx, '5511933330007', 'cancelar SIM-ABC123');
  const semVerif = await tool(ctx, turn.turno_id, 'solicitar_cancelamento', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(semVerif.erro.codigo, 'PROIBIDO');
  await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Sintético', data_entrada: '2026-12-20' });
  const r = await tool(ctx, turn.turno_id, 'solicitar_cancelamento', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(r.resultado.encaminhado, true);
  assert.equal((await ctx.app.repo.getConversation(conversaId)).estado, 'em_atendimento_humano');
  assert.equal(ctx.hotelDriver._bookings.get('SIM-ABC123').status, 'confirmada');
});

async function strongVerified(ctx, from, entrada = '2026-12-20') {
  const { turn, conversaId } = await receiveAndBegin(ctx, from, 'quero cancelar SIM-ABC123');
  await tool(ctx, turn.turno_id, 'verificar_titular_reserva', { codigo_reserva: 'SIM-ABC123', sobrenome: 'Sintético', data_entrada: entrada });
  const r = await tool(ctx, turn.turno_id, 'solicitar_cancelamento', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(r.resultado.situacao, 'verificacao_enviada');
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'ignorado' });
  assert.match(allText(out), /link de confirmação para o e-mail cadastrado/);
  assert.doesNotMatch(allText(out), /titular@/); // e-mail não aparece no chat
  const link = ctx.notifier.sent.at(-1).link;
  assert.equal(ctx.notifier.sent.at(-1).to, 'titular@exemplo.invalid');
  const token = link.split('/').pop();
  assert.equal((await ctx.app.services.reservations.confirmStrongLink(token)).ok, true);
  assert.equal((await ctx.app.services.reservations.confirmStrongLink(token)).ok, false); // uso único
  return { conversaId };
}

test('cancelamento sujeito a multa: verificação reforçada por link, multa do sistema oficial e confirmação explícita', async () => {
  const ctx = await makeApp({ negocio: { verificacaoReforcadaModo: 'link_email' } });
  seed(ctx, { entrada: '2026-11-03', saida: '2026-11-05' }); // < 48h → multa
  const from = '5511933330008';
  await strongVerified(ctx, from, '2026-11-03');
  const { turn, conversaId } = await receiveAndBegin(ctx, from, 'pronto, confirmei no e-mail');
  const r = await tool(ctx, turn.turno_id, 'solicitar_cancelamento', { codigo_reserva: 'SIM-ABC123' });
  assert.equal(r.resultado.situacao, 'aguardando_confirmacao_cliente');
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'x' });
  assert.match(allText(out), /haverá multa de R\$\s?320,00/);
  assert.equal(ctx.hotelDriver._bookings.get('SIM-ABC123').status, 'confirmada'); // nada cancelado ainda
  const acao = (await ctx.app.repo.listActions(conversaId, ['aguardando_cliente']))[0];
  const b = await pressButton(ctx, from, `acao:${acao.id}:confirmar`);
  assert.match(allText(b.turn), /confirmou o cancelamento/);
  assert.equal(ctx.hotelDriver._bookings.get('SIM-ABC123').status, 'cancelada');
});

test('pedido de informação sobre cancelamento não cancela nada', async () => {
  const ctx = await makeApp();
  seed(ctx);
  const { turn } = await receiveAndBegin(ctx, '5511933330009', 'qual a política de cancelamento?');
  const p = await tool(ctx, turn.turno_id, 'consultar_politicas', { categoria: 'cancelamento' });
  assert.equal(p.resultado.politicas[0].abrangencia, 'rede');
  assert.equal(ctx.hotelDriver._bookings.get('SIM-ABC123').status, 'confirmada');
});

test('cancelamento com sistema indisponível na execução → pendente e encaminhado; nunca "cancelada"', async () => {
  const ctx = await makeApp({ negocio: { verificacaoReforcadaModo: 'link_email' } });
  seed(ctx);
  const from = '5511933330010';
  await strongVerified(ctx, from);
  const { turn, conversaId } = await receiveAndBegin(ctx, from, 'ok');
  await tool(ctx, turn.turno_id, 'solicitar_cancelamento', { codigo_reserva: 'SIM-ABC123' });
  await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'x' });
  const acao = (await ctx.app.repo.listActions(conversaId, ['aguardando_cliente']))[0];
  ctx.hotelDriver.setScenario('indisponivel');
  const b = await pressButton(ctx, from, `acao:${acao.id}:confirmar`);
  assert.match(allText(b.turn), /NÃO deve ser considerada cancelada/);
  assert.match(allText(b.turn), /encaminhar sua solicitação/);
  assert.equal((await ctx.app.repo.getConversation(conversaId)).estado, 'em_atendimento_humano');
});

test('solicitação de alteração não permitida pela tarifa', async () => {
  const ctx = await makeApp({ negocio: { verificacaoReforcadaModo: 'link_email' } });
  seed(ctx, { hotel_codigo: 'SIM-GRA-01', acomodacao_nome: 'Chalé (SIMULADO)' });
  const from = '5511933330011';
  await strongVerified(ctx, from);
  const { turn } = await receiveAndBegin(ctx, from, 'quero mudar as datas para 21 a 23');
  const r = await tool(ctx, turn.turno_id, 'alterar_reserva', { codigo_reserva: 'SIM-ABC123', nova_entrada: '2026-12-21', nova_saida: '2026-12-23' });
  assert.equal(r.resultado.situacao, 'nao_permitido');
  assert.match(r.resultado.motivo, /não permitida/);
});

test('alteração permitida: diferença tarifária do sistema oficial e confirmação', async () => {
  const ctx = await makeApp({ negocio: { verificacaoReforcadaModo: 'link_email' } });
  seed(ctx);
  const from = '5511933330012';
  await strongVerified(ctx, from);
  const { turn, conversaId } = await receiveAndBegin(ctx, from, 'mudar para 21 a 24');
  const r = await tool(ctx, turn.turno_id, 'alterar_reserva', { codigo_reserva: 'SIM-ABC123', nova_entrada: '2026-12-21', nova_saida: '2026-12-24' });
  assert.equal(r.resultado.situacao, 'aguardando_confirmacao_cliente');
  await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: 'x' });
  const acao = (await ctx.app.repo.listActions(conversaId, ['aguardando_cliente']))[0];
  const b = await pressButton(ctx, from, `acao:${acao.id}:confirmar`);
  assert.match(allText(b.turn), /confirmou a alteração/);
  assert.equal(ctx.hotelDriver._bookings.get('SIM-ABC123').entrada, '2026-12-21');
});
