// x-fleet-back/routes/team.ts
import express from 'express';
import {
  listProfiles,
  upsertProfile,
  listPresence,
  setPresence,
  sendKudos,
  setRole,
  muteUser,
  unmuteUser,
  disableUser,
} from '../lib/repos/profiles';
import {
  ensureHomebaseChannel,
  postSystemMessage,
  DEFAULT_CHANNEL_NAME,
} from '../lib/repos/chat';
import { getTeamSettings, updateTeamSettings } from '../lib/repos/teamSettings';

// Minimal actor resolver
function actor(req: express.Request, clientId: string) {
  const userId = String(
    req.header('X-User-Id') || req.body?.actorId || req.query.actorId || 'me',
  );
  const me =
    listProfiles(clientId).find((p) => p.userId === userId) || { userId, role: 'owner' as const };
  return me;
}
function requireAdmin(me: any) {
  return me.role === 'owner' || me.role === 'admin';
}
function requireOwner(me: any) {
  return me.role === 'owner';
}

export function makeTeamRouter(io: { emit: (ch: string, p: any) => void; to?: any }) {
  const router = express.Router();

  // ---- Team settings (read/update) ----
  router.get('/settings', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    const settings = getTeamSettings(clientId);
    return res.json({ ok: true, settings });
  });

  router.post('/settings', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireAdmin(me)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const settings = updateTeamSettings(clientId, {
      welcomeMessage:
        typeof req.body?.welcomeMessage === 'string' ? req.body.welcomeMessage : undefined,
      seedWelcome:
        typeof req.body?.seedWelcome === 'boolean' ? req.body.seedWelcome : undefined,
    });
    return res.json({ ok: true, settings });
  });

  // ---- Post welcome to #homebase now (manual trigger) ----
  router.post('/welcome', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireAdmin(me)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const custom = (req.body?.message || '').trim();
    const { welcomeMessage } = getTeamSettings(clientId);
    const text = custom || welcomeMessage || `Welcome to #${DEFAULT_CHANNEL_NAME}! 🎉`;

    const ch = ensureHomebaseChannel(io, clientId);
    postSystemMessage(io, clientId, ch.id, text);
    return res.status(201).json({ ok: true, posted: true });
  });

  // ---- Profiles ----
  router.get('/profiles', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    res.json({ ok: true, clientId, profiles: listProfiles(clientId) });
  });

  router.post('/profiles', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const userId = String(req.body?.userId || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

    const beforeCount = listProfiles(clientId).length;
    const profile = upsertProfile(io, clientId, userId, req.body?.patch || req.body || {});
    res.json({ ok: true, profile });

    // If this is the first teammate created via this endpoint, ensure channel and (optionally) post welcome.
    if (beforeCount === 0) {
      const ch = ensureHomebaseChannel(io, clientId);
      if (ch?.id) {
        const settings = getTeamSettings(clientId);
        if (settings.seedWelcome !== false) {
          const welcomeFromBody =
            typeof req.body?.welcomeMessage === 'string' ? req.body.welcomeMessage.trim() : '';
          const welcomeText =
            welcomeFromBody || settings.welcomeMessage || `Welcome to #${DEFAULT_CHANNEL_NAME}! 🎉`;
          postSystemMessage(io, clientId, ch.id, welcomeText);
        }
      }
    }
  });

  router.patch('/profiles/:userId', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const userId = String(req.params.userId || '').trim();
    const profile = upsertProfile(io, clientId, userId, req.body?.patch || req.body || {});
    res.json({ ok: true, profile });
  });

  // ---- Presence ----
  router.get('/presence', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    res.json({ ok: true, clientId, items: listPresence(clientId) });
  });

  router.post('/presence/heartbeat', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const userId = String(req.body?.userId || '').trim();
    const status = (req.body?.status || 'online') as 'online' | 'away' | 'dnd' | 'offline';
    if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
    const p = setPresence(io, clientId, userId, status);
    res.json({ ok: true, presence: p });
  });

  // ---- Kudos ----
  router.post('/kudos', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const { fromUserId, toUserId, emoji, message } = req.body || {};
    if (!fromUserId || !toUserId)
      return res.status(400).json({ ok: false, error: 'fromUserId & toUserId required' });
    const k = sendKudos(
      io,
      clientId,
      String(fromUserId),
      String(toUserId),
      emoji,
      message,
    );
    res.json({ ok: true, kudos: k });
  });

  // ---- Easy bootstrap from Settings (customizable welcome) ----
  router.post('/bootstrap', express.json(), async (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireAdmin(me)) return res.status(403).json({ ok: false, error: 'forbidden' });

    const members: Array<{
      userId: string;
      name: string;
      title?: string;
      role?: any;
    }> = req.body?.members || [];

    // Optional settings capture during bootstrap
    if (req.body?.welcomeMessage != null || req.body?.seedWelcome != null) {
      updateTeamSettings(clientId, {
        welcomeMessage:
          typeof req.body.welcomeMessage === 'string' ? req.body.welcomeMessage : undefined,
        seedWelcome:
          typeof req.body.seedWelcome === 'boolean' ? req.body.seedWelcome : undefined,
      });
    }

    // Optional flags/overrides (respect saved settings if not overridden in the request)
    const saved = getTeamSettings(clientId);
    const seedWelcome: boolean =
      req.body?.seedWelcome !== undefined ? !!req.body.seedWelcome : saved.seedWelcome ?? true;
    const welcomeMessage: string =
      (typeof req.body?.welcomeMessage === 'string' && req.body.welcomeMessage.trim()) ||
      saved.welcomeMessage ||
      `Team is set up. Say hi in #${DEFAULT_CHANNEL_NAME}! 👋`;

    for (const m of members) {
      upsertProfile(io, clientId, m.userId, {
        name: m.name,
        title: m.title,
        role: m.role || 'member',
      });
    }

    const ch = ensureHomebaseChannel(io, clientId);
    if (ch?.id && seedWelcome) {
      postSystemMessage(io, clientId, ch.id, welcomeMessage);
    }

    res.status(201).json({ ok: true });
  });

  // ---- Admin actions ----
  router.post('/profiles/:userId/role', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireOwner(me)) return res.status(403).json({ ok: false, error: 'owner_only' });
    const profile = setRole(clientId, req.params.userId, req.body?.role);
    if (!profile) return res.status(404).json({ ok: false, error: 'not_found' });
    return res.json({ ok: true, profile });
  });

  router.post('/profiles/:userId/mute', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireAdmin(me)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const duration = Number(req.body?.minutes || 60);
    const until = new Date(Date.now() + duration * 60_000).toISOString();
    const profile = muteUser(clientId, req.params.userId, until);
    if (!profile) return res.status(404).json({ ok: false, error: 'not_found' });
    io.emit('profile:updated', { clientId, profile });
    return res.json({ ok: true, profile });
  });

  router.post('/profiles/:userId/unmute', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireAdmin(me)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const profile = unmuteUser(clientId, req.params.userId);
    if (!profile) return res.status(404).json({ ok: false, error: 'not_found' });
    io.emit('profile:updated', { clientId, profile });
    return res.json({ ok: true, profile });
  });

  router.delete('/profiles/:userId', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    const me = actor(req, clientId);
    if (!requireOwner(me)) return res.status(403).json({ ok: false, error: 'owner_only' });
    const profile = disableUser(clientId, req.params.userId, true);
    if (!profile) return res.status(404).json({ ok: false, error: 'not_found' });
    io.emit('profile:updated', { clientId, profile });
    return res.json({ ok: true });
  });

  return router;
}