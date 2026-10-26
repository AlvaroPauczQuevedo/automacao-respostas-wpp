import http from 'node:http';
import { loadConfig, validateConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './observability/logger.js';

const cfg = loadConfig();
const logger = createLogger({ level: cfg.logLevel, base: { servico: 'hotel-agent-core', ambiente: cfg.appEnv } });
const { erros, avisos } = validateConfig(cfg);
for (const a of avisos) logger.warn('configuracao', { aviso: a });
if (erros.length) {
  for (const e of erros) logger.error('configuracao_invalida', { erro: e });
  process.exit(1);
}

const app = await createApp(cfg, { logger });
if (cfg.repo === 'memory') {
  const { seedSynthetic } = await import('./dev/seed.js');
  await seedSynthetic(app.repo);
  logger.warn('repositorio_em_memoria_com_dados_simulados', {});
}
if (app.hotel.simulated || app.waClient.simulated) logger.warn('modo_simulado', { hotel: app.hotel.simulated, whatsapp: app.waClient.simulated });

const server = http.createServer((req, res) => app.router.handle(req, res));
server.headersTimeout = 15000;
server.requestTimeout = 60000;
server.listen(cfg.port, () => logger.info('servidor_iniciado', { porta: cfg.port }));

const shutdown = (sig) => {
  logger.info('encerrando', { sinal: sig });
  server.close(async () => {
    await app.repo.close?.();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
