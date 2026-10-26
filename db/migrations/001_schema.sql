-- =====================================================================
-- Agente de Atendimento e Reservas Hoteleiras — esquema operacional
-- PostgreSQL >= 14. Executado por services/core/scripts/migrate.js
--
-- Princípios:
--  * Minimização: dados de hóspedes permanecem no PMS; aqui só o necessário à operação.
--  * Telefone (wa_id) somente cifrado (AES-256-GCM na aplicação) + hash HMAC para busca.
--  * Conteúdo de mensagens é opcional, cifrado e com expiração (ver política de retenção).
--  * Nenhum dado de cartão, CVV, senha ou credencial é armazenado.
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migracao (
  versao      text PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
);

-- Remoção simples de acentos para buscas por cidade/palavra-chave (sem depender da extensão unaccent).
CREATE OR REPLACE FUNCTION unaccent_simple(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(t,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')
$$;

-- ---------------------------------------------------------------------
-- BASE DE CONHECIMENTO (informações oficiais publicadas pela rede)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotel (
  id                      text PRIMARY KEY,
  codigo_externo          text UNIQUE,                 -- código do hotel no PMS/motor
  nome                    text NOT NULL,
  cidade                  text NOT NULL,
  uf                      text,
  pais                    text NOT NULL DEFAULT 'BR',
  endereco                text,
  telefone                text,                        -- telefone comercial do hotel (não é dado pessoal)
  email_contato           text,
  categoria               text,
  descricao               text,
  comodidades             jsonb NOT NULL DEFAULT '[]'::jsonb,
  acessibilidade          text,
  checkin_horario         text,
  checkout_horario        text,
  fuso_horario            text NOT NULL DEFAULT 'America/Sao_Paulo',
  status                  text NOT NULL DEFAULT 'em_configuracao'
                          CHECK (status IN ('ativo','inativo','em_configuracao')),
  estado_publicacao       text NOT NULL DEFAULT 'rascunho'
                          CHECK (estado_publicacao IN ('rascunho','publicado','arquivado')),
  fonte_oficial           text NOT NULL,
  responsavel_atualizacao text,
  dados_simulados         boolean NOT NULL DEFAULT false, -- true apenas em ambientes de teste
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hotel_cidade ON hotel (lower(cidade)) WHERE estado_publicacao = 'publicado';

CREATE TABLE IF NOT EXISTS acomodacao (
  id                   text PRIMARY KEY,
  hotel_id             text NOT NULL REFERENCES hotel(id),
  codigo_externo       text,
  tipo                 text NOT NULL,
  capacidade_adultos   int  NOT NULL CHECK (capacidade_adultos > 0),
  capacidade_criancas  int  NOT NULL DEFAULT 0 CHECK (capacidade_criancas >= 0),
  capacidade_total     int  NOT NULL CHECK (capacidade_total > 0),
  descricao            text,
  comodidades          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status               text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  fonte_oficial        text NOT NULL,
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, codigo_externo)
);

-- hotel_id NULL = política geral da rede; preenchido = específica do hotel (prevalece).
CREATE TABLE IF NOT EXISTS politica (
  id                 text PRIMARY KEY,
  hotel_id           text REFERENCES hotel(id),
  categoria          text NOT NULL CHECK (categoria IN (
                       'checkin_checkout','criancas','hospede_adicional','animais','cancelamento',
                       'alteracao','pagamento','acessibilidade','geral','privacidade')),
  titulo             text NOT NULL,
  descricao          text NOT NULL,
  vigencia_inicio    date NOT NULL,
  vigencia_fim       date,
  fonte              text NOT NULL,
  responsavel        text,
  estado_publicacao  text NOT NULL DEFAULT 'rascunho' CHECK (estado_publicacao IN ('rascunho','publicado','arquivado')),
  dados_simulados    boolean NOT NULL DEFAULT false,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS ix_politica_lookup ON politica (categoria, hotel_id) WHERE estado_publicacao = 'publicado';

CREATE TABLE IF NOT EXISTS faq (
  id                 text PRIMARY KEY,
  hotel_id           text REFERENCES hotel(id),
  pergunta           text NOT NULL,
  resposta           text NOT NULL,
  palavras_chave     text[] NOT NULL DEFAULT '{}',
  fonte              text NOT NULL,
  responsavel        text,
  estado_publicacao  text NOT NULL DEFAULT 'rascunho' CHECK (estado_publicacao IN ('rascunho','publicado','arquivado')),
  vigencia_inicio    date,
  vigencia_fim       date,
  dados_simulados    boolean NOT NULL DEFAULT false,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- CONVERSAS E MENSAGENS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa (
  id                         text PRIMARY KEY,
  titular_hash               text NOT NULL,             -- HMAC(pepper, wa_id)
  wa_id_cifrado              text,                      -- necessário para responder; NULL após anonimização
  canal                      text NOT NULL DEFAULT 'whatsapp',
  estado                     text NOT NULL DEFAULT 'nova' CHECK (estado IN (
                               'nova','ativa','aguardando_cliente','aguardando_confirmacao',
                               'em_atendimento_humano','suspensa','encerrada')),
  responsavel_atual          text NOT NULL DEFAULT 'agente',
  idioma                     text NOT NULL DEFAULT 'pt-BR',
  contexto                   jsonb NOT NULL DEFAULT '{}'::jsonb, -- slots de busca e intenções pendentes (sem PII)
  ultima_entrada_cliente_em  timestamptz,               -- base da janela de atendimento
  lock_dono                  text,
  lock_ate                   timestamptz,
  bloqueio_legal             boolean NOT NULL DEFAULT false,
  anonimizada_em             timestamptz,
  criada_em                  timestamptz NOT NULL DEFAULT now(),
  atualizada_em              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conversa_titular_canal ON conversa (titular_hash, canal) WHERE anonimizada_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_conversa_atualizada ON conversa (atualizada_em);

-- Idempotência de webhooks: o identificador da Meta (wamid / id de status) é a chave primária.
CREATE TABLE IF NOT EXISTS evento_entrada (
  id               text PRIMARY KEY,
  tipo             text NOT NULL CHECK (tipo IN ('mensagem','status')),
  conversa_id      text REFERENCES conversa(id),
  estado           text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','processando','processado','descartado','falhou')),
  payload_cifrado  text,                                -- mensagem normalizada, cifrada; apagada após processamento
  tentativas       int  NOT NULL DEFAULT 0,
  recebido_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evento_conversa_estado ON evento_entrada (conversa_id, estado);
CREATE INDEX IF NOT EXISTS ix_evento_recebido ON evento_entrada (recebido_em);

CREATE TABLE IF NOT EXISTS mensagem (
  id                    text PRIMARY KEY,
  ordem                 bigint GENERATED ALWAYS AS IDENTITY,  -- desempate de ordenação
  conversa_id           text NOT NULL REFERENCES conversa(id),
  identificador_externo text UNIQUE,                    -- wamid
  direcao               text NOT NULL CHECK (direcao IN ('entrada','saida')),
  tipo                  text NOT NULL,
  finalidade            text CHECK (finalidade IN ('atendimento','operacional','marketing')),
  estado                text NOT NULL CHECK (estado IN ('recebida','enviando','enviada','entregue','lida','falhou','bloqueada')),
  conteudo_cifrado      text,                           -- opcional; expira conforme política
  conteudo_expira_em    timestamptz,
  chave_deduplicacao    text UNIQUE,
  modelo_nome           text,
  erro_codigo           text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mensagem_conversa ON mensagem (conversa_id, criado_em DESC, ordem DESC);
CREATE INDEX IF NOT EXISTS ix_mensagem_conteudo_expira ON mensagem (conteudo_expira_em) WHERE conteudo_cifrado IS NOT NULL;

CREATE TABLE IF NOT EXISTS turno (
  id                    text PRIMARY KEY,
  conversa_id           text NOT NULL REFERENCES conversa(id),
  eventos               text[] NOT NULL DEFAULT '{}',
  estado                text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','concluido','falhou')),
  intencoes             jsonb,
  ferramentas_chamadas  int NOT NULL DEFAULT 0,
  confirmacao_enviada   boolean NOT NULL DEFAULT false,
  encaminhado           boolean NOT NULL DEFAULT false,
  operacao_confirmada   text,                               -- resultado de operação executada neste turno
  saida                 jsonb NOT NULL DEFAULT '[]'::jsonb, -- mensagens determinísticas a enviar (sem PII além do necessário)
  valores_apresentaveis text[] NOT NULL DEFAULT '{}',       -- valores monetários retornados por fontes oficiais neste turno
  criado_em             timestamptz NOT NULL DEFAULT now(),
  concluido_em          timestamptz
);
CREATE INDEX IF NOT EXISTS ix_turno_conversa ON turno (conversa_id, criado_em DESC);

-- ---------------------------------------------------------------------
-- COTAÇÕES, AÇÕES PENDENTES E RESERVAS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cotacao (
  id                     text PRIMARY KEY,
  conversa_id            text NOT NULL REFERENCES conversa(id),
  hotel_id               text NOT NULL REFERENCES hotel(id),
  acomodacao_codigo      text NOT NULL,
  acomodacao_nome        text,
  identificador_externo  text NOT NULL,                 -- chave da oferta/tarifa no PMS
  entrada                date NOT NULL,
  saida                  date NOT NULL,
  adultos                int  NOT NULL CHECK (adultos > 0),
  criancas_idades        int[] NOT NULL DEFAULT '{}',
  quartos                int  NOT NULL DEFAULT 1 CHECK (quartos > 0),
  noites                 int  NOT NULL CHECK (noites > 0),
  valor_total            numeric(12,2) NOT NULL CHECK (valor_total >= 0),
  valor_medio_diaria     numeric(12,2),
  moeda                  char(3) NOT NULL,
  impostos_incluidos     boolean,
  taxas_descricao        text,
  politica_cancelamento  text,
  condicoes_pagamento    text,
  plano_tarifario        text,
  validade               timestamptz,
  estado                 text NOT NULL DEFAULT 'ofertada' CHECK (estado IN ('ofertada','selecionada','expirada','convertida','substituida')),
  origem                 text NOT NULL CHECK (origem IN ('pms','simulado')),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CHECK (saida > entrada)
);
CREATE INDEX IF NOT EXISTS ix_cotacao_conversa ON cotacao (conversa_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS acao_pendente (
  id                      text PRIMARY KEY,
  conversa_id             text NOT NULL REFERENCES conversa(id),
  tipo                    text NOT NULL CHECK (tipo IN ('criar_reserva','cancelar_reserva','alterar_reserva')),
  estado                  text NOT NULL CHECK (estado IN ('coletando_dados','aguardando_cliente','executando','concluida','expirada','cancelada','falhou','pendente_reconciliacao')),
  cotacao_id              text REFERENCES cotacao(id),
  reserva_externa_hash    text,
  payload_cifrado         text,                         -- dados mínimos do hóspede; apagado ao concluir
  payload_hash            text,                         -- integridade do resumo confirmado
  resumo_confirmado       jsonb,                        -- valores exibidos ao cliente (sem PII)
  expira_em               timestamptz,
  confirmada_por_evento   text,
  resultado_codigo        text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_acao_conversa_estado ON acao_pendente (conversa_id, estado);

CREATE TABLE IF NOT EXISTS reserva (
  id                     text PRIMARY KEY,
  identificador_externo  text,                          -- código de confirmação retornado pelo PMS
  hotel_id               text NOT NULL REFERENCES hotel(id),
  cotacao_id             text REFERENCES cotacao(id),
  conversa_id            text REFERENCES conversa(id),
  acao_id                text UNIQUE REFERENCES acao_pendente(id),
  chave_idempotencia     text NOT NULL UNIQUE,
  estado                 text NOT NULL CHECK (estado IN ('iniciada','provisoria','confirmacao_pendente','confirmada','cancelamento_pendente','cancelada','falhou')),
  entrada                date NOT NULL,
  saida                  date NOT NULL,
  valor_total            numeric(12,2),
  moeda                  char(3),
  bloqueio_legal         boolean NOT NULL DEFAULT false,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reserva_estado ON reserva (estado, atualizado_em);

-- ---------------------------------------------------------------------
-- VERIFICAÇÃO DE TITULARIDADE (consulta/alteração de reservas existentes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verificacao_titular (
  id                     text PRIMARY KEY,
  conversa_id            text NOT NULL REFERENCES conversa(id),
  reserva_externa_hash   text NOT NULL,
  nivel                  int  NOT NULL CHECK (nivel IN (1,2)),
  estado                 text NOT NULL CHECK (estado IN ('valida','expirada','revogada','aguardando_link')),
  token_hash             text UNIQUE,                   -- link de verificação reforçada (somente hash)
  acao_id                text REFERENCES acao_pendente(id),
  expira_em              timestamptz NOT NULL,
  criado_em              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_verificacao_lookup ON verificacao_titular (conversa_id, reserva_externa_hash, estado);

CREATE TABLE IF NOT EXISTS contador_limite (
  chave         text NOT NULL,
  janela_inicio timestamptz NOT NULL,
  contagem      int NOT NULL DEFAULT 0,
  expira_em     timestamptz NOT NULL,
  PRIMARY KEY (chave, janela_inicio)
);

-- ---------------------------------------------------------------------
-- ATENDIMENTO HUMANO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitacao_atendimento (
  id                 text PRIMARY KEY,
  conversa_id        text NOT NULL REFERENCES conversa(id),
  categoria          text NOT NULL,
  motivo             text NOT NULL,
  prioridade         text NOT NULL CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  fila               text NOT NULL,
  estado             text NOT NULL CHECK (estado IN ('aberta','em_atendimento','encerrada')),
  responsavel        text,
  resumo_mascarado   text,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  assumida_em        timestamptz,
  encerrada_em       timestamptz
);
CREATE INDEX IF NOT EXISTS ix_atendimento_estado ON solicitacao_atendimento (estado, fila, criada_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_atendimento_aberto_por_conversa ON solicitacao_atendimento (conversa_id) WHERE estado <> 'encerrada';

-- ---------------------------------------------------------------------
-- COMUNICAÇÃO E PRIVACIDADE
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preferencia_comunicacao (
  id               text PRIMARY KEY,
  titular_hash     text NOT NULL,
  finalidade       text NOT NULL CHECK (finalidade IN ('marketing','operacional')),
  estado           text NOT NULL CHECK (estado IN ('concedida','revogada')),
  origem           text NOT NULL,                       -- ex.: 'whatsapp:palavra_chave', 'formulario_site'
  evidencia        text,                                -- referência (ex.: wamid), nunca o conteúdo
  registrado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (titular_hash, finalidade)
);

CREATE TABLE IF NOT EXISTS solicitacao_privacidade (
  id                   text PRIMARY KEY,
  titular_hash         text NOT NULL,
  conversa_id          text REFERENCES conversa(id),
  tipo                 text NOT NULL CHECK (tipo IN ('confirmacao','acesso','correcao','compartilhamento','eliminacao','anonimizacao','bloqueio','revogacao_consentimento','oposicao','portabilidade','outro')),
  estado               text NOT NULL CHECK (estado IN ('recebida','aguardando_identificacao','em_analise','concluida','indeferida')),
  descricao_mascarada  text,
  prazo_interno        timestamptz,
  responsavel          text,
  resultado            text,
  criada_em            timestamptz NOT NULL DEFAULT now(),
  atualizada_em        timestamptz NOT NULL DEFAULT now(),
  concluida_em         timestamptz
);

CREATE TABLE IF NOT EXISTS modelo_mensagem (
  id                 text PRIMARY KEY,
  nome               text NOT NULL,
  idioma             text NOT NULL,
  categoria          text NOT NULL CHECK (categoria IN ('UTILITY','MARKETING','AUTHENTICATION')),
  finalidade         text NOT NULL CHECK (finalidade IN ('operacional','marketing','atendimento')),
  estado             text NOT NULL CHECK (estado IN ('rascunho','pendente','aprovado','rejeitado','pausado','desativado')),
  qtd_parametros     int  NOT NULL DEFAULT 0,
  corpo_referencia   text,
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nome, idioma)
);

-- ---------------------------------------------------------------------
-- AUDITORIA E OPERAÇÃO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registro_auditoria (
  id                        text PRIMARY KEY,
  ator                      text NOT NULL,
  operacao                  text NOT NULL,
  recurso                   text,
  resultado                 text NOT NULL,
  instante                  timestamptz NOT NULL DEFAULT now(),
  identificador_correlacao  text,
  detalhes                  jsonb
);
CREATE INDEX IF NOT EXISTS ix_auditoria_instante ON registro_auditoria (instante);
CREATE INDEX IF NOT EXISTS ix_auditoria_operacao ON registro_auditoria (operacao, instante);

CREATE TABLE IF NOT EXISTS erro_operacional (
  id                  text PRIMARY KEY,
  origem              text NOT NULL,
  codigo              text,
  workflow            text,
  no                  text,
  mensagem_mascarada  text,
  correlacao          text,
  instante            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_erro_instante ON erro_operacional (instante);

INSERT INTO schema_migracao (versao) VALUES ('001_schema') ON CONFLICT DO NOTHING;
