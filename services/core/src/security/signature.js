import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto.js';

// Validação do cabeçalho X-Hub-Signature-256 enviado pela Meta (HMAC-SHA256 do corpo BRUTO com o App Secret).
// O corpo precisa ser o byte-a-byte recebido; reserializar o JSON invalida a assinatura.
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader || typeof signatureHeader !== 'string') return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signatureHeader);
}

export function signForTest(rawBody, appSecret) {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

// Desafio GET de inscrição do webhook (hub.mode / hub.verify_token / hub.challenge).
export function verifySubscription(query, verifyToken) {
  if (!verifyToken) return null;
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] && safeEqual(query['hub.verify_token'], verifyToken)) {
    const ch = String(query['hub.challenge'] ?? '');
    return /^[A-Za-z0-9_-]{1,128}$/.test(ch) ? ch : null;
  }
  return null;
}
