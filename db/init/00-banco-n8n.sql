-- Executado apenas na primeira inicialização do contêiner PostgreSQL (docker-entrypoint-initdb.d).
-- Banco separado para o n8n (isolamento de dados operacionais do agente e do orquestrador).
CREATE DATABASE n8n ENCODING 'UTF8' TEMPLATE template0;
