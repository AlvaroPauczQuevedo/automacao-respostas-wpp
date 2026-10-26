import Ajv from 'ajv';
import { TOOLS, getTool } from './registry.js';
import { AppError, Errors } from '../util/errors.js';
import { botMayRespond } from '../conversation/stateMachine.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(TOOLS.map((t) => [t.nome, ajv.compile(t.parametros)]));

// Orientações devolvidas ao modelo quando uma ferramenta falha — direcionam para comportamento seguro.
const ORIENTACAO = {
  INTEGRACAO_INDISPONIVEL: 'O sistema oficial está indisponível. Não informe preços ou disponibilidade. Explique a limitação e ofereça nova tentativa ou atendimento humano.',
  RESPOSTA_INVALIDA_INTEGRACAO: 'O sistema oficial retornou dados inconsistentes. Não use nenhum valor. Ofereça atendimento humano.',
  VALIDACAO: 'Parâmetros inválidos. Confirme com o cliente as informações indicadas em "detalhes" antes de tentar de novo.',
  NAO_ENCONTRADO: 'Registro não encontrado. Não invente dados; confirme as informações com o cliente.',
  PROIBIDO: 'Operação não autorizada. Não revele dados. Se for reserva existente, a titularidade precisa ser verificada; caso contrário, ofereça atendimento humano.',
  CONFLITO: 'A operação não pode prosseguir no estado atual. Explique ao cliente e, se necessário, refaça a consulta.',
  CONFIGURACAO_PENDENTE: 'Esta operação depende de configuração da rede ainda pendente. Encaminhe para atendimento humano.',
  NAO_SUPORTADO: 'A integração atual não suporta esta operação. Encaminhe para atendimento humano.',
  LIMITE: 'Limite de operações atingido neste atendimento. Ofereça atendimento humano.',
};

/**
 * Gateway de ferramentas: única porta de execução de ferramentas pela IA.
 * Controles: lista permitida, turno aberto e pertencente à conversa, conversa elegível para automação,
 * limite de chamadas por turno, validação estrita de parâmetros, despacho para serviço controlado,
 * auditoria (sem conteúdo de parâmetros), resultados estruturados.
 */
export function createToolGateway({ repo, services, cfg, audit, metrics, logger, now = () => new Date() }) {
  const { knowledge, booking, reservations, handoff, privacy } = services;
  const nowIso = () => now().toISOString();

  async function pushOutbox(turnoId, mensagem, flags = {}) {
    const t = await repo.getTurn(turnoId);
    await repo.updateTurn(turnoId, { saida: [...t.saida, { ...mensagem, origem: 'sistema' }], ...flags });
  }

  async function encaminhar(ctx, motivo, resumo) {
    const r = await handoff.create({ conversaId: ctx.conversa.id, motivo, resumo, correlacao: ctx.turno.id });
    await pushOutbox(ctx.turno.id, r.mensagem, { encaminhado: true });
    return { encaminhado: true, instrucao: 'A conversa foi transferida para a equipe humana e a mensagem de encaminhamento já foi enviada. Não escreva mais nada.' };
  }

  const handlers = {
    listar_hoteis: () => knowledge.listHotels({}).then((hoteis) => ({ hoteis })),
    buscar_hoteis_por_cidade: (a) => knowledge.listHotels({ cidade: a.cidade }).then((hoteis) => ({ hoteis, encontrados: hoteis.length })),
    consultar_detalhes_hotel: async (a) => (await knowledge.hotelDetails(a.hotel_id)) ?? Promise.reject(Errors.notFound('Hotel')),
    consultar_comodidades: async (a) => (await knowledge.amenities(a.hotel_id)) ?? Promise.reject(Errors.notFound('Hotel')),
    consultar_politicas: (a) => knowledge.policies({ hotelId: a.hotel_id, categoria: a.categoria }),
    consultar_faq: (a) => knowledge.faq({ hotelId: a.hotel_id, pergunta: a.pergunta }).then((respostas) => ({ respostas, encontrou: respostas.length > 0 })),

    atualizar_contexto: async (a, ctx) => {
      const slots = { ...(ctx.conversa.contexto?.slots || {}), ...a };
      await repo.updateConversation(ctx.conversa.id, { contexto: { ...(ctx.conversa.contexto || {}), slots }, atualizada_em: nowIso() });
      return { contexto_atualizado: true };
    },

    consultar_disponibilidade: async (a, ctx) => {
      const params = { entrada: a.entrada, saida: a.saida, adultos: a.adultos, criancas_idades: a.criancas_idades || [], quartos: a.quartos || 1 };
      let hotelIds;
      if (a.hotel_id) hotelIds = [a.hotel_id];
      else {
        const hs = await knowledge.listHotels({ cidade: a.cidade });
        if (!hs.length) return { opcoes: [], mensagem: 'Nenhum hotel publicado nessa cidade.' };
        hotelIds = hs.slice(0, 5).map((h) => h.hotel_id);
      }
      const opcoes = [];
      const falhas = [];
      for (const hid of hotelIds) {
        try {
          const r = await booking.searchAndStore({ conversaId: ctx.conversa.id, turnoId: ctx.turno.id, hotelId: hid, ...params });
          for (const q of r.opcoes) opcoes.push(booking.presentQuote(q, r.hotel));
        } catch (err) {
          if (hotelIds.length === 1 || err.code === 'VALIDACAO') throw err;
          falhas.push({ hotel_id: hid, codigo: err.code || 'erro' });
        }
      }
      if (!opcoes.length && falhas.length === hotelIds.length) throw Errors.upstream('Nenhum hotel pôde ser consultado');
      return {
        opcoes: opcoes.slice(0, 8),
        sem_disponibilidade: opcoes.length === 0,
        consultas_com_falha: falhas.length,
        observacao: 'Valores do sistema oficial. Diferencie valor total e média por diária. A tarifa só é definitiva após confirmação da reserva.',
      };
    },

    calcular_cotacao: async (a, ctx) => {
      const q = await repo.getQuote(a.cotacao_id);
      if (!q || q.conversa_id !== ctx.conversa.id) throw Errors.notFound('Cotação');
      const h = await repo.getHotel(q.hotel_id);
      const t = await repo.getTurn(ctx.turno.id);
      await repo.updateTurn(ctx.turno.id, { valores_apresentaveis: [...new Set([...t.valores_apresentaveis, q.valor_total, q.valor_medio_diaria].filter(Boolean))] });
      const expirada = q.validade && q.validade < nowIso();
      return { ...booking.presentQuote(q, h), expirada: Boolean(expirada), ...(expirada ? { orientacao: 'Cotação expirada: consulte a disponibilidade novamente antes de prosseguir.' } : {}) };
    },

    iniciar_reserva: async (a, ctx) => {
      try {
        return await booking.startBooking({ conversaId: ctx.conversa.id, cotacaoId: a.cotacao_id });
      } catch (err) {
        if (err.code === 'CONFIGURACAO_PENDENTE') return encaminhar(ctx, 'configuracao_pendente', 'Reserva solicitada; configuração pendente impede coleta de dados pelo assistente.');
        throw err;
      }
    },
    registrar_dados_hospede: (a, ctx) => booking.registerGuest({ conversaId: ctx.conversa.id, cotacaoId: a.cotacao_id, hospede: { nome: a.nome, sobrenome: a.sobrenome, email: a.email, telefone: a.telefone } }),

    solicitar_confirmacao_reserva: async (a, ctx) => {
      let r;
      try {
        r = await booking.prepareConfirmation({ conversaId: ctx.conversa.id, cotacaoId: a.cotacao_id, turnoId: ctx.turno.id });
      } catch (err) {
        if (err.code === 'CONFIGURACAO_PENDENTE') return encaminhar(ctx, 'configuracao_pendente', 'Sistema de reservas exige dado que não pode ser coletado pelo chat.');
        throw err;
      }
      if (r.situacao === 'indisponivel') return { situacao: 'indisponivel', instrucao: 'A opção não está mais disponível no sistema oficial. Informe o cliente e ofereça nova consulta.' };
      await pushOutbox(ctx.turno.id, r.mensagem_cliente, { confirmacao_enviada: true });
      if (r.situacao === 'preco_alterado') {
        return { situacao: 'preco_alterado', nova_cotacao_id: r.nova_cotacao_id, instrucao: 'O cliente já foi avisado da mudança de valor. Não escreva mais nada neste turno.' };
      }
      return { situacao: r.situacao, instrucao: 'O resumo oficial com botões já foi enviado. A reserva só será criada quando o cliente confirmar. Não escreva mais nada neste turno.' };
    },

    verificar_titular_reserva: (a, ctx) =>
      reservations.verifyHolder({ conversaId: ctx.conversa.id, titularHash: ctx.conversa.titular_hash, codigo: a.codigo_reserva, sobrenome: a.sobrenome, dataEntrada: a.data_entrada }),
    consultar_reserva: (a, ctx) => reservations.consult({ conversaId: ctx.conversa.id, codigo: a.codigo_reserva }),

    alterar_reserva: async (a, ctx) => {
      const r = await reservations.requestModification({ conversaId: ctx.conversa.id, codigo: a.codigo_reserva, novaEntrada: a.nova_entrada, novaSaida: a.nova_saida });
      return handleSensitive(r, ctx, 'Alteração de reserva solicitada');
    },
    solicitar_cancelamento: async (a, ctx) => {
      const r = await reservations.requestCancellation({ conversaId: ctx.conversa.id, codigo: a.codigo_reserva });
      return handleSensitive(r, ctx, 'Cancelamento de reserva solicitado');
    },

    encaminhar_atendimento: (a, ctx) => encaminhar(ctx, a.motivo, a.resumo),

    consultar_estado_atendimento: async (_a, ctx) => {
      const acoes = await repo.listActions(ctx.conversa.id, ['coletando_dados', 'aguardando_cliente', 'executando', 'pendente_reconciliacao']);
      const atd = await repo.getOpenHandoffByConversation(ctx.conversa.id);
      return {
        estado_conversa: ctx.conversa.estado,
        atendimento_humano: atd ? { estado: atd.estado, fila: atd.fila } : null,
        operacoes_pendentes: acoes.map((x) => ({ tipo: x.tipo, estado: x.estado, expira_em: x.expira_em })),
      };
    },

    registrar_solicitacao_privacidade: async (a, ctx) => {
      const r = await privacy.register({ conversaId: ctx.conversa.id, titularHash: ctx.conversa.titular_hash, tipo: a.tipo, descricao: a.descricao });
      await pushOutbox(ctx.turno.id, r.mensagem);
      return { registrado: true, instrucao: 'A confirmação do registro já foi enviada ao cliente. Não prometa prazos nem eliminação.' };
    },
  };

  async function handleSensitive(r, ctx, resumo) {
    if (r.situacao === 'encaminhar') return encaminhar(ctx, 'verificacao_reforcada', `${resumo}; ${r.motivo}`);
    if (r.mensagem) {
      await pushOutbox(ctx.turno.id, r.mensagem, r.situacao === 'aguardando_confirmacao_cliente' ? { confirmacao_enviada: true } : {});
      return { situacao: r.situacao, instrucao: 'A mensagem oficial já foi enviada ao cliente. Não escreva mais nada neste turno.' };
    }
    return { situacao: r.situacao, motivo: r.motivo };
  }

  return {
    async execute({ nome, argumentos, turnoId, principal, correlacao }) {
      const started = Date.now();
      const tool = getTool(nome);
      if (!tool) {
        metrics.inc('ferramentas_chamadas_total', { ferramenta: 'nao_autorizada', resultado: 'bloqueada' });
        await audit({ ator: principal?.ator || 'agente', operacao: 'ferramenta.nao_autorizada', recurso: String(nome).slice(0, 60), resultado: 'bloqueada', correlacao });
        throw Errors.forbidden('Ferramenta não autorizada');
      }
      const turno = typeof turnoId === 'string' ? await repo.getTurn(turnoId) : null;
      if (!turno || turno.estado !== 'aberto') throw Errors.conflict('Turno inexistente ou encerrado');
      const conversa = await repo.getConversation(turno.conversa_id);
      if (!conversa || !botMayRespond(conversa)) throw Errors.conflict('Conversa não elegível para automação');
      if (turno.encaminhado) throw Errors.conflict('Conversa encaminhada para atendimento humano neste turno');

      const chamadas = (turno.ferramentas_chamadas || 0) + 1;
      await repo.updateTurn(turno.id, { ferramentas_chamadas: chamadas });
      if (chamadas > cfg.limites.maxChamadasFerramentaPorTurno) {
        await audit({ ator: 'agente', operacao: 'ferramenta.limite_turno', recurso: turno.id, resultado: 'bloqueada', correlacao });
        return { ok: false, erro: { codigo: 'LIMITE', orientacao: ORIENTACAO.LIMITE } };
      }

      const args = argumentos && typeof argumentos === 'object' && !Array.isArray(argumentos) ? argumentos : {};
      const validate = validators.get(nome);
      if (!validate(args)) {
        metrics.inc('ferramentas_chamadas_total', { ferramenta: nome, resultado: 'parametros_invalidos' });
        return { ok: false, erro: { codigo: 'VALIDACAO', detalhes: validate.errors.slice(0, 5).map((e) => `${e.instancePath || '/'} ${e.message}`), orientacao: ORIENTACAO.VALIDACAO } };
      }

      const ctx = { conversa, turno };
      try {
        const resultado = await handlers[nome](args, ctx);
        metrics.inc('ferramentas_chamadas_total', { ferramenta: nome, resultado: 'ok' });
        await audit({ ator: 'agente', operacao: `ferramenta.${nome}`, recurso: conversa.id, resultado: 'ok', correlacao: correlacao || turno.id });
        return { ok: true, resultado };
      } catch (err) {
        // Somente erros de domínio (AppError) têm código/mensagem expostos; o resto é genérico.
        const known = err instanceof AppError;
        const codigo = known ? err.code : 'ERRO_INTERNO';
        metrics.inc('ferramentas_chamadas_total', { ferramenta: nome, resultado: codigo });
        await audit({ ator: 'agente', operacao: `ferramenta.${nome}`, recurso: conversa.id, resultado: codigo, correlacao: correlacao || turno.id });
        if (!known) logger.error('erro_interno_ferramenta', { ferramenta: nome, err });
        // Falhas de integração repetidas no turno → encaminhamento automático.
        if (codigo === 'INTEGRACAO_INDISPONIVEL' || codigo === 'RESPOSTA_INVALIDA_INTEGRACAO') {
          const ctxConv = conversa.contexto || {};
          const falhas = (ctxConv.falhas_integracao || 0) + 1;
          await repo.updateConversation(conversa.id, { contexto: { ...ctxConv, falhas_integracao: falhas } });
          if (falhas >= 3) {
            await repo.updateConversation(conversa.id, { contexto: { ...ctxConv, falhas_integracao: 0 } });
            return { ok: false, erro: { codigo, orientacao: ORIENTACAO[codigo] }, ...(await encaminhar({ conversa, turno }, 'falha_integracao', `Falhas repetidas na ferramenta ${nome}`)) };
          }
        }
        return {
          ok: false,
          erro: { codigo, mensagem: known ? err.message : 'Erro interno', detalhes: known && err.details && !err.details.encaminhar ? err.details : undefined, orientacao: ORIENTACAO[codigo] || 'Não foi possível concluir. Não invente informações; ofereça atendimento humano.' },
        };
      } finally {
        metrics.observe('ferramentas_duracao_segundos', { ferramenta: nome }, (Date.now() - started) / 1000);
      }
    },
  };
}
