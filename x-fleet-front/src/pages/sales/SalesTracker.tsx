'use client'

import * as React from 'react'

// Sales feature components you already have
import UnassignedPaymentsTable from "../../components/sales/UnassignedPaymentsTable";
import CommissionByRep from "../../components/sales/CommissionByRep";
import OutstandingByCustomer from "../../components/sales/OutstandingByCustomer";
import CustomersBreakdown from "../../components/sales/CustomersBreakdown";
import MonthlyReports from "../../components/sales/MonthlyReports";
import { api, resolveTenantId } from "../../lib/http";

// ------------------------------------------------------------
// Dark theme using ONLY React + Tailwind (no external UI deps)
// Brand accent stays red; surfaces are deep neutrals with
// subtle separators for an accessible, high-contrast UI.
// ------------------------------------------------------------

type RangeKey = 'mtd' | 'qtd' | 'ytd'

function toApiRange(key: RangeKey): 'this-month' | 'last-30' {
  if (key === 'mtd') return 'this-month'
  // Temporary mappings until we add real QTD/YTD server support:
  if (key === 'qtd') return 'last-30'
  if (key === 'ytd') return 'last-30'
  return 'this-month'
}

export default function SalesTracker(): JSX.Element {
  const [range, setRange] = React.useState<RangeKey>('mtd')

  // KPI: total commissions for selected range
  const [commissionTotal, setCommissionTotal] = React.useState<number | null>(null)
  const [kpiBusy, setKpiBusy] = React.useState(false)
  const [kpiErr, setKpiErr] = React.useState<string | null>(null)

  React.useEffect(() => {
  let alive = true;
  (async () => {
    try {
      setKpiBusy(true);
      setKpiErr(null);

      const apiRange = toApiRange(range);
      const tenant = resolveTenantId();

      // Use tenant-aware axios (adds X-Tenant-Id + clientId, routes to VITE_API_BASE)
      const { data } = await api.get("/api/analytics/commission-by-rep", {
        params: { range: apiRange, clientId: tenant },
        headers: { "X-Tenant-Id": tenant },
      });

      if (!alive) return;
      const rows = Array.isArray(data) ? data : [];
      const sum = rows.reduce((s: number, row: any) => s + (Number(row.commission_usd) || 0), 0);
      setCommissionTotal(Number(sum.toFixed(2)));
    } catch (e: any) {
      if (!alive) return;
      setKpiErr(e?.message || "Failed to load");
      setCommissionTotal(null);
    } finally {
      if (alive) setKpiBusy(false);
    }
  })();
  return () => { alive = false; };
}, [range]);

  return (
    <div className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Sticky top toolbar */}
      <header className="sticky top-0 z-40 border-b border-neutral-800/60 bg-neutral-950/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] px-4 md:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Sales &amp; Commissions</h1>
            <span className="hidden md:inline-block rounded-full border border-red-700/40 px-2.5 py-0.5 text-xs bg-red-900/30 text-red-300">live</span>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            {/* Search (desktop) */}
            <div className="relative hidden md:block">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
              <input
                className="pl-8 w-[260px] h-9 rounded-lg border border-neutral-800/60 bg-neutral-925 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                placeholder="Search customers, reps, invoices…"
              />
            </div>

            {/* Quick timeframe */}
            <div className="hidden md:flex rounded-lg border border-neutral-800/60 p-0.5 bg-neutral-900/60">
              {(['mtd','qtd','ytd'] as RangeKey[]).map(key => (
                <button
                  key={key}
                  onClick={() => setRange(key)}
                  className={[
                    'px-3 h-8 rounded-md text-xs font-medium transition-colors',
                    range === key
                      ? 'bg-red-600 text-white'
                      : 'text-neutral-300 hover:bg-neutral-850'
                  ].join(' ')}
                >
                  {key.toUpperCase()}
                </button>
              ))}
            </div>

            <button className="hidden md:inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-800/60 bg-neutral-900 px-3 text-sm text-neutral-200 hover:bg-neutral-850">Date range</button>
            <button className="hidden md:inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-800/60 bg-neutral-900 px-3 text-sm text-neutral-200 hover:bg-neutral-850">Filters</button>

            <div className="relative">
              <select className="h-9 rounded-lg border border-neutral-800/60 bg-neutral-900 px-3 pr-8 text-sm text-neutral-200 hover:bg-neutral-850">
                <option>Export CSV</option>
                <option>Export XLSX</option>
                <option>Export PDF</option>
              </select>
            </div>

            <button aria-label="Refresh data" className="h-9 w-9 rounded-lg border border-neutral-800/60 bg-neutral-900 text-neutral-300 hover:bg-neutral-850 active:scale-[.98]">↻</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 md:px-6 lg:px-8 py-6 space-y-6">
        {/* KPI band (neutral, no red glow) */}
        <div className="rounded-2xl border border-neutral-800/60 bg-neutral-950 p-4 md:p-6">
          <section className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Unassigned Payments" hint="Needs matching" />
            <KpiCard
              label={`Total Commission (${range.toUpperCase()})`}
              value={commissionTotal != null ? fmtUsd(commissionTotal) : (kpiBusy ? '…' : '—')}
              hint={kpiErr ? `Error: ${kpiErr}` : 'Period to date'}
            />
            <KpiCard label="Outstanding Balance" hint="Open invoices" />
            <KpiCard label="Active Customers" hint="This period" />
          </section>
        </div>

        {/* Unassigned Payments */}
        <SectionCard
          title="Unassigned Payments"
          subtitle="Payments that need to be matched to invoices or customers."
        >
          <div className="px-4 py-3 border-b border-neutral-800/60 flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-neutral-950">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
              <input
                className="pl-8 w-[240px] h-9 rounded-lg border border-neutral-800/60 bg-neutral-900 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                placeholder="Quick search…"
              />
            </div>
            <div className="flex items-center gap-2">
              <button className="h-9 rounded-lg border border-neutral-800/60 bg-neutral-900 px-3 text-sm text-neutral-200 hover:bg-neutral-850">
                Filter
              </button>
            </div>
          </div>
          <div className="p-0">
            <UnassignedPaymentsTable />
          </div>
        </SectionCard>

        {/* Two-up analytics */}
        <div className="grid gap-6 md:grid-cols-12">
          <SectionCard title="Commission by Rep" className="md:col-span-6">
            <div className="p-0">
              <CommissionByRep />
            </div>
          </SectionCard>

          <SectionCard title="Outstanding by Customer" className="md:col-span-6">
            <div className="p-0">
              <OutstandingByCustomer />
            </div>
          </SectionCard>
        </div>

        {/* Monthly Reports */}
        <SectionCard title="Monthly Reports" subtitle="Earned vs. paid (net due) by rep, per month.">
          <div className="p-0">
            {/* Shared component (defaults to 12 months) */}
            <MonthlyReports />
          </div>
        </SectionCard>

        {/* Customers */}
        <SectionCard title="Customers" subtitle="Breakdown of active customers, balances, and statuses.">
          <div className="p-0">
            <CustomersBreakdown />
          </div>
        </SectionCard>
      </main>
    </div>
  )
}


/* ========================== Local UI primitives ========================== */

type MiniStatProps = { label: string; value: string; accent?: boolean }
function MiniStat({ label, value, accent }: MiniStatProps) {
  return (
    <div
      className={[
        "rounded-xl border px-4 py-3",
        accent ? "border-red-500/30 bg-neutral-925" : "border-neutral-800/60 bg-neutral-950"
      ].join(' ')}
    >
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={["text-lg font-semibold", accent ? "text-red-300" : "text-neutral-100"].join(' ')}>
        {value}
      </div>
    </div>
  )
}

type SectionCardProps = {
  title: string
  subtitle?: string
  className?: string
  children: React.ReactNode
}

function SectionCard({ title, subtitle, className, children }: SectionCardProps): JSX.Element {
  return (
    <section
      className={[
        'rounded-2xl border border-neutral-800/60 bg-neutral-950 transition-shadow',
        className || ''
      ].join(' ')}
    >
      <div className="px-4 md:px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base md:text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="text-sm text-neutral-400 mt-0.5">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-800/60" />
      {children}
    </section>
  )
}

type KpiCardProps = { label: string; value?: React.ReactNode; hint?: string }
function KpiCard({ label, value, hint }: KpiCardProps): JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-800/60 bg-neutral-950">
      <div className="px-4 md:px-5 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-neutral-300">{label}</p>
        </div>
      </div>
      <div className="px-4 md:px-5 pb-4">
        <div className="flex items-end justify-between">
          <div className="text-3xl font-semibold tracking-tight text-neutral-100">{value ?? '—'}</div>
          {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
        </div>
      </div>
    </div>
  )
}

// Minimal inline magnifying glass icon (to avoid icon deps)
function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

/* ========================== Tiny utils ========================== */

function fmtUsd(n: number | null | undefined): string {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function formatMonthLabel(yyyyMm: string): string {
  // "2025-03" -> "Mar 2025"
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1))
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}