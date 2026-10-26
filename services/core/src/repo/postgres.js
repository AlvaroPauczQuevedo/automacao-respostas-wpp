// Repositório PostgreSQL — mesmo contrato de repo/memory.js.
// Consultas parametrizadas (sem concatenação de valores). Nomes de colunas vêm apenas do código.
import pg from 'pg';

const { Pool, types } = pg;
// Datas civis como 'YYYY-MM-DD'; timestamps como ISO 8601 UTC; numeric como string decimal.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());
types.setTypeParser(1700, (v) => v);
types.setTypeParser(20, (v) => Number(v));

const JSONB = {
  hotel: ['comodidades'],
  acomodacao: ['comodidades'],
  conversa: ['contexto'],
  turno: ['intencoes', 'saida'],
  acao_pendente: ['resumo_confirmado'],
  registro_auditoria: ['detalhes'],
};
const IDENT = /^[a-z_]+$/;

export async function createPostgresRepo({ connectionString, pool: givenPool, logger, max = 10 }) {
  const pool = givenPool || new Pool({ connectionString, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on?.('error', (err) => logger?.error('erro_pool_postgres', { codigo: err.code }));

  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0] || null;
  const count = async (sql, params) => (await pool.query(sql, params)).rowCount;

  const prep = (table, obj) => {
    const cols = Object.keys(obj).filter((k) => obj[k] !== undefined);
    for (const c of cols) if (!IDENT.test(c)) throw new Error(`coluna inválida ${c}`);
    const vals = cols.map((c) => ((JSONB[table] || []).includes(c) && obj[c] !== null ? JSON.stringify(obj[c]) : obj[c]));
    return { cols, vals };
  };
  const insert = async (table, obj, suffix = '') => {
    const { cols, vals } = prep(table, obj);
    return one(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ${suffix} RETURNING *`, vals);
  };
  const upsert = async (table, obj, conflict) => {
    const { cols, vals } = prep(table, obj);
    const set = cols.filter((c) => !conflict.split(',').includes(c) && c !== 'id').map((c) => `${c}=EXCLUDED.${c}`);
    return one(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT (${conflict}) DO UPDATE SET ${set.join(',')} RETURNING *`, vals);
  };
  const update = async (table, id, patch, where = '') => {
    const { cols, vals } = prep(table, patch);
    if (!cols.length) return one(`SELECT * FROM ${table} WHERE id=$1`, [id]);
    return one(`UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1 ${where} RETURNING *`, [id, ...vals]);
  };
  const strip = (r) => {
    if (!r) return r;
    delete r.ordem;
    return r;
  };

  return {
    kind: 'postgres',
    pool,
    async close() {
      if (!givenPool) await pool.end();
    },
    async ping() {
      await q('SELECT 1');
      return true;
    },

    // ---------------- Base de conhecimento ----------------
    upsertHotel: (h) => upsert('hotel', h, 'id'),
    upsertAccommodation: (a) => upsert('acomodacao', a, 'id'),
    upsertPolicy: (p) => upsert('politica', p, 'id'),
    upsertFaq: (f) => upsert('faq', f, 'id'),
    listHotels: ({ cidade } = {}) =>
      q(
        `SELECT * FROM hotel WHERE estado_publicacao='publicado' AND status='ativo'
         AND ($1::text IS NULL OR lower(unaccent_simple(cidade)) = lower(unaccent_simple($1))) ORDER BY nome`,
        [cidade ?? null],
      ),
    getHotel: (id) => one(`SELECT * FROM hotel WHERE id=$1 AND estado_publicacao='publicado'`, [id]),
    listAccommodations: (hotelId) => q(`SELECT * FROM acomodacao WHERE hotel_id=$1 AND status='ativo' ORDER BY tipo`, [hotelId]),
    listPolicies: ({ hotelId, categoria, data }) =>
      q(
        `SELECT * FROM politica WHERE estado_publicacao='publicado' AND (hotel_id IS NULL OR hotel_id=$1)
         AND ($2::text IS NULL OR categoria=$2) AND vigencia_inicio <= $3::date AND (vigencia_fim IS NULL OR vigencia_fim >= $3::date)`,
        [hotelId ?? null, categoria ?? null, data],
      ),
    searchFaq: ({ hotelId, termos, data }) =>
      q(
        `SELECT * FROM faq WHERE estado_publicacao='publicado' AND (hotel_id IS NULL OR hotel_id=$1)
         AND (vigencia_inicio IS NULL OR vigencia_inicio <= $3::date) AND (vigencia_fim IS NULL OR vigencia_fim >= $3::date)
         AND EXISTS (SELECT 1 FROM unnest(palavras_chave) k WHERE lower(unaccent_simple(k)) = ANY($2::text[]))`,
        [hotelId ?? null, termos, data],
      ),

    // ---------------- Conversas ----------------
    async getOrCreateConversation(c) {
      const ins = await insert('conversa', c, `ON CONFLICT (titular_hash, canal) WHERE anonimizada_em IS NULL DO NOTHING`);
      if (ins) return { conversa: ins, criada: true };
      return { conversa: await one(`SELECT * FROM conversa WHERE titular_hash=$1 AND canal=$2 AND anonimizada_em IS NULL`, [c.titular_hash, c.canal]), criada: false };
    },
    getConversation: (id) => one(`SELECT * FROM conversa WHERE id=$1`, [id]),
    findConversationsByTitular: (h) => q(`SELECT * FROM conversa WHERE titular_hash=$1`, [h]),
    updateConversation: (id, patch) => update('conversa', id, patch),
    // Trava com lease: atômica (UPDATE condicional).
    async tryLockConversation(id, owner, untilIso, nowIso) {
      return (
        (await count(`UPDATE conversa SET lock_dono=$2, lock_ate=$3 WHERE id=$1 AND (lock_dono IS NULL OR lock_dono=$2 OR lock_ate IS NULL OR lock_ate <= $4)`, [id, owner, untilIso, nowIso])) === 1
      );
    },
    async releaseConversationLock(id, owner) {
      await q(`UPDATE conversa SET lock_dono=NULL, lock_ate=NULL WHERE id=$1 AND lock_dono=$2`, [id, owner]);
    },
    async anonymizeConversation(id, nowIso) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `UPDATE conversa SET titular_hash='anon_'||id, wa_id_cifrado=NULL, contexto='{}'::jsonb, anonimizada_em=$2, estado='encerrada', atualizada_em=$2 WHERE id=$1`,
          [id, nowIso],
        );
        await client.query(`UPDATE mensagem SET conteudo_cifrado=NULL, conteudo_expira_em=NULL WHERE conversa_id=$1`, [id]);
        await client.query(`UPDATE evento_entrada SET payload_cifrado=NULL WHERE conversa_id=$1`, [id]);
        await client.query(`UPDATE acao_pendente SET payload_cifrado=NULL WHERE conversa_id=$1`, [id]);
        await client.query('COMMIT');
        return r.rowCount === 1;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async listInactiveConversations(beforeIso) {
      return (
        await q(
          `SELECT c.id FROM conversa c WHERE c.anonimizada_em IS NULL AND c.bloqueio_legal = false AND c.atualizada_em < $1
           AND NOT EXISTS (SELECT 1 FROM solicitacao_atendimento s WHERE s.conversa_id=c.id AND s.estado <> 'encerrada')`,
          [beforeIso],
        )
      ).map((r) => r.id);
    },

    // ---------------- Eventos de entrada ----------------
    async insertInboundEvent(e) {
      return Boolean(await insert('evento_entrada', e, 'ON CONFLICT (id) DO NOTHING'));
    },
    getEvents: (ids) => q(`SELECT * FROM evento_entrada WHERE id = ANY($1::text[])`, [ids]),
    listPendingEvents: (conversaId) => q(`SELECT * FROM evento_entrada WHERE conversa_id=$1 AND estado='pendente' AND tipo='mensagem' ORDER BY recebido_em, id`, [conversaId]),
    async updateEvents(ids, patch) {
      if (!ids.length) return;
      const { cols, vals } = prep('evento_entrada', patch);
      await q(`UPDATE evento_entrada SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id = ANY($1::text[])`, [ids, ...vals]);
    },
    listStaleEvents: (beforeIso) => q(`SELECT * FROM evento_entrada WHERE estado IN ('pendente','processando') AND tipo='mensagem' AND atualizado_em < $1`, [beforeIso]),
    deleteEventsBefore: (beforeIso) => count(`DELETE FROM evento_entrada WHERE recebido_em < $1 AND estado IN ('processado','descartado','falhou')`, [beforeIso]),

    // ---------------- Mensagens ----------------
    insertMessage: async (m) => strip(await insert('mensagem', m)),
    getMessageByDedupe: async (k) => strip(await one(`SELECT * FROM mensagem WHERE chave_deduplicacao=$1`, [k])),
    getMessageByExternalId: async (w) => strip(await one(`SELECT * FROM mensagem WHERE identificador_externo=$1`, [w])),
    updateMessage: async (id, patch) => strip(await update('mensagem', id, patch)),
    async updateMessageByExternalId(wamid, patch) {
      const m = await one(`SELECT id FROM mensagem WHERE identificador_externo=$1`, [wamid]);
      return m ? strip(await update('mensagem', m.id, patch)) : null;
    },
    listRecentMessages: async (conversaId, limit) => (await q(`SELECT * FROM mensagem WHERE conversa_id=$1 ORDER BY criado_em DESC, ordem DESC LIMIT $2`, [conversaId, limit])).map(strip),
    countOutboundSince: async (conversaId, sinceIso) => Number((await one(`SELECT count(*)::int AS n FROM mensagem WHERE conversa_id=$1 AND direcao='saida' AND criado_em >= $2 AND estado <> 'bloqueada'`, [conversaId, sinceIso])).n),
    purgeMessageContent: (nowIso) => count(`UPDATE mensagem SET conteudo_cifrado=NULL WHERE conteudo_cifrado IS NOT NULL AND conteudo_expira_em <= $1`, [nowIso]),
    deleteMessagesBefore: (beforeIso) => count(`DELETE FROM mensagem m USING conversa c WHERE m.conversa_id=c.id AND m.criado_em < $1 AND c.bloqueio_legal=false`, [beforeIso]),

    // ---------------- Turnos ----------------
    insertTurn: (t) => insert('turno', t),
    getTurn: (id) => one(`SELECT * FROM turno WHERE id=$1`, [id]),
    updateTurn: (id, patch) => update('turno', id, patch),

    // ---------------- Cotações ----------------
    insertQuote: (x) => insert('cotacao', x),
    getQuote: (id) => one(`SELECT * FROM cotacao WHERE id=$1`, [id]),
    updateQuote: (id, patch) => update('cotacao', id, patch),
    listQuotesByConversation: (conversaId, sinceIso) => q(`SELECT * FROM cotacao WHERE conversa_id=$1 AND criado_em >= $2`, [conversaId, sinceIso]),
    deleteQuotesBefore: (beforeIso) =>
      count(
        `DELETE FROM cotacao c WHERE c.criado_em < $1
         AND NOT EXISTS (SELECT 1 FROM reserva r WHERE r.cotacao_id=c.id) AND NOT EXISTS (SELECT 1 FROM acao_pendente a WHERE a.cotacao_id=c.id)`,
        [beforeIso],
      ),

    // ---------------- Ações pendentes ----------------
    insertAction: (a) => insert('acao_pendente', a),
    getAction: (id) => one(`SELECT * FROM acao_pendente WHERE id=$1`, [id]),
    updateAction: (id, patch) => update('acao_pendente', id, patch),
    transitionAction: (id, fromStates, patch) => {
      const { cols, vals } = prep('acao_pendente', patch);
      return one(`UPDATE acao_pendente SET ${cols.map((c, i) => `${c}=$${i + 3}`).join(',')} WHERE id=$1 AND estado = ANY($2::text[]) RETURNING *`, [id, fromStates, ...vals]);
    },
    listActions: (conversaId, estados) => q(`SELECT * FROM acao_pendente WHERE conversa_id=$1 AND estado = ANY($2::text[]) ORDER BY criado_em`, [conversaId, estados]),
    listActionsByState: (estados, beforeIso) => q(`SELECT * FROM acao_pendente WHERE estado = ANY($1::text[]) AND atualizado_em < $2`, [estados, beforeIso]),
    expireActions: (nowIso) =>
      count(`UPDATE acao_pendente SET estado='expirada', payload_cifrado=NULL, atualizado_em=$1 WHERE estado IN ('coletando_dados','aguardando_cliente') AND expira_em IS NOT NULL AND expira_em <= $1`, [nowIso]),
    purgeActionPayloads: (beforeIso) =>
      count(`UPDATE acao_pendente SET payload_cifrado=NULL WHERE payload_cifrado IS NOT NULL AND (estado IN ('concluida','expirada','cancelada','falhou') OR atualizado_em < $1)`, [beforeIso]),

    // ---------------- Reservas ----------------
    async insertReservation(r) {
      const ins = await insert('reserva', r, 'ON CONFLICT (chave_idempotencia) DO NOTHING');
      if (ins) return { reserva: ins, criada: true };
      return { reserva: await one(`SELECT * FROM reserva WHERE chave_idempotencia=$1`, [r.chave_idempotencia]), criada: false };
    },
    getReservation: (id) => one(`SELECT * FROM reserva WHERE id=$1`, [id]),
    updateReservation: (id, patch) => update('reserva', id, patch),
    listReservationsByState: (estados, beforeIso) => q(`SELECT * FROM reserva WHERE estado = ANY($1::text[]) AND atualizado_em < $2`, [estados, beforeIso]),

    // ---------------- Verificação ----------------
    insertVerification: (v) => insert('verificacao_titular', v),
    findValidVerification: (conversaId, h, nivelMin, nowIso) =>
      one(`SELECT * FROM verificacao_titular WHERE conversa_id=$1 AND reserva_externa_hash=$2 AND estado='valida' AND nivel >= $3 AND expira_em > $4 ORDER BY nivel DESC LIMIT 1`, [conversaId, h, nivelMin, nowIso]),
    getVerificationByTokenHash: (h) => one(`SELECT * FROM verificacao_titular WHERE token_hash=$1`, [h]),
    updateVerification: (id, patch) => update('verificacao_titular', id, patch),

    // ---------------- Contadores ----------------
    async incrementCounter(chave, janelaInicioIso, expiraIso) {
      const r = await one(
        `INSERT INTO contador_limite (chave, janela_inicio, contagem, expira_em) VALUES ($1,$2,1,$3)
         ON CONFLICT (chave, janela_inicio) DO UPDATE SET contagem = contador_limite.contagem + 1 RETURNING contagem`,
        [chave, janelaInicioIso, expiraIso],
      );
      return r.contagem;
    },
    getCounter: async (chave, janelaInicioIso) => (await one(`SELECT contagem FROM contador_limite WHERE chave=$1 AND janela_inicio=$2`, [chave, janelaInicioIso]))?.contagem || 0,
    deleteExpiredCounters: (nowIso) => count(`DELETE FROM contador_limite WHERE expira_em <= $1`, [nowIso]),

    // ---------------- Atendimento humano ----------------
    async insertHandoff(h) {
      const ins = await insert('solicitacao_atendimento', h, `ON CONFLICT (conversa_id) WHERE estado <> 'encerrada' DO NOTHING`);
      if (ins) return { solicitacao: ins, criada: true };
      return { solicitacao: await one(`SELECT * FROM solicitacao_atendimento WHERE conversa_id=$1 AND estado <> 'encerrada'`, [h.conversa_id]), criada: false };
    },
    getHandoff: (id) => one(`SELECT * FROM solicitacao_atendimento WHERE id=$1`, [id]),
    getOpenHandoffByConversation: (c) => one(`SELECT * FROM solicitacao_atendimento WHERE conversa_id=$1 AND estado <> 'encerrada'`, [c]),
    updateHandoff: (id, patch) => update('solicitacao_atendimento', id, patch),
    listHandoffs: ({ estado, fila } = {}) =>
      q(`SELECT * FROM solicitacao_atendimento WHERE ($1::text IS NULL OR estado=$1) AND ($2::text IS NULL OR fila=$2) ORDER BY prioridade DESC, criada_em`, [estado ?? null, fila ?? null]),

    // ---------------- Preferências ----------------
    getPreference: (h, f) => one(`SELECT * FROM preferencia_comunicacao WHERE titular_hash=$1 AND finalidade=$2`, [h, f]),
    upsertPreference: (p) =>
      one(
        `INSERT INTO preferencia_comunicacao (id,titular_hash,finalidade,estado,origem,evidencia,registrado_em,atualizado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (titular_hash, finalidade) DO UPDATE SET estado=EXCLUDED.estado, origem=EXCLUDED.origem, evidencia=EXCLUDED.evidencia, atualizado_em=EXCLUDED.atualizado_em RETURNING *`,
        [p.id, p.titular_hash, p.finalidade, p.estado, p.origem, p.evidencia, p.registrado_em, p.atualizado_em],
      ),
    listPreferencesByTitular: (h) => q(`SELECT * FROM preferencia_comunicacao WHERE titular_hash=$1`, [h]),

    // ---------------- Privacidade ----------------
    insertPrivacyRequest: (r) => insert('solicitacao_privacidade', r),
    getPrivacyRequest: (id) => one(`SELECT * FROM solicitacao_privacidade WHERE id=$1`, [id]),
    updatePrivacyRequest: (id, patch) => update('solicitacao_privacidade', id, patch),
    listPrivacyRequests: ({ estado } = {}) => q(`SELECT * FROM solicitacao_privacidade WHERE ($1::text IS NULL OR estado=$1) ORDER BY criada_em`, [estado ?? null]),

    // ---------------- Modelos ----------------
    getTemplate: (nome, idioma) => one(`SELECT * FROM modelo_mensagem WHERE nome=$1 AND idioma=$2`, [nome, idioma]),
    upsertTemplate: (m) => upsert('modelo_mensagem', m, 'nome,idioma'),

    // ---------------- Auditoria e erros ----------------
    async insertAudit(rec) {
      await insert('registro_auditoria', rec);
    },
    listAudit: ({ operacao } = {}) => q(`SELECT * FROM registro_auditoria WHERE ($1::text IS NULL OR operacao=$1) ORDER BY instante`, [operacao ?? null]),
    async insertOpError(e) {
      await insert('erro_operacional', e);
    },
    countOpErrorsSince: async (sinceIso) => Number((await one(`SELECT count(*)::int AS n FROM erro_operacional WHERE instante >= $1`, [sinceIso])).n),
  };
}
