// src/pages/LeadHub.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, Mail, Link2, PlugZap, ChevronDown, ChevronRight,
  Sparkles, ShieldCheck, Search
} from 'lucide-react'
import { API_BASE } from '../config'
import { getTenantId, withTenant } from '../lib/socket'
import CopyField from '../components/CopyField'

/* ----------------------------------------------------------------------------
 * Shared config
 * -------------------------------------------------------------------------- */
const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`

const SOURCE_TONE: Record<string, string> = {
  facebook:   'bg-[#1877F2]/15 text-[#D7E3FF] ring-[#1877F2]/30',
  lsa:        'bg-[#34A853]/15 text-emerald-100 ring-emerald-500/30',
  thumbtack:  'bg-[#F39C12]/15 text-amber-100 ring-amber-500/30',
  google_ads: 'bg-[#4285F4]/15 text-sky-100 ring-sky-500/30',
  yelp:       'bg-[#D32323]/15 text-red-100 ring-red-500/30',
  angi:       'bg-[#19A974]/15 text-emerald-100 ring-emerald-500/30',
  nextdoor:   'bg-[#25A35A]/15 text-green-100 ring-green-500/30',
  bing_ads:   'bg-[#008373]/15 text-teal-100 ring-teal-500/30',
  snapchat:   'bg-[#FFFC00]/20 text-yellow-900 ring-yellow-300/30',
  tiktok:     'bg-[#000000]/30 text-white ring-white/10',
  zapier:     'bg-[#FF4F00]/15 text-orange-100 ring-orange-500/30',
  web:        'bg-violet-500/20 text-violet-100 ring-violet-500/30',
  webhook:    'bg-indigo-500/15 text-indigo-100 ring-indigo-500/30',
  other:      'bg-white/10 text-white/80 ring-white/20',
}

type IntegrationDef = {
  id: string
  key: string
  brand: string
  category: 'Ads' | 'Marketplaces' | 'Directories' | 'Automation' | 'Website' | 'Other'
  tone: string
  connectPath: string
  // Optional: if you add real logos in /src/assets/integrations/*.svg, import and set this
  logoUrl?: string
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: 'fb-lead-ads',   key: 'facebook',   brand: 'Facebook Lead Ads',            category: 'Ads',          tone: SOURCE_TONE.facebook,   connectPath: '/integrations/facebook/connect' },
  { id: 'google-lsa',    key: 'lsa',        brand: 'Google Local Services (LSA)',  category: 'Ads',          tone: SOURCE_TONE.lsa,        connectPath: '/integrations/lsa/connect' },
  { id: 'google-ads',    key: 'google_ads', brand: 'Google Ads (Offline Conv.)',   category: 'Ads',          tone: SOURCE_TONE.google_ads, connectPath: '/integrations/google-ads/connect' },
  { id: 'thumbtack',     key: 'thumbtack',  brand: 'Thumbtack',                     category: 'Marketplaces', tone: SOURCE_TONE.thumbtack,  connectPath: '/integrations/thumbtack/connect' },
  // more common asks
  { id: 'yelp',          key: 'yelp',       brand: 'Yelp Ads / Leads',             category: 'Directories',  tone: SOURCE_TONE.yelp,       connectPath: '/integrations/yelp/connect' },
  { id: 'angi',          key: 'angi',       brand: 'Angi / HomeAdvisor',           category: 'Directories',  tone: SOURCE_TONE.angi,       connectPath: '/integrations/angi/connect' },
  { id: 'nextdoor',      key: 'nextdoor',   brand: 'Nextdoor Ads',                 category: 'Directories',  tone: SOURCE_TONE.nextdoor,   connectPath: '/integrations/nextdoor/connect' },
  { id: 'bing-ads',      key: 'bing_ads',   brand: 'Microsoft (Bing) Ads',         category: 'Ads',          tone: SOURCE_TONE.bing_ads,   connectPath: '/integrations/bing-ads/connect' },
  { id: 'snapchat-ads',  key: 'snapchat',   brand: 'Snapchat Ads',                 category: 'Ads',          tone: SOURCE_TONE.snapchat,   connectPath: '/integrations/snapchat/connect' },
  { id: 'tiktok-ads',    key: 'tiktok',     brand: 'TikTok Ads',                   category: 'Ads',          tone: SOURCE_TONE.tiktok,     connectPath: '/integrations/tiktok/connect' },
  { id: 'zapier',        key: 'zapier',     brand: 'Zapier',                       category: 'Automation',   tone: SOURCE_TONE.zapier,     connectPath: '/integrations/zapier/connect' },
  { id: 'webhook',       key: 'webhook',    brand: 'Universal Webhook',            category: 'Automation',   tone: SOURCE_TONE.webhook,    connectPath: '/integrations/webhook/connect' },
  { id: 'site-form',     key: 'web',        brand: 'Website / Hosted Form',        category: 'Website',      tone: SOURCE_TONE.web,        connectPath: '/integrations/website/connect' },
  { id: 'other',         key: 'other',      brand: 'Other Source',                 category: 'Other',        tone: SOURCE_TONE.other,      connectPath: '/integrations/other/connect' },
]

/* ----------------------------------------------------------------------------
 * Little helpers
 * -------------------------------------------------------------------------- */
const fmt = (n?: number) => new Intl.NumberFormat().format(Number(n || 0))
const dateRange = (d: number) => {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - d + 1)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

/* ----------------------------------------------------------------------------
 * Page
 * -------------------------------------------------------------------------- */
export default function LeadHub() {
  const tenantId = useMemo(() => getTenantId(), [])
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // simple status for the header
  const [connected, setConnected] = useState<string[]>([])
  const [last24, setLast24] = useState<number>(0)

  // gallery controls (scales to 20+ sources)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'All' | IntegrationDef['category']>('All')
  const [showAll, setShowAll] = useState(false)
  const categories: Array<'All' | IntegrationDef['category']> = ['All', 'Ads', 'Marketplaces', 'Directories', 'Automation', 'Website', 'Other']

  const filteredIntegrations = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return INTEGRATIONS.filter(i => {
      const matchCat = cat === 'All' || i.category === cat
      const matchText = !needle || i.brand.toLowerCase().includes(needle)
      return matchCat && matchText
    })
  }, [q, cat])

  const visibleIntegrations = useMemo(
    () => (showAll ? filteredIntegrations : filteredIntegrations.slice(0, 6)),
    [filteredIntegrations, showAll]
  )

  // demo load; wire to your real endpoints when ready
  const loadStatus = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const range = dateRange(1)
      const url = new URL(`${API_HTTP_BASE}/leads/summary`)
      url.searchParams.set('clientId', tenantId)
      url.searchParams.set('start', range.startISO)
      url.searchParams.set('end', range.endISO)
      const r = await fetch(url.toString(), withTenant())
      if (r.ok) {
        const j = await r.json()
        setConnected(Array.isArray(j?.connected) ? j.connected : [])
        setLast24(Number(j?.last24 || 0))
      } else {
        setConnected([]); setLast24(0)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load lead status')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { loadStatus() }, [loadStatus])

  const webhookURL = `${API_HTTP_BASE}/lead-intake?clientId=${encodeURIComponent(tenantId)}`
  const hostedForm = `${window.location.origin}/public/lead/${encodeURIComponent(tenantId)}`
  const inboundMail = `leads+${tenantId}@inbound.your-domain.com`

  return (
    <div className="w-full h-full px-3 lg:px-6 py-3">
      {/* Header */}
      <div className="sticky top-0 z-[5] -mx-3 lg:-mx-6 px-3 lg:px-6 py-2 mb-4 backdrop-blur bg-black/20 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="opacity-90" />
            <h1 className="text-base font-semibold">Lead Hub</h1>
            <span className="text-xs text-white/60">Entry point → Connect → Verify</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill icon={<PlugZap size={12} />} label={`${connected.length} connected`} />
            <StatusPill icon={<ActivityDot />} label={`Last 24h: ${fmt(last24)}`} />
            {loading && <span className="text-xs text-white/60">Syncing…</span>}
          </div>
        </div>
      </div>

      {/* Stepper */}
      <Stepper step={step} onStep={setStep} />

      <div className="mt-4 grid gap-6 xl:grid-cols-[520px,minmax(0,1fr)]">
        {/* Left: guided wizard */}
        <div className="space-y-4">
          {/* Step 1 */}
          <StepCard
            index={1}
            title="Choose your lead entry point"
            subtitle="Pick one (or multiple). We auto-normalize, dedupe and tag every lead."
            open={step === 1}
            onNext={() => setStep(2)}
          >
            <EntryOption
              label="Universal Webhook"
              caption="Best for Zapier, Make, custom code. POST JSON and you're done."
              value={webhookURL}
              badge="Recommended"
              icon={<Link2 size={14} />}
            />
            <EntryOption
              label="Hosted Form"
              caption="A shareable form—perfect for landing pages or QR codes."
              value={hostedForm}
              icon={<ShieldCheck size={14} />}
            />
            <EntryOption
              label="Inbound Email"
              caption="Forward vendor emails (Thumbtack/Yelp/etc.). We parse & attach original."
              value={inboundMail}
              icon={<Mail size={14} />}
            />
          </StepCard>

          {/* Step 2 */}
          <StepCard
            index={2}
            title="Connect sources"
            subtitle="OAuth where possible—no brittle zaps. Click connect and authenticate."
            open={step === 2}
            onPrev={() => setStep(1)}
            onNext={() => setStep(3)}
          >
            <div className="space-y-3">
              {/* Search + category chips */}
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50" />
                  <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setShowAll(true) }}
                    placeholder="Search integrations…"
                    className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-black/30 border border-white/10 outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {categories.map(c => {
                    const active = cat === c
                    return (
                      <button
                        key={c}
                        onClick={() => { setCat(c); setShowAll(false) }}
                        className={`px-2 py-1 rounded-full text-[11px] border ${active ? 'bg-white/20 border-white/20' : 'bg-white/10 border-white/10 hover:bg-white/15'}`}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Connected summary */}
              {!!connected.length && (
                <div className="text-[11px] text-white/70">
                  <span className="opacity-80">Connected:</span>{' '}
                  {connected.join(', ')}
                </div>
              )}

              {/* Gallery */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleIntegrations.map((def) => (
                  <ConnectCard
                    key={def.id}
                    brand={def.brand}
                    tone={def.tone}
                    connected={connected.includes(def.key)}
                    logo={<BrandLogo id={def.key} brand={def.brand} logoUrl={def.logoUrl} />}
                    onConnect={() =>
                      (window.location.href =
                        `${API_HTTP_BASE}${def.connectPath}?clientId=${encodeURIComponent(tenantId)}`)
                    }
                  />
                ))}
              </div>

              {/* Show more/less */}
              {filteredIntegrations.length > 6 && (
                <div className="pt-1">
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/20"
                  >
                    {showAll ? 'Show fewer' : `Show all ${filteredIntegrations.length} sources`}
                  </button>
                </div>
              )}
            </div>
          </StepCard>

          {/* Step 3 */}
          <StepCard
            index={3}
            title="Verify & route"
            subtitle="Send a test lead, preview auto-reply, and confirm assignment rules."
            open={step === 3}
            onPrev={() => setStep(2)}
          >
            <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-medium">Send a test lead</div>
                <div className="text-xs text-white/60">We’ll create a lead, normalize it, and push it through your rules.</div>
              </div>
              <button
                onClick={() => sendTestLead(tenantId)}
                className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/20"
              >
                Send test
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
                <div className="text-sm font-medium mb-1">Auto-reply (SMS/Email)</div>
                <div className="text-xs text-white/60">“Thanks {'{{firstName}}'}! We’ll text you a booking link now.”</div>
                <Link to="/automations" className="text-[11px] underline mt-2 inline-block">Edit in Automations</Link>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
                <div className="text-sm font-medium mb-1">Routing preview</div>
                <ul className="text-xs text-white/80 space-y-1">
                  <li>• Assign: Round-robin across “Sales East” (quiet hours 7pm–7am)</li>
                  <li>• Tag: Source + Territory + Campaign UTM</li>
                  <li>• Create: Contact + Job seed for booking</li>
                </ul>
                <Link to="/automations" className="text-[11px] underline mt-2 inline-block">Adjust rules</Link>
              </div>
            </div>
          </StepCard>
        </div>

        {/* Right: Optional analytics (collapsed) */}
        <PerformancePanel />
      </div>

      {error && <div className="mt-4 text-xs text-rose-300">{error}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------------------
 * Components
 * -------------------------------------------------------------------------- */
function Stepper({ step, onStep }: { step: 1 | 2 | 3; onStep: (s: 1 | 2 | 3) => void }) {
  const steps = [
    { id: 1, label: 'Entry point' },
    { id: 2, label: 'Connect sources' },
    { id: 3, label: 'Verify & route' },
  ] as const
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <button
            onClick={() => onStep(s.id as 1 | 2 | 3)}
            className={[
              'px-3 py-1.5 rounded-full text-xs border',
              step === s.id ? 'border-white/20 bg-white/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
            ].join(' ')}
          >
            {i + 1}. {s.label}
          </button>
          {i < steps.length - 1 && <div className="h-[1px] flex-1 bg-white/10" />}
        </React.Fragment>
      ))}
    </div>
  )
}

function StepCard({
  index, title, subtitle, open, children, onPrev, onNext,
}: {
  index: number; title: string; subtitle?: string; open: boolean; children: React.ReactNode; onPrev?: () => void; onNext?: () => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,.05)] backdrop-blur">
      <button
        className="w-full flex items-center justify-between px-5 py-4"
        onClick={() => {/* collapsible look only; step is managed by Stepper */}}
      >
        <div>
          <div className="text-sm font-semibold">{index}. {title}</div>
          {subtitle && <div className="text-xs text-white/60">{subtitle}</div>}
        </div>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          {children}
          <div className="pt-2 flex items-center gap-2">
            {onPrev && (
              <button onClick={onPrev} className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10">
                Back
              </button>
            )}
            {onNext && (
              <button onClick={onNext} className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/20">
                Continue
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EntryOption({ label, caption, value, icon, badge }: {
  label: string; caption?: string; value: string; icon?: React.ReactNode; badge?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium inline-flex items-center gap-2">
          {icon}{label}
          {badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/20">{badge}</span>}
        </div>
        {caption && <div className="text-xs text-white/60">{caption}</div>}
      </div>
      <CopyField value={value} ariaLabel={`Copy ${label}`} />
    </div>
  )
}

function ConnectCard({ brand, tone, connected, onConnect, logo }: {
  brand: string; tone: string; connected?: boolean; onConnect: () => void; logo?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3 flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {logo}
        <div className="truncate text-sm">{brand}</div>
      </div>
      {connected ? (
        <span className="text-xs inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={14} /> Connected</span>
      ) : (
        <button
          onClick={onConnect}
          className="text-xs px-2.5 py-1.5 rounded-full border border-white/10 bg-white/10 hover:bg-white/20"
        >
          Connect
        </button>
      )}
    </div>
  )
}

function BrandLogo({ id, brand, logoUrl, size = 22 }: { id: string; brand: string; logoUrl?: string; size?: number }) {
  // If you add real SVGs under /src/assets/integrations/{id}.svg, import them and pass as logoUrl
  if (logoUrl) {
    return <img src={logoUrl} alt={`${brand} logo`} width={size} height={size} className="rounded-sm bg-white/5" />
  }
  // Minimal, fast “brand marks” (color + initials) as an inline fallback
  const bg =
    id === 'facebook' ? '#1877F2' :
    id === 'lsa' ? '#34A853' :
    id === 'thumbtack' ? '#F39C12' :
    id === 'google_ads' ? '#4285F4' :
    id === 'yelp' ? '#D32323' :
    id === 'angi' ? '#19A974' :
    id === 'nextdoor' ? '#25A35A' :
    id === 'bing_ads' ? '#008373' :
    id === 'snapchat' ? '#FFFC00' :
    id === 'tiktok' ? '#000000' :
    id === 'zapier' ? '#FF4F00' :
    id === 'webhook' ? '#6366F1' :
    id === 'web' ? '#7C3AED' : '#6B7280'

  const initials = (() => {
    if (id === 'google_ads') return 'GA'
    if (id === 'bing_ads') return 'B'
    if (id === 'lsa') return 'LSA'
    if (id === 'webhook') return 'WH'
    if (id === 'web') return 'WEB'
    const parts = brand.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] || '•'
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
    return (first + last).toUpperCase()
  })()

  return (
    <div
      aria-label={`${brand} logo`}
      className="inline-flex items-center justify-center rounded-md text-[10px] font-bold"
      style={{ width: size, height: size, backgroundColor: bg, color: id === 'snapchat' ? '#111827' : '#ffffff' }}
      title={brand}
    >
      {initials}
    </div>
  )
}

function PerformancePanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04]">
        <button className="w-full px-5 py-4 flex items-center justify-between" onClick={() => setOpen(v => !v)}>
          <div>
            <div className="text-sm font-semibold">Performance</div>
            <div className="text-xs text-white/60">Funnel · By Source · Recent</div>
          </div>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {open && (
          <div className="px-5 pb-5">
            <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4 text-xs text-white/60">
              Add your existing funnel/analytics blocks here. Collapsed by default to keep the top of the page clean.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-white/10 bg-white/10">
      {icon}{label}
    </span>
  )
}

function ActivityDot() {
  return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,.25)]" />
}

/* ----------------------------------------------------------------------------
 * Mock “send test lead”
 * -------------------------------------------------------------------------- */
async function sendTestLead(clientId: string) {
  const url = `${API_HTTP_BASE}/lead-intake?clientId=${encodeURIComponent(clientId)}`
  const body = {
    id: `test-${Date.now()}`,
    name: 'Test Lead',
    email: 'test@example.com',
    phone: '+15555550100',
    source: 'web',
    territory: 'East',
    valueEstimate: 2400,
  }
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    alert('Test lead sent!\nCheck Automations → Activity to see the flow.')
  } catch (e) {
    alert('Failed to send test lead.')
  }
}