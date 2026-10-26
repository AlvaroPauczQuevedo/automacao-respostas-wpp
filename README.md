# Agente de atendimento e reservas hoteleiras via WhatsApp

Assistente virtual para uma rede hoteleira no WhatsApp: tira dúvidas com base em informações oficiais, consulta disponibilidade e tarifas no sistema de reservas, conduz reservas com **confirmação explícita do cliente**, consulta e gerencia reservas existentes com verificação de titularidade e transfere para atendentes quando necessário.

> **Situação**: núcleo implementado e testado localmente com serviços **simulados**. Ainda **não** está integrado a uma conta WhatsApp, a um PMS real ou ao modelo de IA com chave real, e não há validação jurídica. Veja `docs/00-indice.md` e `docs/26-pendencias-producao.md`.

## Arquitetura em uma frase
O **n8n** orquestra (webhook, roteamento, agente de IA, notificações, agendamentos); o **core** (Node.js) decide e executa tudo que é crítico (assinatura, idempotência, estados, ferramentas permitidas, preços oficiais, reservas, política do WhatsApp, privacidade); o **modelo Claude** interpreta e redige, mas não executa operações irreversíveis.

## Estrutura
```
services/core/        serviço core (código, prompts, scripts, testes)
n8n/workflows/        12 workflows exportáveis (gerados por services/core/scripts/build-n8n-workflows.js)
db/migrations/        esquema PostgreSQL e papéis de acesso
contracts/            OpenAPI: API do core e contrato de integração hoteleira
docs/                 32 entregáveis (índice em docs/00-indice.md)
docker-compose.yml    ambiente de referência (não executado neste ambiente)
.env.example          configuração de exemplo, sem segredos
```

## Começar (desenvolvimento, dados simulados)
```bash
cd services/core
npm ci
npm test                      # 120 testes
node src/server.js            # core em :8080 com repositório em memória e dados SIMULADOS
# PostgreSQL real (opcional):
PG_TEST_URL=postgres://usuario:senha@localhost:5432/postgres npm run test:pg
# Regenerar workflows do n8n:
CORE_BASE_URL=http://core:8080 npm run build:n8n
```
Instalação completa: `docs/20-manual-instalacao.md`. Configuração: `docs/21-manual-configuracao.md`.

## Garantias principais (testadas)
- Nenhuma reserva é criada sem o clique "Confirmar reserva" (ou "CONFIRMAR") do próprio cliente, vinculado à ação e dentro do prazo; a IA não tem ferramenta para confirmar.
- Uma única reserva mesmo com cliques/eventos repetidos ou concorrentes (idempotência + transição atômica), inclusive em PostgreSQL real.
- Uma reserva só é anunciada como confirmada com resposta válida e coerente do sistema oficial; timeouts ficam "pendentes" e são reconciliados.
- Valores monetários na resposta da IA precisam ter vindo do sistema oficial; caso contrário, a resposta é substituída.
- Reservas existentes só são exibidas após verificação de titularidade (o telefone não basta), com limite de tentativas contra enumeração.
- Fora da janela de 24h, apenas modelos aprovados; marketing desligado por padrão e com opt-out.
- Telefone e conteúdo cifrados em repouso; logs e auditoria sem dados pessoais; erros internos sem detalhes.
