// ============================================================================
//  DRIVER SIMULADO — AMBIENTE DE TESTE. NENHUM DADO AQUI É REAL.
//  Hotéis, tarifas, disponibilidade e reservas são sintéticos e determinísticos.
//  Bloqueado em APP_ENV=producao por validateConfig().
// ============================================================================
import { Errors } from '../../util/errors.js';
import { nightsBetween } from '../../util/dates.js';
import { randomBytes } from 'node:crypto';

export const SIM_HOTELS = [
  { codigo: 'SIM-SP-01', cidade: 'São Paulo' },
  { codigo: 'SIM-FLN-01', cidade: 'Florianópolis' },
  { codigo: 'SIM-GRA-01', cidade: 'Gramado' },
];

const ROOMS = {
  'SIM-SP-01': [
    { codigo: 'STD', nome: 'Standard (SIMULADO)', adultos: 2, criancas: 1, total: 3, diaria: 320 },
    { codigo: 'LUX', nome: 'Luxo (SIMULADO)', adultos: 3, criancas: 1, total: 4, diaria: 480 },
  ],
  'SIM-FLN-01': [
    { codigo: 'STD', nome: 'Standard Vista Jardim (SIMULADO)', adultos: 2, criancas: 1, total: 3, diaria: 390 },
    { codigo: 'FAM', nome: 'Família (SIMULADO)', adultos: 4, criancas: 2, total: 5, diaria: 650 },
  ],
  'SIM-GRA-01': [{ codigo: 'CHL', nome: 'Chalé (SIMULADO)', adultos: 2, criancas: 2, total: 4, diaria: 560 }],
};

export function createMockHotelDriver({ now = () => new Date() } = {}) {
  const bookings = new Map(); // codigo -> reserva
  const byIdem = new Map(); // idempotencyKey -> codigo
  let priceFactor = 1;
  const scenario = { mode: null }; // ver setScenario

  const fail = () => {
    switch (scenario.mode) {
      case 'indisponivel':
        throw Errors.upstream('PMS simulado indisponível', true);
      case 'timeout':
        throw Object.assign(Errors.upstream('Tempo esgotado no PMS simulado', true), { timeout: true });
      default:
    }
  };

  const price = (room, noites) => (room.diaria * noites * priceFactor).toFixed(2);

  const driver = {
    name: 'simulado',
    simulated: true,
    capabilities: [
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
    setScenario(mode) {
      scenario.mode = mode;
    },
    setPriceFactor(f) {
      priceFactor = f;
    },
    seedBooking(b) {
      bookings.set(b.codigo_confirmacao, { ...b });
    },
    _bookings: bookings,

    async health() {
      fail();
      return true;
    },

    async searchAvailability({ hotelCodigo, entrada, saida, adultos, criancasIdades = [], quartos = 1 }) {
      fail();
      if (scenario.mode === 'resposta_invalida') return { ofertas: [{ codigo_oferta: 'x', valor_total: 'abc' }], consultado_em: now().toISOString() };
      const noites = nightsBetween(entrada, saida);
      const rooms = ROOMS[hotelCodigo] || [];
      const validade = new Date(now().getTime() + 20 * 60000).toISOString();
      const ofertas =
        scenario.mode === 'sem_disponibilidade'
          ? []
          : rooms
              .filter((r) => adultos <= r.adultos * quartos && adultos + criancasIdades.length <= r.total * quartos && criancasIdades.length <= r.criancas * quartos)
              .map((r) => ({
                codigo_oferta: `SIMOFF-${hotelCodigo}-${r.codigo}-${entrada}-${saida}-${adultos}-${criancasIdades.join('.')}-${quartos}`,
                hotel_codigo: hotelCodigo,
                acomodacao_codigo: r.codigo,
                acomodacao_nome: r.nome,
                plano_tarifario: 'Tarifa flexível com café da manhã (SIMULADO)',
                noites,
                valor_total: (Number(price(r, noites)) * quartos).toFixed(2),
                valor_medio_diaria: ((Number(price(r, noites)) * quartos) / noites).toFixed(2),
                moeda: 'BRL',
                impostos_incluidos: true,
                taxas_descricao: 'Valores simulados com impostos incluídos.',
                politica_cancelamento: 'SIMULADO: cancelamento gratuito até 48h antes da entrada; após, multa de 1 diária.',
                condicoes_pagamento: 'SIMULADO: pagamento no hotel na chegada.',
                validade,
                quartos_disponiveis: 3,
              }));
      return { ofertas, consultado_em: now().toISOString() };
    },

    async getBookingRequirements() {
      fail();
      return { campos: ['nome', 'sobrenome', 'email'] };
    },

    async createBooking({ codigoOferta, hotelCodigo, entrada, saida, adultos, criancasIdades = [], quartos = 1, valorTotalEsperado, moeda, hospede, idempotencyKey }) {
      if (byIdem.has(idempotencyKey)) return toResult(bookings.get(byIdem.get(idempotencyKey)));
      if (scenario.mode === 'indisponivel') fail();
      if (scenario.mode === 'reserva_recusada') return { status: 'recusada', motivo: 'Sem disponibilidade no momento da confirmação (SIMULADO)' };
      if (scenario.mode === 'resposta_invalida_reserva') return { status: 'confirmada' }; // sem código: deve ser rejeitada pela validação
      const { ofertas } = await driver.searchAvailability({ hotelCodigo, entrada, saida, adultos, criancasIdades, quartos });
      const oferta = ofertas.find((o) => o.codigo_oferta === codigoOferta);
      if (!oferta) return { status: 'recusada', motivo: 'Oferta indisponível (SIMULADO)' };
      if (oferta.valor_total !== valorTotalEsperado || oferta.moeda !== moeda) {
        return { status: 'recusada', motivo: 'PRECO_ALTERADO' };
      }
      const codigo = `SIM-${randomBytes(4).toString('hex').toUpperCase()}`;
      const b = {
        codigo_confirmacao: codigo,
        hotel_codigo: hotelCodigo,
        entrada,
        saida,
        status: scenario.mode === 'reserva_pendente' || scenario.mode === 'reserva_timeout' ? 'pendente' : 'confirmada',
        acomodacao_nome: oferta.acomodacao_nome,
        quantidade_hospedes: adultos + criancasIdades.length,
        titular_sobrenome: hospede.sobrenome,
        contato_verificacao_email: hospede.email ?? null,
        valor_total: oferta.valor_total,
        moeda: oferta.moeda,
        politica_cancelamento: oferta.politica_cancelamento,
      };
      bookings.set(codigo, b);
      byIdem.set(idempotencyKey, codigo);
      if (scenario.mode === 'reserva_timeout') {
        // A reserva foi registrada no PMS, mas a resposta "se perdeu".
        throw Object.assign(Errors.upstream('Tempo esgotado ao confirmar (SIMULADO)', true), { timeout: true });
      }
      return toResult(b);
    },

    // Usado pelo teste de "confirmação recebida após timeout".
    completePending(idempotencyKey) {
      const b = bookings.get(byIdem.get(idempotencyKey));
      if (b) b.status = 'confirmada';
    },

    async findBookingByIdempotencyKey(key) {
      fail();
      const codigo = byIdem.get(key);
      return codigo ? toResult(bookings.get(codigo)) : null;
    },

    async getBooking(codigo) {
      fail();
      const b = bookings.get(codigo);
      return b ? { ...b } : null;
    },

    async quoteCancellation(codigo) {
      fail();
      const b = bookings.get(codigo);
      if (!b || b.status !== 'confirmada') return { permitido: false, motivo_recusa: 'Reserva não está confirmada' };
      const horas = (Date.parse(`${b.entrada}T14:00:00-03:00`) - now().getTime()) / 3600000;
      const diaria = (Number(b.valor_total) / nightsBetween(b.entrada, b.saida)).toFixed(2);
      return horas >= 48
        ? { permitido: true, multa_valor: '0.00', moeda: b.moeda, descricao: 'Cancelamento sem multa (SIMULADO).' }
        : { permitido: true, multa_valor: diaria, moeda: b.moeda, descricao: 'Cancelamento com multa de 1 diária (SIMULADO).' };
    },

    async cancelBooking({ codigo }) {
      fail();
      const b = bookings.get(codigo);
      if (!b || b.status !== 'confirmada') return { status: 'recusada', motivo: 'Reserva não está confirmada' };
      b.status = 'cancelada';
      return { status: 'cancelada', codigo_cancelamento: `SIMCXL-${codigo}` };
    },

    async quoteModification({ codigo, novaEntrada, novaSaida }) {
      fail();
      const b = bookings.get(codigo);
      if (!b || b.status !== 'confirmada') return { permitido: false, motivo_recusa: 'Reserva não está confirmada' };
      if (b.hotel_codigo === 'SIM-GRA-01') return { permitido: false, motivo_recusa: 'Alteração não permitida para esta tarifa (SIMULADO)' };
      const room = (ROOMS[b.hotel_codigo] || []).find((r) => r.nome === b.acomodacao_nome);
      const noites = nightsBetween(novaEntrada, novaSaida);
      const novo = price(room, noites);
      return {
        permitido: true,
        codigo_oferta: `SIMMOD-${codigo}-${novaEntrada}-${novaSaida}`,
        novo_valor_total: novo,
        diferenca: (Number(novo) - Number(b.valor_total)).toFixed(2),
        moeda: b.moeda,
        descricao: 'Alteração sujeita à disponibilidade (SIMULADO).',
      };
    },

    async modifyBooking({ codigo, codigoOferta }) {
      fail();
      const b = bookings.get(codigo);
      const m = /^SIMMOD-.+-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/.exec(codigoOferta || '');
      if (!b || !m) return { status: 'recusada', motivo: 'Oferta de alteração inválida' };
      const room = (ROOMS[b.hotel_codigo] || []).find((r) => r.nome === b.acomodacao_nome);
      Object.assign(b, { entrada: m[1], saida: m[2], valor_total: price(room, nightsBetween(m[1], m[2])) });
      return { status: 'alterada', entrada: b.entrada, saida: b.saida, valor_total: b.valor_total, moeda: b.moeda };
    },
  };
  return driver;
}

function toResult(b) {
  return {
    status: b.status === 'confirmada' ? 'confirmada' : 'pendente',
    codigo_confirmacao: b.codigo_confirmacao,
    hotel_codigo: b.hotel_codigo,
    entrada: b.entrada,
    saida: b.saida,
    valor_total: b.valor_total,
    moeda: b.moeda,
    motivo: null,
    instrucoes_chegada: 'SIMULADO: apresente um documento com foto na recepção.',
  };
}
