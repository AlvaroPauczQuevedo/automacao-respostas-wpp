// Esquemas de validação das RESPOSTAS dos sistemas hoteleiros (PMS / motor de reservas).
// Toda resposta externa é validada antes de ser usada; resposta fora do contrato = erro, nunca "melhor esforço".
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Errors } from '../../util/errors.js';

const ajv = new Ajv({ allErrors: true, removeAdditional: false, strict: false });
addFormats(ajv);

const money = { type: 'string', pattern: '^\\d{1,9}(\\.\\d{1,2})?$' };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const date = { type: 'string', format: 'date' };

export const offerSchema = {
  type: 'object',
  required: ['codigo_oferta', 'hotel_codigo', 'acomodacao_codigo', 'acomodacao_nome', 'valor_total', 'moeda', 'noites'],
  properties: {
    codigo_oferta: { type: 'string', minLength: 1, maxLength: 200 },
    hotel_codigo: { type: 'string', minLength: 1 },
    acomodacao_codigo: { type: 'string', minLength: 1 },
    acomodacao_nome: { type: 'string', minLength: 1, maxLength: 200 },
    plano_tarifario: { type: ['string', 'null'], maxLength: 200 },
    noites: { type: 'integer', minimum: 1 },
    valor_total: money,
    valor_medio_diaria: { anyOf: [money, { type: 'null' }] },
    moeda: currency,
    impostos_incluidos: { type: ['boolean', 'null'] },
    taxas_descricao: { type: ['string', 'null'], maxLength: 500 },
    politica_cancelamento: { type: ['string', 'null'], maxLength: 1000 },
    condicoes_pagamento: { type: ['string', 'null'], maxLength: 1000 },
    validade: { type: ['string', 'null'], format: 'date-time' },
    quartos_disponiveis: { type: ['integer', 'null'], minimum: 0 },
  },
};

export const availabilitySchema = {
  type: 'object',
  required: ['ofertas', 'consultado_em'],
  properties: {
    ofertas: { type: 'array', maxItems: 50, items: offerSchema },
    consultado_em: { type: 'string', format: 'date-time' },
  },
};

export const bookingResultSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['confirmada', 'pendente', 'recusada'] },
    codigo_confirmacao: { type: ['string', 'null'], maxLength: 64 },
    hotel_codigo: { type: ['string', 'null'] },
    entrada: { anyOf: [date, { type: 'null' }] },
    saida: { anyOf: [date, { type: 'null' }] },
    valor_total: { anyOf: [money, { type: 'null' }] },
    moeda: { anyOf: [currency, { type: 'null' }] },
    motivo: { type: ['string', 'null'], maxLength: 300 },
    instrucoes_chegada: { type: ['string', 'null'], maxLength: 1000 },
  },
  if: { properties: { status: { const: 'confirmada' } } },
  then: { required: ['status', 'codigo_confirmacao', 'hotel_codigo', 'entrada', 'saida', 'valor_total', 'moeda'] },
};

export const bookingDetailsSchema = {
  type: 'object',
  required: ['codigo_confirmacao', 'hotel_codigo', 'entrada', 'saida', 'status', 'titular_sobrenome'],
  properties: {
    codigo_confirmacao: { type: 'string' },
    hotel_codigo: { type: 'string' },
    entrada: date,
    saida: date,
    status: { enum: ['confirmada', 'cancelada', 'pendente', 'no_show', 'hospedado', 'finalizada'] },
    acomodacao_nome: { type: ['string', 'null'] },
    quantidade_hospedes: { type: ['integer', 'null'] },
    titular_sobrenome: { type: 'string' },
    contato_verificacao_email: { type: ['string', 'null'] },
    valor_total: { anyOf: [money, { type: 'null' }] },
    moeda: { anyOf: [currency, { type: 'null' }] },
    politica_cancelamento: { type: ['string', 'null'] },
  },
};

export const cancellationQuoteSchema = {
  type: 'object',
  required: ['permitido'],
  properties: {
    permitido: { type: 'boolean' },
    multa_valor: { anyOf: [money, { type: 'null' }] },
    moeda: { anyOf: [currency, { type: 'null' }] },
    descricao: { type: ['string', 'null'], maxLength: 1000 },
    motivo_recusa: { type: ['string', 'null'], maxLength: 300 },
  },
};

export const cancellationResultSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['cancelada', 'pendente', 'recusada'] },
    codigo_cancelamento: { type: ['string', 'null'] },
    motivo: { type: ['string', 'null'] },
  },
  if: { properties: { status: { const: 'cancelada' } } },
  then: { required: ['status', 'codigo_cancelamento'] },
};

export const modificationQuoteSchema = {
  type: 'object',
  required: ['permitido'],
  properties: {
    permitido: { type: 'boolean' },
    codigo_oferta: { type: ['string', 'null'] },
    novo_valor_total: { anyOf: [money, { type: 'null' }] },
    diferenca: { type: ['string', 'null'], pattern: '^-?\\d{1,9}(\\.\\d{1,2})?$' },
    moeda: { anyOf: [currency, { type: 'null' }] },
    descricao: { type: ['string', 'null'] },
    motivo_recusa: { type: ['string', 'null'] },
  },
};

export const modificationResultSchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['alterada', 'pendente', 'recusada'] },
    entrada: { anyOf: [date, { type: 'null' }] },
    saida: { anyOf: [date, { type: 'null' }] },
    valor_total: { anyOf: [money, { type: 'null' }] },
    moeda: { anyOf: [currency, { type: 'null' }] },
    motivo: { type: ['string', 'null'] },
  },
};

export const requirementsSchema = {
  type: 'object',
  required: ['campos'],
  properties: {
    campos: { type: 'array', items: { enum: ['nome', 'sobrenome', 'email', 'telefone', 'documento', 'pais'] } },
  },
};

const compiled = new Map();
export function assertValid(schema, data, label) {
  let v = compiled.get(schema);
  if (!v) {
    v = ajv.compile(schema);
    compiled.set(schema, v);
  }
  if (!v(data)) {
    throw Errors.upstreamInvalid(`Resposta inválida da integração hoteleira (${label})`, {
      violacoes: v.errors.slice(0, 5).map((e) => `${e.instancePath || '/'} ${e.message}`),
    });
  }
  return data;
}
