-- =====================================================================
-- Papéis de banco (menor privilégio). Executar como administrador do banco.
-- As senhas NÃO ficam aqui: defina-as fora do repositório, ex.:
--   ALTER ROLE app_core PASSWORD '<definido pelo cofre de segredos>';
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_core') THEN
    CREATE ROLE app_core LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_conteudo_editor') THEN
    CREATE ROLE app_conteudo_editor LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_leitura_metricas') THEN
    CREATE ROLE app_leitura_metricas LOGIN;
  END IF;
END $$;

-- Serviço core: DML nas tabelas operacionais; sem DDL; sem DELETE na auditoria.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  conversa, evento_entrada, mensagem, turno, cotacao, acao_pendente, reserva,
  verificacao_titular, contador_limite, solicitacao_atendimento, preferencia_comunicacao,
  solicitacao_privacidade, erro_operacional
TO app_core;
GRANT SELECT, INSERT ON registro_auditoria TO app_core;
GRANT SELECT ON hotel, acomodacao, politica, faq, modelo_mensagem, schema_migracao TO app_core;
-- A exclusão de auditoria vencida é feita por um papel de manutenção separado (job de retenção).

-- Editor de conteúdo (base de conhecimento) — usado pela ferramenta administrativa da rede.
GRANT SELECT, INSERT, UPDATE ON hotel, acomodacao, politica, faq, modelo_mensagem TO app_conteudo_editor;

-- Leitura de métricas agregadas sem acesso a dados de conversa.
GRANT SELECT ON reserva, solicitacao_atendimento, erro_operacional TO app_leitura_metricas;
REVOKE ALL ON conversa, mensagem, evento_entrada, acao_pendente FROM app_leitura_metricas;

INSERT INTO schema_migracao (versao) VALUES ('002_papeis_acesso') ON CONFLICT DO NOTHING;
