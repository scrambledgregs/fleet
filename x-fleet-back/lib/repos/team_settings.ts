import { normalizeTenantId, TenantId } from './memory';

export type TeamSettings = {
  welcomeMessage: string;
  seedWelcome: boolean;
};

const byClient = new Map<TenantId, TeamSettings>();

export function getTeamSettings(clientId?: string): TeamSettings {
  const t = normalizeTenantId(clientId);
  if (!byClient.has(t)) {
    byClient.set(t, { welcomeMessage: 'Welcome to #homebase! 🎉', seedWelcome: true });
  }
  return byClient.get(t)!;
}

export function setTeamSettings(clientId: string | undefined, patch: Partial<TeamSettings>): TeamSettings {
  const t = normalizeTenantId(clientId);
  const cur = getTeamSettings(t);
  const next = { ...cur, ...patch };
  byClient.set(t, next);
  return next;
}