// src/settings/VehiclesSettings.jsx
import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function VehiclesSettings() {
  const [loading, setLoading] = useState(true)
  const [list, setList] = useState([])
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ name:'Van', plate:'', capacity:'', notes:'' })

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/vehicles`)
      const j = await r.json()
      setList(j?.vehicles || [])
      setError(null)
    } catch (e) {
      setError(e.message || 'Failed to load vehicles')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function addVehicle(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    const payload = { ...form, capacity: Number(form.capacity) || 0 }
    const r = await fetch(`${API_BASE}/api/vehicles`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    })
    const j = await r.json()
    if (j?.ok) {
      setList(prev => [...prev, j.vehicle])
      setForm({ name:'Van', plate:'', capacity:'', notes:'' })
    }
  }

  async function remove(id) {
    const r = await fetch(`${API_BASE}/api/vehicles/${encodeURIComponent(id)}`, { method:'DELETE' })
    const j = await r.json()
    if (j?.ok) setList(prev => prev.filter(x => x.id !== id))
  }

  return (
    <div className="space-y-4">
      <form onSubmit={addVehicle} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Name (Van 01)"
          value={form.name}
          onChange={e=>setForm(f=>({...f,name:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Plate"
          value={form.plate}
          onChange={e=>setForm(f=>({...f,plate:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none"
          placeholder="Capacity (# stops)"
          value={form.capacity}
          onChange={e=>setForm(f=>({...f,capacity:e.target.value}))}
        />
        <input
          className="glass px-2 py-1 rounded-none sm:col-span-2"
          placeholder="Notes"
          value={form.notes}
          onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
        />
        <button className="glass px-3 py-1 rounded-none">Add</button>
      </form>

      {loading && <div className="text-white/70 text-sm">Loading…</div>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="border border-white/10 rounded-none">
        {list.length === 0 && <div className="p-3 text-white/60 text-sm">No vehicles yet.</div>}
        {list.map(v => (
          <div key={v.id} className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="text-sm">
              <div className="font-medium">{v.name}</div>
              <div className="text-white/60">{v.plate || '—'} · capacity {v.capacity ?? 0}</div>
              <div className="text-white/40 text-xs">{v.notes || '—'}</div>
            </div>
            <button onClick={()=>remove(v.id)} className="text-xs glass px-2 py-1 rounded-none">Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}