// Datas de hospedagem são datas civis (YYYY-MM-DD) no fuso do hotel.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function nightsBetween(entrada, saida) {
  const a = Date.parse(`${entrada}T00:00:00Z`);
  const b = Date.parse(`${saida}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// "Hoje" no fuso informado, como YYYY-MM-DD.
export function todayInZone(timeZone = 'America/Sao_Paulo', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDateBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Validação de período de hospedagem com regras configuráveis.
export function validateStay({ entrada, saida }, { timeZone, maxNoites, antecedenciaMaxDias, now }) {
  const problemas = [];
  if (!isIsoDate(entrada)) problemas.push('data_entrada_invalida');
  if (!isIsoDate(saida)) problemas.push('data_saida_invalida');
  if (problemas.length) return { ok: false, problemas };
  const hoje = todayInZone(timeZone, now);
  if (entrada < hoje) problemas.push('data_entrada_no_passado');
  const noites = nightsBetween(entrada, saida);
  if (noites <= 0) problemas.push('saida_deve_ser_posterior_a_entrada');
  if (noites > maxNoites) problemas.push('periodo_excede_limite');
  if (entrada > addDays(hoje, antecedenciaMaxDias)) problemas.push('antecedencia_excede_limite');
  return problemas.length ? { ok: false, problemas } : { ok: true, noites };
}
