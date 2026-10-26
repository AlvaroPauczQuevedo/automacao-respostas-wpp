# 26 — Pendências para produção

Prioridade: **B** = bloqueante para produção · **A** = alta · **M** = média.

## 1. Dependem da rede/fornecedores

| # | Pendência | Prio | Responsável sugerido |
|---|---|---|---|
| 1 | Responder o levantamento (`01-levantamento-requisitos.md`) | B | Rede |
| 2 | Definir PMS/motor e obter API de homologação; implementar driver/middleware conforme contrato | B | Rede + integrador |
| 3 | Confirmar idempotência e recusa por preço alterado no PMS (ou alternativa segura) | B | Fornecedor PMS |
| 4 | Conta WhatsApp Business (WABA), número, verificação da empresa, token de usuário de sistema, App Secret | B | Rede |
| 5 | Confirmar versão vigente da Graph API e revisar a tabela de erros (`whatsapp/errors.js`) com a documentação atual da Meta | B | Técnico |
| 6 | Publicar aviso de privacidade; validar bases legais, inventário e retenção; RIPD | B | Encarregado + jurídico |
| 7 | Contratos e avaliação de fornecedores (Meta/BSP, Anthropic, nuvem, PMS) e transferências internacionais | B | Jurídico |
| 8 | Carregar e publicar a base de conhecimento oficial | B | Rede |
| 9 | Submeter e aprovar modelos de mensagem; registrá-los no core | B | Rede |
| 10 | Definir canal/inbox de atendimento humano, filas, horário (`HORARIO_ATENDIMENTO`) | B | Rede |
| 11 | Procedimento aprovado de identificação para cancelar/alterar (manter "atendente" ou adotar link por e-mail) | A | Rede + encarregado |
| 12 | Decisão sobre modelo de IA (custo × qualidade) e chave por ambiente | A | Rede |
| 13 | Decisão sobre mensagens promocionais (mantidas desligadas) | M | Rede |

## 2. Técnicas (equipe de desenvolvimento)

| # | Pendência | Prio |
|---|---|---|
| 14 | Executar Dockerfile/docker-compose e montar ambiente de homologação (TLS, rede privada, cofre de segredos, backups) | B |
| 15 | Homologação ponta a ponta com Cloud API real, PMS real e modelo real | B |
| 16 | Conjunto de avaliação da IA (≥ 100 conversas) e red team de injeção de prompt com modelo real | B |
| 17 | Teste de carga (pico × 2) e definição de réplicas/limites; n8n em modo fila se necessário | A |
| 18 | Teste de intrusão e correção de achados | B |
| 19 | Envio automático de modelo aprovado quando a janela estiver fechada (ex.: avisos de reconciliação via `atualizacao_reserva`); hoje o envio livre é bloqueado e registrado | A |
| 20 | Integração com inbox: encaminhar mensagens novas da conversa em atendimento humano (hoje: notificação + leitura via API) | A |
| 21 | Script de re-cifragem para rotação de chave de dados | M |
| 22 | Expurgo de `erro_operacional` e de auditoria vencida por papel de manutenção (hoje manual) | M |
| 23 | Métrica de custo de IA por conversa (tokens) e de respostas corrigidas pela equipe | M |
| 24 | Suporte a múltiplos idiomas (modelos e catálogo determinístico); hoje pt-BR | M |
| 25 | Pré-reserva (hold) quando o PMS suportar | M |
| 26 | Painel administrativo para a base de conhecimento (hoje: SQL/ferramenta da rede) | M |
| 27 | Limite de taxa por IP/número no proxy (complementar ao limite de verificações) | M |
| 28 | Tornar a URL do classificador configurável para gateways corporativos | M |

## 3. Critérios de aceitação do projeto (§22) — situação atual

| # | Critério | Situação |
|---|---|---|
| 1 | Respostas com informações oficiais | Mecanismo pronto; conteúdo oficial pendente (8) |
| 2 | Disponibilidade pelo sistema autorizado | Contrato e drivers prontos; PMS pendente (2) |
| 3 | Tarifas de fonte oficial | Idem; verificador bloqueia valores sem fonte |
| 4 | Reserva com confirmação explícita e validação no backend | Implementado e testado |
| 5 | Não marcar confirmada sem confirmação do sistema | Implementado e testado |
| 6 | Controles de autorização em alteração/cancelamento | Implementado e testado |
| 7 | Janela de atendimento respeitada | Implementado e testado |
| 8 | Modelos aprovados | Pendente (9) |
| 9 | Procedimento de transferência humana | Implementado; inbox pendente (10, 20) |
| 10 | Dados protegidos por controles apropriados | Implementado; infraestrutura pendente (14) |
| 11 | Política de retenção e descarte | Implementada; prazos provisórios (6) |
| 12 | Credenciais fora de prompts, repositório e logs | Implementado e testado |
| 13 | Tratamento de erros nos fluxos críticos | Implementado e testado |
| 14 | Testes essenciais documentados e aprovados | Automatizados aprovados; homologação pendente (15–18) |
| 15 | Documentação de operação e manutenção | Entregue |
| 16 | Políticas de privacidade e bases legais validadas pela empresa | Pendente (6) |
| 17 | Fornecedores e integrações avaliados | Pendente (7) |
| 18 | Procedimento de incidentes | Entregue; ensaio pendente |
| 19 | Monitoramento operacional | Métricas e alertas prontos; stack pendente |
| 20 | Aprovação dos responsáveis da rede | Pendente |

A aprovação técnica nesses critérios **não equivale** a certificação jurídica de conformidade com a LGPD ou com as políticas do WhatsApp.
