import { Errors } from '../../util/errors.js';
import { withRetry } from '../../util/retry.js';
import {
  assertValid,
  availabilitySchema,
  bookingDetailsSchema,
  bookingResultSchema,
  cancellationQuoteSchema,
  cancellationResultSchema,
  modificationQuoteSchema,
  modificationResultSchema,
  requirementsSchema,
} from './schemas.js';

/**
 * Contrato da camada de integração hoteleira.
 * Cada PMS/motor de reservas ganha um "driver" que implementa as operações que realmente suporta
 * e declara suas capacidades. Este invólucro aplica: verificação de capacidade, retentativas
 * apenas em operações idempotentes/seguras, validação de resposta e métricas.
 *
 * Capacidades possíveis:
 *   disponibilidade, requisitos_reserva, pre_reserva, reserva, busca_por_idempotencia,
 *   consulta_reserva, cotacao_cancelamento, cancelamento, cotacao_alteracao, alteracao
 */
export function wrapHotelDriver(driver, { metrics, logger, retries = 2, sleep }) {
  const caps = new Set(driver.capabilities || []);
  const name = driver.name;

  const call = async (op, fn, { idempotent }) => {
    const started = Date.now();
    try {
      const out = await withRetry(fn, {
        retries: idempotent ? retries : 0,
        sleep,
        onRetry: (err, attempt) => logger.warn('retentativa_integracao_hoteleira', { op, attempt, codigo: err.code }),
      });
      metrics?.inc('hotel_integracao_chamadas_total', { driver: name, op, resultado: 'ok' });
      return out;
    } catch (err) {
      metrics?.inc('hotel_integracao_chamadas_total', { driver: name, op, resultado: err.code || 'erro' });
      throw err.code ? err : Errors.upstream('Falha na integração hoteleira', true);
    } finally {
      metrics?.observe('hotel_integracao_duracao_segundos', { driver: name, op }, (Date.now() - started) / 1000);
    }
  };
  const need = (cap) => {
    if (!caps.has(cap)) throw Errors.notSupported(`Operação "${cap}" não suportada pela integração ${name}`);
  };

  return {
    name,
    simulated: Boolean(driver.simulated),
    capabilities: [...caps],
    supports: (cap) => caps.has(cap),

    async searchAvailability(q) {
      need('disponibilidade');
      return call('disponibilidade', async () => assertValid(availabilitySchema, await driver.searchAvailability(q), 'disponibilidade'), { idempotent: true });
    },
    async getBookingRequirements(q) {
      if (!caps.has('requisitos_reserva')) return { campos: ['nome', 'sobrenome', 'email'] }; // mínimo documentado; revisar com o PMS real
      return call('requisitos_reserva', async () => assertValid(requirementsSchema, await driver.getBookingRequirements(q), 'requisitos'), { idempotent: true });
    },
    // Criação de reserva: NÃO é retentada automaticamente aqui. A recuperação é por busca via chave de idempotência.
    async createBooking(req) {
      need('reserva');
      if (!req.idempotencyKey) throw new Error('idempotencyKey obrigatória');
      return call('reserva', async () => assertValid(bookingResultSchema, await driver.createBooking(req), 'reserva'), { idempotent: false });
    },
    async findBookingByIdempotencyKey(key) {
      need('busca_por_idempotencia');
      return call(
        'busca_por_idempotencia',
        async () => {
          const r = await driver.findBookingByIdempotencyKey(key);
          return r === null ? null : assertValid(bookingResultSchema, r, 'busca_idempotencia');
        },
        { idempotent: true },
      );
    },
    async getBooking(codigo) {
      need('consulta_reserva');
      return call(
        'consulta_reserva',
        async () => {
          const r = await driver.getBooking(codigo);
          return r === null ? null : assertValid(bookingDetailsSchema, r, 'consulta_reserva');
        },
        { idempotent: true },
      );
    },
    async quoteCancellation(codigo) {
      need('cotacao_cancelamento');
      return call('cotacao_cancelamento', async () => assertValid(cancellationQuoteSchema, await driver.quoteCancellation(codigo), 'cotacao_cancelamento'), { idempotent: true });
    },
    async cancelBooking(req) {
      need('cancelamento');
      return call('cancelamento', async () => assertValid(cancellationResultSchema, await driver.cancelBooking(req), 'cancelamento'), { idempotent: false });
    },
    async quoteModification(req) {
      need('cotacao_alteracao');
      return call('cotacao_alteracao', async () => assertValid(modificationQuoteSchema, await driver.quoteModification(req), 'cotacao_alteracao'), { idempotent: true });
    },
    async modifyBooking(req) {
      need('alteracao');
      return call('alteracao', async () => assertValid(modificationResultSchema, await driver.modifyBooking(req), 'alteracao'), { idempotent: false });
    },
    async health() {
      try {
        await driver.health();
        return { ok: true };
      } catch (err) {
        return { ok: false, codigo: err.code || 'erro' };
      }
    },
  };
}
