import { newId } from '../util/ids.js';
import { redactObject } from '../security/redact.js';

// Registro de auditoria: quem fez o quê, em qual recurso, com qual resultado.
// Nunca armazena conteúdo de mensagens nem dados pessoais — apenas identificadores internos opacos.
export function createAudit({ repo, logger, now = () => new Date() }) {
  return async function audit({ ator, operacao, recurso, resultado, correlacao, detalhes }) {
    const rec = {
      id: newId('aud'),
      ator: String(ator || 'desconhecido').slice(0, 80),
      operacao: String(operacao).slice(0, 80),
      recurso: recurso ? String(recurso).slice(0, 120) : null,
      resultado: String(resultado).slice(0, 40),
      instante: now().toISOString(),
      identificador_correlacao: correlacao || null,
      detalhes: detalhes ? redactObject(detalhes) : null,
    };
    try {
      await repo.insertAudit(rec);
    } catch (err) {
      // Falha de auditoria não pode ser silenciosa: registra e propaga para operações críticas.
      logger.error('falha_ao_registrar_auditoria', { operacao: rec.operacao, err });
      throw err;
    }
    return rec.id;
  };
}
