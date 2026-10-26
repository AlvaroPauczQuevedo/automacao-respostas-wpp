# 12 — Política de logs

## 1. Princípios
1. Logs servem para operar e investigar, não para guardar conversas.
2. Nenhum log contém: conteúdo de mensagens, telefone, nome, e-mail, documento, endereço, dados de pagamento, tokens, chaves, senhas ou corpo de requisições.
3. Identificação por IDs internos opacos (`conv_…`, `turno_…`, `acao_…`) e `x-correlation-id`.
4. Mensagens de erro ao cliente/IA são genéricas; detalhes técnicos só no log (mascarados).

## 2. Fontes e conteúdo permitido

| Fonte | Conteúdo | Proibido | Retenção (proposta) | Acesso |
|---|---|---|---|---|
| Logs da aplicação (core, JSON em stdout) | nível, evento, IDs internos, códigos de erro, duração, contagens | ver §1.2 | 30 dias | admin_tecnico |
| `registro_auditoria` (banco) | ator, operação, recurso (ID), resultado, correlação, detalhes mascarados | conteúdo, argumentos de ferramentas | 5 anos (provisório) | encarregado_dados, auditoria |
| `erro_operacional` (banco) | origem, workflow, nó, código, mensagem mascarada | dados de entrada | 90 dias (proposta; expurgo manual por enquanto) | admin_tecnico |
| Execuções do n8n | **somente execuções com erro** (podem conter dados da mensagem) | execuções bem-sucedidas | 7 dias (`EXECUTIONS_DATA_MAX_AGE=168`) | administradores do n8n (MFA) |
| Métricas (Prometheus) | contadores/histogramas com rótulos de baixa cardinalidade | IDs de conversa/telefone em rótulos | 30–90 dias | admin_tecnico, supervisão |
| Logs do proxy reverso | IP, rota, status, duração | corpo, query com tokens (`hub.verify_token` deve ser mascarado) | 30 dias | admin_tecnico |

## 3. Controles implementados
- `observability/logger.js`: todo campo passa por `redactObject` (chaves sensíveis → `[REDACTED]`; textos com e-mail/telefone/CPF/cartão/CVV mascarados).
- `audit/audit.js`: detalhes mascarados; falha ao auditar é propagada (não silenciosa).
- `ops/service.js`: mensagens de erro do n8n mascaradas (inclui padrões `Bearer`, `token`, `key`, `secret`).
- Router HTTP: erro interno → `{ codigo: ERRO_INTERNO, correlacao }`, sem mensagem/stack.
- Testes: 44, 76, 91, 101 (ver `11-resultados-testes.md`).

## 4. Níveis
`error` falha que exige ação; `warn` degradação/segurança (assinatura inválida, guardrail, retentativa); `info` ciclo de vida; `debug` desligado em produção.

## 5. Proibições operacionais
- Não ativar `debug` em produção sem mudança aprovada e prazo.
- Não copiar execuções do n8n para tickets/chat; referenciar o ID da execução.
- Não usar conversas como dados de treinamento por padrão.
