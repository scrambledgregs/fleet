// x-fleet-front/src/pages/TeamFeed.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { getTenantId, getSocket, apiFetch } from '../lib/socket';

type PostKind = 'post' | 'kudos' | 'announcement';

type Comment = {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  text: string;
  at: string; // ISO
};

type Post = {
  id: string;
  userId: string;
  userName: string;
  kind: PostKind;
  text: string;
  at: string; // ISO
  channelId?: string | null;
  comments: Comment[];
  reactions: Record<string, string[]>; // emoji -> array of userIds
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function TeamFeed() {
  const clientId = useMemo(() => getTenantId(), []);
  const socket = useMemo(() => getSocket(clientId), [clientId]);

  const [items, setItems] = useState<Post[]>([]);
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<PostKind>('post');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  async function load(before?: string) {
    const r = await apiFetch(
      `/api/team/feed?clientId=${clientId}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    );
    const j = await r.json();
    if (j?.ok && Array.isArray(j.items)) setItems(j.items as Post[]);
  }

  useEffect(() => {
    load();

    const onPost = (p: { post: Post }) => {
      if (!p?.post) return;
      setItems(prev => [p.post, ...prev]);
    };
    const onComment = (p: { postId: string; comment: Comment }) => {
      if (!p?.postId || !p?.comment) return;
      setItems(prev =>
        prev.map(x => (x.id === p.postId ? { ...x, comments: [...(x.comments || []), p.comment] } : x))
      );
    };
    const onReaction = (p: { postId: string; emoji: string; userId: string }) => {
      if (!p?.postId || !p?.emoji || !p?.userId) return;
      setItems(prev =>
        prev.map(x => {
          if (x.id !== p.postId) return x;
          const reactions = { ...(x.reactions || {}) };
          const arr = [...(reactions[p.emoji] || [])];
          const i = arr.indexOf(p.userId);
          if (i === -1) arr.push(p.userId);
          else arr.splice(i, 1);
          reactions[p.emoji] = arr;
          return { ...x, reactions };
        })
      );
    };

    socket.on('feed:post', onPost);
    socket.on('feed:comment', onComment);
    socket.on('feed:reaction', onReaction);
    return () => {
      socket.off('feed:post', onPost);
      socket.off('feed:comment', onComment);
      socket.off('feed:reaction', onReaction);
    };
  }, [clientId, socket]);

  async function publish() {
    const text = draft.trim();
    if (!text) return;
    const r = await apiFetch('/api/team/feed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId,
        userId: 'me',
        userName: 'You',
        kind,
        text,
      }),
    });
    const j = await r.json();
    if (j?.ok) setDraft('');
  }

  async function addComment(postId: string) {
    const text = (commentDrafts[postId] || '').trim();
    if (!text) return;
    const r = await apiFetch(`/api/team/feed/${encodeURIComponent(postId)}/comment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, userId: 'me', userName: 'You', text }),
    });
    const j = await r.json();
    if (j?.ok) {
      setCommentDrafts(d => ({ ...d, [postId]: '' }));
    }
  }

  async function react(postId: string, emoji: string) {
    await apiFetch(`/api/team/feed/${encodeURIComponent(postId)}/react`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, userId: 'me', emoji }),
    });
  }

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-0 flex-col bg-zinc-950 text-zinc-100">
      {/* Composer */}
      <div className="border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3 backdrop-blur">
        <div className="flex items-start gap-3">
          <select
            value={kind}
            onChange={e => setKind(e.target.value as PostKind)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-sm"
          >
            <option value="post">Post</option>
            <option value="kudos">Kudos</option>
            <option value="announcement">Announcement</option>
          </select>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm placeholder:text-zinc-500"
            rows={2}
            placeholder={
              kind === 'kudos'
                ? "Shout someone out…"
                : kind === 'announcement'
                ? "Share an update…"
                : "What's happening?"
            }
          />
          <button
            onClick={publish}
            className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 text-sm font-medium shadow hover:brightness-110 disabled:opacity-50"
            disabled={!draft.trim()}
          >
            Post
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {!items.length && (
          <div className="text-sm text-zinc-500">No posts yet. Be the first to share something!</div>
        )}

        <ul className="space-y-4">
          {items.map(p => (
            <li key={p.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-zinc-700/70" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{p.userName || 'Someone'}</div>
                    <div className="text-xs text-zinc-400">{fmt(p.at)}</div>
                    {p.kind !== 'post' && (
                      <span className="ml-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {p.kind}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-100">{p.text}</div>

                  {/* Reactions */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(['👍', '🎉', '👏', '❤️', '🚀'] as const).map(emo => {
                      const count = (p.reactions?.[emo] || []).length;
                      const mine = (p.reactions?.[emo] || []).includes('me');
                      return (
                        <button
                          key={emo}
                          onClick={() => react(p.id, emo)}
                          className={[
                            'rounded-full border px-2 py-0.5 text-xs',
                            mine ? 'border-orange-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-800/60',
                          ].join(' ')}
                          title={mine ? 'You reacted' : 'React'}
                        >
                          {emo} {count || ''}
                        </button>
                      );
                    })}
                  </div>

                  {/* Comments */}
                  <div className="mt-3 space-y-2">
                    {(p.comments || []).map(c => (
                      <div key={c.id} className="flex items-start gap-2">
                        <div className="h-6 w-6 shrink-0 rounded-full bg-zinc-700/70" />
                        <div className="rounded-xl bg-zinc-800/70 px-3 py-2 text-sm">
                          <div className="text-[12px] opacity-80">
                            <span className="font-medium">{c.userName}</span>{' '}
                            <span className="opacity-70">{fmt(c.at)}</span>
                          </div>
                          <div className="mt-0.5">{c.text}</div>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-end gap-2">
                      <input
                        value={commentDrafts[p.id] || ''}
                        onChange={e =>
                          setCommentDrafts(d => ({ ...d, [p.id]: e.target.value }))
                        }
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            addComment(p.id);
                          }
                        }}
                        placeholder="Write a comment…"
                        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-sm placeholder:text-zinc-500"
                      />
                      <button
                        onClick={() => addComment(p.id)}
                        className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
                        disabled={!(commentDrafts[p.id] || '').trim()}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* (Optional) Load more */}
        {items.length > 0 && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={() => load(items[items.length - 1].at)}
              className="rounded-lg border border-zinc-700 bg-zinc-900/70 px-4 py-2 text-sm hover:bg-zinc-800"
            >
              Load older
            </button>
          </div>
        )}
      </div>
    </div>
  );
}