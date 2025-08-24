import { normalizeTenantId, TenantId } from './memory';

export type TeamSettings = {
  welcomeMessage?: string;      // default text for #homebase
  seedWelcome?: boolean;        // whether to auto-post on bootstrap (default true)
};

const settingsByTenant = new Map<TenantId, TeamSettings>();

export function getTeamSettings(clientId?: string): TeamSettings {
  const t = normalizeTenantId(clientId);
  if (!settingsByTenant.has(t)) settingsByTenant.set(t, {});
  return settingsByTenant.get(t)!;
}

export function updateTeamSettings(clientId: string | undefined, patch: Partial<TeamSettings>): TeamSettings {
  const t = normalizeTenantId(clientId);
  const prev = getTeamSettings(t);
  const next = { ...prev, ...patch };
  settingsByTenant.set(t, next);
  return next;
}