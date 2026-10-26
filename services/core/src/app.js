import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createAudit } from './audit/audit.js';
import { createFieldCrypto, createHasher } from './security/crypto.js';
import { authenticate, authorize } from './security/rbac.js';
import { verifySubscription } from './security/signature.js';
import { createMemoryRepo } from './repo/memory.js';
import { wrapHotelDriver } from './integrations/hotel/adapter.js';
import { createMockHotelDriver } from './integrations/hotel/mockDriver.js';
import { createRestHotelDriver } from './integrations/hotel/restDriver.js';
import { createMockNotifier, createWebhookNotifier } from './integrations/notify/notifier.js';
import { createCloudClient, createMockWhatsAppClient } from './whatsapp/client.js';
import { createOutboundService } from './whatsapp/outbound.js';
import { createKnowledgeService } from './knowledge/service.js';
import { createBookingService } from './booking/service.js';
import { createReservationService } from './reservations/service.js';
import { createHandoffService } from './handoff/service.js';
import { createPrivacyService } from './privacy/service.js';
import { createToolGateway } from './tools/gateway.js';
import { TOOLS } from './tools/registry.js';
import { createInboundService } from './turn/inbound.js';
import { createTurnProcessor } from './turn/processor.js';
import { createRetentionJob } from './retention/job.js';
import { createOpsService } from './ops/service.js';
import { createRouter } from './http/router.js';
import { Errors } from './util/errors.js';
import { newId } from './util/ids.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS = {
  sistema: readFileSync(path.join(here, '..', 'prompts', 'agente-sistema.md'), 'utf8'),
  classificador: readFileSync(path.join(here, '..', 'prompts', 'classificador.md'), 'utf8'),
};

/**
 * Raiz de composição. Dependências externas podem ser injetadas (testes).
 */
export async function createApp(cfg, deps = {}) {
  const dev = cfg.appEnv === 'desenvolvimento';
  const logger = deps.logger || createLogger({ level: cfg.logLevel });
  const metrics = deps.metrics || createMetrics();
  const now = deps.now || (() => new Date());

  let repo = deps.repo;
  if (!repo) {
    if (cfg.repo === 'postgres') {
      const { createPostgresRepo } = await import('./repo/postgres.js');
      repo = await createPostgresRepo({ connectionString: cfg.databaseUrl, logger });
    } else repo = createMemoryRepo();
  }
  const crypto = deps.crypto || createFieldCrypto({ key: cfg.dataEncryptionKey, keyId: cfg.dataEncryptionKeyId, oldKeys: cfg.dataEncryptionOldKeys, allowInsecureDev: dev });
  const hasher = deps.hasher || createHasher({ pepper: cfg.hashPepper, allowInsecureDev: dev });
  const audit = createAudit({ repo, logger, now });

  const hotelDriver = deps.hotelDriver || (cfg.hotel.adapter === 'rest' ? createRestHotelDriver({ baseUrl: cfg.hotel.baseUrl, token: cfg.hotel.token, timeoutMs: cfg.hotel.timeoutMs }) : createMockHotelDriver({ now }));
  const hotel = wrapHotelDriver(hotelDriver, { metrics, logger, retries: cfg.hotel.maxRetries, sleep: deps.sleep });
  const notifier = deps.notifier || (cfg.notify.mode === 'webhook' ? createWebhookNotifier({ url: cfg.notify.emailWebhookUrl, token: cfg.notify.emailWebhookToken }) : createMockNotifier());
  const waClient =
    deps.waClient ||
    (cfg.whatsapp.mode === 'cloud'
      ? createCloudClient({ graphBaseUrl: cfg.whatsapp.graphBaseUrl, graphApiVersion: cfg.whatsapp.graphApiVersion, phoneNumberId: cfg.whatsapp.phoneNumberId, accessToken: cfg.whatsapp.accessToken, timeoutMs: cfg.whatsapp.sendTimeoutMs })
      : createMockWhatsAppClient());

  const outbound = createOutboundService({ repo, client: waClient, crypto, cfg, logger, metrics, audit, now, sleep: deps.sleep });
  const knowledge = createKnowledgeService({ repo, now });
  const booking = createBookingService({ repo, hotel, crypto, cfg, audit, metrics, logger, now });
  const reservations = createReservationService({ repo, hotel, hasher, notifier, cfg, audit, metrics, logger, now });
  const handoff = createHandoffService({ repo, cfg, audit, metrics, now });
  const privacy = createPrivacyService({ repo, crypto, hasher, cfg, audit, metrics, now });
  const services = { knowledge, booking, reservations, handoff, privacy };
  const tools = createToolGateway({ repo, services, cfg, audit, metrics, logger, now });
  const inbound = createInboundService({ repo, crypto, hasher, outbound, cfg, metrics, logger, now });
  const turns = createTurnProcessor({ repo, crypto, cfg, services, metrics, logger, audit, now });
  const retention = createRetentionJob({ repo, cfg, audit, metrics, logger, now });
  const ops = createOpsService({ repo, hotel, booking, cfg, metrics, logger, audit, now });

  // ------------------------------------------------------------------ HTTP
  const router = createRouter({ logger, metrics });
  const auth = (ctx, perm) => {
    const p = authenticate(ctx.headers, cfg.serviceTokens);
    authorize(p, perm);
    return p;
  };

  router.get('/health', async () => ({ ok: true }));
  router.get('/metrics', async (ctx) => {
    auth(ctx, 'metrics:read');
    return { __text: metrics.render(), contentType: 'text/plain; version=0.0.4' };
  });

  // WF01 — inscrição do webhook (GET de verificação repassado pelo n8n)
  router.get('/internal/inbound/verificacao', async (ctx) => {
    auth(ctx, 'inbound:process');
    const ch = verifySubscription(ctx.query, cfg.whatsapp.verifyToken);
    if (!ch) throw Errors.forbidden('Token de verificação inválido');
    return { challenge: ch };
  });
  // WF01 — recepção de eventos: corpo bruto em base64 + cabeçalho de assinatura
  router.post('/internal/inbound', async (ctx) => {
    auth(ctx, 'inbound:process');
    const { corpo_bruto_base64: b64, assinatura } = ctx.body;
    if (typeof b64 !== 'string' || b64.length > 400000) throw Errors.validation('corpo_bruto_base64 obrigatório');
    return inbound.process({ rawBody: Buffer.from(b64, 'base64'), assinatura });
  });

  // WF02/WF03 — turnos
  router.post('/internal/turnos/iniciar', async (ctx) => {
    auth(ctx, 'turn:process');
    if (typeof ctx.body.conversa_id !== 'string') throw Errors.validation('conversa_id obrigatório');
    return turns.begin({ conversaId: ctx.body.conversa_id });
  });
  router.post('/internal/turnos/:id/classificacao', async (ctx) => {
    auth(ctx, 'turn:process');
    return turns.classification({ turnoId: ctx.params.id, intencoes: ctx.body.intencoes });
  });
  router.post('/internal/turnos/:id/resposta', async (ctx) => {
    auth(ctx, 'turn:process');
    return turns.reply({ turnoId: ctx.params.id, texto: typeof ctx.body.texto === 'string' ? ctx.body.texto : '' });
  });
  router.post('/internal/turnos/:id/falha', async (ctx) => {
    auth(ctx, 'turn:process');
    return turns.fail({ turnoId: ctx.params.id, motivo: ctx.body.motivo });
  });
  router.get('/internal/agente/configuracao', async (ctx) => {
    auth(ctx, 'turn:process');
    return { prompt_sistema: PROMPTS.sistema, prompt_classificador: PROMPTS.classificador, ferramentas: TOOLS.map(({ nome, descricao, parametros }) => ({ nome, descricao, parametros })) };
  });

  // WF03 — ferramentas da IA (lista permitida + validação)
  router.post('/internal/ferramentas/:nome', async (ctx) => {
    const principal = auth(ctx, 'tools:execute');
    return tools.execute({ nome: ctx.params.nome, argumentos: ctx.body, turnoId: ctx.headers['x-turno-id'], principal, correlacao: ctx.correlacao });
  });

  // WF09 — saída
  router.post('/internal/saida/enviar', async (ctx) => {
    auth(ctx, 'outbound:send');
    const b = ctx.body;
    if (!b.conversa_id || !b.mensagem || !b.chave_deduplicacao) throw Errors.validation('conversa_id, mensagem e chave_deduplicacao obrigatórios');
    if (!['agente', 'sistema'].includes(b.origem)) throw Errors.validation('origem inválida');
    return outbound.send({ conversaId: b.conversa_id, mensagem: b.mensagem, finalidade: b.finalidade || 'atendimento', origem: b.origem, chaveDeduplicacao: String(b.chave_deduplicacao).slice(0, 200), correlacao: ctx.correlacao });
  });

  // WF11/WF12 — operação
  router.post('/internal/ops/erros', async (ctx) => {
    auth(ctx, 'ops:report_error');
    return ops.reportError(ctx.body);
  });
  router.get('/internal/ops/saude', async (ctx) => {
    auth(ctx, 'ops:read');
    return ops.health();
  });
  router.post('/internal/ops/varredura', async (ctx) => {
    auth(ctx, 'jobs:run');
    return ops.sweep();
  });
  router.post('/internal/jobs/retencao', async (ctx) => {
    const p = auth(ctx, 'jobs:run');
    return retention.run({ executor: p.ator });
  });

  // ------------------------------------------------------------ Equipe (atendentes / DPO / supervisão)
  router.get('/admin/atendimentos', async (ctx) => {
    auth(ctx, 'handoff:read');
    return { atendimentos: await handoff.list({ estado: ctx.query.estado, fila: ctx.query.fila }) };
  });
  router.post('/admin/atendimentos/:id/assumir', async (ctx) => {
    const p = auth(ctx, 'handoff:assign');
    return handoff.assign({ id: ctx.params.id, atendente: p.ator });
  });
  router.get('/admin/atendimentos/:id/mensagens', async (ctx) => {
    const p = auth(ctx, 'handoff:reply');
    const h = await handoff.assertAssigned({ id: ctx.params.id, atendente: p.ator });
    const msgs = await repo.listRecentMessages(h.conversa_id, 30);
    await audit({ ator: p.ator, operacao: 'atendimento.leitura_mensagens', recurso: h.id, resultado: 'ok' });
    return { mensagens: msgs.reverse().map((m) => ({ direcao: m.direcao, criado_em: m.criado_em, texto: m.conteudo_cifrado ? crypto.decrypt(m.conteudo_cifrado) : null })) };
  });
  router.post('/admin/atendimentos/:id/responder', async (ctx) => {
    const p = auth(ctx, 'handoff:reply');
    const h = await handoff.assertAssigned({ id: ctx.params.id, atendente: p.ator });
    const texto = String(ctx.body.texto || '').trim();
    if (!texto || texto.length > 4000) throw Errors.validation('texto inválido');
    return outbound.send({ conversaId: h.conversa_id, mensagem: { tipo: 'texto', texto }, finalidade: 'atendimento', origem: 'atendente', chaveDeduplicacao: ctx.body.chave_deduplicacao || newId('atdmsg'), correlacao: ctx.correlacao });
  });
  router.post('/admin/atendimentos/:id/encerrar', async (ctx) => {
    const p = auth(ctx, 'handoff:close');
    const r = await handoff.close({ id: ctx.params.id, atendente: p.ator, retomarAutomacao: ctx.body.retomar_automacao === true });
    if (r.mensagem) await outbound.send({ conversaId: r.conversa_id, mensagem: r.mensagem, finalidade: 'atendimento', origem: 'sistema', chaveDeduplicacao: `encerramento:${ctx.params.id}` });
    return r;
  });

  router.get('/admin/privacidade/solicitacoes', async (ctx) => {
    auth(ctx, 'privacy:read');
    return { solicitacoes: await privacy.list({ estado: ctx.query.estado }) };
  });
  router.post('/admin/privacidade/exportar', async (ctx) => {
    const p = auth(ctx, 'privacy:execute');
    return privacy.exportSubject({ telefone: ctx.body.telefone, executor: p.ator, solicitacaoId: ctx.body.solicitacao_id });
  });
  router.post('/admin/privacidade/eliminar', async (ctx) => {
    const p = auth(ctx, 'privacy:execute');
    return privacy.eliminate({ solicitacaoId: ctx.body.solicitacao_id, telefone: ctx.body.telefone, executor: p.ator });
  });
  router.post('/admin/privacidade/solicitacoes/:id/estado', async (ctx) => {
    const p = auth(ctx, 'privacy:execute');
    return privacy.updateStatus({ solicitacaoId: ctx.params.id, estado: ctx.body.estado, resultado: ctx.body.resultado, executor: p.ator });
  });
  router.post('/admin/privacidade/bloqueio-legal', async (ctx) => {
    const p = auth(ctx, 'legalhold:set');
    return privacy.setLegalHold({ conversaId: ctx.body.conversa_id, ativo: ctx.body.ativo, justificativa: ctx.body.justificativa, executor: p.ator });
  });
  router.put('/admin/modelos', async (ctx) => {
    const p = auth(ctx, 'templates:write');
    const b = ctx.body;
    if (!b.nome || !b.idioma || !['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(b.categoria)) throw Errors.validation('Modelo inválido');
    await repo.upsertTemplate({ id: newId('tpl'), nome: b.nome, idioma: b.idioma, categoria: b.categoria, finalidade: b.finalidade, estado: b.estado, qtd_parametros: b.qtd_parametros || 0, corpo_referencia: b.corpo_referencia || null, atualizado_em: now().toISOString() });
    await audit({ ator: p.ator, operacao: 'modelo.atualizado', recurso: `${b.nome}:${b.idioma}`, resultado: b.estado });
    return { ok: true };
  });

  // ------------------------------------------------------------ Página pública de verificação reforçada
  router.get('/verificacao/:token', async (ctx) => ({ __html: page('Confirmação de segurança', `<p>Você solicitou, pelo WhatsApp, uma operação em uma reserva. Confirme abaixo somente se foi você.</p><form method="post"><button type="submit">Confirmo que fui eu</button></form><p><small>Se não reconhece esta solicitação, ignore esta página.</small></p>`) }));
  router.post('/verificacao/:token', async (ctx) => {
    const r = await reservations.confirmStrongLink(ctx.params.token);
    return r.ok
      ? { __html: page('Confirmado', '<p>Confirmação registrada. Volte ao WhatsApp para continuar o atendimento.</p>') }
      : { __html: page('Link inválido', '<p>Este link é inválido ou expirou. Solicite um novo pelo WhatsApp.</p>'), status: 400 };
  });

  return { cfg, router, repo, metrics, logger, crypto, hasher, hotel, hotelDriver, waClient, notifier, services, tools, turns, inbound, outbound, retention, ops, now };
}

function page(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}button{font-size:1rem;padding:.7rem 1.2rem}</style></head><body><h1>${title}</h1>${body}</body></html>`;
}
