// Testes de integração HTTP: servidor real em porta efêmera, chamadas como o n8n faria.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeApp, TOKENS, waTextPayload, waButtonPayload, APP_SECRET } from './helpers.js';
import { signForTest } from '../src/security/signature.js';

let ctx;
let server;
let base;
before(async () => {
  ctx = await makeApp();
  server = http.createServer((req, res) => ctx.app.router.handle(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, { token = TOKENS.n8n, body, headers = {} } = {}) => {
  const res = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html/texto */
  }
  return { status: res.status, json, text, headers: res.headers };
};
const inbound = (payload) => {
  const raw = Buffer.from(JSON.stringify(payload));
  return call('POST', '/internal/inbound', { body: { corpo_bruto_base64: raw.toString('base64'), assinatura: signForTest(raw, APP_SECRET) } });
};

test('health é público e mínimo; métricas exigem papel', async () => {
  const h = await call('GET', '/health', { token: null });
  assert.deepEqual(h.json, { ok: true });
  assert.equal((await call('GET', '/metrics', { token: null })).status, 401);
  assert.equal((await call('GET', '/metrics', { token: TOKENS.atendente })).status, 403);
  const m = await call('GET', '/metrics', { token: TOKENS.admin });
  assert.equal(m.status, 200);
  assert.match(m.text, /http_requisicoes_total/);
});

test('fluxo HTTP ponta a ponta: webhook → turno → classificação → ferramenta → resposta → envio', async () => {
  const from = '5511977770001';
  const r1 = await inbound(waTextPayload(from, 'Quero um quarto em São Paulo de 10 a 12/12 para 2 adultos', { ts: ctx.now().getTime() }));
  assert.equal(r1.status, 200);
  const conversaId = r1.json.conversas[0];
  const t = await call('POST', '/internal/turnos/iniciar', { body: { conversa_id: conversaId } });
  assert.equal(t.json.acao, 'interpretar');
  const c = await call('POST', `/internal/turnos/${t.json.turno_id}/classificacao`, { body: { intencoes: [{ intencao: 'consulta_disponibilidade', confianca: 0.9 }, { intencao: 'inventada', confianca: 1 }] } });
  assert.equal(c.json.acao, 'invocar_agente');
  assert.equal(c.json.intencoes.length, 1); // intenção desconhecida descartada
  const f = await call('POST', '/internal/ferramentas/consultar_disponibilidade', { headers: { 'x-turno-id': t.json.turno_id }, body: { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 } });
  assert.equal(f.json.ok, true);
  const rep = await call('POST', `/internal/turnos/${t.json.turno_id}/resposta`, { body: { texto: 'Encontrei opções. Qual prefere?' } });
  assert.equal(rep.json.mensagens.length, 2);
  for (const m of rep.json.mensagens) {
    const s = await call('POST', '/internal/saida/enviar', { body: m });
    assert.equal(s.json.status, 'enviada');
  }
  // reenvio da mesma mensagem (retentativa do n8n) não duplica
  const dup = await call('POST', '/internal/saida/enviar', { body: rep.json.mensagens[0] });
  assert.equal(dup.json.status, 'duplicada');
});

test('webhook com assinatura inválida → 401 sem detalhes', async () => {
  const raw = Buffer.from(JSON.stringify(waTextPayload('5511977770002', 'oi')));
  const r = await call('POST', '/internal/inbound', { body: { corpo_bruto_base64: raw.toString('base64'), assinatura: 'sha256=deadbeef' } });
  assert.equal(r.status, 401);
  assert.equal(r.json.erro.codigo, 'NAO_AUTENTICADO');
});

test('verificação de inscrição do webhook via core', async () => {
  const ok = await call('GET', '/internal/inbound/verificacao?hub.mode=subscribe&hub.verify_token=verificacao-teste&hub.challenge=987654');
  assert.equal(ok.json.challenge, '987654');
  const bad = await call('GET', '/internal/inbound/verificacao?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1');
  assert.equal(bad.status, 403);
});

test('atendente não pode chamar ferramentas da IA nem endpoints de privacidade; DPO pode', async () => {
  assert.equal((await call('POST', '/internal/ferramentas/listar_hoteis', { token: TOKENS.atendente, headers: { 'x-turno-id': 'x' }, body: {} })).status, 403);
  assert.equal((await call('POST', '/admin/privacidade/exportar', { token: TOKENS.atendente, body: { telefone: '5511977770001' } })).status, 403);
  assert.equal((await call('POST', '/admin/privacidade/exportar', { token: TOKENS.n8n, body: { telefone: '5511977770001' } })).status, 403);
  const ok = await call('POST', '/admin/privacidade/exportar', { token: TOKENS.dpo, body: { telefone: '5511977770001' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.conversas.length, 1);
});

test('erro interno não vaza mensagem, stack ou segredo', async () => {
  ctx.app.repo._failNext(new Error('password=SUPERSECRETA at /srv/app/db.js:10'));
  const r = await call('POST', '/internal/turnos/iniciar', { body: { conversa_id: 'conv_qualquer000' } });
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.text, /SUPERSECRETA|db\.js|at \//);
  assert.equal(r.json.erro.codigo, 'ERRO_INTERNO');
  assert.ok(r.json.correlacao);
});

test('corpo acima do limite → 413; content-type inválido → 415; JSON inválido → 422', async () => {
  const big = await fetch(base + '/internal/turnos/iniciar', { method: 'POST', headers: { authorization: `Bearer ${TOKENS.n8n}`, 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(300000) }) });
  assert.equal(big.status, 413);
  const ct = await fetch(base + '/internal/turnos/iniciar', { method: 'POST', headers: { authorization: `Bearer ${TOKENS.n8n}`, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(ct.status, 415);
  const bad = await fetch(base + '/internal/turnos/iniciar', { method: 'POST', headers: { authorization: `Bearer ${TOKENS.n8n}`, 'content-type': 'application/json' }, body: '{x' });
  assert.equal(bad.status, 422);
});

test('atendimento humano via API da equipe: assumir, ler, responder e encerrar retomando automação', async () => {
  const from = '5511977770003';
  const r1 = await inbound(waTextPayload(from, 'quero falar com atendente', { ts: ctx.now().getTime() }));
  const t = await call('POST', '/internal/turnos/iniciar', { body: { conversa_id: r1.json.conversas[0] } });
  assert.equal(t.json.notificar_equipe, true);
  const lista = await call('GET', '/admin/atendimentos?estado=aberta', { token: TOKENS.atendente });
  const atd = lista.json.atendimentos.find((a) => a.conversa_id === r1.json.conversas[0]);
  assert.ok(atd);
  assert.equal((await call('GET', `/admin/atendimentos/${atd.id}/mensagens`, { token: TOKENS.atendente })).status, 403); // ainda não atribuído
  await call('POST', `/admin/atendimentos/${atd.id}/assumir`, { token: TOKENS.atendente });
  const msgs = await call('GET', `/admin/atendimentos/${atd.id}/mensagens`, { token: TOKENS.atendente });
  assert.ok(msgs.json.mensagens.some((m) => m.texto === 'quero falar com atendente'));
  assert.equal((await call('GET', `/admin/atendimentos/${atd.id}/mensagens`, { token: TOKENS.atendente2 })).status, 403);
  const resp = await call('POST', `/admin/atendimentos/${atd.id}/responder`, { token: TOKENS.atendente, body: { texto: 'Olá, aqui é a Ana da equipe.' } });
  assert.equal(resp.json.status, 'enviada');
  const fim = await call('POST', `/admin/atendimentos/${atd.id}/encerrar`, { token: TOKENS.atendente, body: { retomar_automacao: true } });
  assert.equal(fim.json.estado_conversa, 'ativa');
});

test('página de verificação reforçada: GET não confirma (proteção contra pré-carregamento); POST com token inválido → 400', async () => {
  const g = await call('GET', '/verificacao/' + 'a'.repeat(43), { token: null });
  assert.equal(g.status, 200);
  assert.match(g.text, /<form method="post">/);
  assert.equal(g.headers.get('x-frame-options'), 'DENY');
  const p = await fetch(base + '/verificacao/' + 'a'.repeat(43), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
  assert.equal(p.status, 400);
});

test('configuração do agente expõe prompt e ferramentas permitidas apenas ao n8n', async () => {
  const r = await call('GET', '/internal/agente/configuracao');
  assert.match(r.json.prompt_sistema, /Você é o assistente virtual oficial/);
  assert.ok(r.json.ferramentas.some((f) => f.nome === 'solicitar_confirmacao_reserva'));
  assert.ok(!r.json.ferramentas.some((f) => f.nome === 'confirmar_reserva'));
  assert.equal((await call('GET', '/internal/agente/configuracao', { token: TOKENS.atendente })).status, 403);
  assert.ok(waButtonPayload);
});
