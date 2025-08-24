// x-fleet-front/src/components/TeamSettingsCard.tsx
import React, { useEffect, useState } from 'react';
import { apiFetch, getTenantId } from '../lib/socket';

export default function TeamSettingsCard() {
  const clientId = getTenantId();
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [seedWelcome, setSeedWelcome] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  async function load() {
    const r = await apiFetch(`/api/team/settings?clientId=${clientId}`);
    const j = await r.json();
    if (j?.ok) {
      setWelcomeMessage(j.settings?.welcomeMessage || '');
      setSeedWelcome(j.settings?.seedWelcome ?? true);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await apiFetch('/api/team/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, welcomeMessage, seedWelcome }),
      });
      await r.json();
    } finally {
      setSaving(false);
    }
  }

  async function postNow() {
    setPosting(true);
    try {
      const r = await apiFetch('/api/team/welcome', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, message: welcomeMessage }),
      });
      await r.json();
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Team Defaults</h3>
      </div>

      <label className="mt-3 block">
        <span className="text-xs text-zinc-400">Welcome message for #homebase</span>
        <textarea
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
          placeholder={`Welcome to #homebase! 🎉`}
          value={welcomeMessage}
          onChange={e => setWelcomeMessage(e.target.value)}
        />
      </label>

      <label className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={seedWelcome}
          onChange={e => setSeedWelcome(e.target.checked)}
        />
        Auto-post this message when the team is created
      </label>

      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={postNow}
          disabled={posting}
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          {posting ? 'Posting…' : 'Post to #homebase now'}
        </button>
      </div>
    </div>
  );
}