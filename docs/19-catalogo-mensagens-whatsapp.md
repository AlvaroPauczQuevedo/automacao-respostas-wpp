# 19 — Catálogo de mensagens e modelos do WhatsApp

## 1. Mensagens determinísticas (dentro da janela de atendimento)

Implementadas em `services/core/src/whatsapp/catalog.js`. Não são geradas pela IA. Revisar redação com a rede antes da produção.

| Chave | Quando | Texto (resumo) |
|---|---|---|
| `saudacao` | Primeira mensagem / conversa reaberta | "Olá! Seja bem-vindo(a) ao atendimento virtual da [rede]. Sou um assistente virtual automatizado — não sou uma pessoa. … Se preferir falar com nossa equipe a qualquer momento, escreva "atendente". Como posso ajudar?" |
| `indisponibilidadeTecnica` | Sistema de reservas fora | "No momento, não consegui concluir a consulta ao sistema de reservas. Não quero informar um preço ou uma disponibilidade incorretos…" |
| `falhaAssistente` | Falha da IA/orquestração | "Desculpe, tive um problema técnico… posso encaminhar sua solicitação à nossa equipe: basta escrever "atendente"…" |
| `encaminhamento` | Transferência | "Vou encaminhar sua solicitação para nossa equipe de atendimento, que poderá analisar o caso com mais detalhes. [Horário, se configurado e fora do expediente.] Enquanto isso, o assistente virtual ficará em pausa nesta conversa." |
| `retornoAutomacao` | Atendente devolve a conversa | "Seu atendimento com nossa equipe foi concluído…" |
| `naoSuportado` | Áudio/imagem/documento | "Por enquanto consigo entender apenas mensagens de texto… Por segurança, não envie documentos ou dados de cartão por aqui." |
| `optOutConfirmado` | "PARAR", "SAIR", "STOP"… | "Pronto! Você não receberá mais mensagens promocionais…" |
| `resumoReserva` (botões: Confirmar reserva / Não confirmar) | Antes de reservar | Hotel, acomodação, datas, diárias, hóspedes, valor total (impostos incluídos/não), taxas, pagamento, cancelamento, titular, link do aviso de privacidade, prazo para confirmar |
| `reservaConfirmada` | PMS confirmou | Código, hotel, datas, valor confirmado, instruções de chegada e contato do hotel (se retornados) |
| `reservaPendente` | Timeout/pendência | "…a reserva AINDA NÃO está confirmada. Vamos verificar o resultado e avisar você por aqui…" |
| `reservaRecusada` | PMS recusou | "Não foi possível concluir a reserva… Nenhuma reserva foi criada…" |
| `precoAlterado` | Revalidação | "Atenção: o valor desta opção mudou desde a cotação (de X para Y). Nenhuma reserva foi feita…" |
| `confirmacaoExpirada` / `operacaoCancelada` | Prazo vencido / cliente recusou | — |
| `resumoCancelamento` (botões) | Antes de cancelar | Código, multa do sistema oficial, condições, prazo |
| `cancelamentoConfirmado` / `cancelamentoPendente` | Resultado | Protocolo do PMS / "NÃO deve ser considerada cancelada até a confirmação" |
| `resumoAlteracao` (botões) / `alteracaoConfirmada` | Alteração de datas | Novas datas, novo valor, diferença |
| `verificacaoReforcadaEnviada` | Link enviado | "…enviei um link de confirmação para o e-mail cadastrado na reserva…" |
| `privacidadeRecebida` | Pedido LGPD | "Registrei sua solicitação sobre dados pessoais…" |

## 2. Modelos (templates) a submeter à Meta

Necessários para mensagens **fora da janela de 24h**. A aprovação e a **categoria final são definidas pela Meta** — não presumir aprovação. Variáveis `{{n}}` conforme regras da Meta; idioma `pt_BR`. Após aprovação, registrar no core: `PUT /admin/modelos` com nome, idioma, categoria, finalidade, estado `aprovado` e quantidade de parâmetros (o core bloqueia modelos não aprovados ou com parâmetros divergentes).

| Nome sugerido | Categoria proposta | Finalidade | Corpo sugerido | Parâmetros |
|---|---|---|---|---|
| `confirmacao_reserva` | UTILITY | operacional | "Sua reserva {{1}} no {{2}} foi confirmada para {{3}}. Para detalhes, responda esta mensagem." | código, hotel, período |
| `atualizacao_reserva` | UTILITY | operacional | "Temos uma atualização sobre sua solicitação de reserva: {{1}}. Responda esta mensagem para continuar o atendimento." | situação (ex.: "confirmada", "não concluída") |
| `alteracao_reserva` | UTILITY | operacional | "A alteração da sua reserva {{1}} foi registrada: {{2}}." | código, novas datas |
| `cancelamento_reserva` | UTILITY | operacional | "O cancelamento da reserva {{1}} foi confirmado. Protocolo: {{2}}." | código, protocolo |
| `informacoes_hospedagem` | UTILITY | operacional | "Lembrete da sua hospedagem no {{1}} em {{2}}. Check-in a partir de {{3}}." | hotel, data, horário |
| `solicitacao_informacao_pendente` | UTILITY | operacional | "Para concluir sua solicitação, precisamos de uma informação. Responda esta mensagem para continuar." | — |
| `retorno_atendimento` | UTILITY | operacional | "Nossa equipe tem um retorno sobre o seu atendimento. Responda esta mensagem para continuar a conversa." | — |
| `promocional_*` | MARKETING | marketing | Somente se a rede decidir usar, com opt-in específico e opção de saída | — |

Observações:
- Conteúdo promocional não pode ser inserido em modelo utilitário.
- Autorização para receber informações sobre a reserva **não** autoriza publicidade.
- O código atual envia avisos de reconciliação como texto (dentro da janela). Fora da janela, o envio é bloqueado e registrado; a substituição automática pelo modelo `atualizacao_reserva` está listada em `26-pendencias-producao.md`.

## 3. Exemplos do projeto (mantidos)

- Primeira resposta: implementada em `saudacao` (com declaração explícita de assistente virtual).
- Coleta para cotação (redigida pela IA, orientada pelo prompt): "Claro! Para consultar as opções, preciso de três informações: destino, data de entrada e data de saída…"
- Indisponibilidade técnica: `indisponibilidadeTecnica`.
- Encaminhamento: `encaminhamento` (sem prazo).
