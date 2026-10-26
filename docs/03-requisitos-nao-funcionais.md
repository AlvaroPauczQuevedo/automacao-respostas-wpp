# 03 — Requisitos não funcionais

| ID | Categoria | Requisito | Como é atendido | Situação |
|---|---|---|---|---|
| RNF-01 | Segurança | Webhooks autenticados | HMAC `X-Hub-Signature-256` no core; comparação em tempo constante | Implementado e testado |
| RNF-02 | Segurança | Serviços autenticados e autorizados por papel | Bearer token por serviço/pessoa; core armazena só SHA-256; matriz `security/rbac.js` | Implementado e testado |
| RNF-03 | Segurança | Menor privilégio no banco | Papéis `app_core` (sem DDL, sem DELETE na auditoria), `app_conteudo_editor`, `app_leitura_metricas` | Testado em PostgreSQL 18 |
| RNF-04 | Segurança | IA sem acesso a SQL, URLs, código ou administração | Lista permitida de 19 ferramentas, esquema estrito (`additionalProperties:false`), conversa derivada do turno no servidor | Implementado e testado |
| RNF-05 | Segurança | Defesa contra injeção de prompt | Mensagem marcada como dado não confiável; escape de `<`/`>`; classificação de fraude; verificador de saída; travas no backend independem do modelo | Implementado e testado (caminhos determinísticos) |
| RNF-06 | Privacidade | Criptografia em repouso de dados pessoais | AES-256-GCM por campo (telefone, conteúdo, dados do hóspede), com identificação de chave e rotação | Implementado e testado |
| RNF-07 | Privacidade | Pseudonimização | `titular_hash` = HMAC-SHA256(pepper, wa_id) | Implementado e testado |
| RNF-08 | Privacidade | Minimização | Sem nome de perfil; sem CPF/cartão; dados do hóspede apagados ao concluir; conteúdo com expiração | Implementado e testado |
| RNF-09 | Privacidade | Logs sem dados pessoais | Logger com mascaramento recursivo; auditoria sem conteúdo; erros genéricos | Implementado e testado |
| RNF-10 | Confiabilidade | Sem respostas duplicadas | Idempotência de entrada (wamid) e saída (chave de deduplicação) | Testado (memória, PostgreSQL e E2E) |
| RNF-11 | Confiabilidade | Sem reservas duplicadas | Chave de idempotência única + CAS de ação + `Idempotency-Key` no PMS | Testado (concorrência real no PostgreSQL) |
| RNF-12 | Confiabilidade | Retentativas controladas | Backoff exponencial com jitter apenas em operações idempotentes; criação/cancelamento não retentados às cegas | Implementado e testado |
| RNF-13 | Confiabilidade | Recuperação após falha | Lease de trava (120 s), varredura a cada 2 min, reconciliação de reservas pendentes | Implementado e testado |
| RNF-14 | Desempenho | Tempo de resposta | Objetivo inicial (a validar no piloto): p95 < 5 s em respostas sem ferramenta e < 12 s com consulta ao PMS, excluindo latência da Meta | Não medido (requer ambiente real) |
| RNF-15 | Escalabilidade | Horizontal | Core sem estado (estado no PostgreSQL); travas e contadores no banco; n8n escalável em modo fila (queue mode) | Projetado; não testado em carga |
| RNF-16 | Escalabilidade | Limites de envio | Limites locais configuráveis; respeito ao throughput da conta (sem contorno) | Implementado |
| RNF-17 | Observabilidade | Métricas, logs estruturados, correlação | `/metrics` Prometheus; JSON logs; `x-correlation-id` | Implementado |
| RNF-18 | Manutenibilidade | Modularidade | Core em módulos por domínio; drivers de PMS por adaptador; workflows gerados a partir do registro de ferramentas | Implementado |
| RNF-19 | Manutenibilidade | Testabilidade | 120 testes unitários/integração + 8 em PostgreSQL real + E2E com n8n | Executado |
| RNF-20 | Portabilidade | Implantação em contêiner | Dockerfile (não-root, somente leitura), docker-compose de referência | Escrito, **não executado** (Docker indisponível) |
| RNF-21 | Conformidade | Ambientes segregados | `APP_ENV`; produção recusa adaptadores simulados, repositório em memória e configuração sem segredos | Implementado e testado |
| RNF-22 | Conformidade | Codificação | Banco obrigatoriamente UTF8 (migração recusa outro) — defeito real encontrado e corrigido nos testes | Testado |
| RNF-23 | Usabilidade | Mensagens curtas e claras em pt-BR; uma pergunta por vez | Prompt operacional + catálogo determinístico | Implementado (qualidade da IA a avaliar no piloto) |
| RNF-24 | Disponibilidade | Degradação segura | Sem IA → contingência; sem PMS → honestidade + humano; sem banco → erro sem vazamento | Testado |
