// x-fleet-front/src/pages/TeamDirectory.tsx
import React, { useEffect, useState } from 'react';
import { getSocket, getTenantId, apiFetch } from '../lib/socket';
import { listProfiles, upsertProfile, heartbeatPresence, sendKudos } from '../lib/team';

type Profile = {
  id: string;
  userId: string;
  name: string;
  handle?: string;
  title?: string;
  avatarUrl?: string | null;
  color?: string | null;
  bio?: string;
  stats?: { kudosReceived?: number };
  // ⬇︎ added fields used for admin actions / gating
  role?: 'owner' | 'admin' | 'member';
  mutedUntil?: string | null;
  disabledAt?: string | null;
};

export default function TeamDirectory() {
  const clientId = getTenantId();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [me, setMe] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null); // which user's action menu is open

  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const isOwner = me?.role === 'owner';

  async function refresh() {
    const j = await listProfiles();
    if (j?.ok) {
      const list: Profile[] = j.profiles || [];
      setProfiles(list);
      setMe(list.find((p: Profile) => p.userId === 'me') || null);
    }
  }

  useEffect(() => {
    refresh();
    heartbeatPresence('online');
    const t = setInterval(() => heartbeatPresence('online'), 25_000);

    const s = getSocket(clientId);
    const onUpd = () => refresh();
    const onKudos = () => refresh();
    s.on('profile:updated', onUpd);
    s.on('kudos:created', onKudos);

    return () => {
      clearInterval(t);
      s.off('profile:updated', onUpd);
      s.off('kudos:created', onKudos);
    };
  }, [clientId]);

  function isCurrentlyMuted(p: Profile) {
    return !!p.mutedUntil && new Date(p.mutedUntil).getTime() > Date.now();
  }

  // ---- Admin actions ----
  async function mute(u: Profile, minutes = 60) {
    const r = await apiFetch(`/api/team/profiles/${encodeURIComponent(u.userId)}/mute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, minutes }),
    });
    const j = await r.json();
    if (j?.ok && j.profile) {
      setProfiles(prev => prev.map(p => (p.userId === u.userId ? j.profile : p)));
      setMenuFor(null);
    }
  }

  async function unmute(u: Profile) {
    const r = await apiFetch(`/api/team/profiles/${encodeURIComponent(u.userId)}/unmute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    const j = await r.json();
    if (j?.ok && j.profile) {
      setProfiles(prev => prev.map(p => (p.userId === u.userId ? j.profile : p)));
      setMenuFor(null);
    }
  }

  async function removeUser(u: Profile) {
    if (!confirm(`Remove ${u.name} from the team?`)) return;
    const r = await apiFetch(
      `/api/team/profiles/${encodeURIComponent(u.userId)}?clientId=${clientId}`,
      { method: 'DELETE' }
    );
    const j = await r.json();
    if (j?.ok) {
      setProfiles(prev => prev.filter(p => p.userId !== u.userId));
      setMenuFor(null);
    }
  }

  return (
    <div className="h-[calc(100vh-64px)] min-h-0 flex flex-col">
      <div className="px-4 py-3 border-b border-white/10 bg-zinc-900">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold">People</h1>
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 text-white text-sm px-3 py-1.5"
          >
            {me ? 'Edit my profile' : 'Create my profile'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {profiles.map(p => (
          <div key={p.userId} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 relative">
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-full grid place-items-center text-white text-sm font-semibold"
                style={{
                  background: p.avatarUrl ? undefined : (p.color || '#e66a00'),
                  backgroundImage: p.avatarUrl ? `url(${p.avatarUrl})` : undefined,
                  backgroundSize: 'cover', backgroundPosition: 'center'
                }}
              >
                {!p.avatarUrl ? (p.name || '?').slice(0,1).toUpperCase() : null}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  {p.role && (
                    <span className="text-[10px] uppercase rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                      {p.role}
                    </span>
                  )}
                  {isCurrentlyMuted(p) && (
                    <span className="text-[10px] uppercase rounded bg-amber-500/15 text-amber-300 px-1.5 py-0.5">
                      muted
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 truncate">{p.title || p.handle || '\u00A0'}</div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className="text-xs text-zinc-400">👍 {p.stats?.kudosReceived || 0}</div>

                {/* Admin menu trigger */}
                {isAdmin && p.userId !== 'me' && (
                  <div className="relative">
                    <button
                      onClick={() => setMenuFor(menuFor === p.userId ? null : p.userId)}
                      className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800/60"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === p.userId}
                    >
                      •••
                    </button>
                    {menuFor === p.userId && (
                      <div
                        role="menu"
                        className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-zinc-700 bg-zinc-900/95 p-1 shadow-xl"
                      >
                        {!isCurrentlyMuted(p) ? (
                          <>
                            <button onClick={() => mute(p, 60)} className="w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-800/80">Mute 1 hour</button>
                            <button onClick={() => mute(p, 8 * 60)} className="w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-800/80">Mute 8 hours</button>
                            <button onClick={() => mute(p, 24 * 60)} className="w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-800/80">Mute 24 hours</button>
                          </>
                        ) : (
                          <button onClick={() => unmute(p)} className="w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-800/80">Unmute</button>
                        )}
                        {isOwner && (
                          <>
                            <div className="my-1 h-px bg-zinc-700/60" />
                            <button
                              onClick={() => removeUser(p)}
                              className="w-full text-left px-2 py-1 text-xs rounded text-rose-300 hover:bg-rose-900/30"
                            >
                              Remove from team
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <p className="mt-2 text-sm text-zinc-300 line-clamp-3">{p.bio || '—'}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => sendKudos(p.userId, '👏', 'Great job!')}
                className="rounded-md bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
              >
                Send kudos 👏
              </button>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <ProfileModal
          initial={me || { userId: 'me', name: '', handle: '', title: '' }}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

function ProfileModal({
  initial, onClose, onSaved
}: { initial: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>(initial);

  async function save() {
    const j = await upsertProfile(form);
    if (j?.ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-white/10 p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3">Your profile</h3>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name" value={form.name} onChange={v => setForm((s: any) => ({ ...s, name: v }))} />
          <Input label="Handle (@)" value={form.handle} onChange={v => setForm((s: any) => ({ ...s, handle: v.replace(/^@/,'') }))} />
          <Input label="Title" value={form.title} onChange={v => setForm((s: any) => ({ ...s, title: v }))} />
          <Input label="Location" value={form.location} onChange={v => setForm((s: any) => ({ ...s, location: v }))} />
          <Input label="Bio" value={form.bio} onChange={v => setForm((s: any) => ({ ...s, bio: v }))} className="col-span-2" />
          <Input label="Avatar URL" value={form.avatarUrl || ''} onChange={v => setForm((s: any) => ({ ...s, avatarUrl: v || null }))} className="col-span-2" />
          <Input label="Accent color" value={form.color || ''} onChange={v => setForm((s: any) => ({ ...s, color: v || null }))} placeholder="#e66a00" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="px-3 py-1.5 text-sm rounded-md bg-zinc-800" onClick={onClose}>Cancel</button>
          <button className="px-3 py-1.5 text-sm rounded-md bg-gradient-to-r from-orange-500 to-orange-600 text-white" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label, value, onChange, className, placeholder
}: { label: string; value: any; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <label className={'flex flex-col gap-1 ' + (className || '')}>
      <span className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</span>
      <input
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm placeholder:text-zinc-500"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}