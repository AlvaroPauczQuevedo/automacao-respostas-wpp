import { randomBytes, randomUUID } from 'node:crypto';

// Identificadores internos opacos e não sequenciais (dificultam enumeração).
export function newId(prefix) {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
export function correlationId() {
  return randomUUID();
}

// JSON canônico (chaves ordenadas recursivamente) — necessário para hashes estáveis,
// pois o jsonb do PostgreSQL não preserva a ordem das chaves.
export function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
