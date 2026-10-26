# 10 — Plano de testes e casos de teste automatizados

## 1. Níveis de teste

| Nível | Ferramenta | Onde | Dados | Execução |
|---|---|---|---|---|
| Unitário/componente | `node:test` | `services/core/test/*.test.js` | Sintéticos (driver simulado, WhatsApp simulado, repositório em memória) | `npm test` |
| Integração HTTP | `node:test` + servidor real em porta efêmera | `test/http.test.js` | Sintéticos | `npm test` |
| Integração de driver | servidor HTTP local que implementa o contrato | `test/restDriver.test.js` | Sintéticos | `npm test` |
| Banco real | PostgreSQL (testado 18.x) | `test-pg/postgres.test.js` | Sintéticos; banco descartável por execução | `PG_TEST_URL=… npm run test:pg` |
| Ponta a ponta de orquestração | n8n 2.44.7 + core + API Anthropic simulada | procedimento em §4 | Sintéticos | Manual/roteirizado |
| Homologação com serviços reais | Meta (número de teste), PMS de homologação, chave Anthropic | — | Sintéticos/anonimizados | **Pendente** |
| Carga e resiliência | k6/Artillery (proposto) | — | Sintéticos | **Pendente** |
| Avaliação de qualidade da IA | conjunto de conversas de referência + avaliação humana/LLM-juiz | — | Sintéticos | **Pendente** (requer chave e decisões de modelo) |

Regra: **nenhum dado real de hóspede** em desenvolvimento/teste. Os dados simulados contêm "(SIMULADO)" nos nomes e `dados_simulados=true`.

## 2. Rastreabilidade dos cenários obrigatórios (seção 21 do projeto)

Números = ordem na execução de `npm test` (ver `11-resultados-testes.md`). PG = `test-pg/postgres.test.js`. E2E = validação no n8n.

### Atendimento
| Cenário | Testes |
|---|---|
| Cliente inicia uma conversa | 23, 24 · E2E |
| Pergunta genérica | 25 |
| Dados incompletos | 26 (contexto preservado), 4 (validação) |
| Cliente muda de ideia | 20 |
| Mensagens consecutivas | 27, 72 |
| Solicita atendimento humano | 28, 29, 46 · E2E |
| Mensagem ambígua | 33 |

### Reservas
| Cenário | Testes |
|---|---|
| Hotel com disponibilidade | 1, 2, 77 · PG |
| Hotel sem disponibilidade | 3 |
| Tarifa alterada entre consulta e confirmação | 9, 10 |
| Reserva duplicada | 8 · PG (concorrência real) |
| Falha durante a criação | 11, 12, 13 |
| Resposta inválida do PMS | 13, 14, 79 |
| Reserva provisória expirada | 15 |
| Confirmação recebida após timeout | 11 · PG |
| Cancelamento sujeito a multa | 63 |
| Alteração não permitida | 66 (e 67: permitida) |

### WhatsApp
| Cenário | Testes |
|---|---|
| Dentro da janela | 104, 106 |
| Fora da janela | 105, 115 |
| Modelo não aprovado | 107 |
| Modelo indisponível | 107 (inexistente), 108 (pausado/desativado na Meta) |
| Evento duplicado | 111 · PG · E2E (wamid) |
| Erro de envio | 113 |
| Limite de envio | 114, 73 |
| Interrupção de promocionais | 36, 110 |

### Privacidade e segurança
| Cenário | Testes |
|---|---|
| Acessar reserva de terceiro | 58, 60, 17, 21 |
| Obter informações pessoais | 57 (consulta sem dados pessoais), 96 |
| Acesso aos próprios dados | 49, 51 |
| Correção | 52 |
| Eliminação | 53, 54, 56 |
| Injeção de prompt | 96, 97 |
| Ferramenta não autorizada | 93, 6 |
| Falha de autenticação | 41, 86, 92, 100 |
| Acesso indevido por funcionário | 99, 43, 46 |
| Exposição de dados em logs | 91, 89, 76 |
| Segredo em mensagem de erro | 44, 101 |

### Resiliência
| Cenário | Testes |
|---|---|
| Indisponibilidade do banco | 71, 44 |
| Indisponibilidade do modelo de IA | 70 · E2E (chave inválida) |
| Indisponibilidade do PMS | 68, 65 |
| Timeout | 69, 11 |
| Rate limit | 73, 114 |
| Recuperação após reinício | 37, 75 |
| Mensagens concorrentes | 72, 27 · PG |
| Retentativas após falhas | 78, 113 |

## 3. Casos adicionais relevantes
- Guardrail aceita valor oficial (98) e bloqueia número de cartão na saída (120).
- Prompt contém as regras obrigatórias (103) e não contém chaves que quebram o template do n8n (102).
- Produção recusa configuração insegura (85).
- Verificação reforçada: página não confirma em GET; token de uso único (47, 63).
- Migração recusa banco não UTF8 (PG).
- Papéis de banco: `app_core` não apaga auditoria (PG).

## 4. Procedimento E2E local (n8n + core)

1. Core com `WHATSAPP_MODE=mock`, `HOTEL_ADAPTER=mock`, `REPO_DRIVER=memory`, segredos de teste gerados na hora.
2. Gerar workflows com `CORE_BASE_URL=http://127.0.0.1:18080`; importar (`n8n import:workflow --separate`), importar credenciais de teste, `n8n publish:workflow`.
3. Enviar webhooks sintéticos assinados com o App Secret de teste para `http://127.0.0.1:5678/webhook/whatsapp`.
4. Verificar resultados em `/metrics` do core (mensagens enviadas, turnos, ferramentas, guardrails, erros).
5. Para o caminho com ferramentas, apontar a credencial Anthropic para uma API simulada que devolve `tool_use` e, depois, texto.

## 5. Critérios de aprovação para homologação (a executar com serviços reais)
- 100% dos testes automatizados passando (unitários + PostgreSQL).
- Roteiro E2E com número de teste da Meta: saudação, consulta, cotação, reserva com confirmação, consulta de reserva, encaminhamento, opt-out.
- PMS de homologação: disponibilidade, criação idempotente (repetir a mesma chave), recusa por preço alterado, cancelamento.
- Conjunto mínimo de 100 conversas de referência avaliadas (precisão de informação 100% nos itens com fonte oficial; zero valores sem fonte; zero confirmações indevidas).
- Teste de carga no volume de pico estimado × 2, sem respostas duplicadas e p95 dentro do objetivo.
