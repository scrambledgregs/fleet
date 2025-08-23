// src/pages/Estimator.tsx
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { API_BASE } from '../config'
import { PACKS } from '../packs'
import DispositionButton, { DispositionPayload } from '../components/DispositionButton'
import { withTenant } from '../lib/socket'
import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import L from 'leaflet'
import 'leaflet-draw'
import { Send, Copy as CopyIcon, Eye, Loader2 } from 'lucide-react'
import ProposalPreview from '../components/ProposalPreview'

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

type Contact = {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
}

type User = {
  id: string
  name: string
  phone?: string
  email?: string
}

/* ---------- Mini UI helpers ---------- */
const uid = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36)
const currency = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const normalizePhone = (p: string) => {
  if (!p) return ''
  let s = String(p).replace(/[^\d]/g, '')
  if (s.length === 10) s = '1' + s
  if (!s.startsWith('+')) s = '+' + s
  return s
}

/** A small, dependency-free searchable dropdown (portal-based) */
function SearchableSelect<T extends { id: string; name: string }>({
  value, onSelect, onSearch, options, placeholder, loading, allowCreateLabel,
}: {
  value: T | null
  onSelect: (v: T) => void
  onSearch: (query: string) => void
  options: T[]
  placeholder?: string
  loading?: boolean
  allowCreateLabel?: string | null
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState(0)

  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 })

  useEffect(() => {
    const t = setTimeout(() => onSearch(q), 180)
    return () => clearTimeout(t)
  }, [q, onSearch])

  const showCreate =
    !!allowCreateLabel &&
    q.trim().length >= 2 &&
    !options.some(o => o.name.toLowerCase() === q.trim().toLowerCase())

  const updatePos = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const margin = 8
    const maxW = Math.min(448, Math.floor(vw * 0.8))
    const width = Math.max(Math.min(maxW, Math.floor(r.width)), 240)
    let left = Math.min(r.left, vw - width - margin)
    if (left < margin) left = margin
    const top = r.bottom + 4
    setPos({ left: Math.round(left), top: Math.round(top), width })
  }

  useEffect(() => {
    if (!open) return
    updatePos()
    const onScroll = () => updatePos()
    const onResize = () => updatePos()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)

    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="w-full text-left bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm flex items-center justify-between"
        onClick={() => setOpen(o => !o)}
      >
        <span className={value ? '' : 'text-white/50'}>{value ? value.name : (placeholder || 'Select…')}</span>
        <span className="text-white/40">▾</span>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 1000 }}
          className="bg-neutral-900 border border-white/10 rounded-none shadow-xl"
        >
          <div className="p-2 border-b border-white/10">
            <input
              autoFocus
              value={q}
              onChange={e => { setQ(e.target.value); setHover(0) }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(h + 1, (options.length - 1) + (showCreate ? 1 : 0))) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHover(h => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (showCreate && hover === 0) {
                    onSelect({ id: 'new', name: q.trim() } as T); setOpen(false); return
                  }
                  const idx = showCreate ? hover - 1 : hover
                  const chosen = options[idx]; if (chosen) { onSelect(chosen); setOpen(false) }
                } else if (e.key === 'Escape') { setOpen(false) }
              }}
              placeholder="Type to search…"
              className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30"
            />
          </div>

          <div className="max-h-72 overflow-auto">
            {loading && <div className="px-3 py-2 text-sm text-white/60">Searching…</div>}

            {showCreate && (
              <div
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-white/5 ${hover === 0 ? 'bg-white/10' : ''}`}
                onMouseEnter={() => setHover(0)}
                onClick={() => { onSelect({ id: 'new', name: q.trim() } as T); setOpen(false) }}
              >
                ＋ {allowCreateLabel!.replace('%s', q.trim())}
              </div>
            )}

            {options.map((o, i) => {
              const idx = showCreate ? i + 1 : i
              const text = o.name
              const iQ = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
              const html = (iQ === -1) ? text
                : text.slice(0, iQ) +
                  '<mark class="bg-white/10 text-white/90 px-0.5">' +
                  text.slice(iQ, iQ + q.length) +
                  '</mark>' +
                  text.slice(iQ + q.length)
              return (
                <div
                  key={o.id}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-white/5 ${hover === idx ? 'bg-white/10' : ''}`}
                  onMouseEnter={() => setHover(idx)}
                  onClick={() => { onSelect(o); setOpen(false) }}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              )
            })}

            {!loading && !showCreate && options.length === 0 && (
              <div className="px-3 py-3 text-sm text-white/60">No results</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/** Small selected-contact chip */
function ContactChip({ name, phone, email, onClear }: { name: string; phone?: string; email?: string; onClear: () => void }) {
  const tag = [phone, email].filter(Boolean).join(' • ')
  const initials = (name || 'C').split(' ').slice(0, 2).map(s => s[0]?.toUpperCase()).join('')
  return (
    <div className="mt-1 flex items-center gap-2 rounded-none border border-white/10 bg-white/[0.04] px-2 py-1">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold"
        style={{ backgroundColor: `hsl(${(name || 'C').charCodeAt(0) * 7 % 360},65%,30%)` }}
      >{initials}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{name || 'Contact selected'}</div>
        {tag && <div className="truncate text-[11px] text-white/60">{tag}</div>}
      </div>
      <button onClick={onClear} className="text-xs px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none">Clear</button>
    </div>
  )
}

/** ---------- Embedded Roof Measure panel (satellite + draw) ---------- */
type MeasureNumbers = {
  planSqft: number
  pitchFactor: number
  roofSqft: number
  squares: number
  perimeterFt: number
}
type RoofMeasurePanelProps = { onUse: (items: Omit<LineItem, 'id'>[], note: string) => void }
const RoofMeasurePanel: React.FC<RoofMeasurePanelProps> = ({ onUse }) => {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstRef = useRef<L.Map | null>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)

  const [addr, setAddr] = useState('')
  const [pitch, setPitch] = useState('6/12')
  const [measure, setMeasure] = useState<MeasureNumbers>({
    planSqft: 0, pitchFactor: 1.118, roofSqft: 0, squares: 0, perimeterFt: 0,
  })

  const PRICE = { shinglesPerSquare: 250, underlaymentPerSquare: 50, nailsPerLb: 5, laborPerHour: 75 } as const
  const PITCH_FACTORS: Record<string, number> = { '3/12':1.035,'4/12':1.054,'5/12':1.083,'6/12':1.118,'7/12':1.158,'8/12':1.202,'9/12':1.25,'10/12':1.302,'12/12':1.414 }

  const recompute = useCallback(() => {
    const fg = featureGroupRef.current
    if (!fg) return
    const layers = (fg.getLayers() as L.Layer[]).filter((l: L.Layer): l is L.Polygon => l instanceof L.Polygon)
    const poly = layers[0]
    if (!poly) { setMeasure(m => ({ ...m, planSqft: 0, roofSqft: 0, squares: 0, perimeterFt: 0 })); return }
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

  useEffect(() => {
    if (mapInstRef.current || !mapRef.current) return
    const map = L.map(mapRef.current, { center: [40.7128, -74.006], zoom: 19, zoomControl: true })
    mapInstRef.current = map
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri' }).addTo(map)
    const fg = new L.FeatureGroup(); featureGroupRef.current = fg; map.addLayer(fg)
    const draw = new (L as any).Control.Draw({ edit: { featureGroup: fg }, draw: { polygon: true, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false } })
    map.addControl(draw)
    const onCreated = (e: any) => { fg.clearLayers(); fg.addLayer(e.layer); recompute() }
    const onEdited = (_e: any) => recompute()
    const onDeleted = (_e: any) => { fg.clearLayers(); recompute() }
    map.on((L as any).Draw.Event.CREATED, onCreated)
    map.on((L as any).Draw.Event.EDITED, onEdited)
    map.on((L as any).Draw.Event.DELETED, onDeleted)
    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated)
      map.off((L as any).Draw.Event.EDITED, onEdited)
      map.off((L as any).Draw.Event.DELETED, onDeleted)
      try { map.removeControl(draw) } catch {}
      try { map.removeLayer(fg) } catch {}
    }
  }, [recompute])

  useEffect(() => { recompute() }, [recompute])

  async function lookup() {
    if (!addr.trim()) return
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    const j = await r.json().catch(() => [])
    if (Array.isArray(j) && j[0]) {
      const { lat, lon } = j[0]
      const map = mapInstRef.current
      if (map) map.setView([Number(lat), Number(lon)], 19)
    }
  }

  const quickItems = useMemo(() => {
    const waste = 1.1
    const shinglesSquares = Math.ceil(measure.squares * waste * 100) / 100
    const underlaymentSquares = shinglesSquares
    const laborHours = Math.max(2, Math.round(measure.squares * 3 * 10) / 10)
    const nailsLbs = Math.ceil(measure.squares * 2)
    return [
      { name: 'Architectural Shingles', qty: shinglesSquares, unit: 'square', unitPrice: 250, notes: 'Includes 10% waste' },
      { name: 'Roofing Underlayment',   qty: underlaymentSquares, unit: 'square', unitPrice: 50,  notes: 'Synthetic' },
      { name: 'Roofing Nails',          qty: nailsLbs, unit: 'lb', unitPrice: 5 },
      { name: 'Labor',                  qty: laborHours, unit: 'hour', unitPrice: 75, notes: 'Skilled roofing crew' },
    ] as Omit<LineItem, 'id'>[]
  }, [measure])

  const note = `Measured ~${measure.squares.toFixed(2)} squares (plan ${Math.round(measure.planSqft)} ft², pitch factor ${measure.pitchFactor}). Perimeter ~${Math.round(measure.perimeterFt)} ft.`

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 lg:col-span-9">
        <div className="flex gap-2 mb-2">
          <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="Search address…" className="flex-1 bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm" />
          <button onClick={lookup} className="px-3 py-2 rounded-none glass text-sm">Find</button>
          <select value={pitch} onChange={e => setPitch(e.target.value)} className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm">
            {Object.keys(PITCH_FACTORS).map(p => (<option key={p} value={p}>{p} pitch</option>))}
          </select>
          <button onClick={() => onUse(quickItems, note)} className="px-3 py-2 rounded-none glass text-sm" disabled={measure.squares <= 0}>Use in Estimate</button>
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

/** ---------- Main Estimator page with tabs (CONTENT ONLY: AppShell wraps this) ---------- */
export default function Estimator() {
  const navigate = useNavigate()
  const location = useLocation()
  const packId = new URLSearchParams(location.search).get('pack') || 'general'
  const pack = (PACKS as any)[packId] || PACKS.general

  // tabs
  const [tab, setTab] = useState<'estimate' | 'measure'>('estimate')

  // contact + sender
  const [assignedContactId, setAssignedContactId] = useState<string | null>(null)
  const [contactQuery, setContactQuery] = useState('')
  const [contactOptions, setContactOptions] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)

  const [senderId, setSenderId] = useState<string | null>(null)
  const [userOptions, setUserOptions] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  // copy toast
  const [copied, setCopied] = useState(false)

  // proposal preview
  const [showPreview, setShowPreview] = useState(false)
  const [coverLetter, setCoverLetter] = useState('')
  const [coverLoading, setCoverLoading] = useState(false)

  // customer fields
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', email: '', address: '' })
  const [openDetails, setOpenDetails] = useState(false)

  // items
  const [items, setItems] = useState<LineItem[]>(() => {
    const base = (pack?.defaults?.items as any[] | undefined)
    if (Array.isArray(base) && base.length) {
      return base.map(it => ({ id: uid(), name: String(it.name || ''), qty: Number(it.qty) || 1, unit: String(it.unit || ''), unitPrice: Number(it.unitPrice) || 0, notes: it.notes ? String(it.notes) : '' }))
    }
    return [{ id: uid(), name: 'Labor', qty: 1, unit: 'hr', unitPrice: 125 }]
  })

  const addFromTemplate = useCallback((t: Omit<LineItem, 'id'>) => setItems(prev => [...prev, { id: uid(), ...t }]), [])

  const TEMPLATES: Omit<LineItem, 'id'>[] = [
    { name: 'Labor', qty: 1, unit: 'hr', unitPrice: 125, notes: '' },
    { name: 'Materials', qty: 1, unit: 'ea', unitPrice: 250, notes: 'Allowance' },
    { name: 'Disposal', qty: 1, unit: 'ea', unitPrice: 75, notes: 'Debris removal' },
    { name: 'Permit', qty: 1, unit: 'ea', unitPrice: 60, notes: '' },
  ]

  // AI prompt
  const [aiPrompt, setAiPrompt] = useState<string>(
    pack?.aiPrompt ?? 'Scope: roof leak over kitchen; 20yr architectural shingles; 2 sq repair.\nSuggest a line-item breakdown with qty & unit prices appropriate for NY.'
  )

  // totals & numbers
  const [taxRate, setTaxRate] = useState<number>(8.875)
  const [discount, setDiscount] = useState<number>(0)
  const [notes, setNotes] = useState<string>('')

  // UI state
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [showSmsTip, setShowSmsTip] = useState(false)

  // NEW: deposit percentage and accept-intent
  const [depositPct] = useState<number>(30)
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null)
  const [creatingIntent, setCreatingIntent] = useState(false)

  // Create or reuse a customer-facing accept link (intent)
  async function ensureAcceptIntent(): Promise<string> {
    if (acceptUrl) return acceptUrl
    const pct = Math.max(1, Math.min(100, depositPct))
    const contactId =
      assignedContactId || (customer.name ? `manual:${customer.name}` : 'unknown')

    const payload = {
      contactId,
      total: Math.round((items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0) - Math.max(0, Number(discount) || 0)) * (1 + ((Number(taxRate) || 0) / 100)) * 100) / 100,
      depositPct: pct,
      items: items.map(it => ({
        description: it.name,
        quantity: it.qty,
        unit: it.unit,
        unitPrice: it.unitPrice,
        notes: it.notes,
      })),
      notes,
    }

    setCreatingIntent(true)
    try {
      const r = await fetch(`${API_BASE}/api/estimates/intent`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'intent_failed')

      // Prefer url from API; otherwise fall back to public route from id
      const url =
        j?.url ||
        j?.link ||
        `${window.location.origin}/public/estimate-intents/${encodeURIComponent(j?.id || j?.intentId || 'unknown')}`

      setAcceptUrl(url)
      return url
    } catch (e: any) {
      setError(e?.message || 'Failed to create accept link')
      throw e
    } finally {
      setCreatingIntent(false)
    }
  }

  // Create a deposit invoice immediately (used by ProposalPreview "Accept" button)
  async function createDepositInvoice() {
    try {
      const pct = Math.max(1, Math.min(100, depositPct)) / 100
      const amount = Math.round(totals.total * pct * 100) / 100
      if (!amount || amount <= 0) {
        setError('Total must be > 0 to create a deposit invoice.')
        return
      }

      const contactId =
        assignedContactId ||
        (customer.name ? `manual:${customer.name}` : 'unknown')

      const body = {
        contactId,
        items: [
          {
            description: `Deposit (${Math.round(pct * 100)}%) for estimate`,
            quantity: 1,
            unitPrice: amount,
          },
        ],
        notes: `Auto-created from Estimator for ${customer.name || 'customer'}`,
        status: 'open',
      }

      const r = await fetch(`${API_BASE}/api/invoices`, {
        method: 'POST',
        ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
        body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'create_failed')

      alert('Deposit invoice created.')
    } catch (e: any) {
      setError(e?.message || 'Failed to create invoice')
    }
  }

  // compute totals
  const totals: Totals = useMemo(() => {
    const subtotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0)
    const disc = Math.max(0, Number(discount) || 0)
    const taxable = Math.max(0, subtotal - disc)
    const tax = taxable * ((Number(taxRate) || 0) / 100)
    const total = taxable + tax
    return { subtotal, discount: disc, tax, total }
  }, [items, discount, taxRate])

  /* ---------- Contact & User data ---------- */
  useEffect(() => {
    let alive = true
    async function run() {
      setUsersLoading(true)
      try {
        const r = await fetch(`${API_BASE}/api/mock/ghl/users`)
        const j = await r.json().catch(() => [])
        if (!alive) return
        if (Array.isArray(j) && j.length) setUserOptions(j as User[])
        else setUserOptions([
          { id: 'u1', name: 'Alex Johnson', phone: '+15550001001' },
          { id: 'u2', name: 'Taylor Kim', phone: '+15550001002' },
        ])
      } catch {
        setUserOptions([
          { id: 'u1', name: 'Alex Johnson', phone: '+15550001001' },
          { id: 'u2', name: 'Taylor Kim', phone: '+15550001002' },
        ])
      } finally {
        setUsersLoading(false)
      }
    }
    run()
    return () => { alive = false }
  }, [])

  const searchContacts = useCallback(async (q: string) => {
    setContactsLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/mock/ghl/contacts/search?q=${encodeURIComponent(q)}`)
      const j = await r.json().catch(() => [])
      if (Array.isArray(j)) setContactOptions(j as Contact[])
      else setContactOptions([])
    } catch {
      const demo: Contact[] = [
        { id: 'c1', name: 'John Carpenter', phone: '+15555550123', email: 'john@example.com', address: '12 Elm St, Queens, NY' },
        { id: 'c2', name: 'Maria Gomez', phone: '+15555554200', email: 'maria@example.com', address: '48 Pine Ave, Brooklyn, NY' },
      ].filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
      setContactOptions(demo)
    } finally {
      setContactsLoading(false)
    }
  }, [])
  useEffect(() => { searchContacts(contactQuery) }, [contactQuery, searchContacts])

  function onSelectContact(c: Contact) {
    if (c.id === 'new') {
      setAssignedContactId(null)
      setCustomer(prev => ({ ...prev, name: c.name }))
      setOpenDetails(true)
      return
    }
    setAssignedContactId(c.id)
    setCustomer({ name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '' })
    setOpenDetails(true)
  }
  function clearContact() {
    setAssignedContactId(null)
    setCustomer({ name: '', phone: '', email: '', address: '' })
  }

  /* ---------- Item helpers ---------- */
  function addItem() { setItems(prev => [...prev, { id: uid(), name: '', qty: 1, unit: '', unitPrice: 0 }]) }
  function removeItem(id: string) { setItems(prev => prev.filter(x => x.id !== id)) }
  function updateItem(id: string, patch: Partial<LineItem>) { setItems(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x))) }

  /* ---------- Estimate text & actions ---------- */
  function buildEstimateText(extra?: { acceptUrl?: string }): string {
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
    if (extra?.acceptUrl) {
      lines.push('— — —')
      lines.push(`Accept & Sign: ${extra.acceptUrl}`)
    }
    return lines.join('\n')
  }

  async function handleCopyEstimate() {
    try {
      await navigator.clipboard.writeText(buildEstimateText(acceptUrl ? { acceptUrl } : undefined))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { setError('Copy failed') }
  }

  async function handleSendSMS() {
    setError(null)
    const toPhone = normalizePhone(customer.phone)
    if (!toPhone) { setError('Enter a valid customer phone first.'); return }
    try {
      // Ensure accept link exists and append to SMS
      const link = await ensureAcceptIntent()
      const text = buildEstimateText({ acceptUrl: link })

      setSending(true)
      const r = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: assignedContactId || `manual:${toPhone}`, to: toPhone, text, direction: 'outbound', autopilot: false, senderId: senderId || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || (j as any)?.ok === false) throw new Error((j as any)?.error || 'Failed to send SMS')
      navigate(`/chatter/${encodeURIComponent(assignedContactId || `manual:${toPhone}`)}`)
    } catch (e: any) {
      setError(e?.message || 'Failed to send SMS')
    } finally {
      setSending(false)
    }
  }

  async function handleAiAssist() {
    setError(null); setAiLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/agent/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: aiPrompt }) })
      if (r.status === 404) { setError('AI endpoint not wired yet. Next: add POST /api/agent/estimate to call your agent and return items.'); return }
      const j = await r.json()
      if (Array.isArray(j?.items) && j.items.length) {
        setItems(j.items.map((it: any) => ({ id: uid(), name: it.name || '', qty: Number(it.qty) || 1, unit: it.unit || '', unitPrice: Number(it.unitPrice) || 0, notes: it.notes || '' })))
      } else if (typeof j?.text === 'string') {
        const parsed: LineItem[] = j.text.split('\n').map((raw: string) => {
          const m = raw.match(/^(.*?):\s*([\d.]+)\s*(\w+)?\s*@\s*\$?([\d,.]+)/i)
          return { id: uid(), name: (m?.[1] || raw).trim(), qty: m ? Number(m[2]) : 1, unit: m?.[3] || '', unitPrice: m ? Number(String(m[4]).replace(/,/g, '')) : 0 }
        }).filter((x: LineItem) => Boolean(x.name))
        if (parsed.length) setItems(parsed)
      } else { setError('AI did not return items. We’ll refine the endpoint next.') }
    } catch (e: any) { setError(e?.message || 'AI Assist failed') } finally { setAiLoading(false) }
  }

  // 🔁 NEW: structured cover-letter generation
  async function generateCoverLetter() {
    setCoverLoading(true)
    try {
      const r = await fetch(`${API_BASE}/api/agent/proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: 'friendly',
          customer,
          notes,
          items: items.map(it => ({
            name: it.name, qty: it.qty, unit: it.unit, unitPrice: it.unitPrice, notes: it.notes || ''
          })),
        }),
      })
      const j = await r.json().catch(() => ({}))
      const t = (j?.text && String(j.text)) || ''
      if (t) { setCoverLetter(t); return }
      // graceful fallback
      setCoverLetter(`Hi ${customer.name || 'there'},\n\nThanks for inviting us to look at your project. We’ve outlined a clear scope and transparent pricing below. Our licensed team will complete the work safely and efficiently, and we’ll keep you updated at each step.\n\nPlease review the estimate and let us know if you’d like any adjustments. If everything looks good, reply here or call us to pick a start date.\n\nBest regards,\nNONSTOP JOBS`)
    } catch {
      setCoverLetter(`Thank you for the opportunity. The following proposal outlines our recommended scope and pricing. Please let us know if you have any questions or would like to schedule.`)
    } finally { setCoverLoading(false) }
  }

  const phoneValid = !!normalizePhone(customer.phone)
  const canSend = items.length > 0 && phoneValid
  const selectedSender = senderId ? userOptions.find(u => u.id === senderId) : undefined

  // ---------- CONTENT ONLY (AppShell provides TopBar/StatBar/SideNav) ----------
  return (
    <div className="flex flex-col gap-3 min-h-[70vh]">
      {/* === Toolbar above the panel (moved out) === */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3">
        <div className="flex items-center gap-2">
          <div className="bg-white/5 border border-white/10 rounded-full p-0.5">
            <button
              className={['px-3 py-1.5 text-sm rounded-full', tab === 'estimate' ? 'bg-white/10' : 'hover:bg-white/5'].join(' ')}
              onClick={() => setTab('estimate')}
            >
              Estimate
            </button>
            <button
              className={['px-3 py-1.5 text-sm rounded-full', tab === 'measure' ? 'bg-white/10' : 'hover:bg-white/5'].join(' ')}
              onClick={() => setTab('measure')}
            >
              Measure
            </button>
          </div>
        </div>

        {tab === 'estimate' && (
          <div className="relative flex flex-wrap items-center gap-2 md:gap-3">
            <button
              className="inline-flex items-center gap-2 md:px-4 md:py-2 px-3 py-1.5 text-sm rounded-none bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white border border-sky-400/30 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleSendSMS}
              onMouseEnter={() => !canSend && setShowSmsTip(true)}
              onMouseLeave={() => setShowSmsTip(false)}
              onFocus={() => !canSend && setShowSmsTip(true)}
              onBlur={() => setShowSmsTip(false)}
              disabled={sending || !canSend}
              aria-busy={sending}
              title={canSend ? 'Send estimate via SMS' : 'Add a valid phone and at least one item'}
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? 'Sending…' : 'Send via SMS'}
            </button>

            <DispositionButton
              contactId={assignedContactId || customer.name || 'unknown'}
              onDispo={async (p: DispositionPayload) => {
                await fetch(`${API_BASE}/api/dispositions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
                await fetch(`${API_BASE}/api/agent/followup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
              }}
            />

            {!canSend && showSmsTip && (
              <div role="tooltip" className="absolute top-full mt-1 left-0 text-[11px] bg-black/80 border border-white/10 px-2 py-1 rounded-none">
                Add at least one item and a valid phone to enable SMS.
              </div>
            )}

            <div className="hidden md:block h-6 w-px bg-white/10" />

            <button
              type="button"
              onClick={handleCopyEstimate}
              className="inline-flex items-center gap-2 md:px-4 md:py-2 px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-60"
              title="Copy estimate text to clipboard"
              disabled={items.length === 0}
            >
              <CopyIcon size={16} /> {copied ? 'Copied!' : 'Copy'}
            </button>

            <button
              type="button"
              onClick={async () => { setShowPreview(true); if (!coverLetter) await generateCoverLetter() }}
              className="inline-flex items-center gap-2 md:px-4 md:py-2 px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-60"
              title="See print-ready proposal with AI cover letter"
              disabled={items.length === 0}
            >
              <Eye size={16} /> Preview Proposal
            </button>

            {/* NEW: Create/Copy Accept link */}
            <button
              type="button"
              onClick={async () => {
                try {
                  const link = await ensureAcceptIntent()
                  await navigator.clipboard.writeText(link)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                } catch { /* error set in ensureAcceptIntent */ }
              }}
              className="inline-flex items-center gap-2 md:px-4 md:py-2 px-3 py-1.5 text-sm rounded-none bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white border border-emerald-400/30 disabled:opacity-60"
              disabled={items.length === 0 || totals.total <= 0 || creatingIntent}
              title="Generate a customer-facing accept link and copy it"
            >
              {creatingIntent ? <Loader2 size={16} className="animate-spin" /> : null}
              {acceptUrl ? 'Copy Accept Link' : `Create Accept Link (${depositPct}% deposit)`}
            </button>

            {!canSend && <div className="basis-full md:hidden text-xs text-white/55">Add at least one item and a valid phone to enable SMS.</div>}
          </div>
        )}
      </div>
      {/* === End toolbar === */}

      {/* === Panel with page content (no toolbar inside) === */}
      <div className="glass rounded-none p-3 md:p-4 flex flex-col gap-3 flex-1">
        {tab === 'measure' ? (
          <RoofMeasurePanel
            onUse={(list, note) => {
              setItems(list.map(it => ({ id: uid(), ...it })))
              setNotes(note)
              setTab('estimate')
            }}
          />
        ) : (
          <>
            {/* Assign to contact + Sender */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="md:col-span-2">
                <div className="text-xs font-semibold tracking-wide mb-1">ASSIGN TO CONTACT</div>
                <SearchableSelect<Contact>
                  value={assignedContactId ? { id: assignedContactId, name: customer.name } : null}
                  onSelect={onSelectContact}
                  onSearch={setContactQuery}
                  options={contactOptions}
                  placeholder="Search by name or phone…"
                  loading={contactsLoading}
                  allowCreateLabel="Create contact “%s”"
                />
                {assignedContactId ? (
                  <ContactChip name={customer.name} phone={customer.phone} email={customer.email} onClear={clearContact} />
                ) : (
                  <div className="text-xs text-white/60 mt-1">Select a contact to auto-fill details.</div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold tracking-wide mb-1">SENDER (USER)</div>
                <SearchableSelect<User>
                  value={senderId ? userOptions.find(u => u.id === senderId) || null : null}
                  onSelect={u => setSenderId(u.id)}
                  onSearch={() => {}}
                  options={userOptions}
                  placeholder="Choose user…"
                  loading={usersLoading}
                />
                {senderId && (
                  <div className="mt-1 text-xs text-white/60">
                    From: <span className="text-white/80">{userOptions.find(u => u.id === senderId)?.name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Customer details */}
            <div className="border border-white/10 bg-white/[0.035] mt-2">
              <button type="button" onClick={() => setOpenDetails(o => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
                <span>Customer details</span>
                <span className="text-white/60">{openDetails ? '▴' : '▾'}</span>
              </button>
              {openDetails && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 px-3 pb-3">
                  <input value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" readOnly={!assignedContactId} />
                  <div className="relative">
                    <input value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} placeholder="Customer phone (+1 555 555 0123)" className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" readOnly={!assignedContactId} />
                    {!assignedContactId && <span className="absolute right-2 top-2 text-white/40">🔒</span>}
                  </div>
                  <input value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} placeholder="Email (optional)" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" readOnly={!assignedContactId} />
                  <input value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} placeholder="Address (optional)" className="bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" readOnly={!assignedContactId} />
                  {!phoneValid && (customer.phone?.length > 0 || assignedContactId) && (
                    <div className="md:col-span-4 text-xs text-red-400">Please enter a valid phone number (E.164).</div>
                  )}
                </div>
              )}
            </div>

            {/* Quick add */}
            <div className="flex flex-wrap gap-2 mb-2 mt-2">
              {[
                { name: 'Labor', qty: 1, unit: 'hr', unitPrice: 125, notes: '' },
                { name: 'Materials', qty: 1, unit: 'ea', unitPrice: 250, notes: 'Allowance' },
                { name: 'Disposal', qty: 1, unit: 'ea', unitPrice: 75, notes: 'Debris removal' },
                { name: 'Permit', qty: 1, unit: 'ea', unitPrice: 60, notes: '' },
              ].map(t => (
                <button key={t.name} onClick={() => addFromTemplate(t)} className="px-2 py-1 text-xs rounded-none glass hover:bg-white/10" title={`${t.qty} ${t.unit} @ ${currency(t.unitPrice)}`}>
                  + {t.name}
                </button>
              ))}
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

              {items.map(it => {
                const line = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
                return (
                  <div key={it.id} className="grid grid-cols-12 gap-2 p-2 border-t border-white/10">
                    <div className="col-span-4">
                      <input value={it.name} onChange={e => updateItem(it.id, { name: e.target.value })} placeholder="Description" className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                      <input value={it.notes || ''} onChange={e => updateItem(it.id, { notes: e.target.value })} placeholder="Notes (optional)" className="mt-1 w-full bg-black/20 border border-white/10 rounded-none px-2 py-1 text-xs outline-none focus:border-white/30" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" min={0} step="0.01" value={it.qty} onChange={e => updateItem(it.id, { qty: Number(e.target.value) })} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                    </div>
                    <div className="col-span-2">
                      <input value={it.unit} onChange={e => updateItem(it.id, { unit: e.target.value })} placeholder="hr, sq, ea…" className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" min={0} step="0.01" value={it.unitPrice} onChange={e => updateItem(it.id, { unitPrice: Number(e.target.value) })} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30" />
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
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes / terms" rows={4} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
              </div>
              <div className="md:col-span-1 border border-white/10 rounded-none p-2 bg-white/5 sticky top-3 self-start">
                <div className="flex items-center justify-between text-sm"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
                <div className="flex items-center justify-between gap-2 mt-2 text-sm">
                  <label className="opacity-80">Discount ($)</label>
                  <input type="number" min={0} step="0.01" value={discount} onChange={e => setDiscount(Number(e.target.value))} className="w-24 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm text-right outline-none focus:border-white/30" />
                </div>
                <div className="flex items-center justify-between gap-2 mt-2 text-sm">
                  <label className="opacity-80">Tax rate (%)</label>
                  <input type="number" min={0} step="0.01" value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className="w-24 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm text-right outline-none focus:border-white/30" />
                </div>
                <div className="h-px bg-white/10 my-3" />
                <div className="flex items-center justify-between text-base font-semibold"><span>Total</span><span>{currency(totals.total)}</span></div>
              </div>
            </div>

            {/* AI Assist */}
            <div className="border border-white/10 rounded-none p-2 bg-neutral-900">
              <div className="text-sm font-semibold mb-2">AI Assist (beta)</div>
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3} className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30" />
              <div className="mt-2 flex items-center gap-2">
                <button className="px-3 py-1.5 text-sm rounded-none bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white border border-sky-400/30 disabled:opacity-60 disabled:cursor-not-allowed" onClick={handleAiAssist} disabled={aiLoading}>
                  {aiLoading ? 'Thinking…' : 'AI-Powered Calculation'}
                </button>
                {error && <div className="text-sm text-red-400">{error}</div>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Proposal Preview Side Panel */}
      <ProposalPreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
        companyName="NONSTOP JOBS"
        brandingAccent="from-sky-500 to-blue-500"
        items={items}
        totals={totals}
        customer={customer}
        notes={notes}
        coverLetter={coverLetter}
        onRegenerate={generateCoverLetter}
        generating={coverLoading}
        sender={{ name: selectedSender?.name, title: 'Project Manager', phone: selectedSender?.phone, email: selectedSender?.email }}
        depositPct={30}
        showDepositCta
        onAcceptDeposit={createDepositInvoice}
      />
    </div>
  )
}