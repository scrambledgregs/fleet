// src/settings/TeamSettings.jsx
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { getTenantId } from '../lib/socket' // for X-Tenant-Id / clientId

export default function TeamSettings() {
  const tenantId = getTenantId()

  // --- techs (existing) ---
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ name:'', skills:'Repair', territory:'EAST', phone:'', email:'' })

  async function loadTechs() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/techs`)
      const j = await r.json()
      setList(j?.techs || [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load team')
    } finally {
      setLoading(false)
    }
  }

  async function addTech(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    try {
      const r = await fetch(`${API_BASE}/api/techs/add`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form })
      })
      const j = await r.json()
      if (j?.ok) {
        setList(prev => [...prev, j.tech])
        setForm({ name:'', skills:'Repair', territory:'EAST', phone:'', email:'' })
      }
    } catch {}
  }

  async function remove(id) {
    const r = await fetch(`${API_BASE}/api/techs/${encodeURIComponent(id)}`, { method:'DELETE' })
    const j = await r.json()
    if (j?.ok) setList(prev => prev.filter(x => x.id !== id))
  }

  useEffect(() => { loadTechs(); loadTeamSettings(); }, []) // load chat settings too

  // --- team chat settings ---
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [chat, setChat] = useState({
    welcomeMessage: `Welcome to #homebase! 🎉`,
    seedWelcome: true
  })

  async function loadTeamSettings() {
    setSettingsLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/team/settings?clientId=${tenantId}`, {
        headers: { 'X-Tenant-Id': tenantId }
      })
      const j = await r.json()
      if (j?.ok && j.settings) {
        setChat({
          welcomeMessage: j.settings.welcomeMessage ?? `Welcome to #homebase! 🎉`,
          seedWelcome: typeof j.settings.seedWelcome === 'boolean' ? j.settings.seedWelcome : true
        })
      }
    } catch {}
    setSettingsLoading(false)
  }

  async function saveTeamSettings() {
    setSaving(true)
    setSavedMsg('')
    try {
      const r = await fetch(`${API_BASE}/api/team/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({
          clientId: tenantId,
          welcomeMessage: chat.welcomeMessage,
          seedWelcome: chat.seedWelcome
        })
      })
      const j = await r.json()
      if (j?.ok) setSavedMsg('Saved ✓')
    } catch {}
    setSaving(false)
    setTimeout(() => setSavedMsg(''), 2000)
  }

  // Post the welcome message to #homebase right now (manual trigger)
  async function postWelcomeNow() {
    setPosting(true)
    try {
      await fetch(`${API_BASE}/api/team/welcome`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({
          clientId: tenantId,
          message: chat.welcomeMessage
        })
      })
    } catch {}
    setPosting(false)
  }

  // One-click: create Team Chat profiles for your Techs and seed welcome (bootstrap)
  async function syncTechsToTeam() {
    if (!list.length) return
    setSyncing(true)
    try {
      const members = list.map(t => ({
        userId: String(t.id),           // use your tech id as userId
        name: t.name || 'Teammate',
        title: t.territory || (Array.isArray(t.skills) ? t.skills.join(', ') : t.skills) || '',
        role: 'member'
      }))
      await fetch(`${API_BASE}/api/team/bootstrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({
          clientId: tenantId,
          members,
          welcomeMessage: chat.welcomeMessage,
          seedWelcome: chat.seedWelcome
        })
      })
    } catch {}
    setSyncing(false)
  }

  return (
    <div className="space-y-6">
      {/* Team Chat Settings */}
      <div className="rounded-none border border-white/10">
        <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
          <div className="text-sm font-semibold">Team Chat</div>
          {settingsLoading && <div className="text-xs text-white/50">Loading…</div>}
        </div>
        <div className="p-3 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-white/70">Welcome message for #homebase</span>
            <textarea
              className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none min-h-[84px]"
              value={chat.welcomeMessage}
              onChange={e=>setChat(s=>({...s, welcomeMessage: e.target.value}))}
              placeholder="Write the first message everyone will see…"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              checked={chat.seedWelcome}
              onChange={e=>setChat(s=>({...s, seedWelcome: e.target.checked}))}
            />
            Post this message automatically during team setup
          </label>

          <div className="flex gap-2">
            <button
              onClick={saveTeamSettings}
              className="glass px-3 py-1 rounded-none disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={postWelcomeNow}
              className="glass px-3 py-1 rounded-none disabled:opacity-50"
              disabled={posting}
              title="Immediately post to #homebase"
            >
              {posting ? 'Posting…' : 'Post welcome now'}
            </button>
            <button
              onClick={syncTechsToTeam}
              className="glass px-3 py-1 rounded-none disabled:opacity-50"
              disabled={syncing || list.length === 0}
              title="Create Team Chat profiles from your Techs list"
            >
              {syncing ? 'Syncing…' : 'Sync Techs to Team Chat'}
            </button>
            {savedMsg && <span className="text-xs text-white/60 self-center">{savedMsg}</span>}
          </div>
        </div>
      </div>

      {/* Add Tech (existing) */}
      <form onSubmit={addTech} className="grid grid-cols-1 sm:grid-cols-6 gap-2">
        <input
          className="glass px-2 py-1 rounded-none col-span-2"
          placeholder="Full name"
          value={form.name}
          onChange={e=>setForm(f=>({...f,name:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Skills (comma list)"
          value={form.skills}
          onChange={e=>setForm(f=>({...f,skills:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Territory"
          value={form.territory}
          onChange={e=>setForm(f=>({...f,territory:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Phone"
          value={form.phone}
          onChange={e=>setForm(f=>({...f,phone:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Email"
          value={form.email}
          onChange={e=>setForm(f=>({...f,email:e.target.value}))}
        />
        <button className="glass px-3 py-1 rounded-none">Add</button>
      </form>

      {loading && <div className="text-white/70 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {/* Techs list (existing) */}
      <div className="border border-white/10 rounded-none">
        {list.length === 0 && <div className="p-3 text-white/60 text-sm">No team members yet.</div>}
        {list.map(t => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="text-sm">
              <div className="font-medium">{t.name}</div>
              <div className="text-white/60">{(t.skills||[]).join?.(', ') || t.skills || '—'} · {t.territory || '—'}</div>
              <div className="text-white/40 text-xs">{t.phone || '—'} · {t.email || '—'}</div>
            </div>
            <button onClick={()=>remove(t.id)} className="text-xs glass px-2 py-1 rounded-none">Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}