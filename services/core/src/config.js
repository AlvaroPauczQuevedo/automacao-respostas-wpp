// Configuração carregada exclusivamente de variáveis de ambiente.
// Nenhum segredo possui valor padrão. Valores de negócio ausentes ficam `null`
// e são tratados como PENDÊNCIA (o fluxo correspondente encaminha para humano).

const env = process.env;

function str(name, def = null) {
  const v = env[name];
  return v === undefined || v === '' ? def : v;
}
function int(name, def) {
  const v = str(name);
  if (v === null) return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Variável ${name} deve ser inteira`);
  return n;
}
function json(name, def = null) {
  const v = str(name);
  if (v === null) return def;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`Variável ${name} deve conter JSON válido`);
  }
}

export function loadConfig(overrides = {}) {
  const cfg = {
    appEnv: str('APP_ENV', 'desenvolvimento'), // desenvolvimento | homologacao | producao
    port: int('PORT', 8080),
    logLevel: str('LOG_LEVEL', 'info'),
    publicBaseUrl: str('PUBLIC_BASE_URL'),

    repo: str('REPO_DRIVER', 'memory'), // memory | postgres
    databaseUrl: str('DATABASE_URL'),

    // Criptografia de campos (AES-256-GCM) e pseudonimização (HMAC-SHA256)
    dataEncryptionKey: str('DATA_ENCRYPTION_KEY'), // base64 de 32 bytes
    dataEncryptionKeyId: str('DATA_ENCRYPTION_KEY_ID', 'k1'),
    dataEncryptionOldKeys: json('DATA_ENCRYPTION_OLD_KEYS', {}), // {"k0":"base64"} para rotação
    hashPepper: str('HASH_PEPPER'),

    // Tokens de serviço/equipe: {"<sha256 hex do token>": {"papel":"servico_n8n","ator":"n8n"}}
    serviceTokens: json('SERVICE_TOKENS', {}),

    whatsapp: {
      mode: str('WHATSAPP_MODE', 'mock'), // mock | cloud
      graphApiVersion: str('WHATSAPP_GRAPH_API_VERSION'), // confirmar versão vigente na documentação da Meta
      graphBaseUrl: str('WHATSAPP_GRAPH_BASE_URL', 'https://graph.facebook.com'),
      phoneNumberId: str('WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: str('WHATSAPP_ACCESS_TOKEN'),
      appSecret: str('WHATSAPP_APP_SECRET'),
      verifyToken: str('WHATSAPP_VERIFY_TOKEN'),
      serviceWindowHours: int('WHATSAPP_SERVICE_WINDOW_HOURS', 24),
      maxSendPerSecond: int('WHATSAPP_MAX_SEND_PER_SECOND', 20),
      maxPerRecipientPerMinute: int('WHATSAPP_MAX_PER_RECIPIENT_PER_MINUTE', 8),
      sendTimeoutMs: int('WHATSAPP_SEND_TIMEOUT_MS', 10000),
      sendMaxRetries: int('WHATSAPP_SEND_MAX_RETRIES', 3),
    },

    hotel: {
      adapter: str('HOTEL_ADAPTER', 'mock'), // mock | rest
      baseUrl: str('HOTEL_API_BASE_URL'),
      token: str('HOTEL_API_TOKEN'),
      timeoutMs: int('HOTEL_API_TIMEOUT_MS', 12000),
      maxRetries: int('HOTEL_API_MAX_RETRIES', 2),
    },

    notify: {
      mode: str('NOTIFY_MODE', 'mock'), // mock | webhook
      emailWebhookUrl: str('NOTIFY_EMAIL_WEBHOOK_URL'),
      emailWebhookToken: str('NOTIFY_EMAIL_WEBHOOK_TOKEN'),
    },

    negocio: {
      nomeRede: str('NOME_REDE'), // PENDENTE se null
      avisoPrivacidadeUrl: str('AVISO_PRIVACIDADE_URL'), // PENDENTE: sem ele não coletamos dados de hóspede
      canalPrivacidade: str('CANAL_PRIVACIDADE'), // ex.: e-mail do encarregado
      // {"fuso":"America/Sao_Paulo","dias":{"1":["08:00","20:00"],...}} — PENDENTE se null
      horarioAtendimento: json('HORARIO_ATENDIMENTO'),
      idiomas: (str('IDIOMAS_SUPORTADOS', 'pt-BR') || 'pt-BR').split(',').map((s) => s.trim()),
      verificacaoReforcadaModo: str('VERIFICACAO_REFORCADA_MODO', 'atendente'), // atendente | link_email
    },

    limites: {
      confirmacaoTtlMin: int('CONFIRMACAO_TTL_MIN', 15),
      verificacaoTtlMin: int('VERIFICACAO_TTL_MIN', 30),
      verificacaoMaxFalhas: int('VERIFICACAO_MAX_FALHAS', 3),
      verificacaoJanelaHoras: int('VERIFICACAO_JANELA_HORAS', 24),
      lockLeaseMs: int('TURN_LOCK_LEASE_MS', 120000),
      historicoMensagens: int('HISTORICO_MENSAGENS_CONTEXTO', 12),
      maxTamanhoMensagem: int('MAX_TAMANHO_MENSAGEM', 2000),
      maxChamadasFerramentaPorTurno: int('MAX_CHAMADAS_FERRAMENTA_TURNO', 12),
      maxNoitesReserva: int('MAX_NOITES_RESERVA', 30),
      maxQuartosReserva: int('MAX_QUARTOS_RESERVA', 5),
      antecedenciaMaxDias: int('ANTECEDENCIA_MAX_DIAS', 540),
      reconciliacaoAposMin: int('RECONCILIACAO_APOS_MIN', 5),
    },

    // Comportamentos que dependem de decisão da rede (padrão conservador)
    marketingHabilitado: str('MARKETING_HABILITADO', 'false') === 'true',
    pagamentoViaChat: false, // não suportado: pagamentos nunca são coletados pelo chat
    webhookAssinaturaObrigatoria: str('WEBHOOK_ASSINATURA_OBRIGATORIA', 'true') !== 'false',
    filasAtendimento: json('FILAS_ATENDIMENTO', {}), // {"motivo":"fila"} sobrescreve o padrão
    prazoInternoPrivacidadeDias: int('PRAZO_INTERNO_PRIVACIDADE_DIAS', 15),
    alertaErrosPorHora: int('ALERTA_ERROS_POR_HORA', 20),

    // Prazos em dias — valores PROVISÓRIOS até aprovação do encarregado/jurídico
    retencao: {
      conteudoMensagensDias: int('RETENCAO_CONTEUDO_MENSAGENS_DIAS', 30),
      metadadosMensagensDias: int('RETENCAO_METADADOS_MENSAGENS_DIAS', 180),
      eventosEntradaDias: int('RETENCAO_EVENTOS_ENTRADA_DIAS', 7),
      conversasInativasDias: int('RETENCAO_CONVERSAS_INATIVAS_DIAS', 365),
      dadosHospedePendentesHoras: int('RETENCAO_DADOS_HOSPEDE_PENDENTES_HORAS', 24),
      auditoriaDias: int('RETENCAO_AUDITORIA_DIAS', 1825),
      cotacoesDias: int('RETENCAO_COTACOES_DIAS', 90),
    },
    ...overrides,
  };
  return cfg;
}

// Validação para ambientes reais: falha cedo em vez de operar sem controles.
export function validateConfig(cfg) {
  const erros = [];
  const avisos = [];
  const real = cfg.appEnv === 'producao' || cfg.appEnv === 'homologacao';
  if (!cfg.dataEncryptionKey) (real ? erros : avisos).push('DATA_ENCRYPTION_KEY ausente');
  if (!cfg.hashPepper) (real ? erros : avisos).push('HASH_PEPPER ausente');
  if (Object.keys(cfg.serviceTokens).length === 0) (real ? erros : avisos).push('SERVICE_TOKENS vazio');
  if (real) {
    if (cfg.repo !== 'postgres') erros.push('REPO_DRIVER deve ser postgres fora de desenvolvimento');
    if (cfg.whatsapp.mode === 'cloud') {
      for (const k of ['graphApiVersion', 'phoneNumberId', 'accessToken', 'appSecret', 'verifyToken']) {
        if (!cfg.whatsapp[k]) erros.push(`WHATSAPP ${k} ausente`);
      }
    }
    if (cfg.appEnv === 'producao' && (cfg.whatsapp.mode === 'mock' || cfg.hotel.adapter === 'mock' || cfg.notify.mode === 'mock')) {
      erros.push('Adaptadores simulados não são permitidos em produção');
    }
    if (!cfg.webhookAssinaturaObrigatoria) erros.push('WEBHOOK_ASSINATURA_OBRIGATORIA=false só é permitido em desenvolvimento');
    if (cfg.negocio.verificacaoReforcadaModo === 'link_email' && !cfg.publicBaseUrl) erros.push('PUBLIC_BASE_URL obrigatório para VERIFICACAO_REFORCADA_MODO=link_email');
  }
  if (!cfg.negocio.nomeRede) avisos.push('PENDÊNCIA: NOME_REDE não configurado');
  if (!cfg.negocio.avisoPrivacidadeUrl) avisos.push('PENDÊNCIA: AVISO_PRIVACIDADE_URL não configurado — novas reservas serão encaminhadas a atendentes');
  if (!cfg.negocio.horarioAtendimento) avisos.push('PENDÊNCIA: HORARIO_ATENDIMENTO não configurado — nenhum prazo de retorno será informado');
  return { erros, avisos };
}
