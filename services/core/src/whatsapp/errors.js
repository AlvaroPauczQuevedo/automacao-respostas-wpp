// Classificação de erros da WhatsApp Cloud API.
// IMPORTANTE: tabela baseada na documentação pública da Meta conhecida no desenvolvimento.
// Revisar contra a documentação vigente antes da implantação (docs/26-pendencias-producao.md).
//   transitorio  -> pode ser retentado com backoff
//   permanente   -> não retentar
//   fora_janela  -> exige modelo aprovado
//   alerta       -> problema de configuração/conta; acionar responsáveis
const TABLE = {
  1: 'transitorio', // API desconhecida
  2: 'transitorio', // serviço temporariamente indisponível
  4: 'transitorio', // limite de chamadas da aplicação
  80007: 'transitorio', // limite de taxa da conta WABA
  130429: 'transitorio', // limite de throughput do número
  131056: 'transitorio', // limite de mensagens para o mesmo destinatário (par)
  131000: 'transitorio', // erro genérico
  131016: 'transitorio', // serviço indisponível
  131047: 'fora_janela', // mais de 24h desde a última mensagem do cliente
  131026: 'permanente', // mensagem não entregável
  131051: 'permanente', // tipo de mensagem não suportado
  131048: 'alerta', // limite por spam
  131049: 'permanente', // não entregue para manter engajamento saudável (marketing)
  131050: 'opt_out_marketing', // usuário interrompeu mensagens de marketing
  131031: 'alerta', // conta bloqueada
  132000: 'permanente', // número de parâmetros do modelo não confere
  132001: 'modelo_invalido', // modelo inexistente/idioma
  132005: 'permanente', // texto do modelo muito longo
  132007: 'permanente', // violação de política de formato
  132012: 'permanente', // formato de parâmetro
  132015: 'modelo_invalido', // modelo pausado
  132016: 'modelo_invalido', // modelo desativado
  133010: 'alerta', // número não registrado
  190: 'alerta', // token expirado/inválido
  10: 'alerta', // permissão negada
  200: 'alerta', // permissão
  100: 'permanente', // parâmetro inválido
};

export function classifyWhatsAppError(code) {
  return TABLE[Number(code)] || 'permanente';
}

export class WhatsAppSendError extends Error {
  constructor(code, classe, httpStatus) {
    super(`WhatsApp erro ${code}`);
    this.code = `WA_${code}`;
    this.waCode = Number(code);
    this.classe = classe;
    this.httpStatus = httpStatus;
    this.retryable = classe === 'transitorio';
  }
}
