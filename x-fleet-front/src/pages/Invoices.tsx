// src/pages/Invoices.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../config'
import { withTenant } from '../lib/socket'
import { Plus, Loader2, Download } from 'lucide-react'

type InvoiceStatus = 'open' | 'overdue' | 'paid' | 'deposit' | 'sent'
type Invoice = {
  id: string
  number?: string
  contactId?: string
  customer?: string
  issuedAt?: string // ISO
  dueAt?: string    // ISO
  status: InvoiceStatus
  amount: number
}

const money = (n = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

// Safer fetch that avoids the “Unexpected token '<'” failure by verifying content-type
async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`)
  }
  const j = await res.json()
  if (!res.ok || (j && j.ok === false)) {
    throw new Error(j?.error || `Request failed (${res.status})`)
  }
  return j
}

type FilterKey = 'all' | 'open' | 'overdue' | 'paid' | 'deposit' | 'sent'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'open',    label: 'Open (AR)' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid',    label: 'Paid' },
  { key: 'deposit', label: 'Deposits' },
  { key: 'sent',    label: 'Sent' },
]

export default function Invoices() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Invoice[]>([])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const url = new URL(`${API_BASE}/api/invoices`)
      if (filter !== 'all') url.searchParams.set('status', filter)
      if (q.trim()) url.searchParams.set('q', q.trim())
      const j = await fetchJSON(url.toString(), withTenant({}))
      // Accept either {invoices:[...]} or raw array
      const data: Invoice[] = Array.isArray(j) ? j : (Array.isArray(j?.invoices) ? j.invoices : [])
      setRows(
        data.map((d, i) => ({
          id: d.id || String(i + 1),
          number: d.number || `#${String(i + 1).padStart(4, '0')}`,
          contactId: d.contactId,
          customer: d.customer || d.contactId || 'Customer',
          issuedAt: d.issuedAt,
          dueAt: d.dueAt,
          status: (d.status || 'open') as InvoiceStatus,
          amount: Number(d.amount) || 0,
        }))
      )
    } catch (e: any) {
      setRows([])
      setError(e?.message || 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }

  // Load on mount and when the filter changes (search loads on Enter/click)
  useEffect(() => { void load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const base = { all: 0, open: 0, overdue: 0, paid: 0, deposit: 0, sent: 0 } as Record<FilterKey, number>
    for (const r of rows) {
      base.all += r.amount
      base[r.status as FilterKey] = (base[r.status as FilterKey] || 0) + r.amount
    }
    return base
  }, [rows])

  const filteredRows = useMemo(() => {
    const text = q.trim().toLowerCase()
    let out = rows
    if (filter !== 'all') out = out.filter(r => r.status === filter)
    if (text) out = out.filter(r =>
      (r.customer || '').toLowerCase().includes(text) ||
      (r.number || '').toLowerCase().includes(text)
    )
    return out
  }, [rows, q, filter])

  return (
    <div className="flex flex-col gap-4">
      {/* Header row (NON-sticky to avoid page jumps) */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map(f => {
            const active = f.key === filter
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={[
                  'px-3 py-1.5 rounded-full text-sm border',
                  active
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/[0.03] border-white/10 text-white/80 hover:bg-white/10'
                ].join(' ')}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="Search customer or #"
              className="w-64 bg-black/30 border border-white/10 rounded-none px-2 py-1.5 text-sm outline-none focus:border-white/30"
            />
            {q && (
              <button
                onClick={() => { setQ(''); void load() }}
                className="absolute right-1 top-1 text-white/40 hover:text-white/80"
                aria-label="Clear"
              >×</button>
            )}
          </div>
          <button
            onClick={() => {/* TODO: wire export */}}
            className="px-2 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1"
            title="Export CSV"
          >
            <Download size={16} /> Export
          </button>
          <button
            onClick={() => {/* TODO: route to invoice composer */}}
            className="px-3 py-1.5 text-sm rounded-none bg-sky-600 hover:bg-sky-500 text-white border border-sky-400/30 inline-flex items-center gap-1"
          >
            <Plus size={16} /> New invoice
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Summary label="All"      value={counts.all} />
        <Summary label="Open"     value={counts.open} />
        <Summary label="Overdue"  value={counts.overdue} />
        <Summary label="Paid"     value={counts.paid} />
        <Summary label="Deposit"  value={counts.deposit} />
        <Summary label="Sent"     value={counts.sent} />
      </div>

      {/* Error banner (kept visible but non-sticky) */}
      {error && (
        <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-none">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-white/10">
        <div className="grid grid-cols-12 gap-2 p-2 bg-white/5 text-xs text-white/70">
          <div className="col-span-2 sm:col-span-1">#</div>
          <div className="col-span-4 sm:col-span-4">Customer</div>
          <div className="col-span-2 sm:col-span-2">Issued</div>
          <div className="col-span-2 sm:col-span-2">Due</div>
          <div className="col-span-2 sm:col-span-2">Status</div>
          <div className="col-span-2 sm:col-span-1 text-right">Amount</div>
        </div>

        {loading ? (
          <div className="p-6 flex items-center justify-center text-white/70">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading…
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-white/60">No invoices.</div>
        ) : (
          filteredRows.map((r) => (
            <div key={r.id} className="grid grid-cols-12 gap-2 p-2 border-t border-white/10 items-center">
              <div className="col-span-2 sm:col-span-1">{r.number || r.id}</div>
              <div className="col-span-4 sm:col-span-4 truncate">{r.customer || 'Customer'}</div>
              <div className="col-span-2 sm:col-span-2">{fmtDate(r.issuedAt)}</div>
              <div className="col-span-2 sm:col-span-2">{fmtDate(r.dueAt)}</div>
              <div className="col-span-2 sm:col-span-2"><StatusPill s={r.status} /></div>
              <div className="col-span-2 sm:col-span-1 text-right">{money(r.amount)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-none border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/60">{label}</div>
      <div className="text-lg font-semibold">{money(value)}</div>
    </div>
  )
}

function StatusPill({ s }: { s: InvoiceStatus }) {
  const cls =
    s === 'paid'    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
    s === 'overdue' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
    s === 'deposit' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
    s === 'sent'    ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' :
                      'bg-white/10 text-white/80 border-white/20'
  return <span className={`inline-block px-2 py-0.5 text-xs border rounded-full ${cls}`}>{title(s)}</span>
}

function fmtDate(iso?: string) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString()
  } catch { return '—' }
}
function title(s: string) { return s.slice(0,1).toUpperCase() + s.slice(1) }