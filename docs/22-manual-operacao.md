# 22 — Manual de operação

## 1. Rotina diária
- Painel: mensagens, erros, latência, integração PMS, filas humanas.
- Fila de atendimento: nenhuma solicitação aberta > 30 min no horário de expediente.
- `operacoes_pendentes_reconciliacao = 0`. Se > 0 por mais de 30 min: verificar no PMS cada reserva `confirmacao_pendente` e contatar o cliente (atendente).
- Conferir execução do WF12 (retenção) às 03:00 e o resumo de contagens.

## 2. Situações e ações

| Situação | Sinal | Ação |
|---|---|---|
| PMS indisponível | `componente_disponivel{integracao_hoteleira}=0`, erros `INTEGRACAO_INDISPONIVEL` | O assistente já informa indisponibilidade e encaminha após 3 falhas. Acionar fornecedor; acompanhar fila humana |
| IA indisponível | `turnos_total{falhou}` crescente | O cliente recebe contingência. Verificar status do provedor e chave; considerar desativar WF03 temporariamente (mensagens seguem para contingência) |
| Cloud API com erro "alerta" (token/conta) | log `alerta_conta_whatsapp` | Renovar token de usuário de sistema; verificar qualidade/limites do número no console da Meta |
| Envios bloqueados por janela | `whatsapp_envios_bloqueados_total{fora_da_janela_exige_modelo}` | Usar modelos aprovados para retorno; atendentes respondem dentro de 24h |
| Reserva com confirmação pendente | alerta WF11 | Conferir no PMS; a varredura reconcilia automaticamente quando o PMS responde |
| Guardrail bloqueando muito | `guardrail_bloqueios_total` | Revisar conversas (amostra, com acesso autorizado); ajustar prompt/ferramentas; avaliar |
| Suspeita de ataque | assinaturas inválidas, verificações bloqueadas | Seguir `17-resposta-incidentes.md` |
| Conteúdo desatualizado | reclamação/atendente | Corrigir na base (rascunho → publicado); políticas vencidas deixam de aparecer automaticamente |

## 3. Suspender e retomar a automação
- **Uma conversa**: atendente assume via `/admin/atendimentos/{id}/assumir`; devolve com `encerrar` + `retomar_automacao=true`.
- **Toda a automação**: despublicar WF01 (mensagens deixam de ser processadas; a Meta reenvia por algum tempo e depois descarta) **ou** manter WF01 e desativar WF03 (todas as mensagens que exigem IA recebem contingência). Comunicar a equipe humana antes.

## 4. Modelos de mensagem
Quando a Meta aprovar/pausar/desativar um modelo, atualizar via `PUT /admin/modelos`. O core marca automaticamente como `pausado` se a Cloud API retornar erro de modelo inválido.

## 5. Privacidade (encarregado)
- Listar: `GET /admin/privacidade/solicitacoes?estado=aguardando_identificacao`.
- Exportar dados (após verificar identidade): `POST /admin/privacidade/exportar {telefone, solicitacao_id}`.
- Eliminar/anonimizar: `POST /admin/privacidade/eliminar {solicitacao_id, telefone}` (respeita bloqueio legal).
- Bloqueio legal: `POST /admin/privacidade/bloqueio-legal {conversa_id, ativo, justificativa}`.
- Atualizar estado/resultado: `POST /admin/privacidade/solicitacoes/{id}/estado`.

## 6. Acesso
Tokens individuais por pessoa; revogar no desligamento (remover hash de `SERVICE_TOKENS` e reiniciar o core). Revisão trimestral de acessos.
