# 07 — Contratos de API

| Contrato | Arquivo | Consumidor → Provedor | Validação |
|---|---|---|---|
| API do core | `contracts/core-api.openapi.yaml` | n8n e equipe → core | OpenAPI válido (Redocly CLI); comportamento coberto por `test/http.test.js` |
| Integração hoteleira | `contracts/hotel-integration.openapi.yaml` | core (driver `rest`) → middleware do PMS | OpenAPI válido (Redocly CLI); driver testado contra servidor local (`test/restDriver.test.js`); **nenhum PMS real** |
| WhatsApp Cloud API | documentação oficial da Meta | core → Meta | Cliente em `whatsapp/client.js`; **não testado contra a Meta** (sem credenciais) |
| Anthropic Messages API | documentação oficial | n8n → Anthropic | Formato verificado contra API simulada local; **não executado com chave real** |
| Notificação de e-mail | `POST {NOTIFY_EMAIL_WEBHOOK_URL}` com `{ tipo, para, link, finalidade }` | core → serviço de e-mail da rede | Simulado |
| Notificação de equipe / DPO / alertas | `POST` JSON sem dados pessoais (`atendimento_id`, `conversa_id`, `solicitacao_id`, `tipo`) | n8n → canal da rede | Destinos pendentes (placeholders) |

## Pontos-chave do contrato hoteleiro
1. **Idempotência obrigatória** (`Idempotency-Key`) em criação, cancelamento e alteração; e `GET /bookings/by-idempotency-key/{key}` para reconciliação após timeout (404 = não criada).
2. **Valor esperado**: `POST /bookings` recebe `valor_total_esperado` e deve recusar com `motivo=PRECO_ALTERADO` se o total atual divergir.
3. **Consulta para verificação**: `GET /bookings/{code}` retorna `titular_sobrenome` e `contato_verificacao_email`, usados só no servidor (nunca exibidos).
4. **Capacidades**: o driver declara o que suporta; operação ausente → `NAO_SUPORTADO` → encaminhamento.
5. **Erros**: 5xx/429 = indisponibilidade temporária (retentada só em leituras); 4xx = recusa.

## Mensagens trocadas com a Cloud API (resumo)
- Envio: `POST https://graph.facebook.com/{versão}/{phone_number_id}/messages` com `messaging_product: "whatsapp"`, `type: text | interactive (button) | template`. Versão em `WHATSAPP_GRAPH_API_VERSION` (**confirmar a vigente**).
- Recebimento: objeto `whatsapp_business_account` → `entry[].changes[].value.messages[]` e `statuses[]`.
- Assinatura: `X-Hub-Signature-256: sha256=<HMAC do corpo bruto com App Secret>`.
