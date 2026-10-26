// Repositório em memória — usado em testes automatizados e no modo de desenvolvimento.
// Reproduz as restrições de unicidade e os contratos do repositório PostgreSQL (repo/postgres.js).
// NÃO usar em produção: dados se perdem ao reiniciar.

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function createMemoryRepo() {
  const t = {
    hotel: new Map(),
    acomodacao: new Map(),
    politica: new Map(),
    faq: new Map(),
    conversa: new Map(),
    evento: new Map(),
    mensagem: new Map(),
    turno: new Map(),
    cotacao: new Map(),
    acao: new Map(),
    reserva: new Map(),
    verificacao: new Map(),
    contador: new Map(),
    atendimento: new Map(),
    preferencia: new Map(),
    privacidade: new Map(),
    modelo: new Map(),
    auditoria: [],
    erro: [],
  };
  let failNext = null; // injeção de falhas para testes de resiliência

  const guard = () => {
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
  };
  const patchRow = (map, id, patch) => {
    guard();
    const row = map.get(id);
    if (!row) return null;
    Object.assign(row, clone(patch));
    return clone(row);
  };
  const uniqueViolation = (constraint) => Object.assign(new Error(`unique violation ${constraint}`), { code: '23505', constraint });

  return {
    kind: 'memory',
    _tables: t,
    _failNext(err) {
      failNext = err;
    },
    async ping() {
      guard();
      return true;
    },

    // ---------------- Base de conhecimento ----------------
    async upsertHotel(h) {
      t.hotel.set(h.id, clone(h));
    },
    async upsertAccommodation(a) {
      t.acomodacao.set(a.id, clone(a));
    },
    async upsertPolicy(p) {
      t.politica.set(p.id, clone(p));
    },
    async upsertFaq(f) {
      t.faq.set(f.id, clone(f));
    },
    async listHotels({ cidade } = {}) {
      guard();
      return [...t.hotel.values()]
        .filter((h) => h.estado_publicacao === 'publicado' && h.status === 'ativo')
        .filter((h) => !cidade || normalize(h.cidade) === normalize(cidade))
        .map(clone);
    },
    async getHotel(id) {
      guard();
      const h = t.hotel.get(id);
      return h && h.estado_publicacao === 'publicado' ? clone(h) : null;
    },
    async listAccommodations(hotelId) {
      guard();
      return [...t.acomodacao.values()].filter((a) => a.hotel_id === hotelId && a.status === 'ativo').map(clone);
    },
    async listPolicies({ hotelId, categoria, data }) {
      guard();
      return [...t.politica.values()]
        .filter((p) => p.estado_publicacao === 'publicado')
        .filter((p) => p.hotel_id === null || p.hotel_id === hotelId)
        .filter((p) => !categoria || p.categoria === categoria)
        .filter((p) => p.vigencia_inicio <= data && (!p.vigencia_fim || p.vigencia_fim >= data))
        .map(clone);
    },
    async searchFaq({ hotelId, termos, data }) {
      guard();
      const ts = termos.map(normalize);
      return [...t.faq.values()]
        .filter((f) => f.estado_publicacao === 'publicado')
        .filter((f) => f.hotel_id === null || f.hotel_id === hotelId)
        .filter((f) => (!f.vigencia_inicio || f.vigencia_inicio <= data) && (!f.vigencia_fim || f.vigencia_fim >= data))
        .filter((f) => f.palavras_chave.some((k) => ts.includes(normalize(k))))
        .map(clone);
    },

    // ---------------- Conversas ----------------
    async getOrCreateConversation(c) {
      guard();
      const existing = [...t.conversa.values()].find((x) => x.titular_hash === c.titular_hash && x.canal === c.canal && !x.anonimizada_em);
      if (existing) return { conversa: clone(existing), criada: false };
      t.conversa.set(c.id, clone(c));
      return { conversa: clone(c), criada: true };
    },
    async getConversation(id) {
      guard();
      return clone(t.conversa.get(id)) || null;
    },
    async findConversationsByTitular(titularHash) {
      return [...t.conversa.values()].filter((c) => c.titular_hash === titularHash).map(clone);
    },
    async updateConversation(id, patch) {
      return patchRow(t.conversa, id, patch);
    },
    async tryLockConversation(id, owner, untilIso, nowIso) {
      guard();
      const c = t.conversa.get(id);
      if (!c) return false;
      if (c.lock_dono && c.lock_dono !== owner && c.lock_ate && c.lock_ate > nowIso) return false;
      c.lock_dono = owner;
      c.lock_ate = untilIso;
      return true;
    },
    async releaseConversationLock(id, owner) {
      const c = t.conversa.get(id);
      if (c && c.lock_dono === owner) {
        c.lock_dono = null;
        c.lock_ate = null;
      }
    },
    async anonymizeConversation(id, nowIso) {
      const c = t.conversa.get(id);
      if (!c) return false;
      Object.assign(c, { titular_hash: `anon_${id}`, wa_id_cifrado: null, contexto: {}, anonimizada_em: nowIso, estado: 'encerrada', atualizada_em: nowIso });
      for (const m of t.mensagem.values()) if (m.conversa_id === id) Object.assign(m, { conteudo_cifrado: null, conteudo_expira_em: null });
      for (const e of t.evento.values()) if (e.conversa_id === id) e.payload_cifrado = null;
      for (const a of t.acao.values()) if (a.conversa_id === id) a.payload_cifrado = null;
      return true;
    },
    async listInactiveConversations(beforeIso) {
      const openHandoff = new Set([...t.atendimento.values()].filter((h) => h.estado !== 'encerrada').map((h) => h.conversa_id));
      return [...t.conversa.values()]
        .filter((c) => !c.anonimizada_em && !c.bloqueio_legal && c.atualizada_em < beforeIso && !openHandoff.has(c.id))
        .map((c) => c.id);
    },

    // ---------------- Eventos de entrada (idempotência) ----------------
    async insertInboundEvent(e) {
      guard();
      if (t.evento.has(e.id)) return false;
      t.evento.set(e.id, clone(e));
      return true;
    },
    async getEvents(ids) {
      return ids.map((id) => clone(t.evento.get(id))).filter(Boolean);
    },
    async listPendingEvents(conversaId) {
      return [...t.evento.values()]
        .filter((e) => e.conversa_id === conversaId && e.estado === 'pendente' && e.tipo === 'mensagem')
        .sort((a, b) => a.recebido_em.localeCompare(b.recebido_em))
        .map(clone);
    },
    async updateEvents(ids, patch) {
      for (const id of ids) patchRow(t.evento, id, patch);
    },
    async listStaleEvents(beforeIso) {
      return [...t.evento.values()]
        .filter((e) => (e.estado === 'pendente' || e.estado === 'processando') && e.atualizado_em < beforeIso && e.tipo === 'mensagem')
        .map(clone);
    },
    async deleteEventsBefore(beforeIso) {
      let n = 0;
      for (const [id, e] of t.evento) {
        if (e.recebido_em < beforeIso && (e.estado === 'processado' || e.estado === 'descartado' || e.estado === 'falhou')) {
          t.evento.delete(id);
          n++;
        }
      }
      return n;
    },

    // ---------------- Mensagens ----------------
    async insertMessage(m) {
      guard();
      if (m.chave_deduplicacao && [...t.mensagem.values()].some((x) => x.chave_deduplicacao === m.chave_deduplicacao)) {
        throw uniqueViolation('mensagem_chave_deduplicacao_key');
      }
      if (m.identificador_externo && [...t.mensagem.values()].some((x) => x.identificador_externo === m.identificador_externo)) {
        throw uniqueViolation('mensagem_identificador_externo_key');
      }
      t.mensagem.set(m.id, clone(m));
      return clone(m);
    },
    async getMessageByDedupe(key) {
      return clone([...t.mensagem.values()].find((x) => x.chave_deduplicacao === key)) || null;
    },
    async getMessageByExternalId(wamid) {
      return clone([...t.mensagem.values()].find((x) => x.identificador_externo === wamid)) || null;
    },
    async updateMessage(id, patch) {
      return patchRow(t.mensagem, id, patch);
    },
    async updateMessageByExternalId(wamid, patch) {
      const m = [...t.mensagem.values()].find((x) => x.identificador_externo === wamid);
      if (!m) return null;
      Object.assign(m, clone(patch));
      return clone(m);
    },
    async listRecentMessages(conversaId, limit) {
      // Empate de horário: a inserida por último vem primeiro (equivale a ORDER BY criado_em DESC, ordem DESC).
      return [...t.mensagem.values()]
        .reverse()
        .filter((m) => m.conversa_id === conversaId)
        .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
        .slice(0, limit)
        .map(clone);
    },
    async countOutboundSince(conversaId, sinceIso) {
      return [...t.mensagem.values()].filter((m) => m.conversa_id === conversaId && m.direcao === 'saida' && m.criado_em >= sinceIso && m.estado !== 'bloqueada').length;
    },
    async purgeMessageContent(nowIso) {
      let n = 0;
      for (const m of t.mensagem.values()) {
        if (m.conteudo_cifrado && m.conteudo_expira_em && m.conteudo_expira_em <= nowIso) {
          m.conteudo_cifrado = null;
          n++;
        }
      }
      return n;
    },
    async deleteMessagesBefore(beforeIso) {
      let n = 0;
      for (const [id, m] of t.mensagem) {
        const conv = t.conversa.get(m.conversa_id);
        if (m.criado_em < beforeIso && !conv?.bloqueio_legal) {
          t.mensagem.delete(id);
          n++;
        }
      }
      return n;
    },

    // ---------------- Turnos ----------------
    async insertTurn(turn) {
      t.turno.set(turn.id, clone(turn));
      return clone(turn);
    },
    async getTurn(id) {
      return clone(t.turno.get(id)) || null;
    },
    async updateTurn(id, patch) {
      return patchRow(t.turno, id, patch);
    },

    // ---------------- Cotações ----------------
    async insertQuote(q) {
      guard();
      t.cotacao.set(q.id, clone(q));
      return clone(q);
    },
    async getQuote(id) {
      return clone(t.cotacao.get(id)) || null;
    },
    async updateQuote(id, patch) {
      return patchRow(t.cotacao, id, patch);
    },
    async listQuotesByConversation(conversaId, sinceIso) {
      return [...t.cotacao.values()].filter((q) => q.conversa_id === conversaId && q.criado_em >= sinceIso).map(clone);
    },
    async deleteQuotesBefore(beforeIso) {
      const referenced = new Set([...t.reserva.values()].map((r) => r.cotacao_id).concat([...t.acao.values()].map((a) => a.cotacao_id)));
      let n = 0;
      for (const [id, q] of t.cotacao) {
        if (q.criado_em < beforeIso && !referenced.has(id)) {
          t.cotacao.delete(id);
          n++;
        }
      }
      return n;
    },

    // ---------------- Ações pendentes ----------------
    async insertAction(a) {
      t.acao.set(a.id, clone(a));
      return clone(a);
    },
    async getAction(id) {
      return clone(t.acao.get(id)) || null;
    },
    async updateAction(id, patch) {
      return patchRow(t.acao, id, patch);
    },
    // Transição atômica de estado (compare-and-set) — evita dupla execução concorrente.
    async transitionAction(id, fromStates, patch) {
      guard();
      const a = t.acao.get(id);
      if (!a || !fromStates.includes(a.estado)) return null;
      Object.assign(a, clone(patch));
      return clone(a);
    },
    async listActions(conversaId, estados) {
      return [...t.acao.values()].filter((a) => a.conversa_id === conversaId && estados.includes(a.estado)).map(clone);
    },
    async listActionsByState(estados, beforeIso) {
      return [...t.acao.values()].filter((a) => estados.includes(a.estado) && a.atualizado_em < beforeIso).map(clone);
    },
    async expireActions(nowIso) {
      let n = 0;
      for (const a of t.acao.values()) {
        if (['coletando_dados', 'aguardando_cliente'].includes(a.estado) && a.expira_em && a.expira_em <= nowIso) {
          Object.assign(a, { estado: 'expirada', payload_cifrado: null, atualizado_em: nowIso });
          n++;
        }
      }
      return n;
    },
    async purgeActionPayloads(beforeIso) {
      let n = 0;
      for (const a of t.acao.values()) {
        if (a.payload_cifrado && (['concluida', 'expirada', 'cancelada', 'falhou'].includes(a.estado) || a.atualizado_em < beforeIso)) {
          a.payload_cifrado = null;
          n++;
        }
      }
      return n;
    },

    // ---------------- Reservas ----------------
    async insertReservation(r) {
      guard();
      const existing = [...t.reserva.values()].find((x) => x.chave_idempotencia === r.chave_idempotencia);
      if (existing) return { reserva: clone(existing), criada: false };
      t.reserva.set(r.id, clone(r));
      return { reserva: clone(r), criada: true };
    },
    async getReservation(id) {
      return clone(t.reserva.get(id)) || null;
    },
    async updateReservation(id, patch) {
      return patchRow(t.reserva, id, patch);
    },
    async listReservationsByState(estados, beforeIso) {
      return [...t.reserva.values()].filter((r) => estados.includes(r.estado) && r.atualizado_em < beforeIso).map(clone);
    },

    // ---------------- Verificação de titularidade ----------------
    async insertVerification(v) {
      t.verificacao.set(v.id, clone(v));
      return clone(v);
    },
    async findValidVerification(conversaId, reservaHash, nivelMin, nowIso) {
      return (
        clone(
          [...t.verificacao.values()].find(
            (v) => v.conversa_id === conversaId && v.reserva_externa_hash === reservaHash && v.estado === 'valida' && v.nivel >= nivelMin && v.expira_em > nowIso,
          ),
        ) || null
      );
    },
    async getVerificationByTokenHash(h) {
      return clone([...t.verificacao.values()].find((v) => v.token_hash === h)) || null;
    },
    async updateVerification(id, patch) {
      return patchRow(t.verificacao, id, patch);
    },

    // ---------------- Contadores (limites de taxa / tentativas) ----------------
    async incrementCounter(chave, janelaInicioIso, expiraIso) {
      guard();
      const k = `${chave}|${janelaInicioIso}`;
      const row = t.contador.get(k) || { chave, janela_inicio: janelaInicioIso, contagem: 0, expira_em: expiraIso };
      row.contagem += 1;
      t.contador.set(k, row);
      return row.contagem;
    },
    async getCounter(chave, janelaInicioIso) {
      return t.contador.get(`${chave}|${janelaInicioIso}`)?.contagem || 0;
    },
    async deleteExpiredCounters(nowIso) {
      let n = 0;
      for (const [k, r] of t.contador) {
        if (r.expira_em <= nowIso) {
          t.contador.delete(k);
          n++;
        }
      }
      return n;
    },

    // ---------------- Atendimento humano ----------------
    async insertHandoff(h) {
      guard();
      const open = [...t.atendimento.values()].find((x) => x.conversa_id === h.conversa_id && x.estado !== 'encerrada');
      if (open) return { solicitacao: clone(open), criada: false };
      t.atendimento.set(h.id, clone(h));
      return { solicitacao: clone(h), criada: true };
    },
    async getHandoff(id) {
      return clone(t.atendimento.get(id)) || null;
    },
    async getOpenHandoffByConversation(conversaId) {
      return clone([...t.atendimento.values()].find((x) => x.conversa_id === conversaId && x.estado !== 'encerrada')) || null;
    },
    async updateHandoff(id, patch) {
      return patchRow(t.atendimento, id, patch);
    },
    async listHandoffs({ estado, fila } = {}) {
      return [...t.atendimento.values()].filter((h) => (!estado || h.estado === estado) && (!fila || h.fila === fila)).map(clone);
    },

    // ---------------- Preferências de comunicação ----------------
    async getPreference(titularHash, finalidade) {
      return clone([...t.preferencia.values()].find((p) => p.titular_hash === titularHash && p.finalidade === finalidade)) || null;
    },
    async upsertPreference(p) {
      const existing = [...t.preferencia.values()].find((x) => x.titular_hash === p.titular_hash && x.finalidade === p.finalidade);
      if (existing) {
        Object.assign(existing, { estado: p.estado, origem: p.origem, evidencia: p.evidencia, atualizado_em: p.atualizado_em });
        return clone(existing);
      }
      t.preferencia.set(p.id, clone(p));
      return clone(p);
    },
    async listPreferencesByTitular(titularHash) {
      return [...t.preferencia.values()].filter((p) => p.titular_hash === titularHash).map(clone);
    },

    // ---------------- Privacidade ----------------
    async insertPrivacyRequest(r) {
      t.privacidade.set(r.id, clone(r));
      return clone(r);
    },
    async getPrivacyRequest(id) {
      return clone(t.privacidade.get(id)) || null;
    },
    async updatePrivacyRequest(id, patch) {
      return patchRow(t.privacidade, id, patch);
    },
    async listPrivacyRequests({ estado } = {}) {
      return [...t.privacidade.values()].filter((r) => !estado || r.estado === estado).map(clone);
    },

    // ---------------- Modelos de mensagem ----------------
    async getTemplate(nome, idioma) {
      return clone([...t.modelo.values()].find((m) => m.nome === nome && m.idioma === idioma)) || null;
    },
    async upsertTemplate(m) {
      const existing = [...t.modelo.values()].find((x) => x.nome === m.nome && x.idioma === m.idioma);
      if (existing) Object.assign(existing, clone(m), { id: existing.id });
      else t.modelo.set(m.id, clone(m));
    },

    // ---------------- Auditoria e erros ----------------
    async insertAudit(rec) {
      guard();
      t.auditoria.push(clone(rec));
    },
    async listAudit({ operacao } = {}) {
      return t.auditoria.filter((a) => !operacao || a.operacao === operacao).map(clone);
    },
    async insertOpError(e) {
      t.erro.push(clone(e));
    },
    async countOpErrorsSince(sinceIso) {
      return t.erro.filter((e) => e.instante >= sinceIso).length;
    },
  };
}

export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
