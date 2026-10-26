import { redactObject, redactText } from '../security/redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Logger JSON estruturado. Todo campo passa por mascaramento antes da escrita.
// Política: docs/12-politica-logs.md (sem conteúdo de mensagens, sem segredos, sem dados de hóspedes).
export function createLogger({ level = 'info', sink = (line) => process.stdout.write(line + '\n'), base = {} } = {}) {
  const min = LEVELS[level] ?? 20;
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const entry = { ts: new Date().toISOString(), level: lvl, msg: redactText(String(msg)), ...redactObject({ ...base, ...fields }) };
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (extra) => createLogger({ level, sink, base: { ...base, ...extra } }),
  };
}
