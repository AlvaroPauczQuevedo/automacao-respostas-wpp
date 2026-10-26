// Valores monetários trafegam como string decimal ("1234.50") + moeda ISO 4217
// para evitar erros de ponto flutuante. Apresentação em pt-BR.
const DEC = /^\d{1,9}(\.\d{1,2})?$/;
export function isDecimalString(v) {
  return typeof v === 'string' && DEC.test(v);
}
export function formatMoney(valor, moeda = 'BRL') {
  const n = Number(valor);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(n);
}
// Extrai valores monetários escritos num texto (R$ 1.234,56 / 1234,56 / BRL 99).
export function extractAmounts(text) {
  const out = [];
  const re = /(?:R\$|BRL|US\$|USD|€|EUR)\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(text))) {
    let raw = m[1];
    if (/,\d{1,2}$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, '');
    out.push(Number(raw).toFixed(2));
  }
  return out;
}
