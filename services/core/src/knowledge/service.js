import { normalize } from '../repo/memory.js';
import { todayInZone } from '../util/dates.js';

// Base de conhecimento: somente conteúdo PUBLICADO e VIGENTE.
// Política específica do hotel prevalece sobre a geral da rede; conflito entre duas políticas
// do mesmo nível é sinalizado (não escolhemos arbitrariamente) → o agente deve encaminhar.
export function createKnowledgeService({ repo, now = () => new Date() }) {
  const hoje = () => todayInZone('America/Sao_Paulo', now());

  const publicHotel = (h) => ({
    hotel_id: h.id,
    nome: h.nome,
    cidade: h.cidade,
    uf: h.uf,
    endereco: h.endereco,
    telefone: h.telefone,
    categoria: h.categoria,
    descricao: h.descricao,
    checkin: h.checkin_horario,
    checkout: h.checkout_horario,
    acessibilidade: h.acessibilidade,
    atualizado_em: h.atualizado_em,
    fonte: h.fonte_oficial,
    ...(h.dados_simulados ? { aviso: 'DADOS SIMULADOS — ambiente de teste' } : {}),
  });

  return {
    async listHotels({ cidade } = {}) {
      const hs = await repo.listHotels({ cidade });
      return hs.map((h) => ({ hotel_id: h.id, nome: h.nome, cidade: h.cidade, uf: h.uf, categoria: h.categoria, ...(h.dados_simulados ? { aviso: 'DADOS SIMULADOS' } : {}) }));
    },
    async hotelDetails(hotelId) {
      const h = await repo.getHotel(hotelId);
      if (!h || h.status !== 'ativo') return null;
      const acomodacoes = await repo.listAccommodations(hotelId);
      return {
        ...publicHotel(h),
        acomodacoes: acomodacoes.map((a) => ({ tipo: a.tipo, capacidade_adultos: a.capacidade_adultos, capacidade_criancas: a.capacidade_criancas, capacidade_total: a.capacidade_total, descricao: a.descricao })),
      };
    },
    async amenities(hotelId) {
      const h = await repo.getHotel(hotelId);
      if (!h) return null;
      return { hotel_id: h.id, comodidades: h.comodidades || [], acessibilidade: h.acessibilidade || null, atualizado_em: h.atualizado_em, fonte: h.fonte_oficial };
    },
    async policies({ hotelId, categoria }) {
      const ps = await repo.listPolicies({ hotelId: hotelId ?? null, categoria, data: hoje() });
      const porCategoria = new Map();
      for (const p of ps) {
        const list = porCategoria.get(p.categoria) || [];
        list.push(p);
        porCategoria.set(p.categoria, list);
      }
      const resultado = [];
      const conflitos = [];
      for (const [cat, list] of porCategoria) {
        const especificas = list.filter((p) => p.hotel_id !== null);
        const escolhidas = especificas.length ? especificas : list.filter((p) => p.hotel_id === null);
        if (escolhidas.length > 1) {
          conflitos.push(cat);
          continue;
        }
        const p = escolhidas[0];
        resultado.push({
          categoria: cat,
          abrangencia: p.hotel_id ? 'hotel' : 'rede',
          titulo: p.titulo,
          descricao: p.descricao,
          vigencia_inicio: p.vigencia_inicio,
          vigencia_fim: p.vigencia_fim,
          fonte: p.fonte,
          atualizado_em: p.atualizado_em,
        });
      }
      return { politicas: resultado, conflitos, requer_validacao_humana: conflitos.length > 0 };
    },
    async faq({ hotelId, pergunta }) {
      const termos = [...new Set(normalize(pergunta).split(/[^a-z0-9]+/).filter((w) => w.length >= 3))].slice(0, 20);
      if (!termos.length) return [];
      const fs = await repo.searchFaq({ hotelId: hotelId ?? null, termos, data: hoje() });
      return fs.slice(0, 5).map((f) => ({ pergunta: f.pergunta, resposta: f.resposta, abrangencia: f.hotel_id ? 'hotel' : 'rede', fonte: f.fonte, atualizado_em: f.atualizado_em }));
    },
  };
}
