// Driver HTTP genérico que consome o contrato contracts/hotel-integration.openapi.yaml.
// Uso previsto: um middleware de integração (fornecido pelo PMS, por um integrador ou construído
// pela rede) expõe esse contrato e traduz para a API proprietária do PMS.
// STATUS: implementado e testado apenas contra servidor HTTP local de teste; NÃO validado contra PMS real.
import { Errors } from '../../util/errors.js';
import { fetchWithTimeout } from '../../util/retry.js';

export function createRestHotelDriver({ baseUrl, token, timeoutMs = 12000, capabilities }) {
  if (!baseUrl) throw new Error('HOTEL_API_BASE_URL obrigatório para o driver REST');
  const base = baseUrl.replace(/\/+$/, '');

  const req = async (method, path, { query, body, idempotencyKey, allow404 = false } = {}) => {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let res;
    try {
      res = await fetchWithTimeout(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, timeoutMs);
    } catch (err) {
      const timeout = err?.name === 'AbortError';
      throw Object.assign(Errors.upstream(timeout ? 'Tempo esgotado na integração hoteleira' : 'Falha de rede na integração hoteleira', true), { timeout });
    }
    if (allow404 && res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw Errors.upstream(`Integração hoteleira respondeu ${res.status}`, true);
    if (res.status >= 400) throw Errors.upstream(`Integração hoteleira recusou a requisição (${res.status})`, false);
    try {
      return await res.json();
    } catch {
      throw Errors.upstreamInvalid('Resposta não-JSON da integração hoteleira');
    }
  };

  return {
    name: 'rest',
    simulated: false,
    capabilities: capabilities || [
      'disponibilidade',
      'requisitos_reserva',
      'reserva',
      'busca_por_idempotencia',
      'consulta_reserva',
      'cotacao_cancelamento',
      'cancelamento',
      'cotacao_alteracao',
      'alteracao',
    ],
    health: () => req('GET', '/health'),
    searchAvailability: (q) =>
      req('GET', `/hotels/${encodeURIComponent(q.hotelCodigo)}/availability`, {
        query: { checkin: q.entrada, checkout: q.saida, adults: q.adultos, children_ages: q.criancasIdades, rooms: q.quartos },
      }),
    getBookingRequirements: (q) => req('GET', `/hotels/${encodeURIComponent(q.hotelCodigo)}/booking-requirements`),
    createBooking: (r) =>
      req('POST', '/bookings', {
        idempotencyKey: r.idempotencyKey,
        body: {
          codigo_oferta: r.codigoOferta,
          hotel_codigo: r.hotelCodigo,
          entrada: r.entrada,
          saida: r.saida,
          adultos: r.adultos,
          criancas_idades: r.criancasIdades,
          quartos: r.quartos,
          valor_total_esperado: r.valorTotalEsperado,
          moeda: r.moeda,
          hospede: r.hospede,
          origem: 'whatsapp_assistente_virtual',
        },
      }),
    findBookingByIdempotencyKey: (key) => req('GET', `/bookings/by-idempotency-key/${encodeURIComponent(key)}`, { allow404: true }),
    getBooking: (codigo) => req('GET', `/bookings/${encodeURIComponent(codigo)}`, { allow404: true }),
    quoteCancellation: (codigo) => req('POST', `/bookings/${encodeURIComponent(codigo)}/cancellation-quote`),
    cancelBooking: (r) => req('POST', `/bookings/${encodeURIComponent(r.codigo)}/cancel`, { idempotencyKey: r.idempotencyKey }),
    quoteModification: (r) =>
      req('POST', `/bookings/${encodeURIComponent(r.codigo)}/modification-quote`, { body: { nova_entrada: r.novaEntrada, nova_saida: r.novaSaida } }),
    modifyBooking: (r) =>
      req('POST', `/bookings/${encodeURIComponent(r.codigo)}/modify`, { idempotencyKey: r.idempotencyKey, body: { codigo_oferta: r.codigoOferta } }),
  };
}
