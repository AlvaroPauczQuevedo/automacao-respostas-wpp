# 02 — Requisitos funcionais

Situação: **I** = implementado; **T** = coberto por teste automatizado executado; **E2E** = validado também no n8n real (2.44.7) com core local; **P** = pendente/depende de terceiros. Referências de teste: `services/core/test/*.test.js`, `services/core/test-pg/*.test.js`.

## RF-01 Recepção e idempotência
| ID | Requisito | Situação |
|---|---|---|
| RF-01.1 | Receber eventos do webhook oficial da WhatsApp Cloud API (mensagens e status) | I/T/E2E |
| RF-01.2 | Validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto com App Secret) e rejeitar inválidos | I/T/E2E |
| RF-01.3 | Responder ao desafio de inscrição (`hub.challenge`) somente com token correto | I/T/E2E |
| RF-01.4 | Descartar eventos de outro `phone_number_id` | I/T |
| RF-01.5 | Idempotência por `wamid` (evento repetido não gera nova resposta) | I/T (memória e PostgreSQL, inclusive concorrente) |
| RF-01.6 | Normalizar texto (remover caracteres de controle/invisíveis, limitar tamanho e avisar truncamento) | I/T |
| RF-01.7 | Mensagens não suportadas (áudio, imagem, documento…) recebem orientação e não são processadas | I/T |
| RF-01.8 | Atualizar estado de entrega (enviada → entregue → lida; falhou) sem regressão | I/T |

## RF-02 Gestão de conversas
| ID | Requisito | Situação |
|---|---|---|
| RF-02.1 | Estados: nova, ativa, aguardando_cliente, aguardando_confirmacao, em_atendimento_humano, suspensa, encerrada; transições validadas | I/T |
| RF-02.2 | Trava exclusiva por conversa (lease) e agregação de mensagens consecutivas em um turno | I/T (incl. concorrência real no PostgreSQL) |
| RF-02.3 | Em atendimento humano, a automação não responde (silêncio) e notifica a equipe | I/T/E2E |
| RF-02.4 | Saída do atendimento humano apenas por ação de atendente autorizado | I/T |
| RF-02.5 | Contexto mínimo: últimas N mensagens (cifradas, com expiração) + dados de busca sem PII | I/T |
| RF-02.6 | Recuperação após queda: eventos presos são reenfileirados (máx. 3 tentativas) | I/T |

## RF-03 Identificação e saudação
| ID | Requisito | Situação |
|---|---|---|
| RF-03.1 | Primeira mensagem: saudação determinística que declara ser assistente virtual e explica como pedir humano | I/T/E2E |
| RF-03.2 | Sem nome da rede configurado, saudação neutra (sem inventar) | I/T |

## RF-04 Interpretação e intenções
| ID | Requisito | Situação |
|---|---|---|
| RF-04.1 | Classificar as 23 intenções do projeto, com múltiplas intenções e confiança | I (classificador via API no WF03) / T (roteamento no core) |
| RF-04.2 | Intenções desconhecidas descartadas; classificação nunca autoriza operação crítica | I/T |
| RF-04.3 | Roteamento determinístico: pedido de humano, fraude, cobrança/pagamento, privacidade | I/T |
| RF-04.4 | Pedido de humano detectado por regra (independe da IA) | I/T/E2E |
| RF-04.5 | Três turnos sem intenção identificada → encaminhamento (baixa confiança) | I/T |
| RF-04.6 | Intenções secundárias mantidas como pendentes no contexto | I/T |

## RF-05 Informações da rede (base de conhecimento)
| ID | Requisito | Situação |
|---|---|---|
| RF-05.1 | Listar hotéis, buscar por cidade (sem acento/caixa), detalhes, acomodações, comodidades | I/T (memória e PostgreSQL) |
| RF-05.2 | Somente conteúdo publicado e vigente; política do hotel prevalece sobre a da rede | I/T |
| RF-05.3 | Conflito entre políticas do mesmo nível → `requer_validacao_humana` (não escolhe arbitrariamente) | I/T |
| RF-05.4 | FAQ oficial por palavras-chave | I/T |
| RF-05.5 | Carga e manutenção do conteúdo oficial pela rede | P (dados não fornecidos; ferramenta de edição não incluída) |

## RF-06 Disponibilidade e cotação
| ID | Requisito | Situação |
|---|---|---|
| RF-06.1 | Validar datas (formato, passado, saída > entrada, limites) e ocupação (adultos por quarto, idades) | I/T |
| RF-06.2 | Consultar o sistema oficial por hotel ou por cidade (até 5 hotéis) | I/T (driver simulado e REST local) |
| RF-06.3 | Descartar ofertas incoerentes (hotel ou noites divergentes); validar resposta por esquema | I/T |
| RF-06.4 | Registrar cotação com validade, total, média por diária, impostos, pagamento, cancelamento | I/T |
| RF-06.5 | Indisponibilidade do sistema → mensagem honesta + oferta de humano; 3 falhas → encaminhamento automático | I/T |
| RF-06.6 | Integração com PMS real | **P** |

## RF-07 Criação de reserva
| ID | Requisito | Situação |
|---|---|---|
| RF-07.1 | Iniciar reserva da opção escolhida; retornar campos mínimos e aviso de privacidade | I/T |
| RF-07.2 | Sem aviso de privacidade configurado → bloquear coleta e encaminhar | I/T |
| RF-07.3 | Registrar dados mínimos do hóspede (cifrados, com expiração); recusar CPF/documento/cartão | I/T |
| RF-07.4 | Revalidar preço/disponibilidade antes do resumo; preço alterado → nova confirmação | I/T |
| RF-07.5 | Resumo **determinístico** com botões; reserva só após confirmação do próprio cliente (botão ou "CONFIRMAR") dentro do prazo | I/T |
| RF-07.6 | A IA não possui ferramenta de confirmação | I/T |
| RF-07.7 | Idempotência (chave = ação) e transição atômica (uma execução mesmo com cliques concorrentes) | I/T (memória e PostgreSQL) |
| RF-07.8 | PMS recusa se o total divergir do confirmado | I/T (simulado) — **depende do PMS real** |
| RF-07.9 | Timeout/erro ambíguo → `confirmacao_pendente`, nunca "confirmada"; reconciliação pela chave de idempotência | I/T |
| RF-07.10 | Confirmação somente com resposta validada (código, hotel, datas, valor e moeda coerentes) | I/T |
| RF-07.11 | Mensagem de confirmação apenas com dados retornados pelo sistema | I/T |

## RF-08 Reservas existentes
| ID | Requisito | Situação |
|---|---|---|
| RF-08.1 | Verificação nível 1: código + sobrenome + data de entrada conferidos no PMS; vinculada à conversa; expira | I/T |
| RF-08.2 | Resposta genérica em falha (sem revelar existência); limite de tentativas por conversa e por titular | I/T |
| RF-08.3 | Consulta mostra apenas situação, datas, hotel, acomodação, nº hóspedes, valor, política — nunca contato, documentos, acompanhantes, pagamento | I/T |
| RF-08.4 | Cancelar/alterar exige verificação reforçada: link de uso único ao e-mail do PMS (`link_email`) ou atendente (padrão) | I/T |
| RF-08.5 | Multa/diferença vinda do PMS; reavaliação no momento da execução; confirmação explícita | I/T |
| RF-08.6 | Falha/indisponibilidade na execução → "pendente" + encaminhamento; nunca "cancelada" sem confirmação | I/T |
| RF-08.7 | Pergunta sobre política de cancelamento não cancela | I/T |

## RF-09 Atendimento humano
| ID | Requisito | Situação |
|---|---|---|
| RF-09.1 | Encaminhar por pedido do cliente, fraude, falha repetida, divergência, exceção, cobrança, decisão comercial, privacidade, baixa confiança, insatisfação | I/T |
| RF-09.2 | Registrar motivo, fila, prioridade, resumo mascarado; suspender automação; cancelar ações pendentes | I/T |
| RF-09.3 | Informar horário real somente se configurado; nunca inventar prazo | I/T |
| RF-09.4 | API da equipe: listar, assumir (exclusivo), ler mensagens (somente responsável, auditado), responder (via política de envio), encerrar retomando ou não a automação | I/T |
| RF-09.5 | Notificação da equipe sem dados pessoais (WF08) | I/E2E (destino real P) |
| RF-09.6 | Integração com ferramenta de inbox da rede | **P** |

## RF-10 Comunicação WhatsApp
| ID | Requisito | Situação |
|---|---|---|
| RF-10.1 | Janela de 24h calculada pela última mensagem do cliente; fora dela, somente modelo aprovado | I/T |
| RF-10.2 | Modelo: existente, aprovado, idioma, nº de parâmetros, categoria compatível com a finalidade | I/T |
| RF-10.3 | Marketing desabilitado por padrão; exige opt-in específico; opt-out por palavra-chave e erro 131050 | I/T |
| RF-10.4 | Deduplicação por chave; limites locais por segundo e por destinatário (adiar, nunca contornar) | I/T |
| RF-10.5 | Classificação de erros da Cloud API (transitório, permanente, fora da janela, modelo inválido, alerta) | I/T (tabela a revisar com doc. vigente) |
| RF-10.6 | Bloquear saída com número de cartão | I/T |
| RF-10.7 | Envio real pela Cloud API | **P** (cliente HTTP implementado; sem credenciais) |

## RF-11 Privacidade
| ID | Requisito | Situação |
|---|---|---|
| RF-11.1 | Registrar solicitações de titulares (11 tipos) e confirmar ao titular sem prometer prazo/eliminação | I/T |
| RF-11.2 | Execução apenas por `encarregado_dados`: exportação, eliminação/anonimização, estado, bloqueio legal | I/T |
| RF-11.3 | Eliminação respeita bloqueio legal; mensagem informal não exclui nada | I/T |
| RF-11.4 | Retenção diária automática com contagens auditadas | I/T (memória e PostgreSQL) |

## RF-12 Operação
| ID | Requisito | Situação |
|---|---|---|
| RF-12.1 | Registro mascarado de erros de workflow e alertas (WF11) | I/T/E2E |
| RF-12.2 | Varredura: reconciliação, eventos travados, filas acumuladas, taxa de erros | I/T |
| RF-12.3 | Saúde de banco e integração | I/T |
| RF-12.4 | Métricas Prometheus | I/T |
