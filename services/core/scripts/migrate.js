// Aplica as migrações de db/migrations em ordem. Uso: DATABASE_URL=... node scripts/migrate.js [--sem-papeis]
// A migração 002 (papéis) exige privilégio de administrador e pode ser pulada com --sem-papeis.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'migrations');

export async function migrate(connectionString, { skipRoles = false, log = console.log } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Mensagens contêm acentos e emojis: o banco DEVE usar UTF8.
    const enc = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
    if (enc.toUpperCase() !== 'UTF8') throw new Error(`Banco com codificação ${enc}; crie-o com ENCODING 'UTF8' (ver docs/20-manual-instalacao.md)`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migracao (versao text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT versao FROM schema_migracao')).rows.map((r) => r.versao));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      const versao = f.replace(/\.sql$/, '');
      if (done.has(versao)) continue;
      if (skipRoles && versao.includes('papeis')) {
        log(`pulando ${f}`);
        continue;
      }
      log(`aplicando ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(path.join(dir, f), 'utf8'));
        await client.query('INSERT INTO schema_migracao (versao) VALUES ($1) ON CONFLICT DO NOTHING', [versao]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definido');
    process.exit(1);
  }
  migrate(process.env.DATABASE_URL, { skipRoles: process.argv.includes('--sem-papeis') }).then(
    () => console.log('migrações concluídas'),
    (e) => {
      console.error('falha na migração:', e.message);
      process.exit(1);
    },
  );
}
