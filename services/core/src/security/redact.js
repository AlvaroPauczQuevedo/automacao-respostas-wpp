// Mascaramento de dados pessoais em textos destinados a logs, resumos de transferência e auditoria.
// Abordagem conservadora: prefere mascarar a mais do que a menos.

const PATTERNS = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, repl: '[EMAIL]' },
  { name: 'cvv', re: /\b(cvv|cvc|c[oó]digo de seguran[cç]a)\s*[:=]?\s*\d{3,4}\b/gi, repl: '$1 [CVV]' },
  { name: 'cartao', re: /\b(?:\d[ -]?){13,19}\b/g, repl: '[CARTAO]' },
  { name: 'cpf', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, repl: '[CPF]' },
  { name: 'telefone', re: /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?\d{4,5}[\s-]?\d{4}\b/g, repl: '[TELEFONE]' },
  { name: 'documento', re: /\b(rg|passaporte|passport|documento)\s*[:nº#]*\s*[A-Za-z0-9.-]{5,}/gi, repl: '$1 [DOCUMENTO]' },
];

export function redactText(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, p.repl);
  return out;
}

const SENSITIVE_KEYS =
  /(token|secret|senha|password|authorization|cookie|api[_-]?key|cartao|card|cvv|cpf|documento|email|telefone|phone|wa_id|^from$|nome|name|sobrenome|surname|endereco|address|conteudo|^text$|^body$|hospede|guest|cifrad)/i;

// Mascara recursivamente objetos para log. Mantém a estrutura para depuração.
export function redactObject(value, depth = 0) {
  if (depth > 6) return '[PROFUNDO]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactObject(v, depth + 1));
  if (value instanceof Error) return { name: value.name, code: value.code, message: redactText(value.message) };
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(k)) out[k] = v == null ? v : '[REDACTED]';
      else out[k] = redactObject(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return redactText(value);
  return value;
}

// Detecta número de cartão válido (Luhn) — nunca deve aparecer em mensagens de saída.
export function containsCardNumber(text) {
  const candidates = String(text).match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  return candidates.some((c) => luhn(c.replace(/\D/g, '')));
}
function luhn(num) {
  if (num.length < 13 || num.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = num.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
