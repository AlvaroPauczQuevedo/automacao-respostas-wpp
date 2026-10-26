import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// Criptografia de campo AES-256-GCM com identificação de chave (permite rotação).
// Formato: v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>
export function createFieldCrypto({ key, keyId = 'k1', oldKeys = {}, allowInsecureDev = false }) {
  const keys = new Map();
  const decode = (b64) => {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== 32) throw new Error('Chave de criptografia deve ter 32 bytes (base64)');
    return buf;
  };
  if (key) keys.set(keyId, decode(key));
  for (const [id, k] of Object.entries(oldKeys || {})) keys.set(id, decode(k));
  if (!key) {
    if (!allowInsecureDev) throw new Error('DATA_ENCRYPTION_KEY obrigatória');
    // Somente desenvolvimento/testes: chave efêmera por processo (dados não sobrevivem a reinício).
    keys.set(keyId, randomBytes(32));
  }
  const current = keys.get(keyId);

  return {
    currentKeyId: keyId,
    encrypt(plain) {
      if (plain === null || plain === undefined) return null;
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', current, iv);
      const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return ['v1', keyId, iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
    },
    decrypt(token) {
      if (token === null || token === undefined) return null;
      const [v, id, iv, tag, data] = String(token).split('.');
      if (v !== 'v1' || !keys.has(id)) throw new Error('Formato ou chave de criptografia desconhecidos');
      const d = createDecipheriv('aes-256-gcm', keys.get(id), Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
    },
    encryptJson(obj) {
      return obj == null ? null : this.encrypt(JSON.stringify(obj));
    },
    decryptJson(token) {
      return token == null ? null : JSON.parse(this.decrypt(token));
    },
  };
}

// Pseudonimização estável (HMAC com pepper secreto) para buscas sem guardar o telefone em claro.
export function createHasher({ pepper, allowInsecureDev = false }) {
  const p = pepper || (allowInsecureDev ? randomBytes(32).toString('hex') : null);
  if (!p) throw new Error('HASH_PEPPER obrigatório');
  return (value) => createHmac('sha256', p).update(String(value)).digest('hex');
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
