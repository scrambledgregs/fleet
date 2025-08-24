// x-fleet-back/lib/repos/chat.ts
import { normalizeTenantId, TenantId } from './memory';

export type Channel = {
  id: string;
  clientId: TenantId;
  name: string;
  topic?: string;
  createdAt: string;
  lastMessageAt?: string | null;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  attachments?: any[];
  at: string;          // ISO
  system?: boolean;    // system post flag
};

// ---- Config ----
export const DEFAULT_CHANNEL_NAME = 'homebase';

// In-memory stores
const channelsByClient = new Map<TenantId, Map<string, Channel>>();
const messagesByChannel = new Map<string, ChatMessage[]>();

function nowISO() { return new Date().toISOString(); }
function newId(prefix: string) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

function getChanBag(t: TenantId) {
  if (!channelsByClient.has(t)) channelsByClient.set(t, new Map());
  return channelsByClient.get(t)!;
}

// ---- Queries ----
export function listChannels(clientId?: string): Channel[] {
  const t = normalizeTenantId(clientId);
  const bag = channelsByClient.get(t) || new Map();
  return Array.from(bag.values()).sort((a, b) => {
    const ta = new Date(a.lastMessageAt || a.createdAt).getTime();
    const tb = new Date(b.lastMessageAt || b.createdAt).getTime();
    return tb - ta;
  });
}

export function listMessages(_clientId: string | undefined, channelId: string): ChatMessage[] {
  return messagesByChannel.get(channelId) || [];
}

// ---- Mutations ----
export function createChannel(
  io: { emit: (ch: string, p: any) => void },
  clientId: string | undefined,
  name: string,
  topic?: string
): Channel {
  const t = normalizeTenantId(clientId);
  const bag = getChanBag(t);

  // return existing by name if present (case-insensitive)
  for (const c of bag.values()) {
    if (c.name.toLowerCase() === name.toLowerCase()) return c;
  }

  const ch: Channel = {
    id: newId('chn'),
    clientId: t,
    name,
    topic,
    createdAt: nowISO(),
    lastMessageAt: null,
  };
  bag.set(ch.id, ch);

  try { io.emit('chat:channel:created', { channel: ch }); } catch {}
  return ch;
}

/** Ensure we have a default company-wide channel called "homebase". */
export function ensureHomebaseChannel(
  io: { emit: (ch: string, p: any) => void },
  clientId: string | undefined
): Channel {
  const t = normalizeTenantId(clientId);
  const bag = getChanBag(t);
  for (const c of bag.values()) {
    if (c.name.toLowerCase() === DEFAULT_CHANNEL_NAME) return c;
  }
  return createChannel(io, t, DEFAULT_CHANNEL_NAME, 'Company-wide chat');
}

// Backward-compat alias (if anything still imports ensureGeneralChannel)
export const ensureGeneralChannel = ensureHomebaseChannel;

export function addMessage(
  io: { emit: (ch: string, p: any) => void },
  clientId: string | undefined,
  channelId: string,
  msg: Omit<ChatMessage, 'id' | 'at' | 'channelId'>
): ChatMessage {
  const m: ChatMessage = {
    id: newId('msg'),
    channelId,
    userId: msg.userId,
    userName: msg.userName,
    text: msg.text,
    attachments: msg.attachments || [],
    system: msg.system || false,
    at: nowISO(),
  };

  const list = messagesByChannel.get(channelId) || [];
  list.push(m);
  messagesByChannel.set(channelId, list);

  // bump channel activity
  const t = normalizeTenantId(clientId);
  const bag = getChanBag(t);
  const ch = bag.get(channelId);
  if (ch) ch.lastMessageAt = m.at;

  try { io.emit('chat:message', { channelId, message: m }); } catch {}
  return m;
}

export function postSystemMessage(
  io: { emit: (ch: string, p: any) => void },
  clientId: string | undefined,
  channelId: string,
  text: string
): ChatMessage {
  return addMessage(io, clientId, channelId, {
    userId: '_system',
    userName: 'System',
    text,
    attachments: [],
    system: true,
  });
}