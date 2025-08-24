// x-fleet-back/routes/chat.ts
import express from 'express';
import {
  listChannels,
  listMessages,
  createChannel,
  addMessage,
  ensureHomebaseChannel,
} from '../lib/repos/chat';

export function makeChatRouter(io: { emit: (ch: string, p: any) => void; to?: any }) {
  const router = express.Router();

  // Ensure "homebase" exists every time channels are fetched (idempotent)
  router.get('/channels', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    ensureHomebaseChannel(io, clientId);
    return res.json({ ok: true, channels: listChannels(clientId) });
  });

  router.post('/channels', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const name = String(req.body?.name || '').trim();
    const topic = req.body?.topic ? String(req.body.topic) : undefined;
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const channel = createChannel(io, clientId, name, topic);
    return res.status(201).json({ ok: true, channel });
  });

  router.get('/channels/:id/messages', (req, res) => {
    const clientId = String(req.query.clientId || req.header('X-Tenant-Id') || 'default');
    const channelId = String(req.params.id || '').trim();
    return res.json({ ok: true, messages: listMessages(clientId, channelId) });
  });

  router.post('/channels/:id/messages', express.json(), (req, res) => {
    const clientId = String(req.body?.clientId || req.header('X-Tenant-Id') || 'default');
    const channelId = String(req.params.id || '').trim();
    const { userId = 'me', userName = 'Someone', text = '', attachments } = req.body || {};
    const trimmed = String(text || '').trim();
    if (!trimmed) return res.status(400).json({ ok: false, error: 'text required' });

    const m = addMessage(io, clientId, channelId, {
      userId: String(userId),
      userName: String(userName),
      text: trimmed,
      attachments: attachments || [],
    });
    return res.status(201).json({ ok: true, message: m });
  });

  return router;
}