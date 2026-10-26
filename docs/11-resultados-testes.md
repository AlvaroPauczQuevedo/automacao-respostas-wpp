# 11 — Resultados dos testes executados

Data da execução: 26/10/2026. Ambiente: Windows 11, Node.js 22.23.3 (core), Node.js 24.22.1 (n8n), PostgreSQL 18 embarcado, n8n 2.44.7. Todos os dados são **sintéticos**.

## 1. Resumo

| Suíte | Comando | Resultado |
|---|---|---|
| Unitários + integração HTTP + driver REST | `cd services/core && npm test` | **120 de 120 aprovados** |
| PostgreSQL real | `PG_TEST_URL=postgres://… npm run test:pg` | **8 de 8 aprovados** |
| Contratos OpenAPI | `redocly lint contracts/*.yaml` | **Válidos** (somente avisos de estilo: `operationId`, respostas 4xx) |
| Importação dos workflows no n8n | `n8n import:workflow --separate` | **12 de 12 importados e publicados** |
| E2E n8n + core (simulado) | roteiro em `10-plano-testes.md` §4 | **7 cenários aprovados** (ver §3) |

## 2. Defeitos encontrados pelos testes e corrigidos

| # | Defeito | Como foi detectado | Correção |
|---|---|---|---|
| 1 | Mensagens com emoji falhavam ao gravar em banco com codificação WIN1252 | Teste em PostgreSQL real | Migração exige `server_encoding=UTF8`; instruções de criação do banco |
| 2 | Hash de integridade do resumo confirmado não batia após gravar em `jsonb` (reordenação de chaves) — a reserva nunca seria executada no PostgreSQL | Teste em PostgreSQL real | JSON canônico (chaves ordenadas) para hashes |
| 3 | Mensagem técnica de erro do banco era repassada ao modelo de IA pelo gateway de ferramentas | Teste em PostgreSQL real | Somente erros de domínio expõem mensagem; demais → `ERRO_INTERNO` (teste de regressão 101) |
| 4 | Ordenação de histórico instável com horários iguais | Teste unitário | Coluna `ordem` (identidade) e desempate no repositório |
| 5 | Code node com `getBinaryDataBuffer` falhava no task runner do n8n 2.x | E2E no n8n | Nó nativo "Extract From File" |
| 6 | Opção `rawBody` do Webhook ignorada quando `noResponseBody` ativo | E2E no n8n + leitura do código do nó | Removido `noResponseBody` |
| 7 | Nó Anthropic do n8n envia `thinking: disabled` por padrão (rejeitado pelo modelo configurado) | Leitura do código do nó 1.6 | `thinkingMode: adaptive` + `effort`; confirmado na requisição capturada (sem `temperature`) |

## 3. Cenários E2E no n8n (core e WhatsApp simulados)

| Cenário | Evidência (métricas/logs do core) |
|---|---|
| Verificação de webhook (token correto/errado) | HTTP 200 com o desafio / 403 |
| "Oi" assinado | `webhook_eventos_total{ok}`, `turnos_total{iniciado}`, `whatsapp_mensagens_enviadas_total` +1 |
| Assinatura inválida | `webhook_eventos_total{assinatura_invalida}`; erro do WF01 registrado pelo WF11 |
| Pedido de atendente | `atendimentos_humanos_total{solicitacao_cliente}`; 2 mensagens enviadas |
| IA com chave inválida | `turnos_total{falhou}`; mensagem de contingência enviada |
| IA com API simulada (ferramenta) | `ferramentas_chamadas_total{consultar_disponibilidade,ok}`, `agente_respostas_total{ok}`; requisição ao modelo com `thinking:adaptive`, `effort:medium`, 19 ferramentas |
| Erro de workflow | `erros_operacionais_total{WF01}` com mensagem mascarada |

## 4. O que NÃO foi testado (e por quê)

| Item | Motivo | Quando testar |
|---|---|---|
| Envio/recebimento real pela Cloud API | Sem conta/credenciais da Meta | Homologação com número de teste |
| Integração com PMS real | Sistema não informado | Após definição do PMS/middleware |
| Qualidade das respostas com o modelo real | Sem chave de API; requer conjunto de avaliação | Fase 3/8 (protótipo e testes) |
| docker-compose / Dockerfile | Docker indisponível no ambiente de desenvolvimento | Antes da homologação |
| Carga, latência p95, modo fila do n8n | Requer infraestrutura alvo | Fase 8 |
| E-mail transacional real (verificação reforçada) | Serviço não definido | Se o modo `link_email` for aprovado |
| Teste de intrusão / análise de vulnerabilidades | Fora do escopo desta fase | Antes da produção |

## 5. Como reproduzir
```bash
cd services/core
npm ci
npm test
# PostgreSQL (banco descartável é criado e removido automaticamente):
PG_TEST_URL=postgres://usuario:senha@localhost:5432/postgres npm run test:pg
```
Sem `PG_TEST_URL`, a suíte PostgreSQL é marcada como **ignorada** (nunca como aprovada).
