# 20 — Manual de instalação

## 1. Pré-requisitos
- Node.js 22 LTS (core) — o n8n 2.44.7 exige Node.js 24 se instalado fora de contêiner.
- PostgreSQL ≥ 14 com **codificação UTF8** (obrigatório).
- n8n 2.44.7 (versão validada) — preferencialmente a imagem oficial `docker.n8n.io/n8nio/n8n:2.44.7`.
- Proxy reverso com TLS (HTTPS) para expor apenas `/webhook/whatsapp` (n8n) e `/verificacao/*` (core).
- Cofre de segredos.

## 2. Banco de dados
```sql
-- como administrador
CREATE DATABASE hotel_agent ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE n8n ENCODING 'UTF8' TEMPLATE template0;
```
Migrações (o script recusa bancos não UTF8):
```bash
cd services/core
npm ci --omit=dev
DATABASE_URL=postgres://ADMIN:***@HOST:5432/hotel_agent node scripts/migrate.js
# 002_papeis_acesso cria app_core, app_conteudo_editor, app_leitura_metricas (sem senha).
# Defina as senhas fora do repositório: ALTER ROLE app_core PASSWORD '...';
# Sem privilégio de criar papéis: node scripts/migrate.js --sem-papeis
```
O core deve conectar com o papel `app_core`.

## 3. Core
```bash
cp .env.example .env     # preencher (ver 21-manual-configuracao.md); nunca versionar
cd services/core && npm ci --omit=dev
node src/server.js        # porta 8080
curl http://localhost:8080/health   # {"ok":true}
```
Contêiner: `docker build -f services/core/Dockerfile -t hotel-agent-core .` (contexto na raiz). O processo encerra na inicialização se a configuração for insegura para o ambiente (`APP_ENV`).

Gerar segredos:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # DATA_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # HASH_PEPPER e tokens
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "<token>"  # hash para SERVICE_TOKENS
```

## 4. n8n
1. Subir o n8n com PostgreSQL próprio (banco `n8n`), `N8N_ENCRYPTION_KEY` do cofre, `WEBHOOK_URL` HTTPS e as variáveis de `09-workflows-n8n.md` §6.
2. Gerar os workflows apontando para o core:
   ```bash
   cd services/core
   CORE_BASE_URL=http://core:8080 EQUIPE_WEBHOOK_URL=https://… DPO_WEBHOOK_URL=https://… ALERTA_WEBHOOK_URL=https://… npm run build:n8n
   ```
3. Importar: `n8n import:workflow --separate --input=n8n/workflows` (ou pela interface: Import from File).
4. Criar as credenciais `Core API - servico_n8n` (Header Auth) e `Anthropic - agente hoteleiro`.
5. Publicar/ativar os workflows (`n8n publish:workflow --id=HotelAgentWfNN00` ou pela interface).
6. Teste: `GET https://<n8n>/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123` → `123`.

## 5. Meta (WhatsApp)
Configurar webhook conforme `09-workflows-n8n.md` §5. Registrar os modelos aprovados no core (`PUT /admin/modelos`).

## 6. Docker Compose (referência — não executado neste ambiente)
```bash
cp .env.example .env   # preencher POSTGRES_*, N8N_*, segredos do core
docker compose up -d --build
```
O serviço `core-migracao` aplica as migrações (sem papéis) antes do core subir.

## 7. Verificação pós-instalação
- `GET /health` do core; `GET /internal/ops/saude` com token `servico_n8n` (banco e integração `ok`).
- WF11 ativo (agendamentos); WF12 agendado.
- Enviar "Oi" do número de teste → saudação recebida.
- Conferir que `/metrics` exige token e que as rotas `/internal` e `/admin` não estão expostas publicamente.
