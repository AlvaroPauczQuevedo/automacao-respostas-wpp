// Retentativa com backoff exponencial e jitter, apenas para erros marcados como retentáveis.
export async function withRetry(fn, { retries = 2, baseMs = 300, maxMs = 4000, isRetryable = (e) => e?.retryable, sleep = defaultSleep, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + Math.random() / 2);
      onRetry?.(err, attempt, delay);
      await sleep(delay);
      attempt += 1;
    }
  }
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
