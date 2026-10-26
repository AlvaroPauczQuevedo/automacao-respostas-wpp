# 23 — Manual de manutenção

## 1. Estrutura do código (core)
```
services/core/src/
  app.js                 composição e rotas HTTP
  config.js              variáveis de ambiente e validação por ambiente
  http/router.js         roteador, limites, erros uniformes
  security/              criptografia, assinatura, mascaramento, RBAC
  whatsapp/              normalização, cliente, política, saída, catálogo, erros
  turn/                  recepção (idempotência) e processador de turnos
  conversation/          máquina de estados
  tools/                 registro (lista permitida) e gateway
  booking/ reservations/ cotação/reserva e reservas existentes
  handoff/ privacy/      atendimento humano e direitos dos titulares
  integrations/hotel/    contrato do adaptador, drivers simulado e REST, esquemas
  guardrails/            verificador de saída da IA
  retention/ ops/        retenção, monitoramento
  repo/                  repositório em memória (testes) e PostgreSQL
prompts/                 prompt do agente e do classificador
scripts/                 migrate.js, build-n8n-workflows.js
test/, test-pg/          testes
```

## 2. Mudanças comuns

| Mudança | Onde | Cuidados |
|---|---|---|
| Nova ferramenta da IA | `tools/registry.js` (esquema) + `tools/gateway.js` (handler) + domínio em `scripts/build-n8n-workflows.js` (`DOMAIN`) | Regenerar e reimportar workflows; testes de validação, permissão e auditoria |
| Novo PMS | novo driver em `integrations/hotel/` com `capabilities` | Validar respostas contra `schemas.js`; testes com servidor local; idempotência |
| Alterar texto determinístico | `whatsapp/catalog.js` | Revisão da rede; atualizar `19-catalogo…` |
| Alterar prompt | `prompts/*.md` | Sem `{ }`; rodar testes e o conjunto de avaliação |
| Nova coluna/tabela | nova migração `db/migrations/00N_*.sql` (nunca editar migração aplicada) + `repo/postgres.js` + `repo/memory.js` | Rodar `npm test` e `npm run test:pg` |
| Atualizar n8n | Ambiente de homologação | Conferir versões dos nós (`nodes.json`), reimportar, repetir roteiro E2E. Pontos sensíveis já encontrados: `rawBody`×`noResponseBody`, task runner, `thinkingMode` do nó Anthropic |
| Trocar modelo de IA | variáveis do gerador; nó do modelo | Verificar requisitos do modelo (raciocínio, parâmetros de amostragem); reavaliar qualidade/custo |
| Tabela de erros da Cloud API | `whatsapp/errors.js` | Revisar com a documentação vigente da Meta |

## 3. Rotação de segredos
- **Tokens de serviço**: gerar novo token, adicionar seu hash em `SERVICE_TOKENS`, atualizar a credencial do n8n, remover o hash antigo.
- **Chave de dados**: nova chave em `DATA_ENCRYPTION_KEY` com novo `DATA_ENCRYPTION_KEY_ID`; a antiga em `DATA_ENCRYPTION_OLD_KEYS` (dados antigos continuam legíveis; novos são cifrados com a nova). Re-cifrar registros antigos (script a desenvolver) ou aguardar a retenção expirar; então remover a chave antiga.
- **Pepper**: troca invalida a correlação de conversas existentes; planejar migração (recalcular hashes a partir do `wa_id` decifrado).
- **Meta/Anthropic/PMS**: rotacionar no console do fornecedor e no cofre; reiniciar serviços.

## 4. Backups
PostgreSQL com backup diário criptografado + PITR conforme a infraestrutura; teste de restauração trimestral. Backups herdam os prazos de retenção (definir política de expiração de backups com o encarregado).

## 5. Dependências
`npm audit` mensal; atualizar `ajv`, `pg` e Node.js LTS; imagem base do contêiner atualizada mensalmente.

## 6. Testes obrigatórios antes de cada implantação
`npm test` (120) e `npm run test:pg` (8) aprovados; regenerar workflows e reimportar em homologação; roteiro E2E.
