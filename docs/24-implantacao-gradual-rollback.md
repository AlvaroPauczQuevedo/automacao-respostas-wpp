# 24 — Plano de implantação gradual e plano de rollback

## 1. Fases (do projeto) e critérios de passagem

| Fase | Entregas | Critério para avançar | Situação |
|---|---|---|---|
| 1 Descoberta | `01-levantamento-requisitos.md` respondido | Itens críticos respondidos: PMS/API, aviso de privacidade, canal humano, conta Meta | **Em aberto** |
| 2 Arquitetura | Este repositório | Aprovação de arquitetura, segurança e privacidade pela rede | Proposta pronta |
| 3 Protótipo informativo | Base de conhecimento real, sem reservas (`HOTEL_ADAPTER` sem capacidade `reserva`) | Conjunto de avaliação de perguntas frequentes ≥ 95% corretas; zero informação sem fonte | Pendente |
| 4 Integração | Driver/middleware do PMS em homologação | Testes de contrato aprovados (idempotência, recusa por preço) | Pendente |
| 5 Consulta e cotação | Disponibilidade/tarifas reais | Valores conferidos com o PMS em amostra de 100 consultas | Pendente |
| 6 Reservas | Criação, consulta, cancelamento/alteração conforme capacidades | Roteiro de homologação sem duplicidades; reconciliação testada | Pendente |
| 7 Segurança e privacidade | RIPD, teste de intrusão, revisão de acessos | Achados críticos corrigidos; bases legais validadas | Pendente |
| 8 Testes | Funcionais, integração, carga, resiliência | Critérios de `10-plano-testes.md` §5 | Parcial (automatizados locais concluídos) |
| 9 Piloto controlado | 1–2 hotéis; números autorizados/percentual de tráfego; equipe acompanhando | 2–4 semanas sem incidente Sev1; transferência e satisfação dentro das metas acordadas | Pendente |
| 10 Produção | Expansão por hotel | 20 critérios de aceitação (seção 22 do projeto) verificados | Pendente |
| 11 Melhoria contínua | Revisões quinzenais de métricas, custos e amostras | — | — |

**Não avançar para fase irreversível** (reservas reais, produção) com dependência crítica pendente.

## 2. Estratégia de liberação no piloto
1. **Somente informativo** (sem reservas): driver sem capacidade `reserva`/`cancelamento`; o agente encaminha pedidos de reserva.
2. **Cotação real**: habilitar `disponibilidade`.
3. **Reserva** para hotéis do piloto: habilitar `reserva` e `busca_por_idempotencia`. Cancelamento/alteração continuam com atendente (`VERIFICACAO_REFORCADA_MODO=atendente`).
4. **Expansão** por hotel (publicar hotéis gradualmente na base).

Para restringir o piloto a números autorizados, recomenda-se um número de WhatsApp dedicado ao piloto (mais simples e seguro do que filtros por remetente).

## 3. Plano de rollback

| Cenário | Ação de rollback | Tempo estimado | Dados |
|---|---|---|---|
| Comportamento inadequado da IA | Desativar WF03 → todas as mensagens que exigem IA recebem contingência e podem ser encaminhadas; ou voltar versão anterior do prompt/modelo | Minutos | Sem impacto |
| Falha de nova versão do core | Reimplantar imagem anterior (tags imutáveis). Migrações são aditivas; não usar `DROP` em migração de avanço | Minutos | Compatível se a migração for aditiva |
| Falha de nova versão dos workflows | Reimportar os JSON da versão anterior (versionados no Git) e publicar | Minutos | Sem impacto |
| Problema no PMS/integração | Remover capacidades (`reserva`, etc.) do driver ou `HOTEL_ADAPTER` para modo somente leitura; reservas vão para atendente | Minutos | Reservas pendentes: reconciliar manualmente |
| Incidente de segurança | Seguir `17-resposta-incidentes.md` (suspender WF01, rotacionar segredos) | Imediato | Preservar evidências |
| Desistência do canal automatizado | Desativar WF01; reapontar o webhook da Meta para o canal anterior (se houver) | Horas | Aplicar retenção/eliminação conforme política |

Pré-requisitos: imagens com tag por versão; workflows exportados versionados; backup antes de cada migração; procedimento de rollback ensaiado em homologação.
