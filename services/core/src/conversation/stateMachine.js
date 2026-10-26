import { Errors } from '../util/errors.js';

// Máquina de estados da conversa. Transições fora desta tabela são rejeitadas.
export const STATES = ['nova', 'ativa', 'aguardando_cliente', 'aguardando_confirmacao', 'em_atendimento_humano', 'suspensa', 'encerrada'];

const T = {
  nova: ['ativa', 'aguardando_cliente', 'aguardando_confirmacao', 'em_atendimento_humano', 'suspensa', 'encerrada'],
  ativa: ['ativa', 'aguardando_cliente', 'aguardando_confirmacao', 'em_atendimento_humano', 'suspensa', 'encerrada'],
  aguardando_cliente: ['ativa', 'aguardando_cliente', 'aguardando_confirmacao', 'em_atendimento_humano', 'suspensa', 'encerrada'],
  aguardando_confirmacao: ['ativa', 'aguardando_cliente', 'aguardando_confirmacao', 'em_atendimento_humano', 'suspensa', 'encerrada'],
  // Saída do atendimento humano somente por ação autorizada de atendente (handoff.close).
  em_atendimento_humano: ['em_atendimento_humano', 'ativa', 'suspensa', 'encerrada'],
  suspensa: ['ativa', 'encerrada'],
  encerrada: ['ativa', 'em_atendimento_humano'],
};

// Transições que exigem ator humano autorizado (não podem ser feitas pelo fluxo automatizado).
const REQUIRES_STAFF = new Set(['em_atendimento_humano>ativa', 'suspensa>ativa']);

export function canTransition(from, to, { porAtendente = false } = {}) {
  if (!T[from]?.includes(to)) return false;
  if (REQUIRES_STAFF.has(`${from}>${to}`) && !porAtendente) return false;
  return true;
}

export function assertTransition(from, to, opts) {
  if (!canTransition(from, to, opts)) throw Errors.conflict(`Transição de estado não permitida: ${from} → ${to}`);
}

export function botMayRespond(conversa) {
  return conversa.estado !== 'em_atendimento_humano' && conversa.estado !== 'suspensa';
}
