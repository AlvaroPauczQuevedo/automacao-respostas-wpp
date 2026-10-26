import { newId, canonicalJson } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { validateStay } from '../util/dates.js';
import { sha256Hex } from '../security/crypto.js';
import { Catalog } from '../whatsapp/catalog.js';

/**
 * Serviço de cotação e criação de reservas.
 *
 * Garantias:
 *  - Preço/disponibilidade vêm SEMPRE do adaptador oficial; nunca do modelo de IA.
 *  - A IA só consegue PREPARAR a confirmação (resumo determinístico + botões). A EXECUÇÃO ocorre apenas
 *    quando o processador de turnos recebe a confirmação do próprio cliente (botão/CONFIRMAR) vinculada
 *    à ação pendente, dentro do prazo — verificação independente do modelo.
 *  - Revalidação de preço/disponibilidade antes de exibir o resumo e no momento da criação (PMS compara valor esperado).
 *  - Idempotência: chave = id da ação pendente; reserva com chave única no banco + busca no PMS após timeout.
 *  - Só marca "confirmada" com resposta validada do PMS contendo código e dados coerentes.
 */
export function createBookingService({ repo, hotel, crypto, cfg, audit, metrics, logger, now = () => new Date() }) {
  const nowIso = () => now().toISOString();

  async function resolveHotel(hotelId) {
    const h = await repo.getHotel(hotelId);
    if (!h || h.status !== 'ativo') throw Errors.validation('Hotel não encontrado ou inativo', { campo: 'hotel_id' });
    if (!h.codigo_externo) throw Errors.pending('Hotel sem código de integração configurado');
    return h;
  }

  function validateOccupancy({ adultos, criancas_idades = [], quartos = 1 }) {
    const problemas = [];
    if (!Number.isInteger(adultos) || adultos < 1 || adultos > 20) problemas.push('adultos_invalido');
    if (!Array.isArray(criancas_idades) || criancas_idades.length > 10 || criancas_idades.some((i) => !Number.isInteger(i) || i < 0 || i > 17)) problemas.push('idades_criancas_invalidas');
    if (!Number.isInteger(quartos) || quartos < 1 || quartos > cfg.limites.maxQuartosReserva) problemas.push('quartos_invalido');
    if (Number.isInteger(adultos) && Number.isInteger(quartos) && adultos < quartos) problemas.push('cada_quarto_requer_um_adulto');
    return problemas;
  }

  async function searchAndStore({ conversaId, turnoId, hotelId, entrada, saida, adultos, criancas_idades = [], quartos = 1 }) {
    const h = await resolveHotel(hotelId);
    const stay = validateStay({ entrada, saida }, { timeZone: h.fuso_horario, maxNoites: cfg.limites.maxNoitesReserva, antecedenciaMaxDias: cfg.limites.antecedenciaMaxDias, now: now() });
    const occ = validateOccupancy({ adultos, criancas_idades, quartos });
    if (!stay.ok || occ.length) throw Errors.validation('Parâmetros de hospedagem inválidos', { problemas: [...(stay.problemas || []), ...occ] });

    const resp = await hotel.searchAvailability({ hotelCodigo: h.codigo_externo, entrada, saida, adultos, criancasIdades: criancas_idades, quartos });
    const opcoes = [];
    for (const o of resp.ofertas) {
      if (o.hotel_codigo !== h.codigo_externo) {
        logger.warn('oferta_de_hotel_divergente_descartada', { hotel_id: h.id });
        continue;
      }
      if (o.noites !== stay.noites) {
        logger.warn('oferta_com_noites_divergentes_descartada', { hotel_id: h.id });
        continue;
      }
      const q = {
        id: newId('cot'),
        conversa_id: conversaId,
        hotel_id: h.id,
        acomodacao_codigo: o.acomodacao_codigo,
        acomodacao_nome: o.acomodacao_nome,
        identificador_externo: o.codigo_oferta,
        entrada,
        saida,
        adultos,
        criancas_idades,
        quartos,
        noites: o.noites,
        valor_total: o.valor_total,
        valor_medio_diaria: o.valor_medio_diaria ?? null,
        moeda: o.moeda,
        impostos_incluidos: o.impostos_incluidos ?? null,
        taxas_descricao: o.taxas_descricao ?? null,
        politica_cancelamento: o.politica_cancelamento ?? null,
        condicoes_pagamento: o.condicoes_pagamento ?? null,
        plano_tarifario: o.plano_tarifario ?? null,
        validade: o.validade ?? null,
        estado: 'ofertada',
        origem: hotel.simulated ? 'simulado' : 'pms',
        criado_em: nowIso(),
      };
      await repo.insertQuote(q);
      opcoes.push(q);
    }
    metrics.inc('cotacoes_geradas_total', { resultado: opcoes.length ? 'com_disponibilidade' : 'sem_disponibilidade' });
    if (turnoId) await rememberAmounts(turnoId, opcoes.flatMap((q) => [q.valor_total, q.valor_medio_diaria].filter(Boolean)));
    return { hotel: h, opcoes, consultado_em: resp.consultado_em, noites: stay.noites };
  }

  async function rememberAmounts(turnoId, valores) {
    const t = await repo.getTurn(turnoId);
    if (!t) return;
    await repo.updateTurn(turnoId, { valores_apresentaveis: [...new Set([...(t.valores_apresentaveis || []), ...valores.map((v) => Number(v).toFixed(2))])] });
  }

  function presentQuote(q, h) {
    return {
      cotacao_id: q.id,
      hotel: h.nome,
      cidade: h.cidade,
      acomodacao: q.acomodacao_nome,
      plano_tarifario: q.plano_tarifario,
      entrada: q.entrada,
      saida: q.saida,
      noites: q.noites,
      hospedes: { adultos: q.adultos, criancas: q.criancas_idades.length },
      quartos: q.quartos,
      valor_total: q.valor_total,
      valor_medio_diaria: q.valor_medio_diaria,
      moeda: q.moeda,
      impostos_incluidos: q.impostos_incluidos,
      taxas: q.taxas_descricao,
      condicoes_pagamento: q.condicoes_pagamento,
      politica_cancelamento: q.politica_cancelamento,
      valida_ate: q.validade,
      tarifa_definitiva: false, // depende de confirmação no momento da reserva
      ...(q.origem === 'simulado' ? { aviso: 'COTAÇÃO SIMULADA — ambiente de teste, não é preço real' } : {}),
    };
  }

  async function loadQuoteForConversation(cotacaoId, conversaId) {
    const q = await repo.getQuote(cotacaoId);
    // Mesmo erro para "não existe" e "pertence a outra conversa" — evita enumeração.
    if (!q || q.conversa_id !== conversaId) throw Errors.notFound('Cotação');
    return q;
  }

  return {
    searchAndStore,
    presentQuote,

    async startBooking({ conversaId, cotacaoId }) {
      if (!cfg.negocio.avisoPrivacidadeUrl) {
        throw Errors.pending('Aviso de privacidade não configurado: coleta de dados para reserva bloqueada', { encaminhar: true });
      }
      const q = await loadQuoteForConversation(cotacaoId, conversaId);
      if (q.estado !== 'ofertada' && q.estado !== 'selecionada') throw Errors.conflict('Cotação não está mais disponível para reserva');
      if (q.validade && q.validade < nowIso()) {
        await repo.updateQuote(q.id, { estado: 'expirada' });
        throw Errors.conflict('Cotação expirada; é necessário consultar novamente', { motivo: 'cotacao_expirada' });
      }
      const h = await resolveHotel(q.hotel_id);
      const req = await hotel.getBookingRequirements({ hotelCodigo: h.codigo_externo });
      // Campos aceitos pelo assistente. Documento é recusado no chat (encaminhar para canal seguro).
      const campos = req.campos.filter((c) => ['nome', 'sobrenome', 'email', 'telefone', 'pais'].includes(c));
      const exigeDocumento = req.campos.includes('documento');
      await repo.updateQuote(q.id, { estado: 'selecionada' });
      // Cancela ações de criação anteriores ainda abertas nesta conversa (cliente mudou de ideia).
      for (const a of await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente'])) {
        if (a.tipo === 'criar_reserva' && a.cotacao_id !== q.id) await repo.updateAction(a.id, { estado: 'cancelada', payload_cifrado: null, atualizado_em: nowIso() });
      }
      const existing = (await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente'])).find((a) => a.cotacao_id === q.id);
      const acao =
        existing ||
        (await repo.insertAction({
          id: newId('acao'),
          conversa_id: conversaId,
          tipo: 'criar_reserva',
          estado: 'coletando_dados',
          cotacao_id: q.id,
          reserva_externa_hash: null,
          payload_cifrado: null,
          payload_hash: null,
          resumo_confirmado: null,
          expira_em: null,
          confirmada_por_evento: null,
          resultado_codigo: null,
          criado_em: nowIso(),
          atualizado_em: nowIso(),
        }));
      return {
        acao_id: acao.id,
        campos_obrigatorios: campos,
        exige_documento: exigeDocumento,
        finalidade_coleta: 'Registrar a reserva no sistema do hotel e permitir contato sobre ela.',
        aviso_privacidade_url: cfg.negocio.avisoPrivacidadeUrl,
      };
    },

    async registerGuest({ conversaId, cotacaoId, hospede }) {
      const q = await loadQuoteForConversation(cotacaoId, conversaId);
      const acao = (await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente'])).find((a) => a.cotacao_id === q.id && a.tipo === 'criar_reserva');
      if (!acao) throw Errors.conflict('Inicie a reserva desta cotação antes de registrar os dados do hóspede');
      const clean = sanitizeGuest(hospede);
      if (clean.problemas.length) throw Errors.validation('Dados do hóspede inválidos', { problemas: clean.problemas });
      const expira = new Date(now().getTime() + cfg.retencao.dadosHospedePendentesHoras * 3600000).toISOString();
      await repo.updateAction(acao.id, { payload_cifrado: crypto.encryptJson(clean.dados), estado: 'coletando_dados', expira_em: expira, atualizado_em: nowIso() });
      return { registrado: true, campos_recebidos: Object.keys(clean.dados) };
    },

    /**
     * Revalida a oferta e prepara o resumo determinístico com botões de confirmação.
     * Retorna a mensagem de saída para o turno (enviada pelo WF09), NÃO executa a reserva.
     */
    async prepareConfirmation({ conversaId, cotacaoId, turnoId }) {
      const q = await loadQuoteForConversation(cotacaoId, conversaId);
      const acao = (await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente'])).find((a) => a.cotacao_id === q.id && a.tipo === 'criar_reserva');
      if (!acao) throw Errors.conflict('Reserva não iniciada para esta cotação');
      if (!acao.payload_cifrado) throw Errors.conflict('Dados do hóspede ainda não registrados', { motivo: 'dados_hospede_pendentes' });
      const hospede = crypto.decryptJson(acao.payload_cifrado);
      const h = await resolveHotel(q.hotel_id);
      const req = await hotel.getBookingRequirements({ hotelCodigo: h.codigo_externo });
      if (req.campos.includes('documento')) {
        throw Errors.pending('O sistema de reservas exige documento; coleta pelo chat não é permitida', { encaminhar: true });
      }
      const faltantes = req.campos.filter((c) => !hospede[c]);
      if (faltantes.length) throw Errors.validation('Dados obrigatórios do hóspede ausentes', { faltantes });

      // Revalidação na fonte oficial.
      const r = await hotel.searchAvailability({ hotelCodigo: h.codigo_externo, entrada: q.entrada, saida: q.saida, adultos: q.adultos, criancasIdades: q.criancas_idades, quartos: q.quartos });
      const atual = r.ofertas.find((o) => o.acomodacao_codigo === q.acomodacao_codigo && (o.plano_tarifario ?? null) === (q.plano_tarifario ?? null));
      if (!atual) {
        await repo.updateQuote(q.id, { estado: 'expirada' });
        return { situacao: 'indisponivel', mensagem_cliente: null };
      }
      let cot = q;
      if (atual.valor_total !== q.valor_total || atual.moeda !== q.moeda || atual.codigo_oferta !== q.identificador_externo) {
        // Preço/condição mudou: nova cotação, nova confirmação obrigatória.
        const nova = { ...q, id: newId('cot'), identificador_externo: atual.codigo_oferta, valor_total: atual.valor_total, valor_medio_diaria: atual.valor_medio_diaria ?? null, moeda: atual.moeda, politica_cancelamento: atual.politica_cancelamento ?? null, condicoes_pagamento: atual.condicoes_pagamento ?? null, taxas_descricao: atual.taxas_descricao ?? null, impostos_incluidos: atual.impostos_incluidos ?? null, validade: atual.validade ?? null, estado: 'selecionada', criado_em: nowIso() };
        await repo.insertQuote(nova);
        await repo.updateQuote(q.id, { estado: 'substituida' });
        await repo.updateAction(acao.id, { cotacao_id: nova.id, atualizado_em: nowIso() });
        if (turnoId) await rememberAmounts(turnoId, [q.valor_total, nova.valor_total]);
        metrics.inc('cotacoes_preco_alterado_total', {});
        if (atual.valor_total !== q.valor_total) {
          return {
            situacao: 'preco_alterado',
            nova_cotacao_id: nova.id,
            valor_anterior: q.valor_total,
            valor_novo: nova.valor_total,
            moeda: nova.moeda,
            mensagem_cliente: { tipo: 'texto', texto: Catalog.precoAlterado({ anterior: q.valor_total, novo: nova.valor_total, moeda: nova.moeda }) },
          };
        }
        cot = nova;
      }

      const expiraMin = cfg.limites.confirmacaoTtlMin;
      const resumo = {
        hotel_id: h.id,
        cotacao_id: cot.id,
        codigo_oferta: cot.identificador_externo,
        entrada: cot.entrada,
        saida: cot.saida,
        adultos: cot.adultos,
        criancas_idades: cot.criancas_idades,
        quartos: cot.quartos,
        valor_total: cot.valor_total,
        moeda: cot.moeda,
        politica_cancelamento: cot.politica_cancelamento,
        condicoes_pagamento: cot.condicoes_pagamento,
      };
      const payloadHash = sha256Hex(canonicalJson(resumo) + '|' + acao.payload_cifrado);
      await repo.updateAction(acao.id, {
        estado: 'aguardando_cliente',
        resumo_confirmado: resumo,
        payload_hash: payloadHash,
        expira_em: new Date(now().getTime() + expiraMin * 60000).toISOString(),
        atualizado_em: nowIso(),
      });
      await repo.updateConversation(conversaId, { estado: 'aguardando_confirmacao', atualizada_em: nowIso() });
      if (turnoId) await rememberAmounts(turnoId, [cot.valor_total]);
      await audit({ ator: 'agente', operacao: 'reserva.confirmacao_solicitada', recurso: acao.id, resultado: 'ok' });
      return {
        situacao: 'aguardando_confirmacao_cliente',
        acao_id: acao.id,
        mensagem_cliente: {
          tipo: 'botoes',
          texto: Catalog.resumoReserva({ hotel: h, cotacao: cot, hospede, avisoPrivacidadeUrl: cfg.negocio.avisoPrivacidadeUrl, expiraMin }),
          botoes: [
            { id: `acao:${acao.id}:confirmar`, titulo: 'Confirmar reserva' },
            { id: `acao:${acao.id}:cancelar`, titulo: 'Não confirmar' },
          ],
        },
      };
    },

    /**
     * Executa a criação. Chamado SOMENTE pelo processador de turnos após validar a confirmação do cliente.
     * Retorna { situacao, mensagem } — mensagem determinística para o cliente.
     */
    async executeCreate({ acaoId, conversaId, eventoId, correlacao }) {
      // Compare-and-set: apenas uma execução por ação, mesmo com eventos concorrentes.
      const acao = await repo.transitionAction(acaoId, ['aguardando_cliente'], { estado: 'executando', confirmada_por_evento: eventoId, atualizado_em: nowIso() });
      if (!acao || acao.conversa_id !== conversaId) {
        metrics.inc('reservas_duplicidade_evitada_total', {});
        return { situacao: 'ignorada' };
      }
      const resumo = acao.resumo_confirmado;
      const hospede = crypto.decryptJson(acao.payload_cifrado);
      if (sha256Hex(canonicalJson(resumo) + '|' + acao.payload_cifrado) !== acao.payload_hash) {
        await repo.updateAction(acao.id, { estado: 'falhou', resultado_codigo: 'integridade', atualizado_em: nowIso() });
        throw Errors.conflict('Resumo confirmado não confere com os dados da ação');
      }
      const h = await resolveHotel(resumo.hotel_id);
      const { reserva, criada } = await repo.insertReservation({
        id: newId('res'),
        identificador_externo: null,
        hotel_id: h.id,
        cotacao_id: resumo.cotacao_id,
        conversa_id: conversaId,
        acao_id: acao.id,
        chave_idempotencia: acao.id,
        estado: 'iniciada',
        entrada: resumo.entrada,
        saida: resumo.saida,
        valor_total: resumo.valor_total,
        moeda: resumo.moeda,
        bloqueio_legal: false,
        criado_em: nowIso(),
        atualizado_em: nowIso(),
      });
      if (!criada) return { situacao: 'ignorada' };
      metrics.inc('reservas_total', { estado: 'iniciada' });

      let r;
      try {
        r = await hotel.createBooking({
          codigoOferta: resumo.codigo_oferta,
          hotelCodigo: h.codigo_externo,
          entrada: resumo.entrada,
          saida: resumo.saida,
          adultos: resumo.adultos,
          criancasIdades: resumo.criancas_idades,
          quartos: resumo.quartos,
          valorTotalEsperado: resumo.valor_total,
          moeda: resumo.moeda,
          hospede,
          idempotencyKey: acao.id,
        });
      } catch (err) {
        // Falha ambígua (timeout/rede/resposta inválida): a reserva PODE existir no PMS. Nunca afirmamos sucesso;
        // marcamos para reconciliação pela chave de idempotência.
        await repo.updateReservation(reserva.id, { estado: 'confirmacao_pendente', atualizado_em: nowIso() });
        await repo.updateAction(acao.id, { estado: 'pendente_reconciliacao', resultado_codigo: err.code || 'erro', atualizado_em: nowIso() });
        await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
        await audit({ ator: 'sistema', operacao: 'reserva.criacao_ambigua', recurso: reserva.id, resultado: err.code || 'erro', correlacao });
        metrics.inc('reservas_total', { estado: 'confirmacao_pendente' });
        logger.warn('reserva_confirmacao_pendente', { reserva_id: reserva.id, codigo: err.code });
        return { situacao: 'pendente', reserva_id: reserva.id, mensagem: { tipo: 'texto', texto: Catalog.reservaPendente() } };
      }
      return finalize({ acao, reserva, r, h, conversaId, correlacao });
    },

    // Reconciliação de reservas com confirmação pendente (WF11). Consulta o PMS pela chave de idempotência.
    async reconcilePending({ olderThanMin }) {
      const before = new Date(now().getTime() - olderThanMin * 60000).toISOString();
      const pend = await repo.listReservationsByState(['confirmacao_pendente'], before);
      const resultados = [];
      for (const reserva of pend) {
        try {
          const r = await hotel.findBookingByIdempotencyKey(reserva.chave_idempotencia);
          const acao = await repo.getAction(reserva.acao_id);
          const h = await resolveHotel(reserva.hotel_id);
          if (r === null) {
            // PMS não tem registro: a reserva não foi criada.
            await repo.updateReservation(reserva.id, { estado: 'falhou', atualizado_em: nowIso() });
            await repo.updateAction(acao.id, { estado: 'falhou', payload_cifrado: null, atualizado_em: nowIso() });
            resultados.push({ reserva_id: reserva.id, conversa_id: reserva.conversa_id, situacao: 'nao_criada', mensagem: { tipo: 'texto', texto: Catalog.reservaRecusada() } });
            continue;
          }
          if (r.status === 'pendente') {
            await repo.updateReservation(reserva.id, { atualizado_em: nowIso() });
            resultados.push({ reserva_id: reserva.id, situacao: 'ainda_pendente' });
            continue;
          }
          const out = await finalize({ acao, reserva, r, h, conversaId: reserva.conversa_id, correlacao: null });
          resultados.push({ reserva_id: reserva.id, conversa_id: reserva.conversa_id, ...out });
        } catch (err) {
          resultados.push({ reserva_id: reserva.id, situacao: 'erro', codigo: err.code || 'erro' });
        }
      }
      return resultados;
    },
  };

  async function finalize({ acao, reserva, r, h, conversaId, correlacao }) {
    const resumo = acao.resumo_confirmado;
    if (r.status === 'recusada') {
      await repo.updateReservation(reserva.id, { estado: 'falhou', atualizado_em: nowIso() });
      await repo.updateAction(acao.id, { estado: 'falhou', resultado_codigo: r.motivo === 'PRECO_ALTERADO' ? 'preco_alterado' : 'recusada', payload_cifrado: null, atualizado_em: nowIso() });
      await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
      await audit({ ator: 'sistema', operacao: 'reserva.recusada', recurso: reserva.id, resultado: r.motivo || 'recusada', correlacao });
      metrics.inc('reservas_total', { estado: 'falhou' });
      return { situacao: 'recusada', mensagem: { tipo: 'texto', texto: Catalog.reservaRecusada() } };
    }
    if (r.status === 'pendente') {
      await repo.updateReservation(reserva.id, { estado: 'confirmacao_pendente', atualizado_em: nowIso() });
      await repo.updateAction(acao.id, { estado: 'pendente_reconciliacao', atualizado_em: nowIso() });
      await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
      metrics.inc('reservas_total', { estado: 'confirmacao_pendente' });
      return { situacao: 'pendente', reserva_id: reserva.id, mensagem: { tipo: 'texto', texto: Catalog.reservaPendente() } };
    }
    // status === 'confirmada': validação de coerência com o que o cliente confirmou.
    const coerente = r.hotel_codigo === h.codigo_externo && r.entrada === resumo.entrada && r.saida === resumo.saida && r.valor_total === resumo.valor_total && r.moeda === resumo.moeda;
    if (!coerente) {
      await repo.updateReservation(reserva.id, { estado: 'confirmacao_pendente', identificador_externo: r.codigo_confirmacao, atualizado_em: nowIso() });
      await repo.updateAction(acao.id, { estado: 'pendente_reconciliacao', resultado_codigo: 'divergencia', atualizado_em: nowIso() });
      await audit({ ator: 'sistema', operacao: 'reserva.divergencia_confirmacao', recurso: reserva.id, resultado: 'divergente', correlacao });
      metrics.inc('reservas_divergentes_total', {});
      return { situacao: 'divergente', reserva_id: reserva.id, encaminhar: true, mensagem: { tipo: 'texto', texto: Catalog.reservaPendente() } };
    }
    await repo.updateReservation(reserva.id, { estado: 'confirmada', identificador_externo: r.codigo_confirmacao, atualizado_em: nowIso() });
    await repo.updateAction(acao.id, { estado: 'concluida', resultado_codigo: 'confirmada', payload_cifrado: null, atualizado_em: nowIso() });
    await repo.updateQuote(resumo.cotacao_id, { estado: 'convertida' });
    await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
    await audit({ ator: 'sistema', operacao: 'reserva.confirmada', recurso: reserva.id, resultado: 'ok', correlacao });
    metrics.inc('reservas_total', { estado: 'confirmada' });
    return { situacao: 'confirmada', reserva_id: reserva.id, mensagem: { tipo: 'texto', texto: Catalog.reservaConfirmada({ hotel: h, r }) } };
  }
}

const NAME = /^[\p{L}][\p{L} '.-]{0,79}$/u;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const PHONE = /^\+?\d{10,15}$/;

export function sanitizeGuest(h = {}) {
  const problemas = [];
  const dados = {};
  const nome = String(h.nome ?? '').trim();
  const sobrenome = String(h.sobrenome ?? '').trim();
  if (!NAME.test(nome)) problemas.push('nome_invalido');
  else dados.nome = nome;
  if (!NAME.test(sobrenome)) problemas.push('sobrenome_invalido');
  else dados.sobrenome = sobrenome;
  if (h.email !== undefined && h.email !== null && h.email !== '') {
    if (!EMAIL.test(String(h.email).trim())) problemas.push('email_invalido');
    else dados.email = String(h.email).trim().toLowerCase();
  }
  if (h.telefone !== undefined && h.telefone !== null && h.telefone !== '') {
    const tel = String(h.telefone).replace(/[\s().-]/g, '');
    if (!PHONE.test(tel)) problemas.push('telefone_invalido');
    else dados.telefone = tel;
  }
  if (h.pais) dados.pais = String(h.pais).slice(0, 2).toUpperCase();
  // Campos não previstos (ex.: CPF, documento, cartão) são descartados intencionalmente.
  return { problemas, dados };
}
