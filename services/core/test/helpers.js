// Utilitários de teste. Todos os dados são SINTÉTICOS.
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { seedSynthetic } from '../src/dev/seed.js';
import { createMockHotelDriver } from '../src/integrations/hotel/mockDriver.js';
import { createMockWhatsAppClient } from '../src/whatsapp/client.js';
import { createMockNotifier } from '../src/integrations/notify/notifier.js';
import { signForTest } from '../src/security/signature.js';
import { sha256Hex } from '../src/security/crypto.js';

export const APP_SECRET = 'segredo-de-teste-' + 'x'.repeat(16);
export const PHONE_ID = '100000000000001';
export const TOKENS = {
  n8n: 'tok_n8n_' + 'a'.repeat(32),
  atendente: 'tok_atd_' + 'b'.repeat(32),
  atendente2: 'tok_atd2_' + 'f'.repeat(32),
  supervisor: 'tok_sup_' + 'c'.repeat(32),
  dpo: 'tok_dpo_' + 'd'.repeat(32),
  admin: 'tok_adm_' + 'e'.repeat(32),
};

export function makeClock(start = '2026-11-02T13:00:00.000Z') {
  let t = Date.parse(start);
  const now = () => new Date(t);
  now.advance = (ms) => {
    t += ms;
  };
  now.set = (iso) => {
    t = Date.parse(iso);
  };
  return now;
}

export async function makeApp(overrides = {}, opts = {}) {
  const base = loadConfig();
  const cfg = {
    ...base,
    appEnv: 'desenvolvimento',
    dataEncryptionKey: randomBytes(32).toString('base64'),
    hashPepper: 'pepper-de-teste',
    publicBaseUrl: 'https://exemplo.invalid',
    serviceTokens: {
      [sha256Hex(TOKENS.n8n)]: { papel: 'servico_n8n', ator: 'n8n' },
      [sha256Hex(TOKENS.atendente)]: { papel: 'atendente', ator: 'atendente.ana' },
      [sha256Hex(TOKENS.atendente2)]: { papel: 'atendente', ator: 'atendente.bruno' },
      [sha256Hex(TOKENS.supervisor)]: { papel: 'supervisor', ator: 'supervisor.carla' },
      [sha256Hex(TOKENS.dpo)]: { papel: 'encarregado_dados', ator: 'dpo.dani' },
      [sha256Hex(TOKENS.admin)]: { papel: 'admin_tecnico', ator: 'admin.edu' },
    },
    whatsapp: { ...base.whatsapp, appSecret: APP_SECRET, phoneNumberId: PHONE_ID, verifyToken: 'verificacao-teste', mode: 'mock' },
    hotel: { ...base.hotel, adapter: 'mock', maxRetries: 1 },
    negocio: {
      ...base.negocio,
      nomeRede: 'Rede Exemplo (SIMULADA)',
      avisoPrivacidadeUrl: 'https://exemplo.invalid/privacidade',
      canalPrivacidade: 'privacidade@exemplo.invalid',
      horarioAtendimento: null,
      verificacaoReforcadaModo: 'atendente',
      ...(overrides.negocio || {}),
    },
    ...overrides,
  };
  if (overrides.negocio) cfg.negocio = { ...cfg.negocio, ...overrides.negocio };
  const now = opts.now || makeClock();
  const logs = [];
  const logger = mkLogger(logs);
  const hotelDriver = createMockHotelDriver({ now });
  const waClient = createMockWhatsAppClient();
  const notifier = createMockNotifier();
  const app = await createApp(cfg, { now, logger, hotelDriver, waClient, notifier, sleep: async () => {}, ...(opts.repo ? { repo: opts.repo } : {}) });
  await seedSynthetic(app.repo);
  return { app, cfg, now, logs, hotelDriver, waClient, notifier };
}

function mkLogger(logs) {
  const make = (base = {}) => {
    const w = (level) => (msg, fields) => logs.push({ level, msg, ...base, ...fields });
    return { debug: w('debug'), info: w('info'), warn: w('warn'), error: w('error'), child: (b) => make({ ...base, ...b }) };
  };
  return make();
}

let seq = 0;
export function waTextPayload(from, text, { id, ts, phoneNumberId = PHONE_ID } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_SIM',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '550000000000', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Cliente Sintético' }, wa_id: from }],
              messages: [{ from, id: id || `wamid.TESTE.${++seq}.${randomBytes(4).toString('hex')}`, timestamp: String(Math.floor((ts ?? Date.now()) / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

export function waButtonPayload(from, replyId, { id, ts } = {}) {
  const p = waTextPayload(from, 'x', { id, ts });
  p.entry[0].changes[0].value.messages[0] = { from, id: id || `wamid.TESTE.${++seq}.btn`, timestamp: String(Math.floor((ts ?? Date.now()) / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: replyId, title: 'Confirmar' } } };
  return p;
}

export function waMediaPayload(from, type = 'image', { ts } = {}) {
  const p = waTextPayload(from, 'x', { ts });
  p.entry[0].changes[0].value.messages[0] = { from, id: `wamid.TESTE.${++seq}.media`, timestamp: String(Math.floor((ts ?? Date.now()) / 1000)), type, [type]: { id: 'MEDIA_SIM' } };
  return p;
}

export function signed(payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  return { rawBody: raw, assinatura: signForTest(raw, APP_SECRET) };
}

/** Recebe uma mensagem de texto e inicia o turno. */
export async function receive(ctx, from, text, extra = {}) {
  const r = await ctx.app.inbound.process(signed(waTextPayload(from, text, { ts: ctx.now().getTime(), ...extra })));
  return r;
}

export async function receiveAndBegin(ctx, from, text) {
  const r = await receive(ctx, from, text);
  if (!r.conversas.length) return { inbound: r, turn: null };
  const turn = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  return { inbound: r, turn, conversaId: r.conversas[0] };
}

/** Envia as mensagens resultantes de um turno, como o WF09 faria. */
export async function deliver(ctx, turnResult) {
  const out = [];
  for (const m of turnResult.mensagens || []) {
    out.push(await ctx.app.outbound.send({ conversaId: m.conversa_id, mensagem: m.mensagem, finalidade: m.finalidade, origem: m.origem, chaveDeduplicacao: m.chave_deduplicacao }));
  }
  return out;
}

export const tool = (ctx, turnoId, nome, argumentos) => ctx.app.tools.execute({ nome, argumentos, turnoId, principal: { papel: 'servico_n8n', ator: 'n8n' } });
export const lastSent = (ctx) => ctx.waClient.sent[ctx.waClient.sent.length - 1];
export const allText = (turnResult) => (turnResult.mensagens || []).map((m) => m.mensagem.texto).join('\n---\n');

/** Fluxo completo até o resumo de confirmação de reserva. */
export async function bookingUntilSummary(ctx, from = '5511900000001') {
  const { turn, conversaId } = await receiveAndBegin(ctx, from, 'Quero reservar em São Paulo de 10 a 12 de dezembro para 2 adultos');
  await ctx.app.turns.classification({ turnoId: turn.turno_id, intencoes: [{ intencao: 'nova_reserva', confianca: 0.95 }] });
  const disp = await tool(ctx, turn.turno_id, 'consultar_disponibilidade', { hotel_id: 'hot_simSP0001', entrada: '2026-12-10', saida: '2026-12-12', adultos: 2 });
  const opcao = disp.resultado.opcoes[0];
  const t1 = await ctx.app.turns.reply({ turnoId: turn.turno_id, texto: `Encontrei a opção ${opcao.acomodacao} por R$ ${opcao.valor_total.replace('.', ',')} no total.` });
  await deliver(ctx, t1);

  const r2 = await receiveAndBegin(ctx, from, 'Quero essa. Sou Maria Teste, maria.teste@exemplo.invalid');
  await ctx.app.turns.classification({ turnoId: r2.turn.turno_id, intencoes: [{ intencao: 'nova_reserva', confianca: 0.95 }] });
  const ini = await tool(ctx, r2.turn.turno_id, 'iniciar_reserva', { cotacao_id: opcao.cotacao_id });
  const reg = await tool(ctx, r2.turn.turno_id, 'registrar_dados_hospede', { cotacao_id: opcao.cotacao_id, nome: 'Maria', sobrenome: 'Teste', email: 'maria.teste@exemplo.invalid' });
  const conf = await tool(ctx, r2.turn.turno_id, 'solicitar_confirmacao_reserva', { cotacao_id: opcao.cotacao_id });
  const t2 = await ctx.app.turns.reply({ turnoId: r2.turn.turno_id, texto: 'Enviei o resumo.' });
  await deliver(ctx, t2);
  const acoes = await ctx.app.repo.listActions(conversaId, ['aguardando_cliente']);
  return { conversaId, opcao, ini, reg, conf, t2, acao: acoes[0], from };
}

export async function pressButton(ctx, from, replyId, id) {
  const r = await ctx.app.inbound.process(signed(waButtonPayload(from, replyId, { ts: ctx.now().getTime(), id })));
  if (!r.conversas.length) return { inbound: r, turn: null };
  const turn = await ctx.app.turns.begin({ conversaId: r.conversas[0] });
  return { inbound: r, turn };
}
