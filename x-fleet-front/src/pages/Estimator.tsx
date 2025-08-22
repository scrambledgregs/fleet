// src/pages/Estimator.tsx
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'
import { API_BASE } from '../config'
import { PACKS } from '../packs'

import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import L from 'leaflet'
import 'leaflet-draw' // runtime; we’ll cast handler types to any

export type EstimateItem = {
  id: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  notes?: string
  tax?: number
  discount?: number
}

type LineItem = {
  id: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  notes?: string
}

type Customer = {
  name: string
  phone: string
  email?: string
  address?: string
}

type Totals = {
  subtotal: number
  discount: number
  tax: number
  total: number
}

const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const currency = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const normalizePhone = (p: string) => {
  if (!p) return ''
  let s = String(p).replace(/[^\d]/g, '')
  if (s.length === 10) s = '1' + s
  if (!s.startsWith('+')) s = '+' + s
  return s
}

/** --- Embedded Roof Measure panel (satellite + draw) --- */
type MeasureNumbers = {
  planSqft: number
  pitchFactor: number
  roofSqft: number
  squares: number
  perimeterFt: number
}
type RoofMeasurePanelProps = {
  onUse: (items: Omit<LineItem, 'id'>[], note: string) => void
}
const RoofMeasurePanel: React.FC<RoofMeasurePanelProps> = ({ onUse }) => {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)

  const [addr, setAddr] = useState('')
  const [pitch, setPitch] = useState('6/12')
  const [measure, setMeasure] = useState<MeasureNumbers>({
    planSqft: 0, pitchFactor: 1.118, roofSqft: 0, squares: 0, perimeterFt: 0
  })

  const PRICE = {
    shinglesPerSquare: 250,
    underlaymentPerSquare: 50,
    nailsPerLb: 5,
    laborPerHour: 75,
  } as const

  const PITCH_FACTORS: Record<string, number> = {
    '3/12': 1.035, '4/12': 1.054, '5/12': 1.083,
    '6/12': 1.118, '7/12': 1.158, '8/12': 1.202,
    '9/12': 1.250, '10/12': 1.302, '12/12': 1.414
  }

  const recompute = useCallback(() => {
    const fg = featureGroupRef.current
    if (!fg) return
    const layers = (fg.getLayers() as L.Layer[]).filter(
      (l: L.Layer): l is L.Polygon => l instanceof L.Polygon
    )
    const poly = layers[0]
    if (!poly) {
      setMeasure(m => ({ ...m, planSqft: 0, roofSqft: 0, squares: 0, perimeterFt: 0 }))
      return
    }
    const gj = poly.toGeoJSON() as unknown as Feature<Polygon>

    const planM2 = turf.area(gj)
    const planSqft = planM2 * 10.7639

    const outer: Position[] = (gj.geometry?.coordinates?.[0] ?? []) as Position[]
    const perimMeters = turf.length(turf.lineString(outer), { units: 'meters' })
    const perimeterFt = perimMeters * 3.28084

    const pitchFactor = PITCH_FACTORS[pitch] ?? 1.118
    const roofSqft = planSqft * pitchFactor
    const squares = roofSqft / 100

    setMeasure(m => ({ ...m, planSqft, pitchFactor, roofSqft, squares, perimeterFt }))
  }, [pitch])

  // init map once
  useEffect(() => {
    if (mapInstRef.current || !mapRef.current) return
    const map = L.map(mapRef.current, {
      center: [40.7128, -74.0060],
      zoom: 19,
      zoomControl: true,
    })
    mapInstRef.current = map

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri' }
    ).addTo(map)

    const fg = new L.FeatureGroup()
    featureGroupRef.current = fg
    map.addLayer(fg)

    const draw = new (L as any).Control.Draw({
      edit: { featureGroup: fg },
      draw: { polygon: true, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false },
    })
    map.addControl(draw)

    const onCreated = (e: any) => { fg.clearLayers(); fg.addLayer(e.layer); recompute() }
    const onEdited  = (_e: any) => recompute()
    const onDeleted = (_e: any) => { fg.clearLayers(); recompute() }

    map.on((L as any).Draw.Event.CREATED, onCreated)
    map.on((L as any).Draw.Event.EDITED,  onEdited)
    map.on((L as any).Draw.Event.DELETED, onDeleted)

    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated)
      map.off((L as any).Draw.Event.EDITED,  onEdited)
      map.off((L as any).Draw.Event.DELETED, onDeleted)
      try { map.removeControl(draw) } catch {}
      try { map.removeLayer(fg) } catch {}
    }
  }, [recompute])

  // recompute on pitch change
  useEffect(() => { recompute() }, [recompute])

  async function lookup() {
    if (!addr.trim()) return
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
    const j = await r.json().catch(() => [])
    if (Array.isArray(j) && j[0]) {
      const { lat, lon } = j[0]
      const map = mapInstRef.current
      if (map) map.setView([Number(lat), Number(lon)], 19)
    }
  }

  const quickItems = useMemo(() => {
    const waste = 1.10
    const shinglesSquares = Math.ceil(measure.squares * waste * 100) / 100
    const underlaymentSquares = shinglesSquares
    const laborHours = Math.max(2, Math.round(measure.squares * 3 * 10) / 10)
    const nailsLbs = Math.ceil(measure.squares * 2)

    return [
      { name: 'Architectural Shingles', qty: shinglesSquares, unit: 'square', unitPrice: PRICE.shinglesPerSquare, notes: 'Includes 10% waste' },
      { name: 'Roofing Underlayment',   qty: underlaymentSquares, unit: 'square', unitPrice: PRICE.underlaymentPerSquare, notes: 'Synthetic' },
      { name: 'Roofing Nails',          qty: nailsLbs, unit: 'lb', unitPrice: PRICE.nailsPerLb },
      { name: 'Labor',                   qty: laborHours, unit: 'hour', unitPrice: PRICE.laborPerHour, notes: 'Skilled roofing crew' },
    ] as Omit<LineItem, 'id'>[]
  }, [measure])

  const note = `Measured ~${measure.squares.toFixed(2)} squares (plan ${Math.round(measure.planSqft)} ft², pitch factor ${measure.pitchFactor}). Perimeter ~${Math.round(measure.perimeterFt)} ft.`

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 lg:col-span-9">
        <div className="flex gap-2 mb-2">
          <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="Search address…" className="flex-1 bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm" />
          <button onClick={lookup} className="px-3 py-2 rounded-none glass text-sm">Find</button>
          <select value={pitch} onChange={(e)=>setPitch(e.target.value)} className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm">
            {Object.keys(PITCH_FACTORS).map((p) => <option key={p} value={p}>{p} pitch</option>)}
          </select>
          <button
            onClick={() => onUse(quickItems, note)}
            className="px-3 py-2 rounded-none glass text-sm"
            disabled={measure.squares <= 0}
          >
            Use in Estimate
          </button>
        </div>
        <div ref={mapRef} className="w-full h-[60vh] rounded-none border border-white/10" />
      </div>

      <div className="col-span-12 lg:col-span-3 border border-white/10 rounded-none p-2 bg-white/5 space-y-2">
        <div className="text-sm font-semibold">Measurement</div>
        <div className="text-sm">Plan area: {Math.round(measure.planSqft)} ft²</div>
        <div className="text-sm">Pitch factor: {measure.pitchFactor.toFixed(3)}</div>
        <div className="text-sm">Roof surface: {Math.round(measure.roofSqft)} ft²</div>
        <div className="text-sm">Squares: {measure.squares.toFixed(2)}</div>
        <div className="text-sm">Perimeter: {Math.round(measure.perimeterFt)} ft</div>
      </div>
    </div>
  )
}

/** --- Main Estimator page with tabs --- */
export default function Estimator() {
  const navigate = useNavigate()
  const location = useLocation()
  const packId = new URLSearchParams(location.search).get('pack') || 'general'
  const pack = (PACKS as any)[packId] || PACKS.general

  const [tab, setTab] = useState<'estimate' | 'measure'>('estimate')

  const [mode, setMode] = useState<'Approve' | 'Schedule' | 'Dispatch'>('Approve')
  const [compact, setCompact] = useState(false)

  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', email: '', address: '' })

  // use pack defaults if provided
  const [items, setItems] = useState<LineItem[]>(() => {
    const base = (pack?.defaults?.items as any[] | undefined)
    if (Array.isArray(base) && base.length) {
      return base.map(it => ({
        id: uid(),
        name: String(it.name || ''),
        qty: Number(it.qty) || 1,
        unit: String(it.unit || ''),
        unitPrice: Number(it.unitPrice) || 0,
        notes: it.notes ? String(it.notes) : '',
      }))
    }
    return [{ id: uid(), name: 'Labor', qty: 1, unit: 'hr', unitPrice: 125 }]
  })

  const [aiPrompt, setAiPrompt] = useState<string>(
    pack?.aiPrompt ??
      'Scope: roof leak over kitchen; 20yr architectural shingles; 2 sq repair.\nSuggest a line-item breakdown with qty & unit prices appropriate for NY.'
  )

  const [taxRate, setTaxRate] = useState<number>(8.875)
  const [discount, setDiscount] = useState<number>(0)
  const [notes, setNotes] = useState<string>('')

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  // accept push from RoofMeasurePanel
  const takeMeasured = (list: Omit<LineItem, 'id'>[], note: string) => {
    setItems(list.map(it => ({ id: uid(), ...it })))
    setNotes(note)
    setTab('estimate')
  }

  const totals: Totals = useMemo(() => {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
    const disc = Math.max(0, Number(discount) || 0)
    const taxable = Math.max(0, subtotal - disc)
    const tax = taxable * ((Number(taxRate) || 0) / 100)
    const total = taxable + tax
    return { subtotal, discount: disc, tax, total }
  }, [items, discount, taxRate])

  function addItem() {
    setItems((prev) => [...prev, { id: uid(), name: '', qty: 1, unit: '', unitPrice: 0 }])
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id))
  }
  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  }

  async function handleSendSMS() {
    setError(null)
    const toPhone = normalizePhone(customer.phone)
    if (!toPhone) { setError('Enter a valid customer phone first.'); return }

    const lines: string[] = []
    lines.push(`Estimate for ${customer.name || 'Customer'}`)
    if (customer.address) lines.push(customer.address)
    lines.push('— — —')
    for (const it of items) {
      const lineTotal = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
      const name = it.name || 'Item'
      const qty = Number(it.qty) || 0
      const unit = it.unit || ''
      lines.push(`${name}: ${qty}${unit ? ' ' + unit : ''} @ ${currency(Number(it.unitPrice) || 0)} = ${currency(lineTotal)}`)
      if (it.notes) lines.push(`  • ${it.notes}`)
    }
    lines.push('— — —')
    lines.push(`Subtotal: ${currency(totals.subtotal)}`)
    if (totals.discount) lines.push(`Discount: -${currency(totals.discount)}`)
    lines.push(`Tax (${taxRate}%): ${currency(totals.tax)}`)
    lines.push(`Total: ${currency(totals.total)}`)
    if (notes) { lines.push('— — —'); lines.push(notes) }

    const text = lines.join('\n')

    try {
      setSending(true)
      const r = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: `manual:${toPhone}`,
          to: toPhone,
          text,
          direction: 'outbound',
          autopilot: false,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'Failed to send SMS')
      navigate(`/chatter/${encodeURIComponent(`manual:${toPhone}`)}`)
    } catch (e: any) {
      setError(e?.message || 'Failed to send SMS')
    } finally {
      setSending(false)
    }
  }

  async function handleAiAssist() {
    setError(null)
    setAiLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/agent/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })

      if (r.status === 404) {
        setError('AI endpoint not wired yet. Next: add POST /api/agent/estimate to call your agent and return items.')
        return
      }

      const j = await r.json()
      if (Array.isArray(j?.items) && j.items.length) {
        setItems(j.items.map((it: any) => ({
          id: uid(),
          name: it.name || '',
          qty: Number(it.qty) || 1,
          unit: it.unit || '',
          unitPrice: Number(it.unitPrice) || 0,
          notes: it.notes || '',
        })))
      } else if (typeof j?.text === 'string') {
        const parsed: LineItem[] = j.text.split('\n').map((raw: string) => {
          const m = raw.match(/^(.*?):\s*([\d.]+)\s*(\w+)?\s*@\s*\$?([\d,.]+)/i)
          return {
            id: uid(),
            name: (m?.[1] || raw).trim(),
            qty: m ? Number(m[2]) : 1,
            unit: m?.[3] || '',
            unitPrice: m ? Number(String(m[4]).replace(/,/g, '')) : 0,
          }
        }).filter((x: LineItem) => Boolean(x.name))
        if (parsed.length) setItems(parsed)
      } else {
        setError('AI did not return items. We’ll refine the endpoint next.')
      }
    } catch (e: any) {
      setError(e?.message || 'AI Assist failed')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className={'min-h-screen flex flex-col text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />

      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'flex-1 min-h-0 overflow-hidden grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="estimator" onChange={(id: string) => { if (id !== 'estimator') navigate('/') }} />
        </aside>

        <section className="col-span-12 lg:col-span-10 h-full min-h-0">
          <div className="glass rounded-none p-3 md:p-4 flex flex-col gap-3 min-h-[70vh]">
            {/* Tabs */}
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Estimator</div>
              <div className="flex items-center gap-2">
                <div className="bg-white/5 border border-white/10 rounded-none p-1">
                  <button className={`px-3 py-1.5 text-sm ${tab==='estimate' ? 'bg-white/10' : ''}`} onClick={() => setTab('estimate')}>Estimate</button>
                  <button className={`px-3 py-1.5 text-sm ${tab==='measure'  ? 'bg-white/10' : ''}`} onClick={() => setTab('measure')}>Measure</button>
                </div>
                {tab === 'estimate' && (
                  <button className="px-3 py-1.5 text-sm rounded-none glass disabled:opacity-60" onClick={handleSendSMS} disabled={sending || !customer.phone || items.length === 0}>
                    {sending ? 'Sending…' : 'Send via SMS'}
                  </button>
                )}
              </div>
            </div>

            {tab === 'measure' ? (
              <RoofMeasurePanel onUse={takeMeasured} />
            ) : (
              <>
                {/* Customer */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input value={customer.name}  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}   placeholder="Customer name" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                  <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}  placeholder="Customer phone (+1 555 555 0123)" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                  <input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })}  placeholder="Email (optional)" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                  <input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Address (optional)" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                </div>

                {/* Items */}
                <div className="border border-white/10 rounded-none">
                  <div className="grid grid-cols-12 gap-2 p-2 bg-white/5 text-xs text-white/70">
                    <div className="col-span-4">Item</div>
                    <div className="col-span-2">Qty</div>
                    <div className="col-span-2">Unit</div>
                    <div className="col-span-2">Unit Price</div>
                    <div className="col-span-1 text-right">Line</div>
                    <div className="col-span-1"></div>
                  </div>

                  {items.map((it) => {
                    const line = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
                    return (
                      <div key={it.id} className="grid grid-cols-12 gap-2 p-2 border-t border-white/10">
                        <div className="col-span-4">
                          <input value={it.name} onChange={(e) => updateItem(it.id, { name: e.target.value })} placeholder="Description" className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                          <input value={it.notes || ''} onChange={(e) => updateItem(it.id, { notes: e.target.value })} placeholder="Notes (optional)" className="mt-1 w-full bg-black/20 border border-white/10 rounded-none px-2 py-1 text-xs outline-none focus:border-white/30" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" min={0} step="0.01" value={it.qty} onChange={(e) => updateItem(it.id, { qty: Number(e.target.value) })} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                        </div>
                        <div className="col-span-2">
                          <input value={it.unit} onChange={(e) => updateItem(it.id, { unit: e.target.value })} placeholder="hr, sq, ea…" className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                        </div>
                        <div className="col-span-2">
                          <input type="number" min={0} step="0.01" value={it.unitPrice} onChange={(e) => updateItem(it.id, { unitPrice: Number(e.target.value) })} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                        </div>
                        <div className="col-span-1 text-right pt-2 text-sm">{currency(line)}</div>
                        <div className="col-span-1 flex items-center justify-end">
                          <button className="px-2 py-1 text-xs rounded-none glass" onClick={() => removeItem(it.id)}>Remove</button>
                        </div>
                      </div>
                    )
                  })}

                  <div className="p-2 border-t border-white/10">
                    <button className="px-3 py-1.5 text-sm rounded-none glass" onClick={addItem}>+ Add item</button>
                  </div>
                </div>

                {/* Totals */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes / terms" rows={4} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                  </div>
                  <div className="md:col-span-1 border border-white/10 rounded-none p-2 bg-white/5">
                    <div className="flex items-center justify-between text-sm">
                      <span>Subtotal</span>
                      <span>{currency(totals.subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-sm">
                      <label className="opacity-80">Discount ($)</label>
                      <input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="w-24 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm text-right outline-none focus:border-white/30" />
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2 text-sm">
                      <label className="opacity-80">Tax rate (%)</label>
                      <input type="number" min={0} step="0.01" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} className="w-24 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm text-right outline-none focus:border-white/30" />
                    </div>
                    <div className="h-px bg-white/10 my-3" />
                    <div className="flex items-center justify-between text-base font-semibold">
                      <span>Total</span>
                      <span>{currency(totals.total)}</span>
                    </div>
                  </div>
                </div>

                {/* AI Assist */}
                <div className="border border-white/10 rounded-none p-2 bg-neutral-900">
                  <div className="text-sm font-semibold mb-2">AI Assist (beta)</div>
                  <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={3} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
                  <div className="mt-2 flex items-center gap-2">
                    <button className="px-3 py-1.5 text-sm rounded-none glass disabled:opacity-60" onClick={handleAiAssist} disabled={aiLoading}>
                      {aiLoading ? 'Thinking…' : 'Suggest line items'}
                    </button>
                    {error && <div className="text-sm text-red-400">{error}</div>}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}