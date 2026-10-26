// Catálogo de mensagens DETERMINÍSTICAS (não geradas pela IA).
// Usadas onde precisão é obrigatória: saudação com identificação de assistente virtual, resumos de
// reserva, confirmações, falhas técnicas e encaminhamentos. Revisão de texto: docs/19-catalogo-mensagens-whatsapp.md
import { formatDateBR } from '../util/dates.js';
import { formatMoney } from '../util/money.js';

const rede = (n) => (n ? `da ${n}` : 'da nossa rede de hotéis');

export const Catalog = {
  saudacao: (nomeRede) =>
    `Olá! Seja bem-vindo(a) ao atendimento virtual ${rede(nomeRede)}. ` +
    'Sou um assistente virtual automatizado — não sou uma pessoa. Posso ajudar você a conhecer nossos hotéis, ' +
    'consultar disponibilidade, verificar tarifas ou tratar de uma reserva existente.\n\n' +
    'Se preferir falar com nossa equipe a qualquer momento, escreva "atendente".\n\nComo posso ajudar?',

  indisponibilidadeTecnica: () =>
    'No momento, não consegui concluir a consulta ao sistema de reservas. Não quero informar um preço ou uma ' +
    'disponibilidade incorretos. Você pode tentar novamente em alguns minutos ou, se preferir, escreva "atendente" ' +
    'para que eu encaminhe sua solicitação à nossa equipe.',

  falhaAssistente: () =>
    'Desculpe, tive um problema técnico para processar sua mensagem. Para não deixar você sem resposta, ' +
    'posso encaminhar sua solicitação à nossa equipe: basta escrever "atendente". Você também pode tentar novamente em instantes.',

  encaminhamento: (disponibilidade) => {
    let s = 'Vou encaminhar sua solicitação para nossa equipe de atendimento, que poderá analisar o caso com mais detalhes.';
    if (disponibilidade?.configurado && !disponibilidade.aberto && disponibilidade.descricaoHorario) {
      s += ` Nosso horário de atendimento humano é ${disponibilidade.descricaoHorario}.`;
    }
    return s + ' Enquanto isso, o assistente virtual ficará em pausa nesta conversa.';
  },

  retornoAutomacao: () => 'Seu atendimento com nossa equipe foi concluído. Se precisar de algo mais, estou à disposição — sou o assistente virtual.',

  naoSuportado: () =>
    'Por enquanto consigo entender apenas mensagens de texto. Pode me escrever o que precisa? ' +
    'Se preferir, escreva "atendente" para falar com nossa equipe. Por segurança, não envie documentos ou dados de cartão por aqui.',

  mensagemTruncada: (max) => `Sua mensagem é muito longa; considerei apenas os primeiros ${max} caracteres.`,

  optOutConfirmado: () =>
    'Pronto! Você não receberá mais mensagens promocionais nossas por aqui. Mensagens sobre suas reservas e este atendimento continuam disponíveis.',

  resumoReserva: ({ hotel, cotacao, hospede, avisoPrivacidadeUrl, expiraMin }) =>
    [
      'Confira os dados da reserva antes de confirmar:',
      '',
      `🏨 Hotel: ${hotel.nome} — ${hotel.cidade}`,
      `🛏️ Acomodação: ${cotacao.acomodacao_nome}${cotacao.quartos > 1 ? ` (${cotacao.quartos} quartos)` : ''}`,
      `📅 Entrada: ${formatDateBR(cotacao.entrada)} | Saída: ${formatDateBR(cotacao.saida)} (${cotacao.noites} ${cotacao.noites === 1 ? 'diária' : 'diárias'})`,
      `👥 Hóspedes: ${cotacao.adultos} adulto(s)${cotacao.criancas_idades.length ? ` e ${cotacao.criancas_idades.length} criança(s)` : ''}`,
      `💰 Valor total: ${formatMoney(cotacao.valor_total, cotacao.moeda)}${cotacao.impostos_incluidos === true ? ' (impostos incluídos)' : cotacao.impostos_incluidos === false ? ' (impostos não incluídos)' : ''}`,
      cotacao.taxas_descricao ? `ℹ️ Taxas: ${cotacao.taxas_descricao}` : null,
      `💳 Pagamento: ${cotacao.condicoes_pagamento || 'conforme informado pelo hotel'}`,
      `↩️ Cancelamento: ${cotacao.politica_cancelamento || 'consulte a política do hotel'}`,
      `👤 Titular: ${hospede.nome} ${hospede.sobrenome}`,
      '',
      `Seus dados serão usados apenas para registrar e gerenciar esta reserva. Aviso de privacidade: ${avisoPrivacidadeUrl}`,
      '',
      `Para confirmar, toque em "Confirmar reserva" (ou responda CONFIRMAR) em até ${expiraMin} minutos. Nada será reservado sem sua confirmação.`,
    ]
      .filter((l) => l !== null)
      .join('\n'),

  reservaConfirmada: ({ hotel, r }) =>
    [
      '✅ Reserva confirmada pelo sistema do hotel.',
      '',
      `Código da reserva: ${r.codigo_confirmacao}`,
      `Hotel: ${hotel.nome} — ${hotel.cidade}`,
      `Entrada: ${formatDateBR(r.entrada)} | Saída: ${formatDateBR(r.saida)}`,
      `Valor confirmado: ${formatMoney(r.valor_total, r.moeda)}`,
      r.instrucoes_chegada ? `Chegada: ${r.instrucoes_chegada}` : null,
      hotel.telefone ? `Contato do hotel: ${hotel.telefone}` : null,
      '',
      'Posso ajudar com mais alguma coisa?',
    ]
      .filter((l) => l !== null)
      .join('\n'),

  reservaPendente: () =>
    'Sua solicitação de reserva foi enviada ao sistema do hotel, mas ainda não recebemos a confirmação final. ' +
    'Por isso, a reserva AINDA NÃO está confirmada. Vamos verificar o resultado e avisar você por aqui. ' +
    'Se preferir, escreva "atendente".',

  reservaRecusada: () =>
    'Não foi possível concluir a reserva: o sistema do hotel não confirmou a operação (por exemplo, a acomodação pode ter ficado indisponível). ' +
    'Nenhuma reserva foi criada. Posso consultar outras opções para você?',

  precoAlterado: ({ anterior, novo, moeda }) =>
    `Atenção: o valor desta opção mudou desde a cotação (de ${formatMoney(anterior, moeda)} para ${formatMoney(novo, moeda)}). ` +
    'Nenhuma reserva foi feita. Se quiser seguir com o novo valor, me avise que preparo um novo resumo para sua confirmação.',

  confirmacaoExpirada: () => 'O prazo para confirmar essa operação expirou e nada foi alterado. Se ainda quiser prosseguir, posso preparar um novo resumo.',

  operacaoCancelada: () => 'Tudo bem, a operação não foi realizada. Posso ajudar com mais alguma coisa?',

  resumoCancelamento: ({ codigo, cotacao, expiraMin }) =>
    [
      `Você está solicitando o cancelamento da reserva ${codigo}.`,
      cotacao.multa_valor && Number(cotacao.multa_valor) > 0
        ? `⚠️ Segundo o sistema do hotel, haverá multa de ${formatMoney(cotacao.multa_valor, cotacao.moeda)}.`
        : 'Segundo o sistema do hotel, não há multa para este cancelamento.',
      cotacao.descricao ? `Condições: ${cotacao.descricao}` : null,
      '',
      `Para confirmar o cancelamento, toque em "Confirmar cancelamento" (ou responda CONFIRMAR) em até ${expiraMin} minutos.`,
    ]
      .filter((l) => l !== null)
      .join('\n'),

  cancelamentoConfirmado: ({ codigo, codigoCancelamento }) =>
    `✅ O sistema do hotel confirmou o cancelamento da reserva ${codigo}. Protocolo de cancelamento: ${codigoCancelamento}.`,

  cancelamentoPendente: () =>
    'Sua solicitação de cancelamento foi registrada, mas o sistema do hotel ainda não confirmou. A reserva NÃO deve ser considerada cancelada até a confirmação. ' +
    'Nossa equipe vai acompanhar e retornar por aqui.',

  resumoAlteracao: ({ codigo, novaEntrada, novaSaida, cotacao, expiraMin }) =>
    [
      `Alteração da reserva ${codigo}:`,
      `Novas datas: ${formatDateBR(novaEntrada)} a ${formatDateBR(novaSaida)}`,
      cotacao.novo_valor_total ? `Novo valor total: ${formatMoney(cotacao.novo_valor_total, cotacao.moeda)}` : null,
      cotacao.diferenca ? `Diferença: ${formatMoney(cotacao.diferenca, cotacao.moeda)}` : null,
      cotacao.descricao ? `Condições: ${cotacao.descricao}` : null,
      '',
      `Para confirmar, toque em "Confirmar alteração" (ou responda CONFIRMAR) em até ${expiraMin} minutos.`,
    ]
      .filter((l) => l !== null)
      .join('\n'),

  alteracaoConfirmada: ({ codigo, r }) =>
    `✅ O sistema do hotel confirmou a alteração da reserva ${codigo}: ${formatDateBR(r.entrada)} a ${formatDateBR(r.saida)}` +
    (r.valor_total ? `, valor total ${formatMoney(r.valor_total, r.moeda)}.` : '.'),

  verificacaoReforcadaEnviada: () =>
    'Por segurança, enviei um link de confirmação para o e-mail cadastrado na reserva. Depois de abrir o link e confirmar, me avise por aqui para continuarmos.',

  privacidadeRecebida: (canal) =>
    'Registrei sua solicitação sobre dados pessoais e ela será analisada pela equipe responsável pela proteção de dados.' +
    (canal ? ` Você também pode acompanhar pelo canal: ${canal}.` : '') +
    ' Para sua segurança, poderemos pedir uma confirmação de identidade antes de atender ao pedido.',
};

// Avalia o horário de atendimento humano configurado. Sem configuração → não informa prazo algum.
export function humanAvailability(horario, now = new Date()) {
  if (!horario || !horario.dias) return { configurado: false };
  const fuso = horario.fuso || 'America/Sao_Paulo';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  const hhmm = `${parts.hour}:${parts.minute}`;
  const hoje = horario.dias[String(dow)];
  const aberto = Array.isArray(hoje) && hhmm >= hoje[0] && hhmm < hoje[1];
  return { configurado: true, aberto, descricaoHorario: horario.descricao || null };
}
