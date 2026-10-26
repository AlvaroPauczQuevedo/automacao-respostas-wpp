# 00 — Índice dos entregáveis e situação

Legenda: ✅ implementado e testado localmente · 🟡 implementado/escrito, não validado contra serviço real ou ambiente alvo · ⛔ pendente / depende de terceiros.

| # | Entregável (seção 23) | Arquivo(s) | Situação |
|---|---|---|---|
| 1 | Requisitos funcionais | `docs/02-requisitos-funcionais.md` | ✅ |
| 2 | Requisitos não funcionais | `docs/03-requisitos-nao-funcionais.md` | ✅ |
| 3 | Arquitetura geral | `docs/04-arquitetura.md` | ✅ |
| 4 | Diagrama de componentes | `docs/04-arquitetura.md` §1 | ✅ |
| 5 | Diagrama de fluxo de atendimento | `docs/04-arquitetura.md` §4 | ✅ |
| 6 | Modelo de dados | `db/migrations/*.sql`, `docs/05-modelo-dados.md` | ✅ (PostgreSQL 18) |
| 7 | Dicionário de dados | `docs/05-modelo-dados.md` §3 | ✅ |
| 8 | Especificação das ferramentas da IA | `docs/06-ferramentas-ia.md`, `src/tools/registry.js` | ✅ |
| 9 | Contratos de API | `contracts/*.openapi.yaml`, `docs/07-contratos-api.md` | ✅ válidos; 🟡 PMS real |
| 10 | Integrações e dependências | `docs/08-integracoes-dependencias.md` | ✅ |
| 11 | Workflows do n8n exportáveis | `n8n/workflows/*.json`, `docs/09-workflows-n8n.md` | ✅ importados e executados no n8n 2.44.7 (simulado) |
| 12 | Configuração dos webhooks | `docs/09-workflows-n8n.md` §5 | 🟡 sem conta Meta |
| 13 | Código complementar | `services/core/` | ✅ |
| 14 | Configuração de ambiente de exemplo | `.env.example` | ✅ sem segredos |
| 15 | Plano de testes | `docs/10-plano-testes.md` | ✅ |
| 16 | Casos de teste automatizados | `services/core/test/`, `test-pg/`; resultados em `docs/11-resultados-testes.md` | ✅ 120 + 8 aprovados |
| 17 | Política de logs | `docs/12-politica-logs.md` | ✅ |
| 18 | Plano de monitoramento | `docs/13-plano-monitoramento.md` | ✅ métricas; ⛔ stack |
| 19 | Matriz de permissões | `docs/14-matriz-permissoes.md`, `src/security/rbac.js` | ✅ |
| 20 | Inventário de tratamento de dados | `docs/15-inventario-dados.md` | 🟡 proposta para validação jurídica |
| 21 | Matriz de riscos de privacidade | `docs/16-matriz-riscos-privacidade.md` | 🟡 idem |
| 22 | Plano de resposta a incidentes | `docs/17-resposta-incidentes.md` | 🟡 ensaio pendente |
| 23 | Procedimento de transferência humana | `docs/18-transferencia-humana.md` | ✅ API; ⛔ inbox |
| 24 | Catálogo de mensagens e modelos | `docs/19-catalogo-mensagens-whatsapp.md`, `src/whatsapp/catalog.js` | ✅ textos; ⛔ aprovação Meta |
| 25 | Manual de instalação | `docs/20-manual-instalacao.md` | ✅ |
| 26 | Manual de configuração | `docs/21-manual-configuracao.md` | ✅ |
| 27 | Manual de operação | `docs/22-manual-operacao.md` | ✅ |
| 28 | Manual de manutenção | `docs/23-manual-manutencao.md` | ✅ |
| 29 | Plano de implantação gradual | `docs/24-implantacao-gradual-rollback.md` | ✅ |
| 30 | Plano de rollback | `docs/24-implantacao-gradual-rollback.md` §3 | ✅ |
| 31 | Estimativa de custos | `docs/25-estimativa-custos.md` | 🟡 premissas a medir no piloto |
| 32 | Lista de pendências para produção | `docs/26-pendencias-producao.md` | ✅ |
| — | Levantamento de requisitos (seção 3) | `docs/01-levantamento-requisitos.md` | ⛔ aguardando a rede |
| — | Prompt interno do agente (seção 14) | `services/core/prompts/agente-sistema.md` | ✅ texto integral + regras operacionais |
| — | Infraestrutura de referência | `docker-compose.yml`, `services/core/Dockerfile` | 🟡 não executados (sem Docker) |

## O que está pronto vs. o que depende de terceiros

**Pronto e testado localmente**: núcleo de regras (recepção assinada e idempotente, turnos com trava, máquina de estados, 19 ferramentas com lista permitida e validação, cotação, reserva com confirmação explícita e idempotência, reconciliação, reservas existentes com verificação de titularidade, transferência humana, política de envio do WhatsApp, verificador de saída da IA, privacidade e retenção, auditoria e métricas), esquema PostgreSQL, 12 workflows n8n importados e executados ponta a ponta com serviços simulados.

**Simulado** (claramente identificado como SIMULADO): hotéis, tarifas, reservas, envio WhatsApp, e-mail. Produção recusa adaptadores simulados.

**Depende de terceiros**: conta WhatsApp e modelos aprovados; PMS/motor de reservas; chave do modelo de IA; conteúdo oficial; política de privacidade e validação jurídica; infraestrutura; canal de atendimento humano.
