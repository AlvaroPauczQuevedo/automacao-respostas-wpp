import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receiveAndBegin, tool, deliver, bookingUntilSummary, pressButton, allText, lastSent } from './helpers.js';

test('hotel com disponibilidade: opções oficiais com cotacao_id, total e média por diária', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511900000010', 'Tem quarto em São Paulo de 10 a 12/12 para 2 adultos?');
  assert.equal(turn.acao, 'interpretar');
  const r = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  assert.equal(r.ok, true);
  assert.ok(r.resultado.opcoes.length >= 1);
  const o = r.resultado.opcoes[0];
  assert.match(o.cotacao_id, /^cot_/);
  assert.equal(o.noites, 2);
  assert.equal(o.moeda, 'BRL');
  assert.equal(o.tarifa_definitiva, false);
  assert.match(o.aviso, /SIMULADA/);
  assert.equal(Number(o.valor_medio_diaria) * 2, Number(o.valor_total));
});

test('consulta por cidade agrega hotéis da cidade', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511900000011', 'Opções em Florianópolis?');
  const r = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { cidade: 'florianopolis', entrada: '2026-12-10', saida: '2026-12-13', adultos: 2, criancas_idades: [4] });
  assert.equal(r.ok, true);
  assert.ok(r.resultado.opcoes.every((o) => o.cidade === 'Florianópolis'));
});

test('hotel sem disponibilidade', async () => {
  const ctx = await makeApp();
  ctx.hotelDriver.setScenario('sem_disponibilidade');
  const { turn } = await receiveAndBegin(ctx, '5511900000012', 'Quarto em SP?');
  const r = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.resultado.sem_disponibilidade, true);
  assert.equal(r.resultado.opcoes.length, 0);
});

test('validações de datas e ocupação (saída antes da entrada, passado, capacidade)', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511900000013', 'reserva');
  const r1 = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-12', saida: '2026-12-10', adultos: 2 });
  assert.equal(r1.ok, false);
  assert.equal(r1.erro.codigo, 'VALIDACAO');
  assert.ok(r1.erro.detalhes.problemas.includes('saida_deve_ser_posterior_a_entrada'));
  const r2 = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-10-01', saida: '2026-10-03', adultos: 2 });
  assert.ok(r2.erro.detalhes.problemas.includes('data_entrada_no_passado'));
  const r3 = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-11', adultos: 1, quartos: 2 });
  assert.ok(r3.erro.detalhes.problemas.includes('cada_quarto_requer_um_adulto'));
  const r4 = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '10/12/2026', saida: '2026-12-11', adultos: 1 });
  assert.equal(r4.erro.codigo, 'VALIDACAO'); // formato rejeitado pelo esquema da ferramenta
});

test('fluxo completo: resumo determinístico com botões e reserva somente após clique do cliente', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  assert.equal(s.ini.ok, true);
  assert.deepEqual(s.ini.resultado.campos_obrigatorios, ['nome', 'sobrenome', 'email']);
  assert.equal(s.ini.resultado.aviso_privacidade_url, 'https://exemplo.invalid/privacidade');
  assert.equal(s.conf.resultado.situacao, 'aguardando_confirmacao_cliente');
  // texto livre da IA descartado; somente o resumo oficial foi enviado
  assert.equal(s.t2.mensagens.length, 1);
  assert.equal(s.t2.mensagens[0].mensagem.tipo, 'botoes');
  assert.match(s.t2.mensagens[0].mensagem.texto, /Valor total/);
  assert.match(s.t2.mensagens[0].mensagem.texto, /Aviso de privacidade/);
  assert.equal(lastSent(ctx).payload.type, 'interactive');
  // Ainda nada foi reservado
  assert.equal(ctx.hotelDriver._bookings.size, 0);
  const conv = await ctx.app.repo.getConversation(s.conversaId);
  assert.equal(conv.estado, 'aguardando_confirmacao');

  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.equal(b.turn.acao, 'responder');
  assert.match(allText(b.turn), /Reserva confirmada pelo sistema do hotel/);
  assert.match(allText(b.turn), /Código da reserva: SIM-/);
  assert.equal(ctx.hotelDriver._bookings.size, 1);
  const res = [...ctx.app.repo._tables.reserva.values()][0];
  assert.equal(res.estado, 'confirmada');
  // dados do hóspede apagados da ação após conclusão
  const acao = await ctx.app.repo.getAction(s.acao.id);
  assert.equal(acao.payload_cifrado, null);
  assert.equal(acao.estado, 'concluida');
});

test('a IA não consegue confirmar reserva: não há ferramenta para isso', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const { turn } = await receiveAndBegin(ctx, s.from, 'sim, pode confirmar');
  const r = await tool(ctx, turn.turno_id, 'confirmar_reserva', { cotacao_id: s.opcao.cotacao_id }).catch((e) => e);
  assert.equal(r.code, 'PROIBIDO');
  assert.equal(ctx.hotelDriver._bookings.size, 0);
});

test('manifestação genérica ("pode ser") não confirma; "CONFIRMAR" digitado confirma', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const a = await receiveAndBegin(ctx, s.from, 'pode ser');
  assert.equal(a.turn.acao, 'interpretar');
  await ctx.app.turns.reply({ turnoId: a.turn.turno_id, texto: 'Para confirmar, toque no botão do resumo.' });
  assert.equal(ctx.hotelDriver._bookings.size, 0);
  const b = await receiveAndBegin(ctx, s.from, 'CONFIRMAR');
  assert.equal(b.turn.acao, 'responder');
  assert.match(allText(b.turn), /Reserva confirmada/);
  assert.equal(ctx.hotelDriver._bookings.size, 1);
});

test('reserva duplicada: dois cliques/eventos de confirmação criam uma única reserva', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const b1 = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  const b2 = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b1.turn), /confirmada/);
  assert.doesNotMatch(allText(b2.turn) || '', /confirmada/);
  assert.equal(ctx.hotelDriver._bookings.size, 1);
  assert.equal(ctx.app.repo._tables.reserva.size, 1);
  // evento de webhook repetido (mesmo wamid) também é descartado
  const again = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`, 'wamid.REPETIDO');
  const again2 = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`, 'wamid.REPETIDO');
  assert.equal(again2.inbound.duplicados, 1);
  assert.equal(again2.turn, null);
  assert.ok(again);
});

test('tarifa alterada entre a consulta e a confirmação: nova confirmação obrigatória', async () => {
  const ctx = await makeApp();
  const from = '5511900000020';
  const { turn } = await receiveAndBegin(ctx, from, 'Quero reservar');
  const disp = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const op = disp.resultado.opcoes[0];
  await tool(ctx, turn.turno_id, 'iniciar_reserva', { cotacao_id: op.cotacao_id });
  await tool(ctx, turn.turno_id, 'registrar_dados_hospede', { cotacao_id: op.cotacao_id, nome: 'Ana', sobrenome: 'Sintetica', email: 'ana@exemplo.invalid' });
  ctx.hotelDriver.setPriceFactor(1.1);
  const c = await tool(ctx, turn.turno_id, 'solicitar_confirmacao_reserva', { cotacao_id: op.cotacao_id });
  assert.equal(c.resultado.situacao, 'preco_alterado');
  const out = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: '' });
  assert.match(allText(out), /o valor desta opção mudou/);
  assert.equal(ctx.hotelDriver._bookings.size, 0);
  // nova confirmação com a nova cotação
  const t2 = await receiveAndBegin(ctx, from, 'ok, pode seguir com o novo valor');
  const c2 = await tool(ctx, t2.turn.turno_id, 'solicitar_confirmacao_reserva', { cotacao_id: c.resultado.nova_cotacao_id });
  assert.equal(c2.resultado.situacao, 'aguardando_confirmacao_cliente');
});

test('tarifa alterada no momento da criação (PMS recusa por preço): nada é reservado', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  ctx.hotelDriver.setPriceFactor(1.2);
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /Não foi possível concluir a reserva/);
  assert.equal([...ctx.app.repo._tables.reserva.values()][0].estado, 'falhou');
});

test('falha durante a criação (timeout) → confirmação pendente, sem afirmar sucesso; reconciliação confirma depois', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  ctx.hotelDriver.setScenario('reserva_timeout');
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /AINDA NÃO está confirmada/);
  assert.doesNotMatch(allText(b.turn), /Reserva confirmada/);
  const res = [...ctx.app.repo._tables.reserva.values()][0];
  assert.equal(res.estado, 'confirmacao_pendente');
  // Confirmação recebida após o timeout
  ctx.hotelDriver.setScenario(null);
  ctx.hotelDriver.completePending(s.acao.id);
  ctx.now.advance(10 * 60000);
  const sw = await ctx.app.ops.sweep();
  assert.equal(sw.reconciliacao[0].situacao, 'confirmada');
  assert.match(sw.notificacoes_reserva[0].mensagem.texto, /Reserva confirmada/);
  assert.equal((await ctx.app.repo.getReservation(res.id)).estado, 'confirmada');
});

test('reconciliação: PMS não tem registro → reserva marcada como não criada', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  ctx.hotelDriver.setScenario('indisponivel');
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /AINDA NÃO/);
  ctx.hotelDriver.setScenario(null);
  ctx.now.advance(10 * 60000);
  const sw = await ctx.app.ops.sweep();
  assert.equal(sw.reconciliacao[0].situacao, 'nao_criada');
});

test('resposta inválida do PMS na criação → nunca marcada como confirmada', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  ctx.hotelDriver.setScenario('resposta_invalida_reserva');
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.doesNotMatch(allText(b.turn), /Reserva confirmada/);
  assert.equal([...ctx.app.repo._tables.reserva.values()][0].estado, 'confirmacao_pendente');
});

test('resposta inválida do PMS na disponibilidade → erro estruturado, nenhum valor usado', async () => {
  const ctx = await makeApp();
  ctx.hotelDriver.setScenario('resposta_invalida');
  const { turn } = await receiveAndBegin(ctx, '5511900000021', 'quarto em SP');
  const r = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.erro.codigo, 'RESPOSTA_INVALIDA_INTEGRACAO');
  assert.match(r.erro.orientacao, /Não use nenhum valor/);
});

test('confirmação expirada (pré-reserva vencida) não executa', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  ctx.now.advance(16 * 60000);
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /prazo para confirmar essa operação expirou/);
  assert.equal(ctx.hotelDriver._bookings.size, 0);
});

test('cliente recusa no botão "Não confirmar"', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:cancelar`);
  assert.match(allText(b.turn), /operação não foi realizada/);
  assert.equal(ctx.hotelDriver._bookings.size, 0);
});

test('botão com ação de OUTRA conversa é ignorado', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx, '5511900000030');
  const b = await pressButton(ctx, '5511900000031', `acao:${s.acao.id}:confirmar`);
  assert.doesNotMatch(allText(b.turn), /confirmada/);
  assert.equal(ctx.hotelDriver._bookings.size, 0);
  const audits = await ctx.app.repo.listAudit({ operacao: 'acao.referencia_invalida' });
  assert.equal(audits.length, 1);
});

test('aviso de privacidade não configurado → coleta bloqueada e encaminhamento', async () => {
  const ctx = await makeApp({ negocio: { avisoPrivacidadeUrl: null } });
  const { turn, conversaId } = await receiveAndBegin(ctx, '5511900000040', 'quero reservar');
  const disp = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const r = await tool(ctx, turn.turno_id, 'iniciar_reserva', { cotacao_id: disp.resultado.opcoes[0].cotacao_id });
  assert.equal(r.resultado.encaminhado, true);
  assert.equal((await ctx.app.repo.getConversation(conversaId)).estado, 'em_atendimento_humano');
});

test('dados do hóspede: campos não previstos (CPF/cartão) são descartados e e-mail validado', async () => {
  const ctx = await makeApp();
  const { turn } = await receiveAndBegin(ctx, '5511900000041', 'quero reservar');
  const disp = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const id = disp.resultado.opcoes[0].cotacao_id;
  await tool(ctx, turn.turno_id, 'iniciar_reserva', { cotacao_id: id });
  const bad = await tool(ctx, turn.turno_id, 'registrar_dados_hospede', { cotacao_id: id, nome: 'Ana', sobrenome: 'Teste', cpf: '123.456.789-00' });
  assert.equal(bad.erro.codigo, 'VALIDACAO'); // propriedade não permitida no esquema
  const bad2 = await tool(ctx, turn.turno_id, 'registrar_dados_hospede', { cotacao_id: id, nome: 'Ana', sobrenome: 'Teste', email: 'nao-e-email' });
  assert.ok(bad2.erro.detalhes.problemas.includes('email_invalido'));
  const ok = await tool(ctx, turn.turno_id, 'registrar_dados_hospede', { cotacao_id: id, nome: 'Ana', sobrenome: 'Teste', email: 'ANA@Exemplo.invalid' });
  assert.deepEqual(ok.resultado.campos_recebidos.sort(), ['email', 'nome', 'sobrenome']);
  const miss = await tool(ctx, turn.turno_id, 'solicitar_confirmacao_reserva', { cotacao_id: id });
  assert.equal(miss.resultado.situacao, 'aguardando_confirmacao_cliente');
});

test('cliente muda de ideia: nova opção cancela a ação anterior de reserva', async () => {
  const ctx = await makeApp();
  const { turn, conversaId } = await receiveAndBegin(ctx, '5511900000042', 'quero reservar');
  const disp = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const [a, b] = disp.resultado.opcoes;
  await tool(ctx, turn.turno_id, 'iniciar_reserva', { cotacao_id: a.cotacao_id });
  await tool(ctx, turn.turno_id, 'iniciar_reserva', { cotacao_id: b.cotacao_id });
  const abertas = await ctx.app.repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente']);
  assert.equal(abertas.length, 1);
  assert.equal(abertas[0].cotacao_id, b.cotacao_id);
});

test('cotação de outra conversa não pode ser usada (sem enumeração)', async () => {
  const ctx = await makeApp();
  const t1 = await receiveAndBegin(ctx, '5511900000043', 'quarto');
  const disp = await tool(ctx, t1.turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const t2 = await receiveAndBegin(ctx, '5511900000044', 'quarto');
  const r = await tool(ctx, t2.turn.turno_id, 'calcular_cotacao', { cotacao_id: disp.resultado.opcoes[0].cotacao_id });
  assert.equal(r.erro.codigo, 'NAO_ENCONTRADO');
});

test('mensagem de confirmação usa somente dados retornados pelo sistema', async () => {
  const ctx = await makeApp();
  const s = await bookingUntilSummary(ctx);
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  const booking = [...ctx.hotelDriver._bookings.values()][0];
  const txt = allText(b.turn);
  assert.ok(txt.includes(booking.codigo_confirmacao));
  assert.doesNotMatch(txt, /maria\.teste@/i); // não ecoa dados pessoais
  await deliver(ctx, b.turn);
});
