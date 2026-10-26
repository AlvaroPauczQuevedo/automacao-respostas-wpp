# 08 — Integrações e dependências

## 1. Serviços externos

| Integração | Finalidade | Dados pessoais trafegados | Papel LGPD provável* | Estado | Pendências |
|---|---|---|---|---|---|
| Meta — WhatsApp Business Platform (Cloud API) ou BSP autorizado | Mensageria | Telefone, conteúdo das mensagens | Operador (avaliar termos da Meta) | Cliente implementado; sem conta | WABA, número verificado, App Secret, token de usuário de sistema, modelos aprovados, versão da Graph API |
| Anthropic (Claude) | Interpretação e redação | Conteúdo das mensagens, contexto (sem telefone) | Operador | Configurado no n8n; sem chave real | Contrato/termos comerciais, região de processamento, retenção de dados do provedor, avaliação de transferência internacional |
| PMS / motor de reservas | Disponibilidade, tarifas, reservas | Nome, sobrenome, e-mail, telefone do titular | Operador (ou sistema do próprio controlador) | Contrato definido; driver simulado e REST | Identificar sistema, API, credenciais, ambiente de homologação |
| Provedor de nuvem / hospedagem | Executar core, n8n, PostgreSQL | Todos os dados armazenados | Operador | Não definido | Região, backups, criptografia de disco, contrato |
| Serviço de e-mail transacional | Link de verificação reforçada | E-mail do titular | Operador | Simulado | Opcional (modo `link_email`) |
| Ferramenta de inbox/atendimento | Atendentes | Conteúdo (via API do core) | Operador | API do core pronta | Escolha e integração |
| Monitoramento/alertas (Prometheus/Grafana, chat de alertas) | Observabilidade | Nenhum dado pessoal por projeto | — | Métricas expostas | Escolher stack |

\* A definição de papéis (controlador/operador), subprocessadores e transferências internacionais **depende dos contratos** e deve ser validada pelo jurídico/encarregado. Certificações públicas de fornecedores não comprovam conformidade por si só.

## 2. Dependências de software

| Componente | Versão | Uso | Licença |
|---|---|---|---|
| Node.js | 22 LTS (core); 24 exigido pelo n8n 2.44.7 | Runtime | MIT |
| ajv / ajv-formats | 8.x / 3.x | Validação de esquemas | MIT |
| pg | 8.x | Driver PostgreSQL | MIT |
| PostgreSQL | ≥ 14 (testado 18) | Banco | PostgreSQL License |
| n8n | 2.44.7 (fixado) | Orquestração | Sustainable Use License — **avaliar termos para o uso pretendido** |

## 3. Ordem de dependência para entrar em produção
1. Conta WhatsApp Business + número + verificação da empresa.
2. Política de privacidade publicada + bases legais validadas.
3. Acesso ao PMS (homologação) e implementação do driver/middleware.
4. Infra (PostgreSQL gerenciado, core, n8n com TLS, cofre de segredos).
5. Conteúdo oficial carregado e publicado (hotéis, políticas, FAQ).
6. Modelos de mensagem aprovados.
7. Canal de atendimento humano e horário definidos.
8. Piloto controlado.
