# 15 — Inventário de tratamento de dados pessoais (proposta técnica)

> **Proposta técnica para validação** do encarregado e do jurídico. As bases legais indicadas são hipóteses a avaliar no contexto real (LGPD, art. 7º); não constituem parecer jurídico. Prazos de retenção são provisórios.

## 1. Inventário

| # | Dado | Finalidade | Base legal a avaliar | Origem | Sistemas | Armazenamento | Retenção (provisória) | Acesso | Eliminação |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Número de WhatsApp (wa_id) | Responder ao cliente; vincular conversa | Procedimentos preliminares a contrato / execução de contrato; legítimo interesse para atendimento de dúvidas | Cliente (WhatsApp) | Meta, n8n (trânsito), core | `conversa.wa_id_cifrado` (AES-256-GCM) + `titular_hash` (HMAC) | Enquanto a conversa estiver ativa; anonimização após 365 d sem interação | servico_n8n (decifra só para envio), encarregado | Anonimização (`wa_id_cifrado=NULL`, hash substituído) |
| 2 | Conteúdo das mensagens | Atender a solicitação; contexto da conversa; atendimento humano | Mesmas do item 1 | Cliente / sistema | Meta, n8n (trânsito; execuções com erro por 7 d), Anthropic (processamento), core | `mensagem.conteudo_cifrado` | 30 d | atendente responsável (auditado), encarregado | Expurgo diário (WF12) |
| 3 | Nome, sobrenome, e-mail, telefone do titular da reserva | Criar a reserva no sistema oficial | Execução de contrato / procedimentos preliminares | Cliente | Anthropic (trânsito), core, PMS | `acao_pendente.payload_cifrado` (temporário) → PMS | Até concluir/expirar; máx. 24 h no core. No PMS: política do PMS | servico_n8n | Apagado ao concluir/expirar; no PMS conforme política da rede |
| 4 | Código da reserva, sobrenome, data de entrada (verificação) | Confirmar titularidade | Legítimo interesse (segurança) / execução de contrato | Cliente | core, PMS | Apenas hash do código (`verificacao_titular`); sobrenome não armazenado | 30 min (verificação) | — | Expiração |
| 5 | E-mail cadastrado no PMS (verificação reforçada) | Enviar link de confirmação | Legítimo interesse (prevenção a fraude) | PMS | core (memória), serviço de e-mail | Não armazenado no core | — | — | — |
| 6 | Preferência de marketing (opt-in/opt-out) | Respeitar escolha do titular | Consentimento (opt-in) / cumprimento de obrigação de respeitar oposição | Cliente | core | `preferencia_comunicacao` | Enquanto houver relação; opt-out mantido para continuar sendo respeitado | encarregado | Mediante solicitação, preservando o registro de oposição |
| 7 | Solicitações de titulares | Atender direitos (art. 18) | Cumprimento de obrigação legal | Cliente | core | `solicitacao_privacidade` (descrição mascarada) | Prazo a definir (comprovação de atendimento) | encarregado | Conforme política |
| 8 | Registros de auditoria | Segurança, rastreabilidade | Legítimo interesse / obrigação legal (se aplicável) | Sistema | core | `registro_auditoria` (sem conteúdo/PII) | 5 anos | encarregado, auditoria | Expurgo por papel de manutenção |
| 9 | Resumo de transferência | Contexto para atendente | Mesmas do item 1 | IA/sistema | core | `solicitacao_atendimento.resumo_mascarado` | Prazo da conversa | atendentes | Anonimização com a conversa |
| 10 | Métricas | Operação | Legítimo interesse | Sistema | Prometheus | Sem dados pessoais | 30–90 d | TI | Rotação |

**Não coletados**: CPF, RG/passaporte, endereço residencial, dados de cartão/CVV, senhas, códigos de autenticação, nome de perfil do WhatsApp, mídias. Se o PMS exigir documento, a reserva é encaminhada a atendente (canal seguro definido pela rede).

## 2. Uso de IA
- O conteúdo da conversa (sem telefone) é enviado ao provedor do modelo para interpretação/redação. Avaliar: contrato, retenção pelo provedor, uso para treinamento (deve estar desativado/contratualmente vedado), região de processamento e transferência internacional.
- **Por padrão, conversas não são usadas para treinar modelos.** Qualquer uso adicional exige análise de finalidade, base legal, transparência e segurança.
- O aviso de privacidade deve informar o uso de assistente virtual automatizado e de fornecedores de IA.

## 3. Transparência — conteúdo mínimo do aviso (a ser redigido pela rede)
Controlador e contato do encarregado; finalidades; categorias de dados; compartilhamentos (Meta, provedor de IA, PMS, hospedagem); retenção; direitos e canal; uso de IA e possibilidade de atendimento humano. O sistema exibe o link (`AVISO_PRIVACIDADE_URL`) antes de coletar dados para reserva e **bloqueia a coleta** se ele não estiver configurado.

## 4. Direitos dos titulares — procedimento
1. Recebimento: pelo chat (`registrar_solicitacao_privacidade` ou classificação) ou outro canal → `solicitacao_privacidade` + notificação ao encarregado (WF10).
2. Identificação proporcional ao risco (definida pela rede; ex.: confirmação pelo próprio número + dado de reserva, ou canal oficial).
3. Execução pelo encarregado (API `/admin/privacidade/*`): acesso/exportação, correção (no PMS, pela equipe do hotel), eliminação/anonimização (respeitando bloqueio legal e obrigações de guarda), bloqueio legal, atualização de estado.
4. Resposta ao titular pelo canal adequado, sem prometer eliminação de dados com guarda obrigatória.
5. Prazos internos: `PRAZO_INTERNO_PRIVACIDADE_DIAS` (provisório 15) — confirmar com o encarregado conforme regulamentação vigente.
