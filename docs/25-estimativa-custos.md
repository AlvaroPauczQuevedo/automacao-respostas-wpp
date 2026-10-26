# 25 — Estimativa de custos

> Estimativas de ordem de grandeza, baseadas em premissas explícitas. O volume de conversas da rede **não foi informado**; os valores devem ser recalculados com dados reais do piloto (consumo no console da Anthropic, painel de cobrança da Meta, fatura da nuvem). Preços de modelos: tabela pública da Anthropic consultada em set/2026 (US$ por milhão de tokens). Preços da Meta e da nuvem **não** foram inventados: indicam-se a fórmula e onde consultar.

## 1. Modelo de linguagem

Preços (US$/MTok, entrada/saída): Claude Opus 5.5 4/20 (leitura de cache 0,20) · Claude Sonnet 5.5 2/10 · Claude Haiku 4.5 1/5.

Premissas por turno que aciona a IA (turnos determinísticos, como saudação, botões, "atendente" e opt-out, não usam IA):
- Classificador: ~1.500 tokens de entrada, ~250 de saída (inclui raciocínio em esforço baixo).
- Agente: prefixo fixo (prompt + 19 ferramentas) ~4.600 tokens, cacheado; ~1.500 de contexto; média de 2 chamadas ao modelo por turno (uma ferramenta); ~900 tokens de saída (inclui raciocínio em esforço médio).

| Item | Opus 5.5 (padrão) | Sonnet 5.5 |
|---|---|---|
| Classificador por turno | ≈ US$ 0,011 | ≈ US$ 0,006 |
| Agente por turno (cache aquecido) | ≈ US$ 0,038 | ≈ US$ 0,019 |
| Agente por turno (sem cache) | ≈ US$ 0,075 | ≈ US$ 0,038 |
| **Total por turno com IA** | **≈ US$ 0,05 – 0,09** | ≈ US$ 0,025 – 0,045 |
| Por conversa (premissa: 5 turnos com IA) | ≈ US$ 0,25 – 0,45 | ≈ US$ 0,13 – 0,23 |

Cenários mensais (somente IA):

| Conversas/mês | Opus 5.5 | Sonnet 5.5 |
|---|---|---|
| 1.000 | US$ 250 – 450 | US$ 130 – 230 |
| 5.000 | US$ 1.250 – 2.250 | US$ 650 – 1.150 |
| 20.000 | US$ 5.000 – 9.000 | US$ 2.600 – 4.600 |

Alavancas (decisão da rede, medir qualidade antes de adotar): cache de prompt (já habilitado, 5 min); reduzir esforço; classificador em modelo menor (Haiku 4.5 — atenção: esse modelo usa configuração de raciocínio diferente, a requisição do classificador precisa ser ajustada); agente em Sonnet 5.5; reduzir histórico (12 mensagens). Converter para reais pela cotação do dia de faturamento.

## 2. WhatsApp Business Platform
- A Meta cobra por **mensagem de modelo entregue**, por categoria (marketing, utilidade, autenticação) e país do destinatário. Respostas de atendimento dentro da janela de 24h iniciada pelo cliente não são cobradas, e modelos de utilidade enviados dentro dessa janela também não, conforme as regras vigentes publicadas pela Meta. **Confirmar na tabela oficial para o Brasil antes de orçar.**
- Este projeto responde majoritariamente dentro da janela; o custo vem de modelos fora dela (confirmações tardias, lembretes, retorno de atendimento) e de marketing, que está desligado.
- Fórmula: Σ por categoria (mensagens de modelo entregues × preço da categoria no Brasil). Se usar um BSP, somar a tarifa do provedor.

## 3. Infraestrutura (ordem de grandeza — solicitar cotação)
| Componente | Dimensionamento inicial | Observação |
|---|---|---|
| PostgreSQL gerenciado | 2 vCPU / 4–8 GB, backups e PITR | Maior item fixo |
| Core (contêiner) | 2 réplicas pequenas | Sem estado |
| n8n (contêiner) | 1 instância (modo fila se o volume crescer) | Licença Sustainable Use: avaliar termos para o uso pretendido, ou n8n Cloud/Enterprise |
| Proxy/TLS, monitoramento, logs | Conforme provedor | — |
Faixa típica em provedores de nuvem para esse porte: **algumas centenas de reais a poucos milhares por mês**, a depender de provedor, região, alta disponibilidade e retenção de logs. Valores exatos dependem de cotação.

## 4. Esforço restante de implementação (planejamento, em pessoa-dia)
| Item | Faixa | Dependência |
|---|---|---|
| Driver/middleware do PMS (sem contar o lado do fornecedor) | 10 – 25 | API e homologação do PMS |
| Integração com inbox dos atendentes | 5 – 15 | Escolha da ferramenta |
| Carga e curadoria da base de conhecimento (com a rede) | 5 – 10 | Conteúdo oficial |
| Conjunto de avaliação da IA e ajustes de prompt | 5 – 10 | Chave de API, conversas de referência |
| Homologação com Meta, PMS e infraestrutura (Docker, TLS, cofre, monitoramento) | 8 – 15 | Contas e ambientes |
| Segurança (teste de intrusão, correções) e RIPD (apoio técnico) | 5 – 10 | Fornecedor de teste, jurídico |
| Piloto assistido | 10 – 20 | Equipe da rede |
