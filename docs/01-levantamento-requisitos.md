# 01 — Levantamento de requisitos (informações a fornecer pela rede)

Este documento lista as informações que **ainda não foram fornecidas** pela empresa. Nenhum campo foi preenchido com suposições. O comportamento do sistema enquanto cada item estiver pendente está descrito na coluna "Comportamento enquanto pendente".

> Não registrar aqui credenciais, chaves, tokens ou dados reais de hóspedes. Segredos vão para o cofre de segredos; dados de hotéis vão para a base de conhecimento (tabelas `hotel`, `acomodacao`, `politica`, `faq`).

Legenda de situação: **PENDENTE** (não informado) · **PARCIAL** · **RECEBIDO**.

## 1. Identidade e catálogo

| Informação | Situação | Onde será usada | Comportamento enquanto pendente |
|---|---|---|---|
| Nome comercial da rede | PENDENTE | `NOME_REDE` (saudação, mensagens) | Saudação neutra: "atendimento virtual da nossa rede de hotéis" |
| Lista completa de hotéis | PENDENTE | tabela `hotel` (estado `publicado`) | Em produção não há hotéis: buscas retornam vazio e o agente informa que não há hotel publicado. Em desenvolvimento usam-se 3 hotéis **SIMULADOS** |
| Endereço e localização de cada hotel | PENDENTE | `hotel.endereco`, `cidade`, `uf` | Não informado ao cliente |
| Categoria e características das acomodações | PENDENTE | `hotel.categoria`, `acomodacao.descricao` | Não informado |
| Tipos de quartos | PENDENTE | `acomodacao.tipo`, `codigo_externo` (deve casar com o PMS) | Somente o que o PMS retornar na disponibilidade |
| Capacidade de cada acomodação | PENDENTE | `acomodacao.capacidade_*` | Validação de ocupação fica a cargo do PMS |
| Horários de check-in e check-out | PENDENTE | `hotel.checkin_horario/checkout_horario`, política `checkin_checkout` | Agente informa que não possui a informação e oferece atendimento humano |
| Serviços e comodidades | PENDENTE | `hotel.comodidades` | Idem |
| Informações de acessibilidade | PENDENTE | `hotel.acessibilidade`, política `acessibilidade` | Idem |
| Telefones de contato dos hotéis | PENDENTE | `hotel.telefone` (exibido na confirmação de reserva) | Omitido da confirmação |

## 2. Políticas comerciais

| Informação | Situação | Onde será usada | Comportamento enquanto pendente |
|---|---|---|---|
| Política de crianças e hóspedes adicionais | PENDENTE | `politica` (`criancas`, `hospede_adicional`) | "Não possuo essa informação" + encaminhamento |
| Política para animais de estimação | PENDENTE | `politica` (`animais`) | Idem |
| Política de cancelamento | PENDENTE | `politica` (`cancelamento`) e retorno do PMS por tarifa | Para reservas, vale o que o PMS retornar na cotação; para dúvidas gerais, encaminhamento |
| Política de alteração de reservas | PENDENTE | `politica` (`alteracao`) + capacidade do PMS | Alterações encaminhadas a atendente |
| Política de pagamento | PENDENTE | `politica` (`pagamento`), condições da oferta | Pagamentos **nunca** pelo chat; pedidos de pagamento → atendente (fila financeiro) |
| Tarifas e regras comerciais | PENDENTE | exclusivamente via PMS/motor | Sem PMS, não há cotação: informa indisponibilidade e encaminha |
| Promoções vigentes | PENDENTE | apenas se retornadas pelo PMS na oferta | O agente não cita promoções |
| Regras para descontos, cortesias e exceções | PENDENTE | — | Sempre encaminhado (`decisao_comercial`) |

## 3. Atendimento humano

| Informação | Situação | Onde será usada | Comportamento enquanto pendente |
|---|---|---|---|
| Canais de atendimento humano (ferramenta de inbox) | PENDENTE | WF08 (`EQUIPE_WEBHOOK_URL`) e API `/admin/atendimentos` | Solicitações ficam registradas no core; notificação vai para URL placeholder (falha registrada) |
| Horários de atendimento | PENDENTE | `HORARIO_ATENDIMENTO` | **Nenhum horário ou prazo é informado ao cliente** |
| Filas (reservas, financeiro, qualidade, segurança, privacidade) | PENDENTE (padrão proposto) | `FILAS_ATENDIMENTO` | Usa o mapeamento padrão de `handoff/service.js` |
| Responsáveis por fila e escalonamento | PENDENTE | Operação | — |

## 4. Sistemas

| Informação | Situação | Onde será usada | Comportamento enquanto pendente |
|---|---|---|---|
| Sistema de reservas utilizado | PENDENTE | escolha/implementação do driver | Driver **simulado** em dev; produção bloqueada (`validateConfig`) |
| Existência de motor de reservas com API | PENDENTE | driver `rest` ou driver específico | Ver alternativas em `04-arquitetura.md` §8 |
| Existência de PMS (e qual) | PENDENTE | idem | idem |
| Capacidades da API (pré-reserva, idempotência, cancelamento, alteração, consulta por código) | PENDENTE | declaração de capacidades do driver | Operação não suportada → encaminhamento |
| Campos obrigatórios do hóspede para reservar | PENDENTE | `GET /booking-requirements` | Mínimo provisório: nome, sobrenome, e-mail. Documento é recusado no chat |
| Existência de CRM | PENDENTE | não integrado | Sem sincronização com CRM |
| Sistema de pagamentos | PENDENTE | não integrado | Sem cobrança pelo chat |
| Serviço de e-mail transacional | PENDENTE | `NOTIFY_*` (link de verificação reforçada) | `VERIFICACAO_REFORCADA_MODO=atendente` (cancelamento/alteração vão para atendente) |
| Conta WhatsApp Business (WABA), número, verificação de empresa | PENDENTE | `WHATSAPP_*` | Somente modo simulado |

## 5. Volume e idiomas

| Informação | Situação | Onde será usada |
|---|---|---|
| Volume médio de conversas (mês/dia/pico) | PENDENTE | dimensionamento, custos (`25-estimativa-custos.md`) |
| Atendimentos simultâneos estimados | PENDENTE | limites de envio, pool de conexões, réplicas |
| Idiomas suportados | PENDENTE (padrão pt-BR) | `IDIOMAS_SUPORTADOS`; modelos de mensagem por idioma |

## 6. Privacidade e segurança

| Informação | Situação | Onde será usada | Comportamento enquanto pendente |
|---|---|---|---|
| Política de privacidade vigente (URL) | PENDENTE | `AVISO_PRIVACIDADE_URL` | **Coleta de dados de hóspede bloqueada**; reservas encaminhadas a atendente |
| Prazos de retenção aprovados | PENDENTE | `RETENCAO_*` | Valores provisórios conservadores (ver `.env.example`) |
| Encarregado (DPO) e canal | PENDENTE | `CANAL_PRIVACIDADE`, WF10 (`DPO_WEBHOOK_URL`) | Solicitações registradas; canal não informado ao titular |
| Bases legais por finalidade | PENDENTE (proposta em `15-inventario-dados.md`) | — | Proposta técnica; validação jurídica obrigatória |
| Regras de acesso aos sistemas e dados de hóspedes | PENDENTE (proposta em `14-matriz-permissoes.md`) | `SERVICE_TOKENS` | Matriz proposta aplicada |
| Procedimento aprovado de verificação de identidade para reservas | PENDENTE | `reservations/service.js` | Nível 1 (código + sobrenome + data de entrada) para consulta; operações de impacto → atendente |
| Contratos com fornecedores (Meta/BSP, provedor de IA, nuvem) | PENDENTE | `08-integracoes-dependencias.md` | — |

## 7. Perguntas abertas para a reunião de descoberta

1. O PMS/motor permite **reservar via API** com chave de idempotência e recusa se o preço mudou? Se não, aceitamos que a criação seja feita por atendente (fluxo "reserva assistida")?
2. A reserva no PMS é confirmada no ato ou fica pendente de garantia (cartão, pré-pagamento)? Como o assistente deve comunicar essa condição?
3. Qual procedimento a rede aprova para identificar o titular antes de **cancelar/alterar**? (link por e-mail, contato com o hotel, atendente)
4. A rede deseja enviar mensagens promocionais? Se sim, como coletará o opt-in específico?
5. Onde os atendentes trabalham hoje (ferramenta de inbox)? Será necessário integrá-la ao core (`/admin/atendimentos/*`)?
6. Existe exigência de armazenar o conteúdo das conversas (ex.: auditoria de qualidade)? Por quanto tempo?
7. Os modelos de mensagem (templates) serão aprovados na conta de qual empresa/BSP?
