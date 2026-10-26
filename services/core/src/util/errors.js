// Erros de domínio com código estável. Mensagens são seguras para o cliente HTTP
// interno (n8n) e nunca contêm dados pessoais, segredos ou stack traces.
export class AppError extends Error {
  constructor(code, message, { status = 400, retryable = false, details } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
  toJSON() {
    return { erro: { codigo: this.code, mensagem: this.message, retentavel: this.retryable, detalhes: this.details } };
  }
}

export const Errors = {
  validation: (message, details) => new AppError('VALIDACAO', message, { status: 422, details }),
  unauthorized: () => new AppError('NAO_AUTENTICADO', 'Credencial ausente ou inválida', { status: 401 }),
  forbidden: (message = 'Operação não permitida para este papel') => new AppError('PROIBIDO', message, { status: 403 }),
  notFound: (what = 'Recurso') => new AppError('NAO_ENCONTRADO', `${what} não encontrado`, { status: 404 }),
  conflict: (message, details) => new AppError('CONFLITO', message, { status: 409, details }),
  rateLimited: (message = 'Limite de requisições atingido') => new AppError('LIMITE', message, { status: 429, retryable: true }),
  upstream: (message, retryable = true, details) => new AppError('INTEGRACAO_INDISPONIVEL', message, { status: 502, retryable, details }),
  upstreamInvalid: (message, details) => new AppError('RESPOSTA_INVALIDA_INTEGRACAO', message, { status: 502, details }),
  notSupported: (message) => new AppError('NAO_SUPORTADO', message, { status: 501 }),
  pending: (message, details) => new AppError('CONFIGURACAO_PENDENTE', message, { status: 409, details }),
};
