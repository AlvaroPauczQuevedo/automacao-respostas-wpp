// Normalização do payload de webhook da WhatsApp Cloud API.
// Extrai somente o necessário: identificador da mensagem, remetente (wa_id), tipo, texto/resposta interativa
// e carimbo de tempo. Nome de perfil e demais metadados são descartados (minimização).

const MAX_TEXT = 4096;

export function normalizeWebhook(body, { expectedPhoneNumberId, maxTextLength = 2000 } = {}) {
  const result = { mensagens: [], status: [], descartados: [] };
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) {
    result.descartados.push({ motivo: 'objeto_desconhecido' });
    return result;
  }
  for (const entry of body.entry.slice(0, 20)) {
    for (const change of (entry?.changes || []).slice(0, 20)) {
      if (change?.field !== 'messages') {
        result.descartados.push({ motivo: `campo_${String(change?.field).slice(0, 30)}` });
        continue;
      }
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (expectedPhoneNumberId && phoneNumberId !== expectedPhoneNumberId) {
        result.descartados.push({ motivo: 'numero_destino_nao_configurado' });
        continue;
      }
      for (const m of (v.messages || []).slice(0, 50)) {
        const n = normalizeMessage(m, maxTextLength);
        if (n) result.mensagens.push(n);
        else result.descartados.push({ motivo: 'mensagem_malformada' });
      }
      for (const s of (v.statuses || []).slice(0, 100)) {
        if (typeof s?.id !== 'string' || typeof s?.status !== 'string') continue;
        result.status.push({
          evento_id: `status:${s.id}:${s.status}`,
          wamid: s.id,
          estado: mapStatus(s.status),
          instante: toIso(s.timestamp),
          erro_codigo: Array.isArray(s.errors) && s.errors[0]?.code ? String(s.errors[0].code) : null,
        });
      }
    }
  }
  return result;
}

function normalizeMessage(m, maxTextLength) {
  if (!m || typeof m.id !== 'string' || typeof m.from !== 'string' || !/^\d{6,20}$/.test(m.from)) return null;
  const base = { wamid: m.id.slice(0, 200), wa_id: m.from, instante: toIso(m.timestamp), tipo: 'nao_suportado', texto: null, resposta_id: null, truncada: false };
  switch (m.type) {
    case 'text': {
      const raw = String(m.text?.body ?? '').slice(0, MAX_TEXT);
      base.tipo = 'texto';
      base.texto = sanitizeText(raw).slice(0, maxTextLength);
      base.truncada = raw.length > maxTextLength;
      break;
    }
    case 'interactive': {
      const r = m.interactive?.button_reply || m.interactive?.list_reply;
      if (!r?.id) return null;
      base.tipo = 'resposta_interativa';
      base.resposta_id = String(r.id).slice(0, 256);
      base.texto = sanitizeText(String(r.title ?? '')).slice(0, 100);
      break;
    }
    case 'button': {
      // Resposta rápida de modelo (template)
      base.tipo = 'resposta_interativa';
      base.resposta_id = String(m.button?.payload ?? '').slice(0, 256) || null;
      base.texto = sanitizeText(String(m.button?.text ?? '')).slice(0, 100);
      break;
    }
    case 'reaction':
      base.tipo = 'reacao';
      break;
    default:
      // audio, image, video, document, sticker, location, contacts, order, system, unsupported...
      base.tipo = 'nao_suportado';
      base.tipo_original = String(m.type || 'desconhecido').slice(0, 30);
  }
  return base;
}

// Remove caracteres de controle e invisíveis usados para ofuscar injeções; preserva acentos e emojis.
export function sanitizeText(s) {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .trim();
}

function toIso(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

function mapStatus(s) {
  return { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' }[s] || 'enviada';
}
