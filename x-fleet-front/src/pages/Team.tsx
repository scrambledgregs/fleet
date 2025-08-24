// x-fleet-front/src/pages/Team.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import InternalChat from './InternalChat';
import TeamFeed from './TeamFeed';
import { apiFetch, getSocket, getTenantId } from '../lib/socket';
import { useSearchParams } from 'react-router-dom';

/* ===========================
   Shared types
=========================== */
type Profile = {
  id: string;
  userId: string;
  name: string;
  handle?: string;
  title?: string;
  phone?: string;
  email?: string;
  location?: string;
  timezone?: string;
  bio?: string;
  avatarUrl?: string | null;
  color?: string | null;
  skills?: string[];
  links?: { label: string; url: string }[];
  createdAt: string;
  updatedAt: string;
  stats?: { kudosReceived?: number; messages?: number };
  pinnedChannels?: string[];
};
type Presence = {
  userId: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  lastActiveAt: string;
};

/* ===========================
   Directory Panel (profiles) — with Org Chart view
=========================== */
function DirectoryPanel() {
  const clientId = useMemo(() => getTenantId(), []);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Profile | null>(null);
  const [mine, setMine] = useState<Profile | null>(null);
  const [kudosTo, setKudosTo] = useState<Profile | null>(null);
  const kudosMsgRef = useRef<HTMLInputElement | null>(null);
  const [kudosEmoji, setKudosEmoji] = useState('👏');
  const [view, setView] = useState<'org' | 'grid'>('org'); // <— org chart by default

  const emojis = ['👏', '🙌', '🔥', '💯', '🚀', '🎯', '🦾'];

  async function loadProfiles() {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/team/profiles?clientId=${clientId}`);
      const j = await r.json();
      if (j?.ok) {
        setProfiles(Array.isArray(j.profiles) ? j.profiles : j.items || []);
        const guess =
          (j.profiles || j.items || []).find((p: Profile) => p.userId === 'me') || null;
        setMine(guess || null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadPresence() {
    try {
      const r = await apiFetch(`/api/team/presence?clientId=${clientId}`);
      const j = await r.json();
      const items: Presence[] = Array.isArray(j?.items)
        ? j.items
        : Array.isArray(j?.presence)
        ? j.presence
        : [];
      const map: Record<string, Presence> = {};
      items.forEach((p: Presence) => (map[p.userId] = p));
      setPresence(map);
    } catch {}
  }

  useEffect(() => {
    loadProfiles();
    loadPresence();

    const s = getSocket(clientId);
    const onPU = (p: any) => {
      if (!p?.profile) return;
      setProfiles((prev) => {
        const idx = prev.findIndex((x) => x.userId === p.profile.userId);
        if (idx === -1) return [p.profile, ...prev];
        const next = prev.slice();
        next[idx] = p.profile;
        return next;
      });
      if (p.profile.userId === 'me') setMine(p.profile);
    };
    const onPR = (p: any) => {
      if (!p?.presence) return;
      setPresence((prev) => ({ ...prev, [p.presence.userId]: p.presence }));
    };
    const onKudo = (_p: any) => {
      if (_p?.kudos?.toUserId) {
        setProfiles((prev) =>
          prev.map((pf) =>
            pf.userId === _p.kudos.toUserId
              ? {
                  ...pf,
                  stats: {
                    ...(pf.stats || {}),
                    kudosReceived: (pf.stats?.kudosReceived || 0) + 1,
                  },
                }
              : pf
          )
        );
      }
    };

    s.on('profile:updated', onPU);
    s.on('presence:updated', onPR);
    s.on('kudos:created', onKudo);
    return () => {
      s.off('profile:updated', onPU);
      s.off('presence:updated', onPR);
      s.off('kudos:created', onKudo);
    };
  }, [clientId]);

  // Auto-prompt profile editor if the user's profile looks empty
  useEffect(() => {
    if (mine && !mine.title && !mine.bio) {
      setTimeout(() => setEditing(mine), 0);
    }
  }, [mine]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return profiles;
    return profiles.filter((p) =>
      [p.name, p.handle, p.title, p.skills?.join(' ')].filter(Boolean).join(' ').toLowerCase().includes(k)
    );
  }, [q, profiles]);

  // --- Org chart helpers (very lightweight; bucket by seniority heuristics) ---
  function levelFor(p: Profile): 0 | 1 | 2 | 3 {
    const t = (p.title || '').toLowerCase();
    if (/(owner|founder|ceo|president|principal)/.test(t)) return 0; // exec
    if (/(vp|director|admin|operations|ops|manager|gm)/.test(t)) return 1; // managers
    if (/(lead|superintendent|foreman|supervisor)/.test(t)) return 2; // leads
    return 3; // crew/staff
  }
  const levels = useMemo(() => {
    const L0: Profile[] = [], L1: Profile[] = [], L2: Profile[] = [], L3: Profile[] = [];
    for (const p of filtered) {
      (levelFor(p) === 0 ? L0 : levelFor(p) === 1 ? L1 : levelFor(p) === 2 ? L2 : L3).push(p);
    }
    const byName = (a: Profile, b: Profile) => (a.name || '').localeCompare(b.name || '');
    return {
      exec: L0.sort(byName),
      managers: L1.sort(byName),
      leads: L2.sort(byName),
      crew: L3.sort(byName),
    };
  }, [filtered]);

  async function saveProfile(patch: Partial<Profile>) {
    const payload = { clientId, userId: 'me', patch };
    const r = await apiFetch('/api/team/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (j?.ok && j.profile) {
      setEditing(null);
      setProfiles((prev) => {
        const idx = prev.findIndex((x) => x.userId === j.profile.userId);
        if (idx === -1) return [j.profile, ...prev];
        const next = prev.slice();
        next[idx] = j.profile;
        return next;
      });
    }
  }

  async function sendKudos() {
    if (!kudosTo) return;
    const r = await apiFetch('/api/team/kudos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId,
        fromUserId: 'me',
        toUserId: kudosTo.userId,
        emoji: kudosEmoji,
        message: kudosMsgRef.current?.value || '',
      }),
    });
    const j = await r.json();
    if (j?.ok) {
      setKudosTo(null);
      if (kudosMsgRef.current) kudosMsgRef.current.value = '';
    }
  }

  function startEditMine() {
    const base: Profile =
      mine ?? {
        id: 'me',
        userId: 'me',
        name: 'Me',
        handle: '',
        title: '',
        phone: '',
        email: '',
        location: '',
        timezone: '',
        bio: '',
        avatarUrl: null,
        color: null,
        skills: [],
        links: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: { kudosReceived: 0, messages: 0 },
        pinnedChannels: [],
      };
    setEditing(base);
  }

  function presenceDot(u: string) {
    const st = presence[u]?.status || 'offline';
    const color =
      st === 'online'
        ? 'bg-emerald-500'
        : st === 'away'
        ? 'bg-amber-400'
        : st === 'dnd'
        ? 'bg-rose-500'
        : 'bg-zinc-600';
    return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} title={st} />;
  }

  function Card({ p }: { p: Profile }) {
    return (
      <div className="relative rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 min-w-[180px]">
        <div className="flex items-start gap-3">
          <div
            className="relative h-9 w-9 shrink-0 rounded-lg grid place-items-center text-xs font-semibold"
            style={{ background: p.color || 'linear-gradient(135deg,#1e293b,#0b1220)' }}
          >
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            ) : (
              <span>{(p.name || '?').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase()}</span>
            )}
            <span className="absolute -right-0.5 -bottom-0.5">{presenceDot(p.userId)}</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{p.name}</div>
            <div className="truncate text-xs text-zinc-400">{p.title || p.handle || '\u00A0'}</div>
          </div>
          <div className="ml-auto text-[11px] text-zinc-400">👍 {p.stats?.kudosReceived || 0}</div>
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => setKudosTo(p)}
            className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-800/60"
          >
            Kudos
          </button>
          {p.userId === 'me' && (
            <button
              type="button"
              onClick={() => setEditing(p)}
              className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-800/60"
            >
              Edit
            </button>
          )}
        </div>
        {/* connector down (only visible in org view; purely decorative) */}
        {view === 'org' && (
          <div className="absolute left-1/2 -bottom-3 hidden h-3 w-px bg-zinc-700/60 lg:block" />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      {/* Controls */}
      <div className="px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teammates, roles, skills…"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
          />
          <div className="inline-flex rounded-lg border border-zinc-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setView('org')}
              className={`px-3 py-1.5 text-xs ${view === 'org' ? 'bg-zinc-800 text-white' : 'text-zinc-300'}`}
              title="Org chart view"
            >
              Org chart
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`px-3 py-1.5 text-xs ${view === 'grid' ? 'bg-zinc-800 text-white' : 'text-zinc-300'}`}
              title="Grid view"
            >
              Grid
            </button>
          </div>
          <button
            type="button"
            onClick={startEditMine}
            className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-2 text-sm font-medium shadow hover:brightness-110"
          >
            Edit my profile
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loading && <div className="text-sm text-zinc-400">Loading profiles…</div>}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-zinc-500">No teammates yet.</div>
        )}

        {view === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <Card key={p.userId} p={p} />
            ))}
          </div>
        ) : (
          // ---- Org chart rows (Exec → Managers → Leads → Crew) ----
          <div className="space-y-8">
            {[
              { label: 'Owner / Exec', list: levels.exec },
              { label: 'Managers', list: levels.managers },
              { label: 'Leads', list: levels.leads },
              { label: 'Crew', list: levels.crew },
            ].map(({ label, list }, i, arr) =>
              list.length ? (
                <div key={label} className="relative">
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
                  <div className="flex flex-wrap items-start justify-center gap-4">
                    {list.map((p) => (
                      <div key={p.userId} className="relative">
                        <Card p={p} />
                      </div>
                    ))}
                  </div>
                  {/* horizontal connector to suggest hierarchy (skip last row) */}
                  {i < arr.length - 1 && (
                    <div className="mt-2 hidden h-px w-full bg-zinc-800/70 lg:block" />
                  )}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="text-sm font-semibold mb-3">Edit profile</div>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="col-span-2 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Name"
                defaultValue={editing.name}
                onChange={(e) => (editing.name = e.target.value)}
              />
              <input
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="@handle"
                defaultValue={editing.handle || ''}
                onChange={(e) => (editing.handle = e.target.value)}
              />
              <input
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Title"
                defaultValue={editing.title || ''}
                onChange={(e) => (editing.title = e.target.value)}
              />
              <input
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Phone"
                defaultValue={editing.phone || ''}
                onChange={(e) => (editing.phone = e.target.value)}
              />
              <input
                className="col-span-2 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Email"
                defaultValue={editing.email || ''}
                onChange={(e) => (editing.email = e.target.value)}
              />
              <input
                className="col-span-2 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Skills (comma separated)"
                defaultValue={(editing.skills || []).join(', ')}
                onChange={(e) =>
                  (editing.skills = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean))
                }
              />
              <textarea
                className="col-span-2 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
                placeholder="Short bio"
                defaultValue={editing.bio || ''}
                onChange={(e) => (editing.bio = e.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveProfile(editing)}
                className="rounded-md bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-1.5 text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kudos modal */}
      {kudosTo && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="text-sm font-semibold mb-2">Send kudos to {kudosTo.name}</div>
            <div className="flex gap-2 mb-3">
              {emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setKudosEmoji(e)}
                  className={`h-9 w-9 rounded-full border ${
                    kudosEmoji === e ? 'border-orange-500 bg-zinc-800' : 'border-zinc-700 bg-zinc-800/60'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              ref={kudosMsgRef}
              placeholder="Say something nice… (optional)"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setKudosTo(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendKudos}
                className="rounded-md bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-1.5 text-sm font-medium"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================
   Team Hub (tabs + optional split)
=========================== */
type Tab = 'feed' | 'chat' | 'directory';

export default function Team() {
  const [split, setSplit] = useState(false);
  const [search, setSearch] = useSearchParams();

  // Single source of truth: read current tab from URL
  const tab: Tab = (search.get('tab') as Tab) || 'chat';

  const switchTab = (next: Tab) => {
    const params = new URLSearchParams(search);
    if (next === 'chat') params.delete('tab'); // clean default
    else params.set('tab', next);
    setSearch(params, { replace: false });
  };

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-0 flex-col">
      {/* Tabs / actions */}
      <div className="px-4 lg:px-6 py-3 border-b border-white/10 bg-zinc-900/60 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-zinc-800/60 p-1">
            <button
              type="button"
              onClick={() => switchTab('chat')}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                tab === 'chat' ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => switchTab('feed')}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                tab === 'feed' ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:text-white'
              }`}
            >
              Feed
            </button>
            <button
              type="button"
              onClick={() => switchTab('directory')}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                tab === 'directory' ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:text-white'
              }`}
            >
              Directory
            </button>
          </div>
          <div className="hidden lg:flex items-center gap-2">
            <label className="text-xs text-zinc-400">Split view</label>
            <button
              type="button"
              onClick={() => setSplit((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                split ? 'border-orange-500 text-white' : 'border-zinc-600 text-zinc-300 hover:text-white'
              }`}
            >
              {split ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {split ? (
          // Split shows Chat + Directory (common workflow)
          <div className="h-full min-h-0 grid grid-cols-12 gap-4 p-4 lg:p-6">
            <div className="col-span-12 xl:col-span-7 min-h-0">
              <div className="h-full min-h-0 rounded-2xl overflow-hidden border border-white/10">
                <InternalChat />
              </div>
            </div>
            <div className="col-span-12 xl:col-span-5 min-h-0">
              <div className="h-full min-h-0 rounded-2xl overflow-hidden border border-white/10">
                <DirectoryPanel />
              </div>
            </div>
          </div>
        ) : tab === 'feed' ? (
          <div className="h-full min-h-0">
            <TeamFeed />
          </div>
        ) : tab === 'chat' ? (
          <InternalChat />
        ) : (
          <DirectoryPanel />
        )}
      </div>
    </div>
  );
}