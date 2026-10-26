// ============================================================================
//  DADOS SINTÉTICOS PARA DESENVOLVIMENTO E TESTES — NÃO SÃO DADOS DA REDE.
//  Todos marcados com dados_simulados=true e "(SIMULADO)" nos nomes.
// ============================================================================
const AGORA = '2026-01-01T00:00:00.000Z';
const FONTE = 'SIMULADO: semente de desenvolvimento';

export const SYNTHETIC = {
  hoteis: [
    { id: 'hot_simSP0001', codigo_externo: 'SIM-SP-01', nome: 'Hotel Exemplo Centro (SIMULADO)', cidade: 'São Paulo', uf: 'SP', endereco: 'Endereço fictício, 100 — Centro', telefone: '+55 11 0000-0000 (fictício)', categoria: 'Executivo', descricao: 'Hotel fictício para testes.', comodidades: ['Wi-Fi', 'Café da manhã', 'Academia'], acessibilidade: 'Quartos adaptados (SIMULADO)', checkin_horario: '14:00', checkout_horario: '12:00' },
    { id: 'hot_simFLN001', codigo_externo: 'SIM-FLN-01', nome: 'Hotel Exemplo Praia (SIMULADO)', cidade: 'Florianópolis', uf: 'SC', endereco: 'Endereço fictício, 200 — Praia', telefone: '+55 48 0000-0000 (fictício)', categoria: 'Lazer', descricao: 'Hotel fictício à beira-mar.', comodidades: ['Wi-Fi', 'Piscina', 'Estacionamento'], acessibilidade: null, checkin_horario: '15:00', checkout_horario: '11:00' },
    { id: 'hot_simGRA001', codigo_externo: 'SIM-GRA-01', nome: 'Pousada Exemplo Serra (SIMULADO)', cidade: 'Gramado', uf: 'RS', endereco: 'Endereço fictício, 300 — Serra', telefone: '+55 54 0000-0000 (fictício)', categoria: 'Charme', descricao: 'Pousada fictícia na serra.', comodidades: ['Wi-Fi', 'Lareira'], acessibilidade: null, checkin_horario: '14:00', checkout_horario: '12:00' },
  ],
  acomodacoes: [
    { id: 'aco_simSP0std', hotel_id: 'hot_simSP0001', codigo_externo: 'STD', tipo: 'Standard', capacidade_adultos: 2, capacidade_criancas: 1, capacidade_total: 3, descricao: 'Quarto standard (SIMULADO)' },
    { id: 'aco_simSP0lux', hotel_id: 'hot_simSP0001', codigo_externo: 'LUX', tipo: 'Luxo', capacidade_adultos: 3, capacidade_criancas: 1, capacidade_total: 4, descricao: 'Quarto luxo (SIMULADO)' },
    { id: 'aco_simFLNstd', hotel_id: 'hot_simFLN001', codigo_externo: 'STD', tipo: 'Standard Vista Jardim', capacidade_adultos: 2, capacidade_criancas: 1, capacidade_total: 3, descricao: '(SIMULADO)' },
    { id: 'aco_simFLNfam', hotel_id: 'hot_simFLN001', codigo_externo: 'FAM', tipo: 'Família', capacidade_adultos: 4, capacidade_criancas: 2, capacidade_total: 5, descricao: '(SIMULADO)' },
    { id: 'aco_simGRAchl', hotel_id: 'hot_simGRA001', codigo_externo: 'CHL', tipo: 'Chalé', capacidade_adultos: 2, capacidade_criancas: 2, capacidade_total: 4, descricao: '(SIMULADO)' },
  ],
  politicas: [
    { id: 'pol_simRedeAni', hotel_id: null, categoria: 'animais', titulo: 'Animais de estimação (rede)', descricao: 'SIMULADO: animais de pequeno porte mediante consulta prévia.' },
    { id: 'pol_simSP0Ani', hotel_id: 'hot_simSP0001', categoria: 'animais', titulo: 'Animais (Centro)', descricao: 'SIMULADO: este hotel não aceita animais.' },
    { id: 'pol_simRedeCxl', hotel_id: null, categoria: 'cancelamento', titulo: 'Cancelamento (rede)', descricao: 'SIMULADO: varia conforme a tarifa; consulte a cotação.' },
    { id: 'pol_simRedeCri', hotel_id: null, categoria: 'criancas', titulo: 'Crianças (rede)', descricao: 'SIMULADO: crianças até 5 anos não pagam no mesmo quarto dos pais.' },
    // Duas políticas conflitantes do mesmo nível para testar o tratamento de conflito.
    { id: 'pol_simGRAPg1', hotel_id: 'hot_simGRA001', categoria: 'pagamento', titulo: 'Pagamento v1', descricao: 'SIMULADO: pagamento antecipado.' },
    { id: 'pol_simGRAPg2', hotel_id: 'hot_simGRA001', categoria: 'pagamento', titulo: 'Pagamento v2', descricao: 'SIMULADO: pagamento no check-in.' },
  ],
  faq: [{ id: 'faq_simWifi01', hotel_id: null, pergunta: 'Os hotéis têm Wi-Fi?', resposta: 'SIMULADO: todos os hotéis da rede oferecem Wi-Fi gratuito.', palavras_chave: ['wifi', 'wi-fi', 'internet'] }],
  modelos: [
    { id: 'tpl_simconf01', nome: 'confirmacao_reserva', idioma: 'pt_BR', categoria: 'UTILITY', finalidade: 'operacional', estado: 'aprovado', qtd_parametros: 3, corpo_referencia: 'SIMULADO' },
    { id: 'tpl_simretor1', nome: 'retorno_atendimento', idioma: 'pt_BR', categoria: 'UTILITY', finalidade: 'operacional', estado: 'aprovado', qtd_parametros: 0, corpo_referencia: 'SIMULADO' },
    { id: 'tpl_simpend01', nome: 'atualizacao_reserva', idioma: 'pt_BR', categoria: 'UTILITY', finalidade: 'operacional', estado: 'pendente', qtd_parametros: 1, corpo_referencia: 'SIMULADO' },
    { id: 'tpl_simpromo1', nome: 'promocao_exemplo', idioma: 'pt_BR', categoria: 'MARKETING', finalidade: 'marketing', estado: 'aprovado', qtd_parametros: 0, corpo_referencia: 'SIMULADO' },
  ],
};

export async function seedSynthetic(repo) {
  for (const h of SYNTHETIC.hoteis) {
    await repo.upsertHotel({ ...h, pais: 'BR', email_contato: null, fuso_horario: 'America/Sao_Paulo', status: 'ativo', estado_publicacao: 'publicado', fonte_oficial: FONTE, responsavel_atualizacao: 'seed', dados_simulados: true, criado_em: AGORA, atualizado_em: AGORA });
  }
  for (const a of SYNTHETIC.acomodacoes) await repo.upsertAccommodation({ ...a, comodidades: [], status: 'ativo', fonte_oficial: FONTE, atualizado_em: AGORA });
  for (const p of SYNTHETIC.politicas) await repo.upsertPolicy({ ...p, vigencia_inicio: '2026-01-01', vigencia_fim: null, fonte: FONTE, responsavel: 'seed', estado_publicacao: 'publicado', dados_simulados: true, atualizado_em: AGORA });
  for (const f of SYNTHETIC.faq) await repo.upsertFaq({ ...f, fonte: FONTE, responsavel: 'seed', estado_publicacao: 'publicado', vigencia_inicio: null, vigencia_fim: null, dados_simulados: true, atualizado_em: AGORA });
  for (const m of SYNTHETIC.modelos) await repo.upsertTemplate({ ...m, atualizado_em: AGORA });
}
