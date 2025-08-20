// src/settings/TeamSettings.jsx
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function TeamSettings() {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ name:'', skills:'Repair', territory:'EAST', phone:'', email:'' })

  async function load() {
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
  useEffect(() => { load() }, [])

  async function addTech(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    const body = { ...form }
    try {
      const r = await fetch(`${API_BASE}/api/techs/add`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
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

  return (
    <div className="space-y-4">
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

      <div className="border border-white/10 rounded-none">
        {list.length === 0 && <div className="p-3 text-white/60 text-sm">No team members yet.</div>}
        {list.map(t => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="text-sm">
              <div className="font-medium">{t.name}</div>
              <div className="text-white/60">{(t.skills||[]).join(', ') || '—'} · {t.territory || '—'}</div>
              <div className="text-white/40 text-xs">{t.phone || '—'} · {t.email || '—'}</div>
            </div>
            <button onClick={()=>remove(t.id)} className="text-xs glass px-2 py-1 rounded-none">Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}