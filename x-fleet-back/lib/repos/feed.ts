// Thin in-memory feed (posts, comments, reactions) per tenant.

import { normalizeTenantId, TenantId } from './memory';

export type Post = {
  id: string;
  userId: string;
  userName: string;
  text: string;
  channelId?: string | null;
  attachments?: any[];
  at: string; // ISO
  comments: Comment[];
  // Internal: reactions are stored as sets; we sanitize on output
  _reactions: Record<string, Set<string>>;
};

export type Comment = {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  text: string;
  at: string; // ISO
};

export type PublicPost = Omit<Post, '_reactions'> & {
  reactions: Record<string, number>; // emoji -> count
};

const feedByClient = new Map<TenantId, Post[]>();

function nowISO() {
  return new Date().toISOString();
}

function sanitize(p: Post): PublicPost {
  const reactions: Record<string, number> = {};
  for (const [emoji, s] of Object.entries(p._reactions)) reactions[emoji] = s.size;
  const { _reactions, ...rest } = p;
  return { ...rest, reactions };
}

export function listFeed(
  clientId: string | undefined,
  opts: { channelId?: string | null; before?: string; limit?: number } = {}
): PublicPost[] {
  const t = normalizeTenantId(clientId);
  const all = feedByClient.get(t) || [];
  let filtered = opts.channelId ? all.filter(p => p.channelId === opts.channelId) : all.slice();
  // newest first
  filtered.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  if (opts.before) {
    const cutoff = +new Date(opts.before);
    filtered = filtered.filter(p => +new Date(p.at) < cutoff);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return filtered.slice(0, limit).map(sanitize);
}

export function addPost(
  clientId: string | undefined,
  body: Partial<Omit<Post, 'id' | 'comments' | '_reactions' | 'at'>>
): PublicPost {
  const t = normalizeTenantId(clientId);
  const list = feedByClient.get(t) || [];
  feedByClient.set(t, list);

  const post: Post = {
    id: 'post_' + Math.random().toString(36).slice(2),
    userId: String(body.userId || 'me'),
    userName: String(body.userName || 'You'),
    text: String(body.text || '').trim(),
    channelId: (body.channelId as string | null) ?? null,
    attachments: body.attachments || [],
    at: nowISO(),
    comments: [],
    _reactions: {},
  };
  list.unshift(post);
  return sanitize(post);
}

export function addComment(
  clientId: string | undefined,
  postId: string,
  body: Partial<Omit<Comment, 'id' | 'postId' | 'at'>>
): Comment | null {
  const t = normalizeTenantId(clientId);
  const list = feedByClient.get(t) || [];
  const p = list.find(x => x.id === postId);
  if (!p) return null;
  const c: Comment = {
    id: 'c_' + Math.random().toString(36).slice(2),
    postId,
    userId: String(body.userId || 'me'),
    userName: String(body.userName || 'You'),
    text: String(body.text || '').trim(),
    at: nowISO(),
  };
  p.comments.push(c);
  return c;
}

export function toggleReaction(
  clientId: string | undefined,
  postId: string,
  userId: string,
  emoji: string
): { emoji: string; count: number; userId: string; added: boolean } | null {
  const t = normalizeTenantId(clientId);
  const list = feedByClient.get(t) || [];
  const p = list.find(x => x.id === postId);
  if (!p) return null;
  const key = emoji || '👍';
  p._reactions[key] = p._reactions[key] || new Set<string>();
  const set = p._reactions[key];
  let added = false;
  if (set.has(userId)) set.delete(userId);
  else {
    set.add(userId);
    added = true;
  }
  return { emoji: key, count: set.size, userId, added };
}