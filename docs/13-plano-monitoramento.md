# 13 — Plano de monitoramento

## 1. Métricas expostas pelo core (`GET /metrics`, formato Prometheus)

| Métrica | Rótulos | Uso |
|---|---|---|
| `whatsapp_mensagens_recebidas_total` | tipo | Volume recebido |
| `whatsapp_mensagens_enviadas_total` | tipo, finalidade | Volume enviado |
| `whatsapp_envios_bloqueados_total` | motivo | Política (janela, modelo, opt-out…) |
| `whatsapp_envios_adiados_total` | motivo | Limites locais |
| `whatsapp_falhas_envio_total` | classe | Erros da Cloud API |
| `whatsapp_duplicidades_evitadas_total` | direcao | Idempotência entrada/saída |
| `whatsapp_status_total` | estado | Entregue/lida/falhou |
| `webhook_eventos_total` | resultado | ok / assinatura_invalida / json_invalido |
| `turnos_total` | resultado | iniciado / enfileirado / falhou |
| `turno_duracao_segundos` | — | Tempo de resposta (histograma) |
| `intencoes_classificadas_total` | intencao | Demanda por tipo |
| `ferramentas_chamadas_total` | ferramenta, resultado | Uso e falhas de ferramentas |
| `ferramentas_duracao_segundos` | ferramenta | Latência |
| `hotel_integracao_chamadas_total` | driver, op, resultado | Disponibilidade do PMS |
| `hotel_integracao_duracao_segundos` | driver, op | Latência do PMS |
| `cotacoes_geradas_total` | resultado | Consultas concluídas / sem disponibilidade |
| `cotacoes_preco_alterado_total` | — | Mudanças de preço |
| `reservas_total` | estado | iniciada, confirmacao_pendente, confirmada, falhou, cancelada, cancelamento_pendente |
| `reservas_duplicidade_evitada_total`, `reservas_divergentes_total` | — | Integridade |
| `verificacoes_titular_total` | resultado | ok / falhou / bloqueado (enumeração) |
| `atendimentos_humanos_total` | motivo, fila | Taxa de transferência |
| `atendimentos_abertos` (gauge) | — | Fila |
| `operacoes_pendentes_reconciliacao` (gauge) | — | Pendências |
| `guardrail_bloqueios_total` | tipo | Qualidade/segurança da IA |
| `agente_respostas_total` | resultado | ok / substituida |
| `agente_respostas_descartadas_total` | motivo | Texto livre suprimido |
| `solicitacoes_privacidade_total` | tipo | Direitos dos titulares |
| `retencao_registros_total` | tipo | Execução de retenção |
| `erros_operacionais_total` | origem, workflow | Falhas de workflow |
| `componente_disponivel` (gauge) | componente | Banco, integração |
| `http_requisicoes_total`, `http_duracao_segundos` | rota, metodo, status | API |

## 2. Indicadores de negócio (derivados)
- Taxa de consultas concluídas = `cotacoes_geradas_total{com_disponibilidade}` / consultas.
- **Reservas confirmadas** = `reservas_total{estado="confirmada"}` (diferenciar de iniciadas e pendentes).
- Taxa de transferência = atendimentos humanos / conversas.
- Taxa de abandono = ações `criar_reserva` expiradas / iniciadas (consulta SQL em `acao_pendente`).
- Tempo de resolução de atendimento humano = `encerrada_em - criada_em` (SQL).
- Respostas corrigidas pela equipe: **pendente** — requer integração com a inbox para marcar correções.
- Custos de IA: **pendente** — o n8n não expõe tokens; usar o console/Admin API da Anthropic por chave dedicada; custos de mensageria pelo painel da Meta.

## 3. Alertas (WF11 + Prometheus/Alertmanager)

| Alerta | Condição sugerida | Severidade |
|---|---|---|
| Core/banco/PMS indisponível | `/internal/ops/saude` com `ok=false` (5 min) | Crítica |
| Erros de workflow | ≥ `ALERTA_ERROS_POR_HORA` (20) por hora | Alta |
| Fila de atendimento acumulada | solicitação aberta > 30 min | Alta |
| Operações pendentes de reconciliação | > 0 por mais de 30 min | Alta |
| Assinaturas inválidas | > 10 em 5 min (possível ataque) | Alta |
| Verificações bloqueadas | > 5/h (possível enumeração) | Média |
| Erro "alerta" da Cloud API (token, conta, número) | qualquer ocorrência | Crítica |
| Guardrail | bloqueios > 5% das respostas em 1 h | Média |
| Envio bloqueado por janela/modelo | crescimento anômalo | Média |
| Latência do turno | p95 > objetivo por 15 min | Média |

## 4. Painéis sugeridos
1. Operação em tempo real: mensagens in/out, turnos, latência, erros.
2. Integrações: PMS (sucesso/latência por operação), Cloud API (falhas por classe).
3. Funil: consultas → cotações → reservas iniciadas → confirmadas / pendentes / falhas.
4. Atendimento humano: abertas, tempo de espera, motivos.
5. Segurança/IA: guardrails, ferramentas não autorizadas, verificações bloqueadas, assinaturas inválidas.

## 5. Retenção e acesso aos dados de observabilidade
Métricas sem identificadores pessoais (rótulos controlados em código). Retenção 30–90 dias. Acesso por papel `admin_tecnico`/supervisão. O endpoint `/metrics` exige token.
