import { extractAmounts } from '../util/money.js';
import { containsCardNumber } from '../security/redact.js';

// Verificação determinística da resposta gerada pela IA ANTES do envio ao cliente.
// Não substitui as travas do backend; é uma camada adicional contra alucinação e vazamento.

const CLAIM_PATTERNS = [
  /\breserva\s+(?:foi\s+|est[aá]\s+|j[aá]\s+)*(?:confirmada|efetuada|realizada|criada|garantida)\b/i,
  /\b(?:confirmei|efetuei|realizei|criei|garanti)\s+(?:a\s+|sua\s+)?reserva\b/i,
  /\b(?:reserva|ela)\s+(?:foi\s+)?cancelada\b/i,
  /\bcancelamento\s+(?:foi\s+)?(?:confirmado|efetuado|realizado|conclu[ií]do)\b/i,
  /\b(?:cancelei|alterei)\s+(?:a\s+|sua\s+)?reserva\b/i,
  /\breserva\s+(?:foi\s+)?alterada\b/i,
];
const HUMAN_CLAIM = /(?<!n[aã]o\s)\b(?:eu\s+)?sou\s+(?:um|uma)\s+(?:pessoa|humano|humana|atendente|funcion[aá]ri[oa]|recepcionista)\b/i;
const LEAK_PATTERNS = [/Você é o assistente virtual oficial da rede/i, /\bBearer\s+[A-Za-z0-9._-]{10,}/, /SERVICE_TOKENS|DATA_ENCRYPTION_KEY|HASH_PEPPER|WHATSAPP_ACCESS_TOKEN|APP_SECRET/i, /sk-ant-[A-Za-z0-9_-]+/];
const URGENCY = /\b(?:[uú]ltim[oa]s?\s+(?:quartos?|vagas?|unidades?)|corra|s[oó]\s+hoje|antes\s+que\s+acabe|promo[cç][aã]o\s+rel[aâ]mpago)\b/i;

/**
 * @param {string} texto  resposta proposta pela IA
 * @param {{valoresPermitidos:Set<string>, operacaoConfirmadaNoTurno:boolean, maxLen?:number}} ctx
 * @returns {{ok:boolean, texto:string, violacoes:string[]}}
 */
export function checkAgentOutput(texto, ctx) {
  const violacoes = [];
  const t = String(texto || '').trim();
  if (!t) return { ok: false, texto: '', violacoes: ['vazia'] };

  if (containsCardNumber(t)) violacoes.push('dado_cartao');
  if (LEAK_PATTERNS.some((p) => p.test(t))) violacoes.push('vazamento_instrucoes_ou_segredo');
  if (HUMAN_CLAIM.test(t)) violacoes.push('alegacao_de_ser_humano');
  if (!ctx.operacaoConfirmadaNoTurno && CLAIM_PATTERNS.some((p) => p.test(t))) violacoes.push('alegacao_operacao_sem_confirmacao');
  const valores = extractAmounts(t);
  const naoVerificados = valores.filter((v) => !ctx.valoresPermitidos.has(v));
  if (naoVerificados.length) violacoes.push('valor_monetario_nao_verificado');
  if (URGENCY.test(t)) violacoes.push('falsa_urgencia');

  const max = ctx.maxLen || 3500;
  const final = t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
  return { ok: violacoes.length === 0, texto: final, violacoes };
}

export const SAFE_REPLACEMENT = {
  valor_monetario_nao_verificado:
    'Para não informar um valor incorreto, preciso confirmar os preços diretamente no sistema de reservas. Pode me confirmar o hotel (ou cidade), as datas de entrada e saída e a quantidade de hóspedes?',
  alegacao_operacao_sem_confirmacao:
    'Ainda não há confirmação do sistema do hotel para essa operação, então ela não deve ser considerada concluída. Posso verificar o estado do seu atendimento ou encaminhar para nossa equipe.',
  padrao: 'Desculpe, não consegui elaborar uma resposta adequada agora. Pode reformular sua pergunta? Se preferir, escreva "atendente" para falar com nossa equipe.',
};
