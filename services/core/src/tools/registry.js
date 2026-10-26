// Registro (lista permitida) das ferramentas disponíveis ao modelo de IA.
// O modelo NÃO escolhe URLs, endpoints, SQL ou operações administrativas: só pode chamar estes nomes,
// com estes parâmetros, validados no backend. Especificação completa: docs/06-ferramentas-ia.md
// Gerado para o n8n por scripts/build-n8n-workflows.js.

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Data no formato AAAA-MM-DD' };
const id = (prefix, desc) => ({ type: 'string', pattern: `^${prefix}_[A-Za-z0-9_-]{6,40}$`, description: desc });
const codigoReserva = { type: 'string', minLength: 4, maxLength: 32, pattern: '^[A-Za-z0-9-]+$', description: 'Código de confirmação da reserva informado pelo cliente' };

export const POLICY_CATEGORIES = ['checkin_checkout', 'criancas', 'hospede_adicional', 'animais', 'cancelamento', 'alteracao', 'pagamento', 'acessibilidade', 'geral', 'privacidade'];

export const TOOLS = [
  {
    nome: 'listar_hoteis',
    descricao: 'Lista os hotéis publicados da rede (nome, cidade, categoria). Use para apresentar a rede ou quando o cliente não sabe qual hotel escolher.',
    parametros: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    risco: 'baixo',
  },
  {
    nome: 'buscar_hoteis_por_cidade',
    descricao: 'Busca hotéis publicados em uma cidade.',
    parametros: { type: 'object', additionalProperties: false, properties: { cidade: { type: 'string', minLength: 2, maxLength: 80 } }, required: ['cidade'] },
    risco: 'baixo',
  },
  {
    nome: 'consultar_detalhes_hotel',
    descricao: 'Retorna endereço, telefone, horários de check-in/check-out, descrição e tipos de acomodação de um hotel.',
    parametros: { type: 'object', additionalProperties: false, properties: { hotel_id: id('hot', 'Identificador do hotel retornado por listar_hoteis/buscar_hoteis_por_cidade') }, required: ['hotel_id'] },
    risco: 'baixo',
  },
  {
    nome: 'consultar_comodidades',
    descricao: 'Retorna comodidades e informações de acessibilidade de um hotel.',
    parametros: { type: 'object', additionalProperties: false, properties: { hotel_id: id('hot', 'Identificador do hotel') }, required: ['hotel_id'] },
    risco: 'baixo',
  },
  {
    nome: 'consultar_politicas',
    descricao:
      'Retorna políticas oficiais vigentes (check-in/out, crianças, animais, cancelamento, alteração, pagamento etc.). Política específica do hotel prevalece sobre a geral da rede. Se "requer_validacao_humana" for true, não responda e encaminhe.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: { hotel_id: id('hot', 'Identificador do hotel (omita para políticas gerais da rede)'), categoria: { type: 'string', enum: POLICY_CATEGORIES } },
      required: [],
    },
    risco: 'baixo',
  },
  {
    nome: 'consultar_faq',
    descricao: 'Busca respostas oficiais em perguntas frequentes publicadas.',
    parametros: { type: 'object', additionalProperties: false, properties: { pergunta: { type: 'string', minLength: 3, maxLength: 300 }, hotel_id: id('hot', 'Identificador do hotel (opcional)') }, required: ['pergunta'] },
    risco: 'baixo',
  },
  {
    nome: 'atualizar_contexto',
    descricao: 'Registra preferências de busca já informadas pelo cliente (destino, datas, ocupação), para não perguntar de novo. Não registre nomes, e-mails, documentos ou telefones aqui.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: {
        destino: { type: 'string', maxLength: 80 },
        hotel_id: id('hot', 'Hotel de interesse'),
        entrada: date,
        saida: date,
        adultos: { type: 'integer', minimum: 1, maximum: 20 },
        criancas_idades: { type: 'array', maxItems: 10, items: { type: 'integer', minimum: 0, maximum: 17 } },
        quartos: { type: 'integer', minimum: 1, maximum: 10 },
        preferencias: { type: 'string', maxLength: 200 },
      },
      required: [],
    },
    risco: 'baixo',
  },
  {
    nome: 'consultar_disponibilidade',
    descricao:
      'Consulta disponibilidade e tarifas OFICIAIS no sistema de reservas para um hotel (hotel_id) ou para todos os hotéis de uma cidade (cidade). Exige datas completas e quantidade de hóspedes confirmadas com o cliente. Retorna opções com cotacao_id.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hotel_id: id('hot', 'Hotel desejado (informe hotel_id OU cidade)'),
        cidade: { type: 'string', minLength: 2, maxLength: 80 },
        entrada: date,
        saida: date,
        adultos: { type: 'integer', minimum: 1, maximum: 20 },
        criancas_idades: { type: 'array', maxItems: 10, items: { type: 'integer', minimum: 0, maximum: 17 }, description: 'Idade de cada criança' },
        quartos: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['entrada', 'saida', 'adultos'],
      oneOf: [{ required: ['hotel_id'] }, { required: ['cidade'] }],
    },
    risco: 'medio',
  },
  {
    nome: 'calcular_cotacao',
    descricao: 'Retorna o detalhamento oficial (total, média por diária, taxas, pagamento, cancelamento, validade) de uma opção já consultada. Não recalcula preços.',
    parametros: { type: 'object', additionalProperties: false, properties: { cotacao_id: id('cot', 'Identificador da opção retornada por consultar_disponibilidade') }, required: ['cotacao_id'] },
    risco: 'baixo',
  },
  {
    nome: 'iniciar_reserva',
    descricao: 'Inicia uma reserva para a opção escolhida pelo cliente. Retorna os dados mínimos obrigatórios e o link do aviso de privacidade que deve ser informado antes da coleta.',
    parametros: { type: 'object', additionalProperties: false, properties: { cotacao_id: id('cot', 'Opção escolhida') }, required: ['cotacao_id'] },
    risco: 'medio',
  },
  {
    nome: 'registrar_dados_hospede',
    descricao: 'Registra os dados do titular da reserva informados pelo cliente (somente os campos obrigatórios retornados por iniciar_reserva). Nunca registre CPF, documentos ou cartão.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cotacao_id: id('cot', 'Opção escolhida'),
        nome: { type: 'string', minLength: 1, maxLength: 80 },
        sobrenome: { type: 'string', minLength: 1, maxLength: 80 },
        email: { type: 'string', maxLength: 254 },
        telefone: { type: 'string', maxLength: 20 },
      },
      required: ['cotacao_id', 'nome', 'sobrenome'],
    },
    risco: 'medio',
  },
  {
    nome: 'solicitar_confirmacao_reserva',
    descricao:
      'Revalida preço e disponibilidade e envia ao cliente um resumo oficial com botões de confirmação. A reserva SÓ é criada se o próprio cliente tocar em "Confirmar reserva". Você não consegue confirmar reservas.',
    parametros: { type: 'object', additionalProperties: false, properties: { cotacao_id: id('cot', 'Opção escolhida') }, required: ['cotacao_id'] },
    risco: 'alto',
  },
  {
    nome: 'verificar_titular_reserva',
    descricao: 'Verifica se o cliente é titular de uma reserva existente (código + sobrenome do titular + data de entrada). Necessário antes de consultar, alterar ou cancelar.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: { codigo_reserva: codigoReserva, sobrenome: { type: 'string', minLength: 2, maxLength: 80 }, data_entrada: date },
      required: ['codigo_reserva', 'sobrenome', 'data_entrada'],
    },
    risco: 'alto',
  },
  {
    nome: 'consultar_reserva',
    descricao: 'Consulta situação, datas e acomodação de uma reserva cuja titularidade já foi verificada nesta conversa.',
    parametros: { type: 'object', additionalProperties: false, properties: { codigo_reserva: codigoReserva }, required: ['codigo_reserva'] },
    risco: 'medio',
  },
  {
    nome: 'alterar_reserva',
    descricao: 'Solicita alteração de datas de uma reserva verificada. Consulta condições no sistema oficial e envia resumo com botão de confirmação. Pode exigir verificação reforçada ou atendimento humano.',
    parametros: { type: 'object', additionalProperties: false, properties: { codigo_reserva: codigoReserva, nova_entrada: date, nova_saida: date }, required: ['codigo_reserva', 'nova_entrada', 'nova_saida'] },
    risco: 'alto',
  },
  {
    nome: 'solicitar_cancelamento',
    descricao:
      'Use somente quando o cliente pedir EXPLICITAMENTE para cancelar uma reserva verificada (não para dúvidas sobre política). Consulta multa no sistema oficial e envia resumo com botão de confirmação.',
    parametros: { type: 'object', additionalProperties: false, properties: { codigo_reserva: codigoReserva }, required: ['codigo_reserva'] },
    risco: 'alto',
  },
  {
    nome: 'encaminhar_atendimento',
    descricao: 'Transfere a conversa para a equipe humana. O assistente fica em pausa nesta conversa. Inclua um resumo operacional curto, sem dados pessoais.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: {
        motivo: {
          type: 'string',
          enum: [
            'solicitacao_cliente',
            'reclamacao_grave',
            'suspeita_fraude',
            'falha_integracao',
            'divergencia_informacao',
            'situacao_excepcional',
            'disputa_cobranca',
            'decisao_comercial',
            'juridico_privacidade',
            'baixa_confianca',
            'insatisfacao_persistente',
            'pagamento',
          ],
        },
        resumo: { type: 'string', minLength: 5, maxLength: 600 },
      },
      required: ['motivo', 'resumo'],
    },
    risco: 'baixo',
  },
  {
    nome: 'consultar_estado_atendimento',
    descricao: 'Informa o estado atual da conversa (ex.: aguardando confirmação, encaminhada) e operações pendentes.',
    parametros: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    risco: 'baixo',
  },
  {
    nome: 'registrar_solicitacao_privacidade',
    descricao: 'Registra pedido do titular sobre seus dados pessoais (acesso, correção, eliminação, etc.) para análise da equipe de proteção de dados. Não prometa prazos nem a eliminação.',
    parametros: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tipo: { type: 'string', enum: ['confirmacao', 'acesso', 'correcao', 'compartilhamento', 'eliminacao', 'anonimizacao', 'bloqueio', 'revogacao_consentimento', 'oposicao', 'portabilidade', 'outro'] },
        descricao: { type: 'string', maxLength: 500 },
      },
      required: ['tipo'],
    },
    risco: 'baixo',
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.nome));
export const getTool = (nome) => TOOLS.find((t) => t.nome === nome) || null;

// Ferramentas INTERNAS (não expostas ao modelo): executadas somente pelo processador de turnos
// após confirmação verificada do cliente.
export const INTERNAL_OPERATIONS = ['confirmar_reserva', 'executar_cancelamento', 'executar_alteracao'];
