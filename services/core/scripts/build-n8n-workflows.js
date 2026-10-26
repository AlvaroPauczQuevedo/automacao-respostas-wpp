// Gera os workflows exportáveis do n8n (n8n/workflows/*.json) a partir do registro de ferramentas,
// garantindo que a lista permitida da IA no n8n seja a mesma validada pelo core.
//
// Uso: CORE_BASE_URL=http://core:8080 node scripts/build-n8n-workflows.js
// Versões de nós conferidas contra n8n 2.44.7 (node_modules/*/dist/types/nodes.json).
// Nenhuma credencial é incluída: os nós referenciam credenciais por NOME, criadas no n8n de destino.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/tools/registry.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'n8n', 'workflows');
const CORE = (process.env.CORE_BASE_URL || 'http://core:8080').replace(/\/+$/, '');
const ALERT_URL = process.env.ALERTA_WEBHOOK_URL || 'https://alertas.exemplo.invalid/PENDENTE-configurar';
const TEAM_URL = process.env.EQUIPE_WEBHOOK_URL || 'https://equipe.exemplo.invalid/PENDENTE-configurar';
const DPO_URL = process.env.DPO_WEBHOOK_URL || 'https://privacidade.exemplo.invalid/PENDENTE-configurar';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const CLASSIFIER_MODEL = process.env.ANTHROPIC_CLASSIFIER_MODEL || MODEL;

const CRED_CORE = { httpHeaderAuth: { id: 'credCoreApi00001', name: 'Core API - servico_n8n' } };
const CRED_ANTHROPIC = { anthropicApi: { id: 'credAnthropic001', name: 'Anthropic - agente hoteleiro' } };

const wfId = (n) => `HotelAgentWf${String(n).padStart(2, '0')}0`.slice(0, 16).padEnd(16, '0');
const IDS = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, wfId(i + 1)]));
let uid = 0;
const nid = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

function node(name, type, typeVersion, parameters, position, extra = {}) {
  return { id: nid(), name, type, typeVersion, position, parameters, ...extra };
}
function workflow(n, name, nodes, connections, { errorWorkflow = true, description } = {}) {
  return {
    id: IDS[n],
    name: `WF${String(n).padStart(2, '0')} — ${name}`,
    active: false,
    isArchived: false,
    nodes,
    connections,
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveManualExecutions: false, callerPolicy: 'workflowsFromSameOwner', ...(errorWorkflow ? { errorWorkflow: IDS[11] } : {}) },
    pinData: {},
    meta: { templateCredsSetupCompleted: false, descricao: description },
    tags: [],
  };
}
// conexões: link(c, 'A', 'B', outIndex=0)
function link(c, from, to, out = 0, kind = 'main') {
  c[from] ??= {};
  c[from][kind] ??= [];
  while (c[from][kind].length <= out) c[from][kind].push([]);
  c[from][kind][out].push({ node: to, type: kind, index: 0 });
}
const coreHttp = (name, method, urlPath, position, { body, query, headers, neverError = true, timeout = 30000 } = {}) =>
  node(
    name,
    'n8n-nodes-base.httpRequest',
    4.2,
    {
      method,
      url: urlPath.startsWith('=') ? `=${CORE}${urlPath.slice(1)}` : `${CORE}${urlPath}`,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      ...(query ? { sendQuery: true, specifyQuery: 'json', jsonQuery: query } : {}),
      ...(headers ? { sendHeaders: true, headerParameters: { parameters: headers } } : {}),
      ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}),
      options: { timeout, response: { response: { neverError, responseFormat: 'json' } } },
    },
    position,
    { credentials: CRED_CORE, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 },
  );
const execWf = (name, n, position, inputsExpr, { wait = true, mode = 'once' } = {}) =>
  node(
    name,
    'n8n-nodes-base.executeWorkflow',
    1.2,
    {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: IDS[n] },
      workflowInputs: { mappingMode: 'defineBelow', value: inputsExpr, matchingColumns: [], schema: Object.keys(inputsExpr).map((k) => ({ id: k, displayName: k, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'any', removed: false })), attemptToConvertTypes: false, convertFieldsToString: false },
      mode,
      options: { waitForSubWorkflow: wait },
    },
    position,
  );
const trigger = (inputs, position = [0, 0]) =>
  node('Entrada', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'workflowInputs', workflowInputs: { values: inputs.map(([name, type]) => ({ name, type })) } }, position);
const code = (name, js, position, extra = {}) => node(name, 'n8n-nodes-base.code', 2, { jsCode: js, ...extra }, position);
const ifNode = (name, leftExpr, op, position, right) =>
  node(
    name,
    'n8n-nodes-base.if',
    2.2,
    {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: nid(), leftValue: leftExpr, rightValue: right ?? '', operator: op }],
        combinator: 'and',
      },
      options: {},
    },
    position,
  );
const isTrue = { type: 'boolean', operation: 'true', singleValue: true };
const sticky = (content, position, w = 420, h = 220) => node(`Nota ${++uid}`, 'n8n-nodes-base.stickyNote', 1, { content, width: w, height: h }, position);

const all = [];

// ============================================================ WF01 — Recepção
{
  const c = {};
  const nodes = [
    sticky('## WF01 — Recepção de mensagens\nRecebe o webhook oficial da WhatsApp Cloud API. O corpo BRUTO e o cabeçalho `X-Hub-Signature-256` são enviados ao core, que valida a assinatura (App Secret), normaliza, aplica idempotência por `wamid` e devolve as conversas com eventos novos.\n\nA resposta 200 é imediata (a Meta reenvia em caso de erro/timeout).', [-40, -380], 520, 240),
    node('Webhook verificação (GET)', 'n8n-nodes-base.webhook', 2, { httpMethod: 'GET', path: 'whatsapp', responseMode: 'responseNode', options: {} }, [0, -100], { webhookId: '7c1f0d7e-0000-4000-8000-0000000000a1' }),
    coreHttp('Core: verificar inscrição', 'GET', '/internal/inbound/verificacao', [260, -100], { query: '={{ JSON.stringify($json.query) }}', neverError: false }),
    node('Responder desafio', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'text', responseBody: '={{ $json.challenge }}', options: { responseCode: 200 } }, [520, -160]),
    node('Responder 403', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'noData', options: { responseCode: 403 } }, [520, -20]),
    node('Webhook eventos (POST)', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'whatsapp', responseMode: 'onReceived', options: { rawBody: true, responseCode: 200 } }, [0, 200], { webhookId: '7c1f0d7e-0000-4000-8000-0000000000a2' }),
    // Corpo BRUTO (binário) → base64, sem código: necessário para validar a assinatura HMAC no core.
    node('Preparar corpo bruto', 'n8n-nodes-base.extractFromFile', 1.1, { operation: 'binaryToPropery', binaryPropertyName: 'data', destinationKey: 'corpo_bruto_base64', options: {} }, [260, 200]),
    coreHttp('Core: processar eventos', 'POST', '/internal/inbound', [520, 200], { body: "={{ JSON.stringify({ corpo_bruto_base64: $json.corpo_bruto_base64, assinatura: $('Webhook eventos (POST)').item.json.headers['x-hub-signature-256'] || null }) }}", neverError: false }),
    node('Separar conversas', 'n8n-nodes-base.splitOut', 1, { fieldToSplitOut: 'conversas', options: { destinationFieldName: 'conversa_id' } }, [780, 200]),
    execWf('WF02: gerenciar conversa', 2, [1040, 200], { conversa_id: '={{ $json.conversa_id }}' }, { wait: false, mode: 'each' }),
  ];
  nodes[2].onError = 'continueErrorOutput';
  link(c, 'Webhook verificação (GET)', 'Core: verificar inscrição');
  link(c, 'Core: verificar inscrição', 'Responder desafio', 0);
  link(c, 'Core: verificar inscrição', 'Responder 403', 1);
  link(c, 'Webhook eventos (POST)', 'Preparar corpo bruto');
  link(c, 'Preparar corpo bruto', 'Core: processar eventos');
  link(c, 'Core: processar eventos', 'Separar conversas');
  link(c, 'Separar conversas', 'WF02: gerenciar conversa');
  all.push(workflow(1, 'Recepção de mensagens', nodes, c, { description: 'Webhook oficial → validação → idempotência → WF02' }));
}

// ============================================================ WF02 — Gerenciador de conversas
{
  const c = {};
  const nodes = [
    sticky('## WF02 — Gerenciador de conversas\nObtém a trava exclusiva da conversa e agrega mensagens pendentes em um turno (core `/internal/turnos/iniciar`).\n- `interpretar` → WF03 (IA)\n- `responder` → envio (WF09)\n- `silencio` → conversa com atendente humano; apenas notifica a equipe\n- `enfileirado` → outro turno em andamento; ele processará as pendências\n\nApós o envio, se `ha_pendentes`, reinvoca a si mesmo.', [-40, -420], 560, 260),
    trigger([['conversa_id', 'string']]),
    coreHttp('Core: iniciar turno', 'POST', '/internal/turnos/iniciar', [240, 0], { body: '={{ JSON.stringify({ conversa_id: $json.conversa_id }) }}', neverError: false }),
    node(
      'Rotear ação',
      'n8n-nodes-base.switch',
      3.2,
      {
        rules: {
          values: ['interpretar', 'responder', 'silencio'].map((v) => ({
            conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.acao }}', rightValue: v, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
            renameOutput: true,
            outputKey: v,
          })),
        },
        options: { fallbackOutput: 'extra', renameFallbackOutput: 'nada_a_fazer' },
      },
      [480, 0],
    ),
    execWf('WF03: agente de IA', 3, [740, -160], { turno: '={{ $json }}' }),
    coreHttp('Core: falha do turno', 'POST', "=/internal/turnos/{{ $('Core: iniciar turno').first().json.turno_id }}/falha", [1000, -40], { body: '={{ JSON.stringify({ motivo: "erro_wf03" }) }}' }),
    code('Resultado do turno', 'return $input.all().map((i) => ({ json: i.json }));', [1260, 40]),
    ifNode('Há mensagens?', '={{ ($json.mensagens || []).length > 0 }}', isTrue, [1480, 40]),
    execWf('WF09: enviar mensagens', 9, [1720, -40], { mensagens: "={{ $('Resultado do turno').first().json.mensagens }}" }),
    ifNode('Notificar equipe?', "={{ $('Resultado do turno').first().json.notificar_equipe === true }}", isTrue, [1960, 40]),
    execWf('WF08: notificar equipe', 8, [2200, -40], { modo: 'notificar', conversa_id: "={{ $('Resultado do turno').first().json.conversa_id }}", atendimento_id: "={{ $('Resultado do turno').first().json.atendimento_id || null }}" }, { wait: false }),
    ifNode('Notificar privacidade?', "={{ $('Resultado do turno').first().json.notificar_privacidade === true }}", isTrue, [2440, 40]),
    execWf('WF10: notificar encarregado', 10, [2680, -40], { modo: 'notificar', solicitacao_id: "={{ $('Resultado do turno').first().json.solicitacao_privacidade_id }}" }, { wait: false }),
    ifNode('Há pendências?', "={{ $('Resultado do turno').first().json.ha_pendentes === true }}", isTrue, [2920, 40]),
    execWf('WF02: próximo turno', 2, [3160, -40], { conversa_id: "={{ $('Resultado do turno').first().json.conversa_id }}" }, { wait: false }),
    node('Nada a fazer', 'n8n-nodes-base.noOp', 1, {}, [740, 220]),
  ];
  nodes.find((n) => n.name === 'WF03: agente de IA').onError = 'continueErrorOutput';
  link(c, 'Entrada', 'Core: iniciar turno');
  link(c, 'Core: iniciar turno', 'Rotear ação');
  link(c, 'Rotear ação', 'WF03: agente de IA', 0);
  link(c, 'Rotear ação', 'Resultado do turno', 1);
  link(c, 'Rotear ação', 'Resultado do turno', 2);
  link(c, 'Rotear ação', 'Nada a fazer', 3);
  link(c, 'WF03: agente de IA', 'Resultado do turno', 0);
  link(c, 'WF03: agente de IA', 'Core: falha do turno', 1);
  link(c, 'Core: falha do turno', 'Resultado do turno');
  link(c, 'Resultado do turno', 'Há mensagens?');
  link(c, 'Há mensagens?', 'WF09: enviar mensagens', 0);
  link(c, 'Há mensagens?', 'Notificar equipe?', 1);
  link(c, 'WF09: enviar mensagens', 'Notificar equipe?');
  link(c, 'Notificar equipe?', 'WF08: notificar equipe', 0);
  link(c, 'Notificar equipe?', 'Notificar privacidade?', 1);
  link(c, 'WF08: notificar equipe', 'Notificar privacidade?');
  link(c, 'Notificar privacidade?', 'WF10: notificar encarregado', 0);
  link(c, 'Notificar privacidade?', 'Há pendências?', 1);
  link(c, 'WF10: notificar encarregado', 'Há pendências?');
  link(c, 'Há pendências?', 'WF02: próximo turno', 0);
  all.push(workflow(2, 'Gerenciador de conversas', nodes, c, { description: 'Trava por conversa, roteamento do turno e pós-processamento' }));
}

// ============================================================ WF03 — Agente de IA
const DOMAIN = {
  4: ['listar_hoteis', 'buscar_hoteis_por_cidade', 'consultar_detalhes_hotel', 'consultar_comodidades', 'consultar_politicas', 'consultar_faq', 'atualizar_contexto'],
  5: ['consultar_disponibilidade', 'calcular_cotacao'],
  6: ['iniciar_reserva', 'registrar_dados_hospede', 'solicitar_confirmacao_reserva'],
  7: ['verificar_titular_reserva', 'consultar_reserva', 'alterar_reserva', 'solicitar_cancelamento', 'consultar_estado_atendimento'],
  8: ['encaminhar_atendimento'],
  10: ['registrar_solicitacao_privacidade'],
};
const domainOf = (nome) => Number(Object.keys(DOMAIN).find((k) => DOMAIN[k].includes(nome)));
for (const t of TOOLS) if (!domainOf(t.nome)) throw new Error(`Ferramenta sem domínio/workflow: ${t.nome}`);

function schemaSummary(s) {
  const req = new Set(s.required || []);
  const parts = Object.entries(s.properties || {}).map(([k, v]) => {
    let type = v.type === 'array' ? `lista de ${v.items?.type === 'integer' ? 'inteiros' : v.items?.type}` : v.type === 'integer' ? 'inteiro' : v.type === 'string' && v.enum ? `um de: ${v.enum.join(', ')}` : v.type === 'string' && v.pattern?.includes('\\d{4}') ? 'data AAAA-MM-DD' : 'texto';
    return `${k} (${type}${req.has(k) ? ', obrigatório' : ', opcional'})`;
  });
  if (s.oneOf) parts.push('informe hotel_id OU cidade');
  return parts.length ? parts.join('; ') : 'nenhum parâmetro: envie um objeto vazio';
}
const quoteSafe = (s) => s.replace(/[`'"\\{}]/g, '').replace(/\s+/g, ' ');

{
  const c = {};
  const CLASSIFIER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['intencoes', 'idioma'],
    properties: {
      intencoes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['intencao', 'confianca'], properties: { intencao: { type: 'string' }, confianca: { type: 'number' } } } },
      idioma: { type: 'string' },
    },
  };
  const nodes = [
    sticky(
      '## WF03 — Agente de IA\n1. Busca prompt e ferramentas permitidas no core.\n2. Monta a entrada: contexto do sistema + mensagem do cliente marcada como dado não confiável.\n3. Classifica intenções (chamada direta à API com saída JSON estruturada) e envia ao core, que valida e roteia (humano, fraude, privacidade).\n4. Se `invocar_agente`: AI Agent com as ferramentas da lista permitida (sub-workflows WF04–WF08, WF10).\n5. Resposta final passa pelo verificador de saída do core (`/resposta`).\n\nModelo padrão: `' +
        MODEL +
        '` com raciocínio adaptativo (obrigatório: o nó envia `thinking: disabled` por padrão e esse modelo rejeita).',
      [-40, -520],
      620,
      300,
    ),
    trigger([['turno', 'object']]),
    coreHttp('Configuração do agente', 'GET', '/internal/agente/configuracao', [220, 0], { neverError: false }),
    code(
      'Montar entrada',
      [
        "const turno = $('Entrada').first().json.turno;",
        '// Impede que o cliente "feche" a tag de dados e injete instruções com aparência de sistema.',
        "const esc = (s) => String(s ?? '').replace(/</g, '‹').replace(/>/g, '›');",
        'const ctx = JSON.stringify(turno.contexto);',
        "const entrada = `<contexto_conversa>${esc(ctx)}</contexto_conversa>\\n<mensagem_cliente>${esc(turno.mensagem_cliente)}</mensagem_cliente>`;",
        "const cfg = $('Configuração do agente').first().json;",
        '// Requisição de classificação montada aqui (e não numa expressão) para evitar conflito de chaves com a sintaxe {{ }}.',
        'const requisicao_classificacao = {',
        `  model: '${CLASSIFIER_MODEL}',`,
        '  max_tokens: 1024,',
        "  thinking: { type: 'adaptive' },",
        `  output_config: { effort: 'low', format: { type: 'json_schema', schema: ${JSON.stringify(CLASSIFIER_SCHEMA)} } },`,
        '  system: cfg.prompt_classificador,',
        "  messages: [{ role: 'user', content: entrada }],",
        '};',
        'return [{ json: { turno_id: turno.turno_id, conversa_id: turno.conversa_id, entrada_agente: entrada, requisicao_classificacao } }];',
      ].join('\n'),
      [440, 0],
    ),
    node(
      'Classificar intenção',
      'n8n-nodes-base.httpRequest',
      4.2,
      {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'anthropicApi',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.requisicao_classificacao) }}',
        options: { timeout: 30000 },
      },
      [660, 0],
      { credentials: CRED_ANTHROPIC, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueErrorOutput' },
    ),
    code(
      'Interpretar classificação',
      [
        '// Saída estruturada: o primeiro bloco de texto contém JSON conforme o esquema. Falha → lista vazia (core decide).',
        'let intencoes = [];',
        'try {',
        "  const r = $input.first().json;",
        "  if (r.stop_reason !== 'refusal') {",
        "    const txt = (r.content || []).find((b) => b.type === 'text')?.text || '{}';",
        '    intencoes = JSON.parse(txt).intencoes || [];',
        '  }',
        '} catch (e) { intencoes = []; }',
        "return [{ json: { turno_id: $('Montar entrada').first().json.turno_id, intencoes } }];",
      ].join('\n'),
      [880, -40],
    ),
    code('Classificação indisponível', "return [{ json: { turno_id: $('Montar entrada').first().json.turno_id, intencoes: [] } }];", [880, 120]),
    coreHttp('Core: registrar classificação', 'POST', '=/internal/turnos/{{ $json.turno_id }}/classificacao', [1100, 0], { body: '={{ JSON.stringify({ intencoes: $json.intencoes }) }}', neverError: false }),
    ifNode('Invocar agente?', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, [1320, 0], 'invocar_agente'),
    node(
      'Agente de atendimento',
      '@n8n/n8n-nodes-langchain.agent',
      2.2,
      {
        promptType: 'define',
        text: "={{ $('Montar entrada').first().json.entrada_agente }}",
        options: { systemMessage: "={{ $('Configuração do agente').first().json.prompt_sistema }}", maxIterations: 8, returnIntermediateSteps: false, enableStreaming: false },
      },
      [1580, -120],
      { onError: 'continueErrorOutput' },
    ),
    node(
      'Modelo Claude',
      '@n8n/n8n-nodes-langchain.lmChatAnthropic',
      1.6,
      { model: { __rl: true, mode: 'id', value: MODEL }, options: { maxTokensToSample: 4096, thinkingMode: 'adaptive', effort: 'medium', promptCaching: '5m' } },
      [1500, 160],
      { credentials: CRED_ANTHROPIC },
    ),
    coreHttp('Core: verificar e registrar resposta', 'POST', "=/internal/turnos/{{ $('Montar entrada').first().json.turno_id }}/resposta", [1900, -160], { body: '={{ JSON.stringify({ texto: $json.output || "" }) }}', neverError: false }),
    coreHttp('Core: falha da IA', 'POST', "=/internal/turnos/{{ $('Montar entrada').first().json.turno_id }}/falha", [1900, 40], { body: '={{ JSON.stringify({ motivo: "erro_agente_ia" }) }}', neverError: false }),
    code('Turno já resolvido', 'return $input.all();', [1580, 260]),
  ];
  // Ferramentas: uma por item da lista permitida, executadas pelo sub-workflow do domínio.
  TOOLS.forEach((t, i) => {
    const dom = domainOf(t.nome);
    const desc = quoteSafe(`${t.descricao} Parâmetros: ${schemaSummary(t.parametros)}.`);
    nodes.push(
      node(
        t.nome,
        '@n8n/n8n-nodes-langchain.toolWorkflow',
        2.2,
        {
          description: desc,
          source: 'database',
          workflowId: { __rl: true, mode: 'id', value: IDS[dom] },
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: {
              modo: 'ferramenta',
              ferramenta: t.nome,
              turno_id: "={{ $('Montar entrada').first().json.turno_id }}",
              argumentos: `={{ $fromAI('argumentos', 'Objeto JSON com os parametros da ferramenta. ${quoteSafe(schemaSummary(t.parametros))}', 'json') }}`,
            },
            matchingColumns: [],
            schema: ['modo', 'ferramenta', 'turno_id', 'argumentos'].map((k) => ({ id: k, displayName: k, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: k === 'argumentos' ? 'object' : 'string', removed: false })),
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
        },
        [1300 + (i % 10) * 160, 420 + Math.floor(i / 10) * 200],
      ),
    );
    link(c, t.nome, 'Agente de atendimento', 0, 'ai_tool');
  });
  link(c, 'Entrada', 'Configuração do agente');
  link(c, 'Configuração do agente', 'Montar entrada');
  link(c, 'Montar entrada', 'Classificar intenção');
  link(c, 'Classificar intenção', 'Interpretar classificação', 0);
  link(c, 'Classificar intenção', 'Classificação indisponível', 1);
  link(c, 'Interpretar classificação', 'Core: registrar classificação');
  link(c, 'Classificação indisponível', 'Core: registrar classificação');
  link(c, 'Core: registrar classificação', 'Invocar agente?');
  link(c, 'Invocar agente?', 'Agente de atendimento', 0);
  link(c, 'Invocar agente?', 'Turno já resolvido', 1);
  link(c, 'Modelo Claude', 'Agente de atendimento', 0, 'ai_languageModel');
  link(c, 'Agente de atendimento', 'Core: verificar e registrar resposta', 0);
  link(c, 'Agente de atendimento', 'Core: falha da IA', 1);
  all.push(workflow(3, 'Agente de IA', nodes, c, { description: 'Classificação + agente com ferramentas da lista permitida' }));
}

// ============================================================ WF04–WF07 — executores de ferramentas por domínio
const DOMAIN_NAMES = { 4: 'Consulta à rede hoteleira', 5: 'Disponibilidade e tarifas', 6: 'Criação de reserva', 7: 'Gestão de reservas existentes' };
function toolExecutor(n, extraNodes = [], extraLinks = () => {}, { modes = false } = {}) {
  const c = {};
  const allowed = DOMAIN[n];
  const nodes = [
    sticky(
      `## WF${String(n).padStart(2, '0')} — ${DOMAIN_NAMES[n] || ''}\nExecutor das ferramentas deste domínio, chamado pelo agente (WF03).\nDefesa em profundidade: confere a lista permitida do domínio ANTES de chamar o core, que valida novamente parâmetros, turno, conversa e permissões.\n\nFerramentas: ${allowed.map((a) => '`' + a + '`').join(', ')}`,
      [-40, -360],
      560,
      220,
    ),
    trigger([['modo', 'string'], ['ferramenta', 'string'], ['turno_id', 'string'], ['argumentos', 'object'], ['conversa_id', 'string'], ['atendimento_id', 'string'], ['solicitacao_id', 'string']]),
    code(
      'Validar ferramenta do domínio',
      [
        `const PERMITIDAS = ${JSON.stringify(allowed)};`,
        'const i = $input.first().json;',
        "if (!PERMITIDAS.includes(i.ferramenta)) throw new Error('Ferramenta fora da lista permitida deste domínio');",
        "if (typeof i.turno_id !== 'string' || !/^turno_[A-Za-z0-9_-]{6,40}$/.test(i.turno_id)) throw new Error('turno_id inválido');",
        '// Alguns modelos enviam o objeto como texto JSON.',
        'let args = i.argumentos;',
        "if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }",
        "if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};",
        'return [{ json: { ferramenta: i.ferramenta, turno_id: i.turno_id, argumentos: args } }];',
      ].join('\n'),
      [440, 0],
    ),
    coreHttp('Core: executar ferramenta', 'POST', '=/internal/ferramentas/{{ $json.ferramenta }}', [680, 0], { body: '={{ JSON.stringify($json.argumentos) }}', headers: [{ name: 'x-turno-id', value: '={{ $json.turno_id }}' }] }),
    code(
      'Retorno para o agente',
      [
        '// Devolve ao modelo apenas o resultado estruturado (ok/resultado ou ok=false/erro com orientação).',
        'const r = $input.first().json;',
        "if (r && r.erro && r.ok === undefined) return [{ json: { ok: false, erro: { codigo: r.erro.codigo, orientacao: 'Operação recusada pelo sistema. Não invente dados; ofereça atendimento humano.' } } }];",
        'return [{ json: r }];',
      ].join('\n'),
      [920, 0],
    ),
    ...extraNodes,
  ];
  if (modes) {
    nodes.push(
      node('Modo', 'n8n-nodes-base.switch', 3.2, {
        rules: {
          values: ['ferramenta', 'notificar'].map((v) => ({
            conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.modo }}', rightValue: v, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
            renameOutput: true,
            outputKey: v,
          })),
        },
        options: {},
      }, [220, 0]),
    );
    link(c, 'Entrada', 'Modo');
    link(c, 'Modo', 'Validar ferramenta do domínio', 0);
  } else link(c, 'Entrada', 'Validar ferramenta do domínio');
  link(c, 'Validar ferramenta do domínio', 'Core: executar ferramenta');
  link(c, 'Core: executar ferramenta', 'Retorno para o agente');
  extraLinks(c);
  return { nodes, c };
}
for (const n of [4, 5, 6, 7]) {
  const { nodes, c } = toolExecutor(n);
  all.push(workflow(n, DOMAIN_NAMES[n], nodes, c, { description: `Executor de ferramentas: ${DOMAIN[n].join(', ')}` }));
}

// ============================================================ WF08 — Atendimento humano
{
  const notify = node(
    'Notificar fila da equipe',
    'n8n-nodes-base.httpRequest',
    4.2,
    {
      method: 'POST',
      url: TEAM_URL,
      sendBody: true,
      specifyBody: 'json',
      // Sem dados pessoais: apenas identificadores internos. Detalhes ficam no core (acesso por papel).
      jsonBody: '={{ JSON.stringify({ tipo: "atendimento_humano", atendimento_id: $json.atendimento_id, conversa_id: $json.conversa_id, mensagem: "Nova solicitação ou nova mensagem em atendimento humano. Consulte o painel de atendimentos." }) }}',
      options: { timeout: 10000 },
    },
    [440, 260],
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput' },
  );
  const { nodes, c } = toolExecutor(8, [notify], (c) => link(c, 'Modo', 'Notificar fila da equipe', 1), { modes: true });
  nodes[0].parameters.content = '## WF08 — Atendimento humano\n- `modo=ferramenta`: executa `encaminhar_atendimento` (core cria a solicitação, suspende a automação, registra resumo mascarado e prepara a mensagem ao cliente).\n- `modo=notificar`: avisa a equipe (canal configurável) SEM dados pessoais.\nA retomada da automação só ocorre por ação do atendente (`/admin/atendimentos/{id}/encerrar`).';
  all.push(workflow(8, 'Atendimento humano', nodes, c, { description: 'Encaminhamento e notificação da equipe' }));
}

// ============================================================ WF09 — Comunicação WhatsApp
{
  const c = {};
  const sendBody = "={{ JSON.stringify({ conversa_id: $('Separar mensagens').item.json.conversa_id, mensagem: $('Separar mensagens').item.json.mensagem, finalidade: $('Separar mensagens').item.json.finalidade, origem: $('Separar mensagens').item.json.origem, chave_deduplicacao: $('Separar mensagens').item.json.chave_deduplicacao }) }}";
  const nodes = [
    sticky('## WF09 — Comunicação pelo WhatsApp\nCada mensagem passa pelo core (`/internal/saida/enviar`), que aplica: deduplicação, janela de 24h, modelo aprovado, finalidade, opt-out, limites e conteúdo sensível — e só então chama a Cloud API (com retentativas internas para erros transitórios).\n- `adiada` (limite local) ou `falhou` retentável → aguarda e faz UMA nova tentativa com a MESMA chave de deduplicação\n- `bloqueada`/falha definitiva → registrada; nunca contornada', [-40, -360], 560, 220),
    trigger([['mensagens', 'array']]),
    node('Separar mensagens', 'n8n-nodes-base.splitOut', 1, { fieldToSplitOut: 'mensagens', options: {} }, [220, 0]),
    coreHttp('Core: enviar', 'POST', '/internal/saida/enviar', [440, 0], { body: sendBody }),
    ifNode('Retentar?', "={{ $json.status === 'adiada' || ($json.status === 'falhou' && $json.retentavel === true) }}", isTrue, [660, 0]),
    node('Aguardar', 'n8n-nodes-base.wait', 1.1, { amount: '={{ Math.min(60, Math.ceil(($json.tentar_apos_ms || 5000) / 1000)) }}' }, [880, -100], { webhookId: '7c1f0d7e-0000-4000-8000-0000000000a9' }),
    coreHttp('Core: enviar (nova tentativa)', 'POST', '/internal/saida/enviar', [1100, -100], { body: sendBody }),
    ifNode('Não enviada?', "={{ ['bloqueada', 'falhou', 'adiada'].includes($json.status) }}", isTrue, [1320, 0]),
    coreHttp('Core: registrar falha de envio', 'POST', '/internal/ops/erros', [1540, -40], { body: "={{ JSON.stringify({ origem: 'n8n', workflow: 'WF09', no: 'Core: enviar', codigo: String($json.motivo || $json.classe || $json.status), correlacao: $('Separar mensagens').item.json.chave_deduplicacao }) }}" }),
  ];
  link(c, 'Entrada', 'Separar mensagens');
  link(c, 'Separar mensagens', 'Core: enviar');
  link(c, 'Core: enviar', 'Retentar?');
  link(c, 'Retentar?', 'Aguardar', 0);
  link(c, 'Retentar?', 'Não enviada?', 1);
  link(c, 'Aguardar', 'Core: enviar (nova tentativa)');
  link(c, 'Core: enviar (nova tentativa)', 'Não enviada?');
  link(c, 'Não enviada?', 'Core: registrar falha de envio', 0);
  all.push(workflow(9, 'Comunicação pelo WhatsApp', nodes, c, { description: 'Envio com política, uma retentativa controlada e registro' }));
}

// ============================================================ WF10 — Privacidade
{
  const notify = node(
    'Notificar encarregado (DPO)',
    'n8n-nodes-base.httpRequest',
    4.2,
    { method: 'POST', url: DPO_URL, sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ tipo: "solicitacao_titular", solicitacao_id: $json.solicitacao_id, mensagem: "Nova solicitação de titular registrada. Consulte o painel de privacidade." }) }}', options: { timeout: 10000 } },
    [440, 260],
    { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000, onError: 'continueRegularOutput' },
  );
  const { nodes, c } = toolExecutor(10, [notify], (c) => link(c, 'Modo', 'Notificar encarregado (DPO)', 1), { modes: true });
  nodes[0].parameters.content = '## WF10 — Privacidade e direitos dos titulares\n- `modo=ferramenta`: `registrar_solicitacao_privacidade` (registro + confirmação ao titular).\n- `modo=notificar`: avisa o encarregado.\nExecução (acesso/eliminação) somente via API administrativa com papel `encarregado_dados`, após verificação de identidade. Nenhuma exclusão é disparada por mensagem no chat.';
  all.push(workflow(10, 'Privacidade e direitos dos titulares', nodes, c, { description: 'Registro de solicitações e notificação do encarregado' }));
}

// ============================================================ WF11 — Monitoramento e falhas
{
  const c = {};
  const alert = (name, pos, body) =>
    node(name, 'n8n-nodes-base.httpRequest', 4.2, { method: 'POST', url: ALERT_URL, sendBody: true, specifyBody: 'json', jsonBody: body, options: { timeout: 10000 } }, pos, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' });
  const nodes = [
    sticky('## WF11 — Monitoramento e falhas\n- **Error Trigger**: qualquer workflow com erro → registro mascarado no core + alerta.\n- **Varredura (2 min)**: reconcilia reservas com confirmação pendente no PMS, reenfileira eventos travados (máx. 3), detecta filas acumuladas.\n- **Saúde (5 min)**: banco e integração hoteleira.\nAlertas não contêm dados pessoais.', [-40, -420], 560, 240),
    node('Erro em workflow', 'n8n-nodes-base.errorTrigger', 1, {}, [0, 0]),
    code(
      'Mascarar erro',
      [
        'const e = $input.first().json;',
        "const msg = String(e.execution?.error?.message || '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[EMAIL]').replace(/\\d{8,}/g, '[NUM]').slice(0, 300);",
        "return [{ json: { origem: 'n8n', workflow: e.workflow?.name || null, no: e.execution?.lastNodeExecuted || null, codigo: e.execution?.error?.name || 'erro', mensagem: msg, correlacao: String(e.execution?.id || '') } }];",
      ].join('\n'),
      [220, 0],
    ),
    coreHttp('Core: registrar erro', 'POST', '/internal/ops/erros', [440, 0], { body: '={{ JSON.stringify($json) }}' }),
    alert('Alertar responsáveis', [660, 0], "={{ JSON.stringify({ tipo: 'erro_workflow', workflow: $('Mascarar erro').first().json.workflow, no: $('Mascarar erro').first().json.no, execucao: $('Mascarar erro').first().json.correlacao }) }}"),

    node('A cada 2 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }, [0, 300]),
    coreHttp('Core: varredura', 'POST', '/internal/ops/varredura', [220, 300], { body: '={{ JSON.stringify({}) }}', neverError: false }),
    code('Reprocessar conversas', "return ($input.first().json.conversas_para_reprocessar || []).map((id) => ({ json: { conversa_id: id } }));", [440, 220]),
    execWf('WF02: reprocessar', 2, [660, 220], { conversa_id: '={{ $json.conversa_id }}' }, { wait: false, mode: 'each' }),
    code("Notificações de reserva", "const n = $('Core: varredura').first().json.notificacoes_reserva || []; return n.length ? [{ json: { mensagens: n } }] : [];", [440, 360]),
    execWf('WF09: avisar clientes', 9, [660, 360], { mensagens: '={{ $json.mensagens }}' }, { wait: false }),
    code('Alertas da varredura', "const a = $('Core: varredura').first().json.alertas || []; return a.map((x) => ({ json: x }));", [440, 500]),
    alert('Alertar (varredura)', [660, 500], '={{ JSON.stringify({ tipo: $json.tipo, quantidade: $json.quantidade }) }}'),

    node('A cada 5 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, [0, 700]),
    coreHttp('Core: saúde', 'GET', '/internal/ops/saude', [220, 700], { neverError: true }),
    ifNode('Saudável?', '={{ $json.ok === true }}', isTrue, [440, 700]),
    alert('Alertar indisponibilidade', [660, 780], "={{ JSON.stringify({ tipo: 'componente_indisponivel', componentes: $json.componentes || 'core_inacessivel' }) }}"),
  ];
  link(c, 'Erro em workflow', 'Mascarar erro');
  link(c, 'Mascarar erro', 'Core: registrar erro');
  link(c, 'Core: registrar erro', 'Alertar responsáveis');
  link(c, 'A cada 2 minutos', 'Core: varredura');
  link(c, 'Core: varredura', 'Reprocessar conversas');
  link(c, 'Core: varredura', 'Notificações de reserva');
  link(c, 'Core: varredura', 'Alertas da varredura');
  link(c, 'Reprocessar conversas', 'WF02: reprocessar');
  link(c, 'Notificações de reserva', 'WF09: avisar clientes');
  link(c, 'Alertas da varredura', 'Alertar (varredura)');
  link(c, 'A cada 5 minutos', 'Core: saúde');
  link(c, 'Core: saúde', 'Saudável?');
  link(c, 'Saudável?', 'Alertar indisponibilidade', 1);
  all.push(workflow(11, 'Monitoramento e falhas', nodes, c, { errorWorkflow: false, description: 'Error trigger, varredura/reconciliação e saúde' }));
}

// ============================================================ WF12 — Retenção e descarte
{
  const c = {};
  const nodes = [
    sticky('## WF12 — Retenção e descarte\nDiariamente às 03:00 executa a política de retenção no core (prazos configurados por variáveis de ambiente — PROVISÓRIOS até aprovação do encarregado). Respeita bloqueio legal. O resultado contém apenas contagens.', [-40, -300], 520, 180),
    node('Diariamente 03:00', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 3 }] } }, [0, 0]),
    coreHttp('Core: executar retenção', 'POST', '/internal/jobs/retencao', [240, 0], { body: '={{ JSON.stringify({}) }}', neverError: false, timeout: 300000 }),
    code('Resumo (somente contagens)', 'return [{ json: { executado_em: new Date().toISOString(), ...$input.first().json } }];', [480, 0]),
  ];
  link(c, 'Diariamente 03:00', 'Core: executar retenção');
  link(c, 'Core: executar retenção', 'Resumo (somente contagens)');
  all.push(workflow(12, 'Retenção e descarte', nodes, c, { description: 'Execução diária da política de retenção' }));
}

mkdirSync(OUT, { recursive: true });
const slug = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const wf of all) {
  const file = path.join(OUT, `${wf.name.slice(0, 4).toLowerCase()}-${slug(wf.name.slice(7))}.json`);
  writeFileSync(file, JSON.stringify(wf, null, 2) + '\n');
  console.log('gerado', path.relative(process.cwd(), file), `(${wf.nodes.length} nós)`);
}
