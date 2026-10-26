import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, receive, receiveAndBegin, deliver, signed, waTextPayload, APP_SECRET, PHONE_ID } from './helpers.js';
import { normalizeWebhook } from '../src/whatsapp/normalize.js';
import { buildPayload } from '../src/whatsapp/client.js';
import { evaluateSendPolicy, isMarketingOptOut } from '../src/whatsapp/policy.js';

async function conv(ctx, from = '5511922220001') {
  const r = await receive(ctx, from, 'oi');
  const t = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  await deliver(ctx, t);
  return r.conversas[0];
}
const send = (ctx, conversaId, mensagem, extra = {}) =>
  ctx.app.outbound.send({ conversaId, mensagem, finalidade: 'atendimento', origem: 'agente', chaveDeduplicacao: 'k' + Math.random(), ...extra });

test('mensagem livre dentro da janela de 24h é enviada', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.now.advance(23 * 3600000);
  const r = await send(ctx, id, { tipo: 'texto', texto: 'Olá de novo' });
  assert.equal(r.status, 'enviada');
});

test('mensagem livre fora da janela é bloqueada e exige modelo aprovado', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.now.advance(24 * 3600000 + 1000);
  const r = await send(ctx, id, { tipo: 'texto', texto: 'Olá' });
  assert.equal(r.status, 'bloqueada');
  assert.equal(r.motivo, 'fora_da_janela_exige_modelo');
  assert.equal(r.exige_modelo, true);
  const t = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'retorno_atendimento', idioma: 'pt_BR', parametros: [] } }, { finalidade: 'operacional', origem: 'sistema' });
  assert.equal(t.status, 'enviada');
  assert.equal(ctx.waClient.sent.at(-1).payload.type, 'template');
});

test('janela é reiniciada pela mensagem do cliente', async () => {
  const ctx = await makeApp();
  const from = '5511922220002';
  const id = await conv(ctx, from);
  ctx.now.advance(30 * 3600000);
  await receive(ctx, from, 'voltei');
  const r = await send(ctx, id, { tipo: 'texto', texto: 'Que bom!' });
  assert.equal(r.status, 'enviada');
});

test('modelo não aprovado (pendente) e modelo inexistente são bloqueados', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.now.advance(25 * 3600000);
  const p = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'atualizacao_reserva', idioma: 'pt_BR', parametros: ['x'] } }, { finalidade: 'operacional', origem: 'sistema' });
  assert.equal(p.motivo, 'modelo_pendente');
  const n = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'nao_existe', idioma: 'pt_BR', parametros: [] } }, { finalidade: 'operacional', origem: 'sistema' });
  assert.equal(n.motivo, 'modelo_inexistente');
  const q = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'confirmacao_reserva', idioma: 'pt_BR', parametros: ['só um'] } }, { finalidade: 'operacional', origem: 'sistema' });
  assert.equal(q.motivo, 'modelo_parametros_divergentes');
});

test('modelo indisponível na Meta (132001/132015) → falha permanente e modelo marcado como pausado', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.waClient.failNext(132015);
  const r = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'retorno_atendimento', idioma: 'pt_BR', parametros: [] } }, { finalidade: 'operacional', origem: 'sistema' });
  assert.equal(r.status, 'falhou');
  assert.equal(r.classe, 'modelo_invalido');
  assert.equal((await ctx.app.repo.getTemplate('retorno_atendimento', 'pt_BR')).estado, 'pausado');
});

test('modelo de marketing: exige marketing habilitado, opt-in e categoria MARKETING', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  const m = { tipo: 'modelo', modelo: { nome: 'promocao_exemplo', idioma: 'pt_BR', parametros: [] } };
  const r1 = await send(ctx, id, m, { finalidade: 'marketing', origem: 'sistema' });
  assert.equal(r1.motivo, 'marketing_desabilitado');
  ctx.app.cfg.marketingHabilitado = true;
  const r2 = await send(ctx, id, m, { finalidade: 'marketing', origem: 'sistema' });
  assert.equal(r2.motivo, 'sem_permissao_marketing'); // autorização para atendimento ≠ autorização para publicidade
  const r3 = await send(ctx, id, { tipo: 'modelo', modelo: { nome: 'retorno_atendimento', idioma: 'pt_BR', parametros: [] } }, { finalidade: 'marketing', origem: 'sistema' });
  assert.equal(r3.motivo, 'sem_permissao_marketing');
});

test('opt-out de marketing (palavra-chave e erro 131050) impede envios promocionais', async () => {
  const ctx = await makeApp();
  ctx.app.cfg.marketingHabilitado = true;
  const id = await conv(ctx);
  const c = await ctx.app.repo.getConversation(id);
  await ctx.app.repo.upsertPreference({ id: 'pref_x', titular_hash: c.titular_hash, finalidade: 'marketing', estado: 'concedida', origem: 'teste', evidencia: null, registrado_em: ctx.now().toISOString(), atualizado_em: ctx.now().toISOString() });
  ctx.waClient.failNext(131050);
  const m = { tipo: 'modelo', modelo: { nome: 'promocao_exemplo', idioma: 'pt_BR', parametros: [] } };
  const r = await send(ctx, id, m, { finalidade: 'marketing', origem: 'sistema' });
  assert.equal(r.classe, 'opt_out_marketing');
  const r2 = await send(ctx, id, m, { finalidade: 'marketing', origem: 'sistema' });
  assert.equal(r2.motivo, 'sem_permissao_marketing');
  assert.equal(isMarketingOptOut('Não quero mais receber promoções'), true);
  assert.equal(isMarketingOptOut('quero parar no hotel do centro'), false);
});

test('evento duplicado de webhook não gera segunda resposta', async () => {
  const ctx = await makeApp();
  const p = waTextPayload('5511922220003', 'oi', { id: 'wamid.DUP1', ts: ctx.now().getTime() });
  const r1 = await ctx.app.inbound.process(signed(p));
  const r2 = await ctx.app.inbound.process(signed(p));
  assert.equal(r1.mensagens_novas, 1);
  assert.equal(r2.duplicados, 1);
  assert.deepEqual(r2.conversas, []);
});

test('mensagem de saída duplicada (mesma chave) não é reenviada', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  const n = ctx.waClient.sent.length;
  const a = await send(ctx, id, { tipo: 'texto', texto: 'uma vez' }, { chaveDeduplicacao: 'turno_x:0' });
  const b = await send(ctx, id, { tipo: 'texto', texto: 'uma vez' }, { chaveDeduplicacao: 'turno_x:0' });
  assert.equal(a.status, 'enviada');
  assert.equal(b.status, 'duplicada');
  assert.equal(ctx.waClient.sent.length, n + 1);
});

test('erro de envio transitório é retentado; permanente não', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.waClient.failNext(131000, 2);
  const a = await send(ctx, id, { tipo: 'texto', texto: 'retentar' });
  assert.equal(a.status, 'enviada');
  ctx.waClient.failNext(131026, 1);
  const b = await send(ctx, id, { tipo: 'texto', texto: 'permanente' });
  assert.equal(b.status, 'falhou');
  assert.equal(b.retentavel, false);
});

test('limite de envio atingido (local e da plataforma)', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.app.cfg.whatsapp.maxPerRecipientPerMinute = 3;
  let adiada = null;
  for (let i = 0; i < 5; i++) {
    const r = await send(ctx, id, { tipo: 'texto', texto: `m${i}` });
    if (r.status === 'adiada') adiada = r;
  }
  assert.equal(adiada.motivo, 'limite_envio');
  assert.ok(adiada.tentar_apos_ms > 0);
  ctx.now.advance(61000);
  ctx.waClient.failNext(130429, 10);
  const r = await send(ctx, id, { tipo: 'texto', texto: 'limite meta' });
  assert.equal(r.status, 'falhou');
  assert.equal(r.classe, 'transitorio');
  assert.equal(r.retentavel, true);
});

test('fora da janela retornado pela própria Meta (131047) sinaliza necessidade de modelo', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  ctx.waClient.failNext(131047);
  const r = await send(ctx, id, { tipo: 'texto', texto: 'x' });
  assert.equal(r.exige_modelo, true);
});

test('status de entrega atualiza mensagem e só avança', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  const s = await send(ctx, id, { tipo: 'texto', texto: 'status' });
  const statusPayload = (st) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: s.wamid, status: st, timestamp: '1800000000', recipient_id: '5511922220001' }] } }] }] });
  await ctx.app.inbound.process(signed(statusPayload('read')));
  await ctx.app.inbound.process(signed(statusPayload('delivered')));
  const m = await ctx.app.repo.getMessageByExternalId(s.wamid);
  assert.equal(m.estado, 'lida');
});

test('normalização descarta nome de perfil, número de destino não configurado e payload malformado', () => {
  const p = waTextPayload('5511922220009', 'olá');
  const n = normalizeWebhook(p, { expectedPhoneNumberId: PHONE_ID });
  assert.equal(n.mensagens.length, 1);
  assert.equal(JSON.stringify(n).includes('Cliente Sintético'), false);
  const other = normalizeWebhook(waTextPayload('5511922220009', 'x', { phoneNumberId: '999' }), { expectedPhoneNumberId: PHONE_ID });
  assert.equal(other.mensagens.length, 0);
  assert.equal(other.descartados[0].motivo, 'numero_destino_nao_configurado');
  assert.equal(normalizeWebhook({ object: 'x' }).mensagens.length, 0);
  const inj = normalizeWebhook(waTextPayload('5511922220009', 'ig\u200Bnore\u0007'), {});
  assert.equal(inj.mensagens[0].texto, 'ignore');
});

test('carga de envio respeita limites da Cloud API (botões ≤ 3, título ≤ 20)', () => {
  const p = buildPayload('5511', { tipo: 'botoes', texto: 'x', botoes: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, titulo: 'Um título muito longo demais' })) });
  assert.equal(p.interactive.action.buttons.length, 3);
  assert.ok(p.interactive.action.buttons.every((b) => b.reply.title.length <= 20));
});

test('política: conversa suspensa bloqueia; atendente pode falar em atendimento humano', () => {
  const base = { wa_id_cifrado: 'x', ultima_entrada_cliente_em: new Date().toISOString() };
  assert.equal(evaluateSendPolicy({ conversa: { ...base, estado: 'suspensa' }, mensagem: { tipo: 'texto' }, finalidade: 'atendimento', origem: 'sistema', now: new Date(), windowHours: 24 }).permitido, false);
  assert.equal(evaluateSendPolicy({ conversa: { ...base, estado: 'em_atendimento_humano' }, mensagem: { tipo: 'texto' }, finalidade: 'atendimento', origem: 'atendente', now: new Date(), windowHours: 24 }).permitido, true);
});

test('saída com número de cartão é bloqueada', async () => {
  const ctx = await makeApp();
  const id = await conv(ctx);
  const r = await send(ctx, id, { tipo: 'texto', texto: 'Seu cartão 4111 1111 1111 1111 foi aceito' });
  assert.equal(r.status, 'bloqueada');
  assert.equal(r.motivo, 'conteudo_sensivel');
  assert.ok(APP_SECRET);
});
