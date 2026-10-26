# 21 — Manual de configuração

Toda a configuração é por variáveis de ambiente (`.env.example` lista todas, com comentários). Segredos vêm do cofre.

## 1. Ambiente e segurança
| Variável | Descrição |
|---|---|
| `APP_ENV` | `desenvolvimento`, `homologacao` ou `producao`. Fora de desenvolvimento, o core exige PostgreSQL, chaves e tokens; em produção recusa adaptadores simulados |
| `DATA_ENCRYPTION_KEY` / `_KEY_ID` / `_OLD_KEYS` | Chave AES-256 (base64, 32 bytes), identificador e chaves antigas para rotação |
| `HASH_PEPPER` | Segredo do HMAC de pseudonimização (trocar exige migração dos hashes) |
| `SERVICE_TOKENS` | JSON `{"<sha256 do token>": {"papel": "...", "ator": "..."}}` |
| `WEBHOOK_ASSINATURA_OBRIGATORIA` | Deve ser `true` fora de desenvolvimento |
| `PUBLIC_BASE_URL` | URL HTTPS do core (links de verificação) |

## 2. WhatsApp
`WHATSAPP_MODE=cloud`, `WHATSAPP_GRAPH_API_VERSION` (**confirmar a versão vigente**), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (usuário de sistema), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. Limites: `WHATSAPP_MAX_SEND_PER_SECOND`, `WHATSAPP_MAX_PER_RECIPIENT_PER_MINUTE` (devem ficar abaixo dos limites da conta; o sistema adia, nunca contorna).

## 3. Integração hoteleira
- `HOTEL_ADAPTER=rest` + `HOTEL_API_BASE_URL` + `HOTEL_API_TOKEN` para um middleware que implemente `contracts/hotel-integration.openapi.yaml`.
- Para um PMS com API própria, criar um driver em `src/integrations/hotel/<pms>Driver.js` com as operações suportadas e a lista `capabilities`, e registrá-lo em `app.js`.
- `hotel.codigo_externo` e `acomodacao.codigo_externo` devem corresponder aos códigos do PMS.

## 4. Base de conhecimento
Carregar hotéis, acomodações, políticas e FAQ nas tabelas correspondentes com `estado_publicacao='rascunho'`, revisar e publicar (`'publicado'`). Campos obrigatórios de governança: `fonte_oficial`/`fonte`, `responsavel`, `atualizado_em`, vigência. Políticas gerais: `hotel_id = NULL`; específicas: `hotel_id` preenchido. Duas políticas publicadas e vigentes da mesma categoria e nível geram conflito (o agente encaminha) — mantenha apenas uma.

## 5. Negócio
| Variável | Efeito |
|---|---|
| `NOME_REDE` | Nome na saudação |
| `AVISO_PRIVACIDADE_URL` | Obrigatório para coletar dados de reserva |
| `CANAL_PRIVACIDADE` | Informado ao titular em pedidos LGPD |
| `HORARIO_ATENDIMENTO` | JSON com fuso, descrição e dias (`"1"`=segunda … `"0"`=domingo). Sem ele, nenhum horário é informado |
| `VERIFICACAO_REFORCADA_MODO` | `atendente` (padrão) ou `link_email` (requer `NOTIFY_*` e `PUBLIC_BASE_URL`) |
| `MARKETING_HABILITADO` | `false` até decisão formal |
| `FILAS_ATENDIMENTO` | Remapeia motivos → filas |

## 6. Modelo de IA (no n8n)
- Modelo padrão `claude-opus-5-5` (WF03, nó "Modelo Claude"; e `requisicao_classificacao` no nó "Montar entrada"). Para trocar, regenerar com `ANTHROPIC_MODEL` / `ANTHROPIC_CLASSIFIER_MODEL`.
- **Manter `thinkingMode: adaptive`** no nó do modelo (o padrão do nó envia raciocínio desativado, rejeitado por esse modelo). Esforço: `medium` (agente), `low` (classificador).
- Cache de prompt 5 min habilitado (reduz custo do prompt de sistema e das ferramentas).
- Se usar gateway corporativo, ajustar a URL base na credencial e a URL do nó "Classificar intenção".

## 7. Retenção e limites
`RETENCAO_*` (dias/horas), `CONFIRMACAO_TTL_MIN`, `VERIFICACAO_*`, `MAX_*`, `TURN_LOCK_LEASE_MS`. Valores provisórios — alterar somente após aprovação do encarregado.

## 8. Prompt do agente
`services/core/prompts/agente-sistema.md` (texto da seção 14 do projeto, integral, + regras operacionais). Não usar `{` ou `}` (o n8n trata o prompt como template; há teste que impede). Alterações exigem revisão e reexecução dos testes e do conjunto de avaliação.
