import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Bot, Mail, Phone, PhoneOutgoing, CheckCircle2, XCircle, Play, Settings, ChevronRight, Shield, Calendar, Inbox, Zap } from 'lucide-react'
import { withTenant, getTenantId } from '../lib/socket'

function apiBase(): string {
  const env = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || ''
  if (env) return String(env).replace(/\/$/, '')
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '')
}

type AIState = {
  chat?: { enabled: boolean }
  email?: { enabled: boolean, from?: string | null }
  voiceInbound?: { enabled: boolean }
  voiceOutbound?: { enabled: boolean }
  integrations?: {
    twilio?: boolean
    email?: boolean
    calendar?: boolean
    numberCount?: number
  }
}

const pill = (on: boolean) =>
  'text-[11px] px-2 py-0.5 rounded-full ' +
  (on ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30' :
        'bg-white/10 text-white/70 border border-white/10')

function StatusBadge({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={pill(on)}>
      {on ? 'On' : 'Off'}{label ? ` • ${label}` : ''}
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-white/10 bg-white/5">
      <div className="text-[11px] text-white/60">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

export default function AIHub(): JSX.Element {
  const navigate = useNavigate()
  const tenantId = useMemo(() => getTenantId(), [])
  const [state, setState] = useState<AIState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Load current AI state
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // You can serve this aggregate from your API; for now we fan-out to existing endpoints.
        const [voice, outbound, email] = await Promise.all([
          fetch(`${apiBase()}/api/voice/state`, withTenant()).then(r => r.json()).catch(() => ({})),
          fetch(`${apiBase()}/api/outbound/state`, withTenant()).then(r => r.json()).catch(() => ({})),
          fetch(`${apiBase()}/api/email/state`, withTenant()).then(r => r.json()).catch(() => ({})),
        ])

        // Optionally fetch numbers to show quick counts
        const nums = await fetch(`${apiBase()}/api/voice/numbers?tenantId=${tenantId}`, withTenant())
          .then(r => r.json()).catch(() => ({}))

        const s: AIState = {
          chat: { enabled: true }, // default on; toggle later if you add a flag
          email: { enabled: !!email?.enabled, from: email?.from || null },
          voiceInbound: { enabled: !!voice?.enabled },
          voiceOutbound: { enabled: !!outbound?.enabled },
          integrations: {
            twilio: !!(nums?.ok),
            numberCount: Array.isArray(nums?.numbers) ? nums.numbers.length : 0,
            email: !!email?.connected || !!email?.enabled,
            calendar: !!email?.calendarConnected || false,
          },
        }
        if (alive) setState(s)
      } catch {
        if (alive) setState({
          chat: { enabled: true },
          email: { enabled: false },
          voiceInbound: { enabled: false },
          voiceOutbound: { enabled: false },
          integrations: { twilio: false, email: false, calendar: false, numberCount: 0 }
        })
      }
    })()
    return () => { alive = false }
  }, [tenantId])

  async function toggle(path: 'voiceInbound'|'voiceOutbound'|'email'|'chat', next: boolean) {
    try {
      setBusy(path)
      if (path === 'voiceInbound') {
        const r = await fetch(`${apiBase()}/api/voice/state`, {
          method: 'POST',
          ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
          body: JSON.stringify({ enabled: next }),
        })
        await r.json().catch(() => ({}))
      } else if (path === 'voiceOutbound') {
        const r = await fetch(`${apiBase()}/api/outbound/state`, {
          method: 'POST',
          ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
          body: JSON.stringify({ enabled: next }),
        })
        await r.json().catch(() => ({}))
      } else if (path === 'email') {
        const r = await fetch(`${apiBase()}/api/email/state`, {
          method: 'POST',
          ...withTenant({ headers: { 'Content-Type': 'application/json' } }),
          body: JSON.stringify({ enabled: next }),
        })
        await r.json().catch(() => ({}))
      }
      setState(prev => prev ? {
        ...prev,
        [path]: { ...(prev as any)[path], enabled: next }
      } : prev)
    } finally {
      setBusy(null)
    }
  }

  function openVoiceHUD() {
    window.dispatchEvent(new CustomEvent('voicehud:open'))
  }

  if (!state) {
    return <div className="p-4 text-sm text-white/60">Loading AI…</div>
  }

  const ints = state.integrations || {}

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap /> AI
        </h1>
        <div className="flex gap-2">
          <Link to="/phones?tab=calls" className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-sm">Calls</Link>
          <Link to="/phones?tab=routing" className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-sm">Routing</Link>
          <Link to="/phones?tab=outbound" className="px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-sm">Outbound</Link>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Left: Quick Start */}
        <aside className="col-span-12 md:col-span-4 glass rounded-none p-3 space-y-3 min-h-[60vh]">
          <div className="flex items-center gap-2">
            <Settings size={16} />
            <div className="font-medium">Quick Start</div>
          </div>

          <ChecklistItem
            ok={!!ints.twilio && (ints.numberCount || 0) > 0}
            label="Connect phone numbers"
            hint={ints.numberCount ? `${ints.numberCount} connected` : 'Twilio numbers needed'}
            action={<Link className="text-xs underline" to="/phones?tab=calls">Manage</Link>}
          />

          <ChecklistItem
            ok={!!state.voiceInbound?.enabled}
            label="Enable inbound Voice AI"
            hint="Answer and triage incoming calls"
            action={
              <button
                onClick={() => toggle('voiceInbound', !state.voiceInbound?.enabled)}
                disabled={busy === 'voiceInbound'}
                className="text-xs underline"
              >
                {state.voiceInbound?.enabled ? 'Disable' : 'Enable'}
              </button>
            }
          />

          <ChecklistItem
            ok={!!state.voiceOutbound?.enabled}
            label="Enable outbound Voice AI"
            hint="Run dialing campaigns"
            action={
              <button
                onClick={() => toggle('voiceOutbound', !state.voiceOutbound?.enabled)}
                disabled={busy === 'voiceOutbound'}
                className="text-xs underline"
              >
                {state.voiceOutbound?.enabled ? 'Disable' : 'Enable'}
              </button>
            }
          />

          <ChecklistItem
            ok={!!ints.email}
            label="Connect Email"
            hint={state.email?.from ? state.email.from : 'SMTP/OAuth'}
            action={<Link className="text-xs underline" to="/automations?tab=email-ai">Connect</Link>}
          />

          <ChecklistItem
            ok={!!ints.calendar}
            label="Connect Calendar"
            hint="For booking calls"
            action={<Link className="text-xs underline" to="/settings?tab=integrations">Connect</Link>}
          />

          <div className="pt-2 flex gap-2">
            <button
              onClick={openVoiceHUD}
              className="px-3 py-1 rounded border border-white/10 hover:bg-white/10 text-sm"
              title="Open Voice HUD"
            >
              <Play size={14} className="inline mr-1" /> Test Call UI
            </button>
            <Link
              to="/phones?tab=outbound"
              className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
            >
              Launch Campaign
            </Link>
          </div>

          <div className="pt-3 text-[11px] text-white/50 flex items-center gap-1">
            <Shield size={12} /> Respect quiet hours, DNC, and consent. Configure in Routing/Outbound.
          </div>
        </aside>

        {/* Right: Products */}
        <main className="col-span-12 md:col-span-8 space-y-3">
          <ProductCard
            icon={<Bot />}
            title="Chat Agent"
            description="Internal chat + team directory. Lets AI summarize threads, draft messages, and answer FAQs."
            status={<StatusBadge on={!!state.chat?.enabled} />}
            actions={<Link to="/team?tab=chat" className="inline-flex items-center gap-1 text-sm underline">Open <ChevronRight size={14}/></Link>}
          />

          <ProductCard
            icon={<Mail />}
            title="Email AI"
            description="Drafts replies, follow-ups, and sequences. Uses your connected mailbox."
            status={<StatusBadge on={!!state.email?.enabled} label={state.email?.from || ''} />}
            actions={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggle('email', !state.email?.enabled)}
                  disabled={busy === 'email'}
                  className="text-sm underline"
                >
                  {state.email?.enabled ? 'Disable' : 'Enable'}
                </button>
                <Link to="/automations?tab=email-ai" className="text-sm underline">Configure</Link>
              </div>
            }
          />

          <ProductCard
            icon={<Phone />}
            title="Inbound Voice AI"
            description="Answers calls, routes with IVR or AI, books appointments, and logs dispositions."
            status={<StatusBadge on={!!state.voiceInbound?.enabled} />}
            actions={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggle('voiceInbound', !state.voiceInbound?.enabled)}
                  disabled={busy === 'voiceInbound'}
                  className="text-sm underline"
                >
                  {state.voiceInbound?.enabled ? 'Disable' : 'Enable'}
                </button>
                <Link to="/phones?tab=routing" className="text-sm underline">Routing</Link>
              </div>
            }
          />

          <ProductCard
            icon={<PhoneOutgoing />}
            title="Outbound Voice AI"
            description="AI dialer for campaigns: qualify leads, set appointments, collect follow-ups."
            status={<StatusBadge on={!!state.voiceOutbound?.enabled} />}
            actions={
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggle('voiceOutbound', !state.voiceOutbound?.enabled)}
                  disabled={busy === 'voiceOutbound'}
                  className="text-sm underline"
                >
                  {state.voiceOutbound?.enabled ? 'Disable' : 'Enable'}
                </button>
                <Link to="/phones?tab=outbound" className="text-sm underline">Campaigns</Link>
              </div>
            }
          />

          {/* Mini metrics (placeholder) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
            <Stat label="Numbers connected" value={ints.numberCount ?? 0} />
            <Stat label="Inbound status" value={state.voiceInbound?.enabled ? 'Active' : 'Off'} />
            <Stat label="Outbound status" value={state.voiceOutbound?.enabled ? 'Active' : 'Off'} />
            <Stat label="Email status" value={state.email?.enabled ? 'Connected' : 'Not connected'} />
          </div>
        </main>
      </div>
    </div>
  )
}

function ChecklistItem({
  ok, label, hint, action,
}: { ok: boolean; label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 p-2 rounded-lg border border-white/10 bg-white/5">
      <div>
        <div className="text-sm flex items-center gap-2">
          {ok ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-white/50" />}
          <span className="font-medium">{label}</span>
        </div>
        {hint && <div className="text-[11px] text-white/60 ml-6">{hint}</div>}
      </div>
      {action}
    </div>
  )
}

function ProductCard({
  icon, title, description, status, actions,
}: {
  icon: React.ReactNode
  title: string
  description: string
  status?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="glass rounded-none p-3 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <div className="text-base font-semibold">{title}</div>
          <div className="text-sm text-white/70">{description}</div>
        </div>
      </div>
      <div className="text-right space-y-2">
        {status}
        <div>{actions}</div>
      </div>
    </div>
  )
}