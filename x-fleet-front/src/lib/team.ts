import { apiFetch, getTenantId } from './socket';

const tenant = () => getTenantId();

export async function listProfiles() {
  const r = await apiFetch(`/api/team/profiles?clientId=${tenant()}`);
  return r.json();
}

export async function upsertProfile(body: any) {
  const r = await apiFetch(`/api/team/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: tenant(), ...body }),
  });
  return r.json();
}

export async function heartbeatPresence(status: 'online'|'away'|'dnd'|'offline'='online') {
  const r = await apiFetch(`/api/team/presence/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: tenant(), userId: 'me', status }),
  });
  return r.json();
}

export async function sendKudos(toUserId: string, emoji?: string, message?: string) {
  const r = await apiFetch(`/api/team/kudos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: tenant(), fromUserId: 'me', toUserId, emoji, message }),
  });
  return r.json();
}