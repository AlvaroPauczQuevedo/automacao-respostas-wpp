// Notificador de e-mail para a verificação reforçada (link enviado ao e-mail registrado na reserva).
// O e-mail de destino vem do PMS e nunca é exibido no chat nem enviado ao modelo de IA.
import { fetchWithTimeout } from '../../util/retry.js';
import { Errors } from '../../util/errors.js';

export function createMockNotifier() {
  const sent = [];
  return {
    simulated: true,
    sent,
    async sendVerificationLink({ to, link, finalidade }) {
      sent.push({ to, link, finalidade, at: new Date().toISOString() });
      return { ok: true };
    },
  };
}

// Encaminha para um serviço de e-mail transacional da rede (via webhook/n8n). Contrato: POST JSON.
export function createWebhookNotifier({ url, token, timeoutMs = 8000 }) {
  if (!url) throw new Error('NOTIFY_EMAIL_WEBHOOK_URL obrigatório');
  return {
    simulated: false,
    async sendVerificationLink({ to, link, finalidade }) {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ tipo: 'verificacao_reforcada', para: to, link, finalidade }),
        },
        timeoutMs,
      ).catch(() => {
        throw Errors.upstream('Falha ao acionar serviço de e-mail', true);
      });
      if (!res.ok) throw Errors.upstream(`Serviço de e-mail respondeu ${res.status}`, res.status >= 500);
      return { ok: true };
    },
  };
}
