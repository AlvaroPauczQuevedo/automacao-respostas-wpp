import { newId, canonicalJson } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { isIsoDate, validateStay } from '../util/dates.js';
import { normalize } from '../repo/memory.js';
import { randomToken, sha256Hex } from '../security/crypto.js';
import { Catalog } from '../whatsapp/catalog.js';

/**
 * Gestão de reservas existentes com verificação de titularidade proporcional ao risco:
 *  Nível 1 (consulta de status/datas): código + sobrenome do titular + data de entrada, conferidos no PMS.
 *  Nível 2 (cancelar/alterar): nível 1 + confirmação por link enviado ao e-mail cadastrado na reserva
 *          (modo link_email) OU encaminhamento obrigatório a atendente (modo atendente — padrão).
 * O telefone da conversa, sozinho, nunca é prova suficiente. Conhecer o código, sozinho, também não.
 * Limite de tentativas por conversa e por titular para impedir enumeração de reservas.
 */
export function createReservationService({ repo, hotel, hasher, notifier, cfg, audit, metrics, logger, now = () => new Date() }) {
  const nowIso = () => now().toISOString();
  const L = cfg.limites;

  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const codeHash = (c) => hasher(`reserva:${normCode(c)}`);

  async function failures(keys) {
    const janela = new Date(Math.floor(now().getTime() / (L.verificacaoJanelaHoras * 3600000)) * L.verificacaoJanelaHoras * 3600000).toISOString();
    let max = 0;
    for (const k of keys) max = Math.max(max, await repo.getCounter(k, janela));
    return { max, janela };
  }
  async function registerFailure(keys, janela) {
    const exp = new Date(Date.parse(janela) + L.verificacaoJanelaHoras * 3600000).toISOString();
    for (const k of keys) await repo.incrementCounter(k, janela, exp);
  }

  async function requireVerification(conversaId, codigo, nivel) {
    const v = await repo.findValidVerification(conversaId, codeHash(codigo), nivel, nowIso());
    if (!v) throw Errors.forbidden(nivel === 1 ? 'Titularidade não verificada para esta reserva' : 'Verificação reforçada necessária');
    return v;
  }

  async function hotelByCode(codigoExterno) {
    const hs = await repo.listHotels({});
    return hs.find((h) => h.codigo_externo === codigoExterno) || null;
  }

  async function createAction(conversaId, tipo, codigo, resumo, botoes, texto) {
    const acao = await repo.insertAction({
      id: newId('acao'),
      conversa_id: conversaId,
      tipo,
      estado: 'aguardando_cliente',
      cotacao_id: null,
      reserva_externa_hash: codeHash(codigo),
      payload_cifrado: null,
      payload_hash: sha256Hex(canonicalJson(resumo)),
      resumo_confirmado: resumo,
      expira_em: new Date(now().getTime() + L.confirmacaoTtlMin * 60000).toISOString(),
      confirmada_por_evento: null,
      resultado_codigo: null,
      criado_em: nowIso(),
      atualizado_em: nowIso(),
    });
    await repo.updateConversation(conversaId, { estado: 'aguardando_confirmacao', atualizada_em: nowIso() });
    return {
      acao,
      mensagem: { tipo: 'botoes', texto, botoes: [{ id: `acao:${acao.id}:confirmar`, titulo: botoes }, { id: `acao:${acao.id}:cancelar`, titulo: 'Não confirmar' }] },
    };
  }

  // Exige verificação nível 2; conforme o modo configurado, envia link ou indica encaminhamento.
  async function ensureStrongVerification(conversaId, codigo, finalidade) {
    const v2 = await repo.findValidVerification(conversaId, codeHash(codigo), 2, nowIso());
    if (v2) return { ok: true };
    await requireVerification(conversaId, codigo, 1);
    if (cfg.negocio.verificacaoReforcadaModo !== 'link_email' || !cfg.publicBaseUrl) {
      return { ok: false, situacao: 'encaminhar', motivo: 'verificacao_reforcada_por_atendente' };
    }
    const b = await hotel.getBooking(normCode(codigo));
    if (!b?.contato_verificacao_email) return { ok: false, situacao: 'encaminhar', motivo: 'sem_contato_para_verificacao' };
    const token = randomToken(32);
    await repo.insertVerification({
      id: newId('ver'),
      conversa_id: conversaId,
      reserva_externa_hash: codeHash(codigo),
      nivel: 2,
      estado: 'aguardando_link',
      token_hash: sha256Hex(token),
      acao_id: null,
      expira_em: new Date(now().getTime() + L.verificacaoTtlMin * 60000).toISOString(),
      criado_em: nowIso(),
    });
    await notifier.sendVerificationLink({ to: b.contato_verificacao_email, link: `${cfg.publicBaseUrl.replace(/\/+$/, '')}/verificacao/${token}`, finalidade });
    await audit({ ator: 'sistema', operacao: 'reserva.verificacao_reforcada_enviada', recurso: conversaId, resultado: 'ok' });
    return { ok: false, situacao: 'verificacao_enviada', mensagem: { tipo: 'texto', texto: Catalog.verificacaoReforcadaEnviada() } };
  }

  return {
    codeHash,
    normCode,

    async verifyHolder({ conversaId, titularHash, codigo, sobrenome, dataEntrada }) {
      const keys = [`verif:conv:${conversaId}`, `verif:tit:${titularHash}`];
      const { max, janela } = await failures(keys);
      if (max >= L.verificacaoMaxFalhas) {
        metrics.inc('verificacoes_titular_total', { resultado: 'bloqueado' });
        await audit({ ator: 'agente', operacao: 'reserva.verificacao_bloqueada', recurso: conversaId, resultado: 'limite' });
        return { verificado: false, bloqueado: true, orientacao: 'Limite de tentativas atingido. Ofereça atendimento humano.' };
      }
      const code = normCode(codigo);
      const formatoOk = code.length >= 4 && code.length <= 32 && typeof sobrenome === 'string' && sobrenome.trim().length >= 2 && isIsoDate(dataEntrada);
      const b = formatoOk ? await hotel.getBooking(code) : null;
      const ok = Boolean(b) && normalize(b.titular_sobrenome) === normalize(sobrenome) && b.entrada === dataEntrada;
      if (!ok) {
        await registerFailure(keys, janela);
        metrics.inc('verificacoes_titular_total', { resultado: 'falhou' });
        await audit({ ator: 'agente', operacao: 'reserva.verificacao_titular', recurso: conversaId, resultado: 'falhou' });
        // Resposta genérica: não revela se o código existe.
        return { verificado: false, bloqueado: false, tentativas_restantes: Math.max(0, L.verificacaoMaxFalhas - max - 1) };
      }
      await repo.insertVerification({
        id: newId('ver'),
        conversa_id: conversaId,
        reserva_externa_hash: codeHash(code),
        nivel: 1,
        estado: 'valida',
        token_hash: null,
        acao_id: null,
        expira_em: new Date(now().getTime() + L.verificacaoTtlMin * 60000).toISOString(),
        criado_em: nowIso(),
      });
      metrics.inc('verificacoes_titular_total', { resultado: 'ok' });
      await audit({ ator: 'agente', operacao: 'reserva.verificacao_titular', recurso: conversaId, resultado: 'ok' });
      return { verificado: true, nivel: 1, valido_por_minutos: L.verificacaoTtlMin };
    },

    async consult({ conversaId, codigo }) {
      await requireVerification(conversaId, codigo, 1);
      const b = await hotel.getBooking(normCode(codigo));
      if (!b) throw Errors.notFound('Reserva');
      const h = await hotelByCode(b.hotel_codigo);
      await audit({ ator: 'agente', operacao: 'reserva.consulta', recurso: conversaId, resultado: 'ok' });
      // Sem dados de acompanhantes, documentos, pagamento ou contato.
      return {
        codigo_reserva: b.codigo_confirmacao,
        hotel: h ? h.nome : null,
        cidade: h ? h.cidade : null,
        entrada: b.entrada,
        saida: b.saida,
        situacao: b.status,
        acomodacao: b.acomodacao_nome,
        quantidade_hospedes: b.quantidade_hospedes,
        valor_total: b.valor_total,
        moeda: b.moeda,
        politica_cancelamento: b.politica_cancelamento,
        ...(hotel.simulated ? { aviso: 'RESERVA SIMULADA — ambiente de teste' } : {}),
      };
    },

    async requestCancellation({ conversaId, codigo }) {
      const strong = await ensureStrongVerification(conversaId, codigo, 'cancelamento');
      if (!strong.ok) return strong;
      const q = await hotel.quoteCancellation(normCode(codigo));
      if (!q.permitido) return { situacao: 'nao_permitido', motivo: q.motivo_recusa || 'Cancelamento não permitido pelo sistema do hotel' };
      const resumo = { codigo: normCode(codigo), multa_valor: q.multa_valor ?? null, moeda: q.moeda ?? null, descricao: q.descricao ?? null };
      const { acao, mensagem } = await createAction(conversaId, 'cancelar_reserva', codigo, resumo, 'Confirmar cancelamento', Catalog.resumoCancelamento({ codigo: resumo.codigo, cotacao: q, expiraMin: L.confirmacaoTtlMin }));
      return { situacao: 'aguardando_confirmacao_cliente', acao_id: acao.id, multa_valor: resumo.multa_valor, moeda: resumo.moeda, mensagem };
    },

    async executeCancel({ acaoId, conversaId, eventoId, correlacao }) {
      const acao = await repo.transitionAction(acaoId, ['aguardando_cliente'], { estado: 'executando', confirmada_por_evento: eventoId, atualizado_em: nowIso() });
      if (!acao || acao.conversa_id !== conversaId) return { situacao: 'ignorada' };
      const resumo = acao.resumo_confirmado;
      try {
        // Reavalia a multa: se mudou entre o resumo e a confirmação, exige nova confirmação.
        const q = await hotel.quoteCancellation(resumo.codigo);
        if (!q.permitido || (q.multa_valor ?? null) !== resumo.multa_valor) {
          await repo.updateAction(acao.id, { estado: 'cancelada', resultado_codigo: 'condicoes_alteradas', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          return { situacao: 'condicoes_alteradas', mensagem: { tipo: 'texto', texto: 'As condições de cancelamento mudaram desde o resumo. Nada foi cancelado. Posso preparar um novo resumo com as condições atualizadas?' } };
        }
        const r = await hotel.cancelBooking({ codigo: resumo.codigo, idempotencyKey: acao.id });
        if (r.status === 'cancelada') {
          await repo.updateAction(acao.id, { estado: 'concluida', resultado_codigo: 'cancelada', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          await audit({ ator: 'sistema', operacao: 'reserva.cancelada', recurso: acao.id, resultado: 'ok', correlacao });
          metrics.inc('reservas_total', { estado: 'cancelada' });
          return { situacao: 'cancelada', mensagem: { tipo: 'texto', texto: Catalog.cancelamentoConfirmado({ codigo: resumo.codigo, codigoCancelamento: r.codigo_cancelamento }) } };
        }
        if (r.status === 'recusada') {
          await repo.updateAction(acao.id, { estado: 'falhou', resultado_codigo: 'recusada', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          return { situacao: 'recusada', encaminhar: true, mensagem: { tipo: 'texto', texto: 'O sistema do hotel não aceitou o cancelamento. Nada foi alterado. Vou encaminhar para nossa equipe analisar.' } };
        }
        throw Object.assign(new Error('pendente'), { code: 'PENDENTE' });
      } catch (err) {
        await repo.updateAction(acao.id, { estado: 'pendente_reconciliacao', resultado_codigo: err.code || 'erro', atualizado_em: nowIso() });
        await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
        await audit({ ator: 'sistema', operacao: 'reserva.cancelamento_pendente', recurso: acao.id, resultado: err.code || 'erro', correlacao });
        metrics.inc('reservas_total', { estado: 'cancelamento_pendente' });
        logger.warn('cancelamento_pendente', { acao_id: acao.id, codigo: err.code });
        return { situacao: 'pendente', encaminhar: true, mensagem: { tipo: 'texto', texto: Catalog.cancelamentoPendente() } };
      }
    },

    async requestModification({ conversaId, codigo, novaEntrada, novaSaida }) {
      const stay = validateStay({ entrada: novaEntrada, saida: novaSaida }, { timeZone: 'America/Sao_Paulo', maxNoites: L.maxNoitesReserva, antecedenciaMaxDias: L.antecedenciaMaxDias, now: now() });
      if (!stay.ok) throw Errors.validation('Datas inválidas', { problemas: stay.problemas });
      const strong = await ensureStrongVerification(conversaId, codigo, 'alteracao');
      if (!strong.ok) return strong;
      if (!hotel.supports('cotacao_alteracao') || !hotel.supports('alteracao')) return { situacao: 'encaminhar', motivo: 'alteracao_nao_suportada_pela_integracao' };
      const q = await hotel.quoteModification({ codigo: normCode(codigo), novaEntrada, novaSaida });
      if (!q.permitido) return { situacao: 'nao_permitido', motivo: q.motivo_recusa || 'Alteração não permitida pelo sistema do hotel' };
      const resumo = { codigo: normCode(codigo), nova_entrada: novaEntrada, nova_saida: novaSaida, codigo_oferta: q.codigo_oferta, novo_valor_total: q.novo_valor_total ?? null, moeda: q.moeda ?? null };
      const { acao, mensagem } = await createAction(conversaId, 'alterar_reserva', codigo, resumo, 'Confirmar alteração', Catalog.resumoAlteracao({ codigo: resumo.codigo, novaEntrada, novaSaida, cotacao: q, expiraMin: L.confirmacaoTtlMin }));
      return { situacao: 'aguardando_confirmacao_cliente', acao_id: acao.id, novo_valor_total: resumo.novo_valor_total, diferenca: q.diferenca ?? null, moeda: resumo.moeda, mensagem };
    },

    async executeModify({ acaoId, conversaId, eventoId, correlacao }) {
      const acao = await repo.transitionAction(acaoId, ['aguardando_cliente'], { estado: 'executando', confirmada_por_evento: eventoId, atualizado_em: nowIso() });
      if (!acao || acao.conversa_id !== conversaId) return { situacao: 'ignorada' };
      const s = acao.resumo_confirmado;
      try {
        const q = await hotel.quoteModification({ codigo: s.codigo, novaEntrada: s.nova_entrada, novaSaida: s.nova_saida });
        if (!q.permitido || (q.novo_valor_total ?? null) !== s.novo_valor_total) {
          await repo.updateAction(acao.id, { estado: 'cancelada', resultado_codigo: 'condicoes_alteradas', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          return { situacao: 'condicoes_alteradas', mensagem: { tipo: 'texto', texto: 'As condições da alteração mudaram desde o resumo. Nada foi alterado. Posso preparar um novo resumo?' } };
        }
        const r = await hotel.modifyBooking({ codigo: s.codigo, codigoOferta: q.codigo_oferta, idempotencyKey: acao.id });
        if (r.status === 'alterada') {
          await repo.updateAction(acao.id, { estado: 'concluida', resultado_codigo: 'alterada', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          await audit({ ator: 'sistema', operacao: 'reserva.alterada', recurso: acao.id, resultado: 'ok', correlacao });
          return { situacao: 'alterada', mensagem: { tipo: 'texto', texto: Catalog.alteracaoConfirmada({ codigo: s.codigo, r }) } };
        }
        if (r.status === 'recusada') {
          await repo.updateAction(acao.id, { estado: 'falhou', resultado_codigo: 'recusada', atualizado_em: nowIso() });
          await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
          return { situacao: 'recusada', mensagem: { tipo: 'texto', texto: 'O sistema do hotel não aceitou a alteração. Nada foi alterado na sua reserva.' } };
        }
        throw Object.assign(new Error('pendente'), { code: 'PENDENTE' });
      } catch (err) {
        await repo.updateAction(acao.id, { estado: 'pendente_reconciliacao', resultado_codigo: err.code || 'erro', atualizado_em: nowIso() });
        await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
        await audit({ ator: 'sistema', operacao: 'reserva.alteracao_pendente', recurso: acao.id, resultado: err.code || 'erro', correlacao });
        return { situacao: 'pendente', encaminhar: true, mensagem: { tipo: 'texto', texto: 'Sua solicitação de alteração foi registrada, mas o sistema do hotel ainda não confirmou. Considere a reserva inalterada até a confirmação. Vou encaminhar para nossa equipe acompanhar.' } };
      }
    },

    // Confirmação do link de verificação reforçada (página pública).
    async confirmStrongLink(token) {
      if (typeof token !== 'string' || token.length < 30 || token.length > 100) return { ok: false };
      const v = await repo.getVerificationByTokenHash(sha256Hex(token));
      if (!v || v.estado !== 'aguardando_link' || v.expira_em <= nowIso()) return { ok: false };
      await repo.updateVerification(v.id, { estado: 'valida', token_hash: null });
      await audit({ ator: 'titular', operacao: 'reserva.verificacao_reforcada_confirmada', recurso: v.conversa_id, resultado: 'ok' });
      return { ok: true };
    },
  };
}
