# 14 — Matriz de permissões

Implementação: `services/core/src/security/rbac.js` (fonte única). Autenticação por token de portador; o core guarda apenas o SHA-256 de cada token em `SERVICE_TOKENS`, associado a um papel e a um ator (para auditoria). Recomenda-se um token por pessoa/serviço, rotação trimestral e revogação imediata no desligamento.

## 1. Papéis

| Papel | Quem | Observações |
|---|---|---|
| `servico_n8n` | Orquestrador | Não acessa dados de privacidade nem lê mensagens pela API da equipe |
| `atendente` | Equipe de atendimento | Só lê/responde atendimentos **atribuídos a si** |
| `supervisor` | Coordenação | Gestão de filas, conteúdo e modelos |
| `encarregado_dados` | DPO / equipe de privacidade | Execução de direitos dos titulares e bloqueio legal |
| `admin_tecnico` | Operação de TI | Métricas, jobs; sem acesso a conteúdo |
| *(modelo de IA)* | — | Não é um papel: só chama as 19 ferramentas via `servico_n8n`, com conversa derivada do turno |

## 2. Permissões da API do core

| Permissão | servico_n8n | atendente | supervisor | encarregado_dados | admin_tecnico |
|---|:-:|:-:|:-:|:-:|:-:|
| inbound:process (webhook) | ✅ | | | | |
| turn:process (turnos, configuração do agente) | ✅ | | | | |
| tools:execute (ferramentas da IA) | ✅ | | | | |
| outbound:send | ✅ | | | | |
| handoff:create | ✅ | ✅ | ✅ | | |
| handoff:read (listar) | | ✅ | ✅ | | |
| handoff:assign | | ✅ | ✅ | | |
| handoff:reply (ler mensagens/responder — só se responsável) | | ✅ | ✅ | | |
| handoff:close | | ✅ | ✅ | | |
| privacy:create | ✅ | | | ✅ | |
| privacy:read | | | | ✅ | |
| privacy:execute (exportar, eliminar, estado) | | | | ✅ | |
| legalhold:set | | | | ✅ | |
| knowledge:read | ✅ | ✅ | ✅ | | ✅ |
| knowledge:write | | | ✅ | | |
| templates:write | | | ✅ | | ✅ |
| jobs:run (retenção, varredura) | ✅ | | | | ✅ |
| ops:read (saúde) | ✅ | | ✅ | | ✅ |
| ops:report_error | ✅ | | | | |
| metrics:read | ✅ | | | | ✅ |

Regras adicionais (além do papel): atendimento já assumido por outro atendente não pode ser assumido; somente o responsável encerra e lê mensagens; toda leitura de mensagens pela equipe é auditada (`atendimento.leitura_mensagens`).

## 3. Banco de dados (papéis PostgreSQL — `002_papeis_acesso.sql`)

| Papel | Permissões |
|---|---|
| `app_core` | DML nas tabelas operacionais; SELECT no catálogo; INSERT/SELECT na auditoria (**sem DELETE/UPDATE**); sem DDL |
| `app_conteudo_editor` | SELECT/INSERT/UPDATE em hotel, acomodação, política, FAQ, modelos |
| `app_leitura_metricas` | SELECT em reserva, atendimento, erros; sem conversas/mensagens |
| Administrador do banco | Migrações e expurgo de auditoria vencida (procedimento controlado) |

## 4. Outros sistemas

| Sistema | Acesso recomendado |
|---|---|
| Editor do n8n | Somente admin técnico e responsáveis pelos fluxos; MFA; rede privada/VPN |
| Credenciais do n8n | Somente admins do n8n; chave de criptografia do n8n no cofre |
| Cofre de segredos | Admin técnico (escrita), runtime (leitura do próprio serviço) |
| Console da Meta (WABA) | Responsável de comunicação + admin técnico; token de usuário de sistema com escopo mínimo |
| Console Anthropic | Admin técnico; chave dedicada por ambiente |
| PMS | Credencial de serviço dedicada ao middleware, escopo mínimo |
