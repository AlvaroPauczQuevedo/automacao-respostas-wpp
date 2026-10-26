// Driver REST contra um servidor HTTP local que implementa contracts/hotel-integration.openapi.yaml (dados sintéticos).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRestHotelDriver } from '../src/integrations/hotel/restDriver.js';
import { wrapHotelDriver } from '../src/integrations/hotel/adapter.js';
import { createMetrics } from '../src/observability/metrics.js';

let server;
let base;
const seen = [];
let fail503 = 0;
before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: body ? JSON.parse(body) : null });
    const json = (code, o) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (req.headers.authorization !== 'Bearer token-teste') return json(401, {});
    if (url.pathname === '/v1/hotels/H1/availability') {
      if (fail503-- > 0) return json(503, {});
      return json(200, { consultado_em: '2026-11-02T10:00:00.000Z', ofertas: [{ codigo_oferta: 'O1', hotel_codigo: 'H1', acomodacao_codigo: 'STD', acomodacao_nome: 'Standard', noites: 2, valor_total: '500.00', moeda: 'BRL' }] });
    }
    if (url.pathname === '/v1/hotels/H2/availability') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('não é json');
    }
    if (url.pathname === '/v1/bookings' && req.method === 'POST') return json(200, { status: 'confirmada', codigo_confirmacao: 'C1', hotel_codigo: 'H1', entrada: '2026-12-10', saida: '2026-12-12', valor_total: '500.00', moeda: 'BRL' });
    if (url.pathname.startsWith('/v1/bookings/by-idempotency-key/')) return json(404, {});
    if (url.pathname === '/v1/bookings/C1/cancel') return json(200, { status: 'cancelada', codigo_cancelamento: 'X1' });
    return json(404, {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());

const make = () => wrapHotelDriver(createRestHotelDriver({ baseUrl: base, token: 'token-teste', timeoutMs: 2000 }), { metrics: createMetrics(), logger: { warn() {}, error() {} }, retries: 2, sleep: async () => {} });

test('disponibilidade: parâmetros mapeados e resposta validada', async () => {
  const d = make();
  const r = await d.searchAvailability({ hotelCodigo: 'H1', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2, criancasIdades: [4, 7], quartos: 1 });
  assert.equal(r.ofertas[0].valor_total, '500.00');
  const q = seen.at(-1).query;
  assert.deepEqual(q, { checkin: '2026-12-10', checkout: '2026-12-12', adults: '2', children_ages: '4,7', rooms: '1' });
});

test('5xx é retentado em operação idempotente', async () => {
  fail503 = 2;
  const r = await make().searchAvailability({ hotelCodigo: 'H1', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  assert.equal(r.ofertas.length, 1);
});

test('resposta não-JSON → erro de resposta inválida', async () => {
  await assert.rejects(make().searchAvailability({ hotelCodigo: 'H2', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 }), (e) => e.code === 'RESPOSTA_INVALIDA_INTEGRACAO');
});

test('criação envia Idempotency-Key e valor esperado; não é retentada automaticamente', async () => {
  const d = make();
  const r = await d.createBooking({ codigoOferta: 'O1', hotelCodigo: 'H1', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2, criancasIdades: [], quartos: 1, valorTotalEsperado: '500.00', moeda: 'BRL', hospede: { nome: 'A', sobrenome: 'B' }, idempotencyKey: 'acao_teste_123' });
  assert.equal(r.codigo_confirmacao, 'C1');
  const s = seen.at(-1);
  assert.equal(s.headers['idempotency-key'], 'acao_teste_123');
  assert.equal(s.body.valor_total_esperado, '500.00');
});

test('busca por chave de idempotência inexistente → null (reserva não criada)', async () => {
  assert.equal(await make().findBookingByIdempotencyKey('nao-existe'), null);
});

test('cancelamento com Idempotency-Key', async () => {
  const r = await make().cancelBooking({ codigo: 'C1', idempotencyKey: 'acao_cxl_1' });
  assert.equal(r.status, 'cancelada');
  assert.equal(seen.at(-1).headers['idempotency-key'], 'acao_cxl_1');
});

test('credencial errada → recusa não retentável', async () => {
  const d = wrapHotelDriver(createRestHotelDriver({ baseUrl: base, token: 'errado' }), { metrics: createMetrics(), logger: { warn() {}, error() {} }, retries: 2, sleep: async () => {} });
  await assert.rejects(d.searchAvailability({ hotelCodigo: 'H1', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 }), (e) => e.code === 'INTEGRACAO_INDISPONIVEL' && e.retryable === false);
});

test('operação não suportada pelo driver é recusada antes de chamar o PMS', async () => {
  const d = wrapHotelDriver(createRestHotelDriver({ baseUrl: base, token: 'token-teste', capabilities: ['disponibilidade'] }), { metrics: createMetrics(), logger: { warn() {}, error() {} } });
  await assert.rejects(d.cancelBooking({ codigo: 'C1', idempotencyKey: 'k' }), (e) => e.code === 'NAO_SUPORTADO');
});

test('validação de configuração: produção recusa simulados e exige segredos', async () => {
  const { loadConfig, validateConfig } = await import('../src/config.js');
  const c = { ...loadConfig(), appEnv: 'producao' };
  const { erros } = validateConfig(c);
  assert.ok(erros.some((e) => /simulados/.test(e)));
  assert.ok(erros.some((e) => /DATA_ENCRYPTION_KEY/.test(e)));
  assert.ok(erros.some((e) => /postgres/.test(e)));
});
