import { Errors } from '../util/errors.js';
import { sha256Hex } from './crypto.js';

// Matriz de permissões — fonte única, espelhada em docs/14-matriz-permissoes.md.
// Papéis: servico_n8n (orquestrador), atendente, supervisor, encarregado_dados (DPO), admin_tecnico.
export const PERMISSIONS = {
  'inbound:process': ['servico_n8n'],
  'turn:process': ['servico_n8n'],
  'tools:execute': ['servico_n8n'],
  'outbound:send': ['servico_n8n'],
  'handoff:create': ['servico_n8n', 'atendente', 'supervisor'],
  'handoff:read': ['atendente', 'supervisor'],
  'handoff:assign': ['atendente', 'supervisor'],
  'handoff:close': ['atendente', 'supervisor'],
  'handoff:reply': ['atendente', 'supervisor'],
  'privacy:create': ['servico_n8n', 'encarregado_dados'],
  'privacy:read': ['encarregado_dados'],
  'privacy:execute': ['encarregado_dados'],
  'legalhold:set': ['encarregado_dados'],
  'knowledge:read': ['servico_n8n', 'atendente', 'supervisor', 'admin_tecnico'],
  'knowledge:write': ['supervisor'],
  'templates:write': ['supervisor', 'admin_tecnico'],
  'jobs:run': ['servico_n8n', 'admin_tecnico'],
  'ops:read': ['servico_n8n', 'admin_tecnico', 'supervisor'],
  'ops:report_error': ['servico_n8n'],
  'metrics:read': ['admin_tecnico', 'servico_n8n'],
};

export const ROLES = ['servico_n8n', 'atendente', 'supervisor', 'encarregado_dados', 'admin_tecnico'];

// Tokens configurados como hash SHA-256: a configuração nunca contém o token em claro.
export function authenticate(headers, serviceTokens) {
  const auth = headers['authorization'];
  if (!auth || !/^Bearer\s+\S{24,}$/.test(auth)) throw Errors.unauthorized();
  const token = auth.replace(/^Bearer\s+/, '');
  const entry = serviceTokens[sha256Hex(token)];
  if (!entry || !ROLES.includes(entry.papel)) throw Errors.unauthorized();
  return { papel: entry.papel, ator: entry.ator || entry.papel };
}

export function authorize(principal, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Permissão desconhecida: ${permission}`);
  if (!principal || !allowed.includes(principal.papel)) throw Errors.forbidden();
}
