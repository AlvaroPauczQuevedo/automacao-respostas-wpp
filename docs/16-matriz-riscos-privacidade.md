# 16 — Matriz de riscos de privacidade e segurança

Escala: Probabilidade (P) e Impacto (I) de 1 (baixo) a 3 (alto); Risco = P×I. "Residual" considera os controles implementados; valores a recalibrar com o encarregado.

| # | Risco | P | I | Risco | Controles implementados | Residual | Ações pendentes |
|---|---|:-:|:-:|:-:|---|:-:|---|
| R1 | Revelar reserva a terceiro (engenharia social, código vazado) | 3 | 3 | 9 | Verificação nível 1 no PMS; resposta genérica; limite de tentativas por conversa e titular; vinculação à conversa; expiração; nível 2 para cancelar/alterar; consulta sem contato/documentos | 3 | Aprovar procedimento de identificação; avaliar OTP/link oficial |
| R2 | Enumeração de códigos de reserva | 2 | 3 | 6 | Contadores por conversa e por titular; auditoria; alerta de bloqueios | 2 | Limite global por IP/número no proxy |
| R3 | Injeção de prompt levando a operação indevida | 3 | 3 | 9 | IA sem ferramenta de execução; confirmação por evento do cliente; CAS; validação estrita; classificação de fraude | 2 | Avaliação adversarial com modelo real (red team) |
| R4 | IA inventar preço/política/confirmação | 3 | 2 | 6 | Ferramentas oficiais; verificador de saída (valores, alegações); mensagens críticas determinísticas | 2 | Conjunto de avaliação; monitorar `guardrail_bloqueios_total` |
| R5 | Dados pessoais em logs/execuções do n8n | 2 | 2 | 4 | Logger mascarado; execuções de sucesso não salvas; poda 7 d | 2 | Restringir acesso ao n8n; revisar execuções de erro |
| R6 | Vazamento do banco | 1 | 3 | 3 | Criptografia de campo (telefone, conteúdo, dados de hóspede); hash com pepper; menor privilégio | 2 | Criptografia de disco/backup, rede privada, rotação de chaves |
| R7 | Comprometimento de credenciais (Meta, Anthropic, PMS, tokens) | 2 | 3 | 6 | Fora do repositório; tokens só como hash; sem segredos em logs/prompts | 3 | Cofre de segredos, rotação, alertas de uso anômalo |
| R8 | Envio indevido de marketing / fora da janela | 2 | 2 | 4 | Marketing desligado por padrão; opt-in; opt-out por palavra-chave e erro 131050; política de janela/modelos | 1 | Processo de coleta de opt-in, se adotado |
| R9 | Reserva duplicada / cobrada em dobro | 2 | 3 | 6 | Idempotência local + `Idempotency-Key` + CAS + reconciliação | 2 | Confirmar idempotência no PMS real |
| R10 | Reserva comunicada como confirmada sem estar | 2 | 3 | 6 | Só com resposta validada e coerente; timeouts → pendente | 1 | — |
| R11 | Transferência internacional sem salvaguarda (IA/nuvem) | 2 | 2 | 4 | Minimização (telefone não vai ao modelo) | 3 | Contratos, cláusulas, avaliação do provedor |
| R12 | Retenção excessiva | 2 | 2 | 4 | Job diário; prazos configuráveis; bloqueio legal | 2 | Aprovar prazos |
| R13 | Coleta sem aviso de privacidade | 2 | 2 | 4 | Coleta bloqueada sem `AVISO_PRIVACIDADE_URL` | 1 | Publicar aviso |
| R14 | Acesso indevido por funcionário | 2 | 2 | 4 | RBAC; atendimento atribuído; auditoria de leitura | 2 | Revisões periódicas de acesso |
| R15 | Webhook forjado | 2 | 2 | 4 | HMAC sobre corpo bruto; idempotência | 1 | Proteger proxy contra alteração de corpo |
| R16 | Exclusão indevida por pedido informal | 2 | 2 | 4 | Eliminação somente via encarregado; bloqueio legal | 1 | — |
| R17 | Indisponibilidade prolongada (PMS/IA/Meta) | 2 | 2 | 4 | Degradação honesta; encaminhamento; alertas | 2 | Plano de contingência operacional |
| R18 | Documentos/mídias enviados pelo cliente | 2 | 2 | 4 | Mídias não processadas nem baixadas; orientação ao cliente | 1 | Definir canal seguro para documentos |

## Recomendação
Elaborar **Relatório de Impacto à Proteção de Dados (RIPD)** antes do piloto, considerando o uso de IA, o volume e as transferências internacionais. Esta matriz é insumo técnico, não substitui a avaliação jurídica.
