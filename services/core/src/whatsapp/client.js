import { fetchWithTimeout } from '../util/retry.js';
import { classifyWhatsAppError, WhatsAppSendError } from './errors.js';
import { randomBytes } from 'node:crypto';

// Monta o corpo de envio da Cloud API a partir de uma mensagem interna.
// Tipos internos: texto | botoes | modelo
export function buildPayload(to, msg) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (msg.tipo === 'texto') return { ...base, type: 'text', text: { body: msg.texto.slice(0, 4096), preview_url: false } };
  if (msg.tipo === 'botoes') {
    return {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: msg.texto.slice(0, 1024) },
        action: { buttons: msg.botoes.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.titulo.slice(0, 20) } })) },
      },
    };
  }
  if (msg.tipo === 'modelo') {
    return {
      ...base,
      type: 'template',
      template: {
        name: msg.modelo.nome,
        language: { code: msg.modelo.idioma },
        components: msg.modelo.parametros?.length ? [{ type: 'body', parameters: msg.modelo.parametros.map((p) => ({ type: 'text', text: String(p) })) }] : [],
      },
    };
  }
  throw new Error(`Tipo de mensagem não suportado: ${msg.tipo}`);
}

export function createCloudClient({ graphBaseUrl, graphApiVersion, phoneNumberId, accessToken, timeoutMs = 10000 }) {
  const url = `${graphBaseUrl.replace(/\/+$/, '')}/${graphApiVersion}/${phoneNumberId}/messages`;
  return {
    simulated: false,
    async send(to, msg) {
      let res;
      try {
        res = await fetchWithTimeout(
          url,
          { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(buildPayload(to, msg)) },
          timeoutMs,
        );
      } catch {
        // Rede/timeout: o envio PODE ter ocorrido. A deduplicação local impede reenvio automático duplicado
        // da mesma chave; a retentativa reutiliza a mesma chave e é limitada.
        throw new WhatsAppSendError('timeout', 'transitorio', 0);
      }
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* corpo vazio */
      }
      if (!res.ok) {
        const code = body?.error?.code ?? res.status;
        throw new WhatsAppSendError(code, res.status >= 500 ? 'transitorio' : classifyWhatsAppError(code), res.status);
      }
      const wamid = body?.messages?.[0]?.id;
      if (!wamid) throw new WhatsAppSendError('sem_id', 'permanente', res.status);
      return { wamid };
    },
  };
}

// Cliente SIMULADO: registra o envio em memória. Permite injetar erros por código.
export function createMockWhatsAppClient() {
  const sent = [];
  const queue = [];
  return {
    simulated: true,
    sent,
    failNext(code, times = 1) {
      for (let i = 0; i < times; i++) queue.push(code);
    },
    async send(to, msg) {
      if (queue.length) {
        const code = queue.shift();
        throw new WhatsAppSendError(code, classifyWhatsAppError(code), 400);
      }
      const payload = buildPayload(to, msg);
      const wamid = `wamid.SIMULADO.${randomBytes(8).toString('hex')}`;
      sent.push({ to, msg, payload, wamid });
      return { wamid };
    },
  };
}
