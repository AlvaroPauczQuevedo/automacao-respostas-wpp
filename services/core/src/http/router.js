import { AppError, Errors } from '../util/errors.js';
import { correlationId } from '../util/ids.js';

// Roteador HTTP mínimo (sem framework) com limite de corpo, correlação e tratamento uniforme de erros.
export function createRouter({ logger, metrics, maxBodyBytes = 256 * 1024 }) {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, re, keys, handler, opts, pattern });
  };

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > maxBodyBytes) throw new AppError('CORPO_GRANDE', 'Corpo da requisição excede o limite', { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://local');
    const corr = /^[A-Za-z0-9-]{8,64}$/.test(req.headers['x-correlation-id'] || '') ? req.headers['x-correlation-id'] : correlationId();
    res.setHeader('x-correlation-id', corr);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    let route = null;
    let status = 500;
    try {
      let params = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (m) {
          route = r;
          params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          break;
        }
      }
      if (!route) throw Errors.notFound('Rota');
      const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
      let body = null;
      if (raw.length && !route.opts.rawBody) {
        const ct = req.headers['content-type'] || '';
        if (ct.includes('application/json')) {
          try {
            body = JSON.parse(raw.toString('utf8'));
          } catch {
            throw Errors.validation('JSON inválido');
          }
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
        } else throw new AppError('TIPO_NAO_SUPORTADO', 'Content-Type não suportado', { status: 415 });
      }
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body: body ?? {}, raw, headers: req.headers, correlacao: corr };
      const out = await route.handler(ctx);
      if (res.writableEnded) {
        status = res.statusCode;
        return;
      }
      if (out && out.__html) {
        status = out.status || 200;
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", 'x-frame-options': 'DENY' });
        res.end(out.__html);
        return;
      }
      if (out && out.__text !== undefined) {
        status = out.status || 200;
        res.writeHead(status, { 'content-type': out.contentType || 'text/plain; charset=utf-8' });
        res.end(out.__text);
        return;
      }
      status = 200;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out ?? {}));
    } catch (err) {
      const e = err instanceof AppError ? err : null;
      status = e ? e.status : 500;
      if (!e) logger.error('erro_nao_tratado', { rota: route?.pattern, err, correlacao: corr });
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      // Erros internos nunca expõem mensagem/stack: apenas código e correlação.
      res.end(JSON.stringify(e ? { ...e.toJSON(), correlacao: corr } : { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' }, correlacao: corr }));
    } finally {
      metrics.inc('http_requisicoes_total', { rota: route?.pattern || 'desconhecida', metodo: req.method, status });
      metrics.observe('http_duracao_segundos', { rota: route?.pattern || 'desconhecida' }, (Date.now() - started) / 1000);
    }
  }

  return { add, handle, get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o), put: (p, h, o) => add('PUT', p, h, o) };
}
