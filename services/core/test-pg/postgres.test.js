// Testes contra PostgreSQL REAL. Requer PG_TEST_URL apontando para um servidor onde o usuário pode
// criar bancos (ex.: postgres://postgres:senha@localhost:5432/postgres). Cada execução cria um banco
// descartável. Sem PG_TEST_URL, a suíte é ignorada (skip) — nunca considerada "aprovada" silenciosamente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '../scripts/migrate.js';
import { createPostgresRepo } from '../src/repo/postgres.js';
import { makeApp, bookingUntilSummary, pressButton, allText, receiveAndBegin, tool, deliver, signed, waTextPayload } from '../test/helpers.js';

const BASE = process.env.PG_TEST_URL;
const skip = !BASE && 'PG_TEST_URL não definido';
let dbUrl;
let dbName;
let pool;

before(async () => {
  if (skip) return;
  dbName = 'hotel_agent_teste_' + randomBytes(4).toString('hex');
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  await admin.end();
  const u = new URL(BASE);
  u.pathname = '/' + dbName;
  dbUrl = u.toString();
  await migrate(dbUrl, { log: () => {} });
  pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
});

after(async () => {
  if (skip) return;
  await pool.end();
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function freshApp(overrides) {
  await pool.query(`TRUNCATE hotel, acomodacao, politica, faq, conversa, evento_entrada, mensagem, turno, cotacao, acao_pendente, reserva,
    verificacao_titular, contador_limite, solicitacao_atendimento, preferencia_comunicacao, solicitacao_privacidade, modelo_mensagem,
    registro_auditoria, erro_operacional CASCADE`);
  const repo = await createPostgresRepo({ pool });
  return makeApp(overrides, { repo });
}

test('migração recusa banco que não seja UTF8', { skip }, async () => {
  const name = dbName + '_latin';
  const admin = new pg.Client({ connectionString: BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} ENCODING 'LATIN1' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  const u = new URL(BASE);
  u.pathname = '/' + name;
  await assert.rejects(migrate(u.toString(), { log: () => {} }), /UTF8/);
  await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
});

test('migrações aplicam todas as tabelas, papéis e são idempotentes', { skip }, async () => {
  await migrate(dbUrl, { log: () => {} });
  const t = await pool.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`);
  assert.ok(t.rows[0].n >= 19);
  const v = await pool.query(`SELECT versao FROM schema_migracao ORDER BY versao`);
  assert.deepEqual(v.rows.map((r) => r.versao), ['001_schema', '002_papeis_acesso']);
  const roles = await pool.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'app_%' ORDER BY 1`);
  assert.deepEqual(roles.rows.map((r) => r.rolname), ['app_conteudo_editor', 'app_core', 'app_leitura_metricas']);
  // app_core não pode apagar auditoria
  const priv = await pool.query(`SELECT has_table_privilege('app_core','registro_auditoria','DELETE') d, has_table_privilege('app_core','registro_auditoria','INSERT') i`);
  assert.equal(priv.rows[0].d, false);
  assert.equal(priv.rows[0].i, true);
});

test('fluxo completo de reserva sobre PostgreSQL', { skip }, async () => {
  const ctx = await freshApp();
  const s = await bookingUntilSummary(ctx);
  assert.equal(s.conf.resultado.situacao, 'aguardando_confirmacao_cliente');
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /Reserva confirmada/);
  const r = await pool.query(`SELECT estado, identificador_externo, valor_total FROM reserva`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].estado, 'confirmada');
  assert.match(r.rows[0].identificador_externo, /^SIM-/);
  const pay = await pool.query(`SELECT payload_cifrado FROM acao_pendente WHERE id=$1`, [s.acao.id]);
  assert.equal(pay.rows[0].payload_cifrado, null);
  // Nenhum telefone em claro no banco
  const dump = await pool.query(`SELECT row_to_json(c)::text j FROM conversa c`);
  assert.ok(dump.rows.every((x) => !x.j.includes(s.from)));
});

test('concorrência real: trava por conversa, CAS de ação, idempotência de reserva e de atendimento', { skip }, async () => {
  const ctx = await freshApp();
  const repo = ctx.app.repo;
  const { conversaId } = await receiveAndBegin(ctx, '5511988880001', 'oi');
  // libera a trava do turno anterior (já concluído) e disputa 10 travas simultâneas
  const nowIso = ctx.now().toISOString();
  const until = new Date(ctx.now().getTime() + 60000).toISOString();
  const locks = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.tryLockConversation(conversaId, `dono_${i}`, until, nowIso)));
  assert.equal(locks.filter(Boolean).length, 1);

  const acao = await repo.insertAction({ id: 'acao_concorrencia1', conversa_id: conversaId, tipo: 'criar_reserva', estado: 'aguardando_cliente', criado_em: nowIso, atualizado_em: nowIso });
  const cas = await Promise.all(Array.from({ length: 8 }, () => repo.transitionAction(acao.id, ['aguardando_cliente'], { estado: 'executando' })));
  assert.equal(cas.filter(Boolean).length, 1);

  await repo.upsertHotel({ id: 'hot_simSP0001', codigo_externo: 'SIM-SP-01', nome: 'x', cidade: 'São Paulo', fonte_oficial: 'teste', status: 'ativo', estado_publicacao: 'publicado', comodidades: [] });
  const res = await Promise.all(
    Array.from({ length: 6 }, (_, i) => repo.insertReservation({ id: `res_c${i}000000`, hotel_id: 'hot_simSP0001', chave_idempotencia: 'chave-unica', estado: 'iniciada', entrada: '2026-12-10', saida: '2026-12-12' })),
  );
  assert.equal(res.filter((r) => r.criada).length, 1);
  assert.equal(new Set(res.map((r) => r.reserva.id)).size, 1);

  const hs = await Promise.all(Array.from({ length: 5 }, (_, i) => repo.insertHandoff({ id: `atd_c${i}000000`, conversa_id: conversaId, categoria: 'x', motivo: 'x', prioridade: 'normal', fila: 'reservas', estado: 'aberta' })));
  assert.equal(hs.filter((h) => h.criada).length, 1);
});

test('idempotência de webhook no banco (mesmo wamid em paralelo)', { skip }, async () => {
  const ctx = await freshApp();
  const p = waTextPayload('5511988880002', 'oi', { id: 'wamid.PG.DUP', ts: ctx.now().getTime() });
  const rs = await Promise.allSettled([1, 2, 3, 4].map(() => ctx.app.inbound.process(signed(p))));
  const ok = rs.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  assert.equal(ok.reduce((n, r) => n + r.mensagens_novas, 0), 1);
  const ev = await pool.query(`SELECT count(*)::int n FROM evento_entrada WHERE id='wamid.PG.DUP'`);
  assert.equal(ev.rows[0].n, 1);
});

test('busca por cidade sem acento, políticas com conflito, FAQ', { skip }, async () => {
  const ctx = await freshApp();
  const { turn } = await receiveAndBegin(ctx, '5511988880003', 'hotéis em florianopolis?');
  const h = await tool(ctx, turn.turno_id, 'buscar_hoteis_por_cidade', { cidade: 'florianopolis' });
  assert.equal(h.resultado.encontrados, 1);
  const p = await tool(ctx, turn.turno_id, 'consultar_politicas', { hotel_id: 'hot_simGRA001', categoria: 'pagamento' });
  assert.equal(p.resultado.requer_validacao_humana, true);
  const a = await tool(ctx, turn.turno_id, 'consultar_politicas', { hotel_id: 'hot_simSP0001', categoria: 'animais' });
  assert.equal(a.resultado.politicas[0].abrangencia, 'hotel'); // específica prevalece
  const f = await tool(ctx, turn.turno_id, 'consultar_faq', { pergunta: 'tem wifi no quarto?' });
  assert.equal(f.resultado.encontrou, true);
});

test('retenção e eliminação sobre PostgreSQL respeitam bloqueio legal', { skip }, async () => {
  const ctx = await freshApp();
  const a = await receiveAndBegin(ctx, '5511988880004', 'oi');
  await deliver(ctx, a.turn);
  const b = await receiveAndBegin(ctx, '5511988880005', 'oi');
  await deliver(ctx, b.turn);
  await ctx.app.services.privacy.setLegalHold({ conversaId: b.conversaId, ativo: true, executor: 'dpo' });
  ctx.now.advance(400 * 86400000);
  const r = await ctx.app.retention.run();
  assert.ok(r.conteudo_mensagens_apagado >= 2);
  assert.equal(r.conversas_anonimizadas, 1);
  const rows = await pool.query(`SELECT id, anonimizada_em, wa_id_cifrado FROM conversa ORDER BY id`);
  const byId = Object.fromEntries(rows.rows.map((x) => [x.id, x]));
  assert.ok(byId[a.conversaId].anonimizada_em);
  assert.equal(byId[a.conversaId].wa_id_cifrado, null);
  assert.equal(byId[b.conversaId].anonimizada_em, null);
});

test('timeout de reserva + reconciliação sobre PostgreSQL', { skip }, async () => {
  const ctx = await freshApp();
  const s = await bookingUntilSummary(ctx);
  ctx.hotelDriver.setScenario('reserva_timeout');
  const b = await pressButton(ctx, s.from, `acao:${s.acao.id}:confirmar`);
  assert.match(allText(b.turn), /AINDA NÃO/);
  ctx.hotelDriver.setScenario(null);
  ctx.hotelDriver.completePending(s.acao.id);
  ctx.now.advance(10 * 60000);
  const sw = await ctx.app.ops.sweep();
  assert.equal(sw.reconciliacao[0].situacao, 'confirmada');
});
