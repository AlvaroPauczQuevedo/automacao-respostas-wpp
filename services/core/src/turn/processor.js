import { newId } from '../util/ids.js';
import { Errors } from '../util/errors.js';
import { todayInZone } from '../util/dates.js';
import { Catalog } from '../whatsapp/catalog.js';
import { isMarketingOptOut } from '../whatsapp/policy.js';
import { checkAgentOutput, SAFE_REPLACEMENT } from '../guardrails/outputCheck.js';

export const INTENTS = [
  'saudacao',
  'informacoes_rede',
  'busca_hoteis_cidade',
  'recomendacao_hotel',
  'consulta_disponibilidade',
  'consulta_tarifas',
  'cotacao_hospedagem',
  'nova_reserva',
  'consulta_reserva_existente',
  'alteracao_reserva',
  'cancelamento_reserva',
  'checkin_checkout',
  'informacoes_acomodacoes',
  'servicos_comodidades',
  'politicas_hotel',
  'solicitacao_pagamento',
  'duvida_cobranca',
  'reclamacao',
  'solicitacao_atendimento_humano',
  'privacidade_dados',
  'sem_intencao_identificada',
  'potencialmente_fraudulenta',
  'fora_do_escopo',
];

// Regras determinísticas (independentes da IA) para pedidos que não podem falhar.
const HUMAN_REQUEST = /\b(atendente|humano|humana|operador|operadora|falar com (algu[eé]m|uma pessoa|um atendente|uma atendente|a equipe|o hotel)|pessoa de verdade|atendimento humano)\b/i;
const GREETING_ONLY = /^\s*(oi+|ol[aá]|bom dia|boa tarde|boa noite|hello|hi|e a[ií]|tudo bem\??|opa)[\s!.,?]*$/i;
const CONFIRM_TEXT = /^\s*confirmar\s*[.!]?\s*$/i;
const ACTION_REPLY = /^acao:(acao_[A-Za-z0-9_-]{6,40}):(confirmar|cancelar)$/;

/**
 * Processador de turnos (WF02/WF03).
 * Um "turno" agrega as mensagens pendentes de uma conversa e é processado sob trava exclusiva da conversa
 * (lease), garantindo uma resposta por vez e ordem de processamento.
 */
export function createTurnProcessor({ repo, crypto, cfg, services, metrics, logger, audit, now = () => new Date() }) {
  const { booking, reservations, handoff, privacy } = services;
  const nowIso = () => now().toISOString();

  async function finish(turno, { estadoEventos = 'processado', estadoConversa } = {}) {
    const t = await repo.getTurn(turno.id);
    await repo.updateEvents(t.eventos, { estado: estadoEventos, payload_cifrado: null, atualizado_em: nowIso() });
    await repo.updateTurn(t.id, { estado: estadoEventos === 'processado' ? 'concluido' : 'falhou', concluido_em: nowIso() });
    const conversa = await repo.getConversation(t.conversa_id);
    const patch = { atualizada_em: nowIso() };
    if (estadoConversa) patch.estado = estadoConversa;
    else if (['nova', 'ativa', 'encerrada'].includes(conversa.estado)) patch.estado = 'aguardando_cliente';
    await repo.updateConversation(conversa.id, patch);
    await repo.releaseConversationLock(conversa.id, t.id);
    const pendentes = await repo.listPendingEvents(conversa.id);
    const mensagens = t.saida.map((m, i) => ({
      conversa_id: conversa.id,
      chave_deduplicacao: `${t.id}:${i}`,
      origem: m.origem || 'sistema',
      finalidade: 'atendimento',
      mensagem: stripOrigin(m),
    }));
    metrics.observe('turno_duracao_segundos', {}, (Date.now() - Date.parse(t.criado_em)) / 1000);
    return { turno_id: t.id, conversa_id: conversa.id, mensagens, ha_pendentes: pendentes.length > 0 };
  }

  async function push(turno, mensagem, origem = 'sistema') {
    const t = await repo.getTurn(turno.id);
    await repo.updateTurn(turno.id, { saida: [...t.saida, { ...mensagem, origem }] });
  }

  async function handleAction(turno, conversa, acaoId, decisao, eventoId) {
    const acao = await repo.getAction(acaoId);
    // Ação de outra conversa ou inexistente: ignora sem revelar nada.
    if (!acao || acao.conversa_id !== conversa.id) {
      await audit({ ator: 'cliente', operacao: 'acao.referencia_invalida', recurso: conversa.id, resultado: 'ignorada' });
      return;
    }
    if (acao.estado !== 'aguardando_cliente') return; // já processada (duplicidade) — sem efeito
    if (acao.expira_em && acao.expira_em <= nowIso()) {
      await repo.updateAction(acao.id, { estado: 'expirada', payload_cifrado: null, atualizado_em: nowIso() });
      await repo.updateConversation(conversa.id, { estado: 'ativa' });
      await push(turno, { tipo: 'texto', texto: Catalog.confirmacaoExpirada() });
      return;
    }
    if (decisao === 'cancelar') {
      await repo.updateAction(acao.id, { estado: 'cancelada', payload_cifrado: null, atualizado_em: nowIso() });
      await repo.updateConversation(conversa.id, { estado: 'ativa' });
      await audit({ ator: 'cliente', operacao: `acao.${acao.tipo}.recusada_pelo_cliente`, recurso: acao.id, resultado: 'ok' });
      await push(turno, { tipo: 'texto', texto: Catalog.operacaoCancelada() });
      return;
    }
    await audit({ ator: 'cliente', operacao: `acao.${acao.tipo}.confirmada_pelo_cliente`, recurso: acao.id, resultado: 'ok', correlacao: turno.id });
    const exec = { criar_reserva: booking.executeCreate, cancelar_reserva: reservations.executeCancel, alterar_reserva: reservations.executeModify }[acao.tipo];
    let r;
    try {
      r = await exec({ acaoId: acao.id, conversaId: conversa.id, eventoId, correlacao: turno.id });
    } catch (err) {
      logger.error('falha_execucao_acao', { acao_id: acao.id, codigo: err.code, err });
      await push(turno, { tipo: 'texto', texto: Catalog.reservaPendente() });
      const h = await handoff.create({ conversaId: conversa.id, motivo: 'situacao_excepcional', resumo: `Falha ao executar ${acao.tipo}; verificar no sistema oficial.` });
      await push(turno, h.mensagem);
      return;
    }
    if (r.mensagem) await push(turno, r.mensagem);
    await repo.updateTurn(turno.id, { operacao_confirmada: r.situacao });
    if (r.encaminhar) {
      const h = await handoff.create({ conversaId: conversa.id, motivo: 'situacao_excepcional', resumo: `${acao.tipo}: ${r.situacao}; verificar no sistema oficial.` });
      await push(turno, h.mensagem);
    }
  }

  return {
    INTENTS,

    async begin({ conversaId }) {
      const conversa0 = await repo.getConversation(conversaId);
      if (!conversa0) throw Errors.notFound('Conversa');
      const turnoId = newId('turno');
      const lockAte = new Date(now().getTime() + cfg.limites.lockLeaseMs).toISOString();
      if (!(await repo.tryLockConversation(conversaId, turnoId, lockAte, nowIso()))) {
        metrics.inc('turnos_total', { resultado: 'enfileirado' });
        return { acao: 'enfileirado' };
      }
      const eventos = await repo.listPendingEvents(conversaId);
      if (!eventos.length) {
        await repo.releaseConversationLock(conversaId, turnoId);
        return { acao: 'nada_a_fazer' };
      }
      await repo.updateEvents(eventos.map((e) => e.id), { estado: 'processando', tentativas: 1, atualizado_em: nowIso() });
      const turno = await repo.insertTurn({
        id: turnoId,
        conversa_id: conversaId,
        eventos: eventos.map((e) => e.id),
        estado: 'aberto',
        intencoes: null,
        ferramentas_chamadas: 0,
        confirmacao_enviada: false,
        encaminhado: false,
        saida: [],
        valores_apresentaveis: [],
        criado_em: nowIso(),
        concluido_em: null,
      });
      metrics.inc('turnos_total', { resultado: 'iniciado' });

      const msgs = eventos.map((e) => crypto.decryptJson(e.payload_cifrado));
      const textos = msgs.filter((m) => m.tipo === 'texto' && m.texto).map((m) => m.texto);
      const interativas = msgs.filter((m) => m.tipo === 'resposta_interativa');
      const naoSuportadas = msgs.filter((m) => m.tipo === 'nao_suportado');
      const textoCompleto = textos.join('\n');

      // Atendimento humano exclusivo: automação permanece em silêncio.
      if (conversa0.estado === 'em_atendimento_humano' || conversa0.estado === 'suspensa') {
        const r = await finish(turno, { estadoConversa: conversa0.estado });
        return { ...r, acao: 'silencio', motivo: conversa0.estado, notificar_equipe: conversa0.estado === 'em_atendimento_humano' };
      }

      let conversa = conversa0;
      const primeira = conversa.estado === 'nova' || conversa.estado === 'encerrada';
      if (primeira) {
        await push(turno, { tipo: 'texto', texto: Catalog.saudacao(cfg.negocio.nomeRede) });
        conversa = await repo.updateConversation(conversaId, { estado: 'ativa', atualizada_em: nowIso() });
      }
      if (msgs.some((m) => m.truncada)) await push(turno, { tipo: 'texto', texto: Catalog.mensagemTruncada(cfg.limites.maxTamanhoMensagem) });

      // 1) Respostas a botões de ação (confirmação explícita do cliente).
      for (const m of interativas) {
        const match = ACTION_REPLY.exec(m.resposta_id || '');
        if (match) {
          await handleAction(turno, conversa, match[1], match[2], m.wamid);
          conversa = await repo.getConversation(conversaId);
        }
      }
      if (interativas.length && !textoCompleto) return { ...(await finish(turno)), acao: 'responder' };

      // 2) "CONFIRMAR" digitado, com exatamente uma ação aguardando o cliente.
      if (CONFIRM_TEXT.test(textoCompleto)) {
        const abertas = (await repo.listActions(conversaId, ['aguardando_cliente'])).filter((a) => !a.expira_em || a.expira_em > nowIso());
        if (abertas.length === 1) {
          await handleAction(turno, conversa, abertas[0].id, 'confirmar', msgs[msgs.length - 1].wamid);
          return { ...(await finish(turno)), acao: 'responder' };
        }
      }

      // 3) Interrupção de mensagens promocionais.
      if (isMarketingOptOut(textoCompleto)) {
        await repo.upsertPreference({ id: newId('pref'), titular_hash: conversa.titular_hash, finalidade: 'marketing', estado: 'revogada', origem: 'whatsapp:palavra_chave', evidencia: msgs[msgs.length - 1].wamid, registrado_em: nowIso(), atualizado_em: nowIso() });
        await audit({ ator: 'cliente', operacao: 'preferencia.marketing_revogada', recurso: conversa.id, resultado: 'ok' });
        await push(turno, { tipo: 'texto', texto: Catalog.optOutConfirmado() });
        return { ...(await finish(turno)), acao: 'responder' };
      }

      // 4) Pedido explícito de atendimento humano.
      if (HUMAN_REQUEST.test(textoCompleto)) {
        const h = await handoff.create({ conversaId, motivo: 'solicitacao_cliente', resumo: 'Cliente solicitou atendimento humano.', correlacao: turno.id });
        await push(turno, h.mensagem);
        const r = await finish(turno, { estadoConversa: 'em_atendimento_humano' });
        return { ...r, acao: 'responder', notificar_equipe: true, atendimento_id: h.solicitacao.id };
      }

      // 5) Somente mídia/conteúdo não suportado.
      if (!textoCompleto) {
        if (naoSuportadas.length) await push(turno, { tipo: 'texto', texto: Catalog.naoSuportado() });
        return { ...(await finish(turno)), acao: 'responder' };
      }

      // 6) Saudação simples em conversa nova: a saudação determinística basta.
      if (primeira && GREETING_ONLY.test(textoCompleto)) return { ...(await finish(turno)), acao: 'responder' };

      // 7) Interpretação pela IA. A trava permanece com este turno até reply/fail.
      const recentes = await repo.listRecentMessages(conversaId, cfg.limites.historicoMensagens + eventos.length);
      const ids = new Set(eventos.map((e) => e.id));
      const historico = recentes
        .filter((m) => !ids.has(m.identificador_externo) && m.conteudo_cifrado && m.estado !== 'bloqueada')
        .slice(0, cfg.limites.historicoMensagens)
        .reverse()
        .map((m) => ({ autor: m.direcao === 'entrada' ? 'cliente' : 'assistente', texto: crypto.decrypt(m.conteudo_cifrado) }));
      if (naoSuportadas.length) await push(turno, { tipo: 'texto', texto: Catalog.naoSuportado() });
      const acoesAbertas = await repo.listActions(conversaId, ['coletando_dados', 'aguardando_cliente']);
      return {
        acao: 'interpretar',
        turno_id: turno.id,
        conversa_id: conversaId,
        mensagem_cliente: textoCompleto,
        contexto: {
          data_hoje: todayInZone('America/Sao_Paulo', now()),
          nome_rede: cfg.negocio.nomeRede || null,
          estado_conversa: conversa.estado,
          primeira_interacao: primeira,
          saudacao_ja_enviada: primeira,
          dados_ja_informados: conversa.contexto?.slots || {},
          intencoes_pendentes: conversa.contexto?.intencoes_pendentes || [],
          operacoes_em_andamento: acoesAbertas.map((a) => ({ tipo: a.tipo, estado: a.estado, cotacao_id: a.cotacao_id })),
          historico,
          ambiente_simulado: cfg.hotel.adapter === 'mock' ? 'ATENÇÃO: ambiente de teste com dados simulados.' : null,
        },
      };
    },

    // Resultado da classificação feita pela IA (n8n). Validado e roteado deterministicamente.
    async classification({ turnoId, intencoes }) {
      const turno = await repo.getTurn(turnoId);
      if (!turno || turno.estado !== 'aberto') throw Errors.conflict('Turno inexistente ou encerrado');
      const lista = (Array.isArray(intencoes) ? intencoes : [])
        .filter((i) => i && INTENTS.includes(i.intencao))
        .map((i) => ({ intencao: i.intencao, confianca: Math.max(0, Math.min(1, Number(i.confianca) || 0)) }))
        .sort((a, b) => b.confianca - a.confianca)
        .slice(0, 5);
      await repo.updateTurn(turnoId, { intencoes: lista });
      for (const i of lista) metrics.inc('intencoes_classificadas_total', { intencao: i.intencao });
      const conversa = await repo.getConversation(turno.conversa_id);
      const has = (nome, min) => lista.some((i) => i.intencao === nome && i.confianca >= min);
      const ctxConv = conversa.contexto || {};

      // Pendências para turnos seguintes (múltiplas intenções).
      const pendentes = lista.slice(1).filter((i) => i.confianca >= 0.5).map((i) => i.intencao);
      const semIntencao = !lista.length || lista[0].confianca < 0.4 || lista[0].intencao === 'sem_intencao_identificada';
      const falhas = semIntencao ? (ctxConv.falhas_compreensao || 0) + 1 : 0;
      await repo.updateConversation(conversa.id, { contexto: { ...ctxConv, intencoes_pendentes: pendentes, falhas_compreensao: falhas } });

      const encaminhar = async (motivo, resumo) => {
        const h = await handoff.create({ conversaId: conversa.id, motivo, resumo, correlacao: turnoId });
        await push(turno, h.mensagem);
        return { ...(await finish(turno, { estadoConversa: 'em_atendimento_humano' })), acao: 'responder', notificar_equipe: true, atendimento_id: h.solicitacao.id };
      };

      if (has('solicitacao_atendimento_humano', 0.6)) return encaminhar('solicitacao_cliente', 'Cliente solicitou atendimento humano.');
      if (has('potencialmente_fraudulenta', 0.7)) return encaminhar('suspeita_fraude', 'Mensagem classificada como potencialmente fraudulenta.');
      if (has('duvida_cobranca', 0.7) || has('solicitacao_pagamento', 0.7)) {
        if (!cfg.pagamentoViaChat) return encaminhar(has('duvida_cobranca', 0.7) ? 'disputa_cobranca' : 'pagamento', 'Assunto de pagamento/cobrança.');
      }
      if (has('privacidade_dados', 0.7)) {
        const r = await privacy.register({ conversaId: conversa.id, titularHash: conversa.titular_hash, tipo: 'outro', descricao: 'Solicitação recebida pelo WhatsApp (classificação automática).' });
        await push(turno, r.mensagem);
        return { ...(await finish(turno)), acao: 'responder', notificar_privacidade: true, solicitacao_privacidade_id: r.solicitacao_id };
      }
      if (falhas >= 3) {
        await repo.updateConversation(conversa.id, { contexto: { ...ctxConv, intencoes_pendentes: pendentes, falhas_compreensao: 0 } });
        return encaminhar('baixa_confianca', 'Três mensagens seguidas sem intenção identificada.');
      }
      return { acao: 'invocar_agente', turno_id: turnoId, intencao_principal: lista[0]?.intencao || 'sem_intencao_identificada', intencoes: lista };
    },

    // Resposta final da IA → verificação de saída → fila de envio. Encerra o turno.
    async reply({ turnoId, texto }) {
      const turno = await repo.getTurn(turnoId);
      if (!turno || turno.estado !== 'aberto') throw Errors.conflict('Turno inexistente ou encerrado');
      if (turno.confirmacao_enviada || turno.encaminhado) {
        // Mensagem oficial determinística já preparada; o texto livre da IA é descartado.
        if (texto) metrics.inc('agente_respostas_descartadas_total', { motivo: turno.encaminhado ? 'encaminhado' : 'confirmacao_enviada' });
        return { ...(await finish(turno, turno.encaminhado ? { estadoConversa: 'em_atendimento_humano' } : {})), acao: 'responder', notificar_equipe: Boolean(turno.encaminhado) };
      }
      const desde = new Date(now().getTime() - 24 * 3600000).toISOString();
      const cotacoes = await repo.listQuotesByConversation(turno.conversa_id, desde);
      const permitidos = new Set([...(turno.valores_apresentaveis || []), ...cotacoes.flatMap((q) => [q.valor_total, q.valor_medio_diaria].filter(Boolean).map((v) => Number(v).toFixed(2)))]);
      const check = checkAgentOutput(texto, { valoresPermitidos: permitidos, operacaoConfirmadaNoTurno: Boolean(turno.operacao_confirmada) });
      let final = check.texto;
      if (!check.ok) {
        for (const v of check.violacoes) metrics.inc('guardrail_bloqueios_total', { tipo: v });
        logger.warn('resposta_agente_bloqueada', { turno_id: turnoId, violacoes: check.violacoes });
        await audit({ ator: 'agente', operacao: 'guardrail.resposta_bloqueada', recurso: turnoId, resultado: check.violacoes.join(',') });
        final = check.violacoes.includes('vazia') && turno.saida.length ? null : SAFE_REPLACEMENT[check.violacoes.find((v) => SAFE_REPLACEMENT[v])] || SAFE_REPLACEMENT.padrao;
      }
      if (final) await push(turno, { tipo: 'texto', texto: final }, check.ok ? 'agente' : 'sistema');
      metrics.inc('agente_respostas_total', { resultado: check.ok ? 'ok' : 'substituida' });
      return { ...(await finish(turno)), acao: 'responder' };
    },

    // Falha na IA/orquestração: resposta de contingência, sem fingir conclusão.
    async fail({ turnoId, motivo }) {
      const turno = await repo.getTurn(turnoId);
      if (!turno || turno.estado !== 'aberto') return { acao: 'nada_a_fazer' };
      const t = await repo.getTurn(turnoId);
      if (!t.confirmacao_enviada && !t.encaminhado) await push(turno, { tipo: 'texto', texto: Catalog.falhaAssistente() });
      await repo.insertOpError({ id: newId('err'), origem: 'turno', codigo: String(motivo || 'falha').slice(0, 60), workflow: null, no: null, mensagem_mascarada: null, correlacao: turnoId, instante: nowIso() });
      metrics.inc('turnos_total', { resultado: 'falhou' });
      return { ...(await finish(turno)), acao: 'responder' };
    },
  };
}

function stripOrigin(m) {
  const { origem, ...rest } = m;
  return rest;
}
