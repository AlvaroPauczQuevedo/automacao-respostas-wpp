# 18 — Procedimento de transferência para atendimento humano

## 1. Gatilhos

| Gatilho | Detecção | Motivo registrado | Fila padrão | Prioridade |
|---|---|---|---|---|
| Cliente pede pessoa ("atendente", "humano", "falar com alguém"…) | Regra determinística (sem IA) ou intenção ≥ 0,6 | solicitacao_cliente | reservas | normal |
| Suspeita de fraude / tentativa de manipulação | Intenção `potencialmente_fraudulenta` ≥ 0,7 ou agente | suspeita_fraude | seguranca | alta |
| Cobrança/pagamento | Intenção ≥ 0,7 (pagamento não é feito pelo chat) | disputa_cobranca / pagamento | financeiro | alta / normal |
| Reclamação grave, insatisfação persistente | Agente (`encaminhar_atendimento`) | reclamacao_grave / insatisfacao_persistente | qualidade | alta |
| Falhas repetidas de integração | 3 falhas na conversa (automático) | falha_integracao | reservas | normal |
| Divergência de informações / conflito de políticas | Agente (ferramenta retorna `requer_validacao_humana`) | divergencia_informacao | reservas | normal |
| Situação excepcional (falha ao executar reserva/cancelamento, confirmação divergente) | Core (automático) | situacao_excepcional | reservas | normal |
| Decisão comercial (descontos, exceções) | Agente | decisao_comercial | reservas | normal |
| Dúvida jurídica/privacidade | Agente | juridico_privacidade | privacidade | alta |
| Baixa confiança (3 turnos sem intenção) | Core (automático) | baixa_confianca | reservas | normal |
| Cancelamento/alteração sem verificação reforçada disponível | Core | verificacao_reforcada | reservas | normal |
| Configuração pendente (ex.: aviso de privacidade) | Core | configuracao_pendente | reservas | normal |

Filas podem ser remapeadas por `FILAS_ATENDIMENTO`.

## 2. O que o sistema faz (automático)
1. Cria `solicitacao_atendimento` (uma aberta por conversa) com motivo, fila, prioridade e **resumo mascarado** (sem e-mail, telefone, CPF, cartão).
2. Muda a conversa para `em_atendimento_humano` e `responsavel_atual = fila:<fila>`.
3. Cancela operações pendentes de confirmação da conversa.
4. Envia ao cliente: "Vou encaminhar sua solicitação para nossa equipe de atendimento…". Se `HORARIO_ATENDIMENTO` estiver configurado e fora do expediente, informa o horário real; **nunca informa prazo**.
5. Notifica a equipe (WF08) apenas com IDs.
6. A partir daí, mensagens do cliente não recebem resposta automática; cada nova mensagem gera nova notificação à equipe.

## 3. O que o atendente faz (API `/admin/atendimentos`)
1. `GET /admin/atendimentos?estado=aberta&fila=…` — ver fila.
2. `POST /admin/atendimentos/{id}/assumir` — assumir (exclusivo).
3. `GET /admin/atendimentos/{id}/mensagens` — ler as últimas mensagens (acesso auditado).
4. `POST /admin/atendimentos/{id}/responder` `{ "texto": "..." }` — responder (passa pela política do WhatsApp: fora da janela de 24h só com modelo).
5. `POST /admin/atendimentos/{id}/encerrar` `{ "retomar_automacao": true|false }`:
   - `true`: conversa volta ao assistente, que envia "Seu atendimento com nossa equipe foi concluído…".
   - `false`: conversa encerrada; a próxima mensagem do cliente reinicia o atendimento com saudação.

> A rede ainda precisa definir **qual ferramenta de inbox** os atendentes usarão. A API acima permite integrá-la (ex.: um app interno, Chatwoot ou similar) sem dar acesso direto ao banco.

## 4. Regras
- Operação conjunta (IA + humano) **não** está habilitada.
- O agente não informa prazo de retorno nem promete solução.
- Atendentes não devem solicitar dados de cartão ou documentos pelo chat; documentos exigidos pelo hotel devem seguir canal seguro definido pela rede.
- Retomar a automação só quando a solicitação estiver resolvida ou quando o cliente puder seguir com o assistente.
