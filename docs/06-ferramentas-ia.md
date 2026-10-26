# 06 — Especificação das ferramentas da IA

Fonte de verdade: `services/core/src/tools/registry.js` (esquemas JSON) e `src/tools/gateway.js` (execução). Os nós de ferramenta do n8n (WF03) são **gerados** a partir do registro.

## Regras comuns a todas as ferramentas

- **Lista permitida**: apenas os 19 nomes abaixo. Qualquer outro nome → 403 + auditoria `ferramenta.nao_autorizada`. Não há ferramentas de código, SQL, HTTP genérico ou administração.
- **Contexto confiável**: a conversa é derivada do `x-turno-id` no servidor; o modelo não informa conversa nem titular. O turno precisa estar **aberto**, a conversa elegível para automação (não em atendimento humano) e sem encaminhamento no turno.
- **Validação**: JSON Schema estrito (`additionalProperties: false`, padrões de data `AAAA-MM-DD`, IDs com prefixo, limites de tamanho); falha → `{ ok:false, erro:{ codigo:"VALIDACAO", detalhes, orientacao } }`.
- **Limite**: 12 chamadas por turno (configurável) → `LIMITE`.
- **Permissão**: papel `servico_n8n` (`tools:execute`).
- **Auditoria**: `ferramenta.<nome>` com resultado; **sem** registrar argumentos.
- **Erros**: somente erros de domínio têm mensagem exposta; erros internos → `ERRO_INTERNO` genérico. Cada código traz `orientacao` (ex.: indisponibilidade → "Não informe preços… ofereça atendimento humano").
- **Falhas repetidas de integração** (3 na conversa) → encaminhamento automático.
- **Formato de resposta**: `{ ok: true, resultado }` ou `{ ok: false, erro }`.

## Catálogo

| Ferramenta | Finalidade | Obrigatórios | Opcionais | Fonte oficial | Risco | Regras específicas |
|---|---|---|---|---|---|---|
| listar_hoteis | Hotéis publicados | — | — | Base de conhecimento | Baixo | Só `publicado` + `ativo` |
| buscar_hoteis_por_cidade | Hotéis por cidade | cidade | — | Base | Baixo | Comparação sem acento/caixa |
| consultar_detalhes_hotel | Endereço, telefone, horários, acomodações | hotel_id | — | Base | Baixo | Aviso se simulado |
| consultar_comodidades | Comodidades e acessibilidade | hotel_id | — | Base | Baixo | — |
| consultar_politicas | Políticas vigentes | — | hotel_id, categoria | Base | Baixo | Específica prevalece; conflito → `requer_validacao_humana` |
| consultar_faq | Respostas oficiais | pergunta | hotel_id | Base | Baixo | Somente publicadas e vigentes |
| atualizar_contexto | Guardar destino/datas/ocupação | — | destino, hotel_id, entrada, saida, adultos, criancas_idades, quartos, preferencias | — | Baixo | Proibido PII (esquema não aceita) |
| consultar_disponibilidade | Disponibilidade e tarifas | entrada, saida, adultos + (hotel_id **ou** cidade) | criancas_idades, quartos | PMS (adaptador) | Médio | Valida datas/ocupação; até 5 hotéis por cidade; grava cotação; registra valores apresentáveis |
| calcular_cotacao | Detalhar opção | cotacao_id | — | Cotação gravada (do PMS) | Baixo | Não recalcula; sinaliza expiração; mesma conversa |
| iniciar_reserva | Iniciar reserva | cotacao_id | — | PMS (requisitos) | Médio | Exige aviso de privacidade configurado; cancela ações anteriores; devolve campos mínimos |
| registrar_dados_hospede | Dados do titular | cotacao_id, nome, sobrenome | email, telefone | Cliente | Médio | Valida formatos; **CPF/documento/cartão rejeitados**; cifrado; expira em 24 h |
| solicitar_confirmacao_reserva | Revalidar e enviar resumo com botões | cotacao_id | — | PMS | **Alto** | Revalida preço; preço alterado → nova cotação + aviso; resumo determinístico; prazo de 15 min; IA não escreve no turno |
| verificar_titular_reserva | Titularidade (nível 1) | codigo_reserva, sobrenome, data_entrada | — | PMS | **Alto** | Resposta genérica em falha; limite 3 falhas/24 h por conversa e por titular; vinculada à conversa; 30 min |
| consultar_reserva | Situação da reserva | codigo_reserva | — | PMS | Médio | Exige nível 1; sem contato/documentos/acompanhantes/pagamento |
| alterar_reserva | Alteração de datas | codigo_reserva, nova_entrada, nova_saida | — | PMS | **Alto** | Exige nível 2 (link) ou encaminha; capacidade do driver; cotação oficial; confirmação explícita |
| solicitar_cancelamento | Cancelamento | codigo_reserva | — | PMS | **Alto** | Só com pedido explícito; nível 2 ou encaminha; multa oficial; reavalia na execução |
| encaminhar_atendimento | Transferir para humano | motivo (enum), resumo | — | — | Baixo | Resumo mascarado; suspende automação; IA não escreve depois |
| consultar_estado_atendimento | Estado da conversa | — | — | Core | Baixo | — |
| registrar_solicitacao_privacidade | Pedido do titular | tipo (enum LGPD) | descricao | — | Baixo | Não promete prazo nem eliminação |

## Operações internas (NÃO disponíveis ao modelo)

| Operação | Gatilho | Verificações |
|---|---|---|
| confirmar_reserva (`booking.executeCreate`) | Evento do cliente `acao:<id>:confirmar` ou "CONFIRMAR" com uma única ação aberta | Ação da mesma conversa, estado `aguardando_cliente`, não expirada, CAS → `executando`, integridade do resumo (hash canônico), chave de idempotência, valor esperado enviado ao PMS, validação da resposta |
| executar_cancelamento | Evento do cliente | Idem + nível 2 obtido antes do resumo + reavaliação de multa |
| executar_alteracao | Evento do cliente | Idem + reavaliação do novo valor |

## Exemplo — consultar_disponibilidade

Requisição (n8n → core): `POST /internal/ferramentas/consultar_disponibilidade`, cabeçalho `x-turno-id: turno_…`
```json
{ "hotel_id": "hot_simSP0001", "entrada": "2026-12-10", "saida": "2026-12-12", "adultos": 2 }
```
Resposta:
```json
{ "ok": true, "resultado": { "opcoes": [ { "cotacao_id": "cot_…", "hotel": "Hotel Exemplo Centro (SIMULADO)", "acomodacao": "Standard (SIMULADO)", "noites": 2, "valor_total": "640.00", "valor_medio_diaria": "320.00", "moeda": "BRL", "impostos_incluidos": true, "politica_cancelamento": "…", "valida_ate": "…", "tarifa_definitiva": false, "aviso": "COTAÇÃO SIMULADA — ambiente de teste, não é preço real" } ], "sem_disponibilidade": false } }
```
(Valores acima são do driver **simulado**.)

## Como as ferramentas chegam ao modelo (n8n)

Cada ferramenta é um nó `toolWorkflow` (v2.2) com um único parâmetro gerado por `$fromAI('argumentos', <resumo do esquema>, 'json')`. O sub-workflow do domínio (WF04–WF08/WF10) confere a lista permitida, converte texto JSON em objeto se necessário e chama o core. Validado no n8n 2.44.7: o modelo recebeu as 19 ferramentas, chamou `consultar_disponibilidade`, o WF05 executou no core e o resultado retornou ao modelo.
