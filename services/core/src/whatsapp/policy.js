// Política de envio — função pura avaliada ANTES de toda mensagem de saída.
// Checklist (seção 16 do projeto):
//  1 destinatário contatável p/ finalidade  2 compatibilidade  3 janela aberta  4 resposta livre permitida
//  5 modelo necessário  6 modelo aprovado  7 finalidade do modelo  8 opt-out  9 limites  10 duplicidade
// (9 e 10 dependem de estado e são verificados no serviço de saída.)

export const FINALIDADES = ['atendimento', 'operacional', 'marketing'];

export function isWindowOpen(ultimaEntradaIso, now, windowHours) {
  if (!ultimaEntradaIso) return false;
  return now.getTime() - Date.parse(ultimaEntradaIso) < windowHours * 3600 * 1000;
}

/**
 * @returns {{permitido:boolean, motivo?:string, exigeModelo?:boolean}}
 */
export function evaluateSendPolicy({ conversa, mensagem, finalidade, origem, modelo, preferenciaMarketing, marketingHabilitado, now, windowHours }) {
  if (!FINALIDADES.includes(finalidade)) return { permitido: false, motivo: 'finalidade_invalida' };
  if (!conversa || !conversa.wa_id_cifrado) return { permitido: false, motivo: 'destinatario_indisponivel' };
  if (conversa.estado === 'suspensa') return { permitido: false, motivo: 'conversa_suspensa' };

  // Atendimento humano exclusivo: o agente automatizado não fala. Mensagens de sistema da própria
  // transferência e mensagens de atendentes (origem 'atendente') continuam permitidas.
  if (conversa.estado === 'em_atendimento_humano' && origem === 'agente') {
    return { permitido: false, motivo: 'conversa_em_atendimento_humano' };
  }

  if (finalidade === 'marketing') {
    if (!marketingHabilitado) return { permitido: false, motivo: 'marketing_desabilitado' };
    if (!preferenciaMarketing || preferenciaMarketing.estado !== 'concedida') return { permitido: false, motivo: 'sem_permissao_marketing' };
    if (mensagem.tipo !== 'modelo') return { permitido: false, motivo: 'marketing_somente_por_modelo' };
  }

  const janelaAberta = isWindowOpen(conversa.ultima_entrada_cliente_em, now, windowHours);

  if (mensagem.tipo !== 'modelo') {
    if (!janelaAberta) return { permitido: false, motivo: 'fora_da_janela_exige_modelo', exigeModelo: true };
    return { permitido: true };
  }

  // Mensagem por modelo
  if (!modelo) return { permitido: false, motivo: 'modelo_inexistente' };
  if (modelo.estado !== 'aprovado') return { permitido: false, motivo: `modelo_${modelo.estado}` };
  if (modelo.idioma !== mensagem.modelo.idioma) return { permitido: false, motivo: 'modelo_idioma_divergente' };
  if ((mensagem.modelo.parametros?.length || 0) !== modelo.qtd_parametros) return { permitido: false, motivo: 'modelo_parametros_divergentes' };
  const esperado = finalidade === 'marketing' ? 'MARKETING' : 'UTILITY';
  if (modelo.categoria !== esperado) return { permitido: false, motivo: 'modelo_categoria_incompativel_com_finalidade' };
  if (modelo.finalidade !== finalidade && !(finalidade === 'atendimento' && modelo.finalidade === 'operacional')) {
    return { permitido: false, motivo: 'modelo_finalidade_divergente' };
  }
  return { permitido: true };
}

// Palavras-chave de interrupção de mensagens promocionais (determinísticas, não dependem da IA).
const OPT_OUT = /^\s*(parar|pare|sair|stop|cancelar promo[cç](oes|ões)|n[aã]o quero (mais )?(receber )?(promo[cç](oes|ões)|ofertas|mensagens))\s*[.!]*\s*$/i;
export function isMarketingOptOut(text) {
  return typeof text === 'string' && OPT_OUT.test(text);
}
