// src/pages/Settings.tsx
import React, { useState } from 'react'
import { Plug, Phone, Mail, ShieldCheck } from 'lucide-react'
import TeamSettingsCard from '../components/TeamSettingsCard'

// These can stay .jsx for now; TS can import them just fine.
import TeamSettings from '../settings/TeamSettings.jsx'
import VehiclesSettings from '../settings/VehiclesSettings.jsx'

type Tab = 'team' | 'vehicles' | 'integrations' | 'company'
type IntegrationStatus = 'connected' | 'disconnected' | 'pending'

function Badge({ state }: { state: IntegrationStatus }) {
  const map: Record<IntegrationStatus, string> = {
    connected: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
    disconnected: 'bg-white/10 text-white/70 border-white/15',
  }
  const label =
    state === 'connected' ? 'Connected' : state === 'pending' ? 'Pending' : 'Not connected'
  return <span className={`text-[11px] px-2 py-0.5 rounded-md border ${map[state]}`}>{label}</span>
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-3 py-1.5 rounded-lg text-sm font-medium transition ' +
        (active ? 'bg-[var(--brand-orange)] text-white shadow-sm' : 'glass hover:bg-white/10')
      }
    >
      {children}
    </button>
  )
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('team')

  // You can hydrate these from your backend later
  const [twilio, setTwilio] = useState<IntegrationStatus>('disconnected')
  const [mailgun, setMailgun] = useState<IntegrationStatus>('disconnected')

  // Show/hide the legacy/advanced team panel to prevent duplicate controls
  const [showAdvancedTeam, setShowAdvancedTeam] = useState(false)

  function startTwilioSetup() {
    setTwilio('pending')
    window.dispatchEvent(new CustomEvent('integrations:twilio:start'))
  }
  function startMailgunSetup() {
    setMailgun('pending')
    window.dispatchEvent(new CustomEvent('integrations:mailgun:start'))
  }

  return (
    <div className="glass rounded-none p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Settings</h1>

        <div className="flex gap-2">
          <TabButton active={tab === 'team'} onClick={() => setTab('team')}>
            Team
          </TabButton>
          <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')}>
            Vehicles
          </TabButton>
          <TabButton active={tab === 'integrations'} onClick={() => setTab('integrations')}>
            Integrations
          </TabButton>
          <TabButton active={tab === 'company'} onClick={() => setTab('company')}>
            Company
          </TabButton>
        </div>
      </div>

      {tab === 'team' && (
        <div className="space-y-4">
          {/* Actions/“buttons above the panel” */}
          <TeamSettingsCard />

          {/* Advanced (optional) — hide by default to avoid duplicate controls */}
          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-white/50">
              Need to manage the roster and sync techs? Open advanced team management.
            </div>
            <button
              type="button"
              onClick={() => setShowAdvancedTeam((v) => !v)}
              className="text-xs rounded-md border border-white/10 px-2 py-1 hover:bg-white/10"
            >
              {showAdvancedTeam ? 'Hide advanced' : 'Show advanced'}
            </button>
          </div>

          {showAdvancedTeam && <TeamSettings />}
        </div>
      )}

      {tab === 'vehicles' && <VehiclesSettings />}

      {tab === 'integrations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Twilio A2P */}
          <div className="rounded-xl border border-white/10 bg-[#0f141a] p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
                  <Phone size={18} />
                </div>
                <div>
                  <div className="font-medium">Twilio A2P & Voice</div>
                  <div className="text-xs text-white/60">
                    Register A2P, verify brand/campaign, and enable calling/recordings.
                  </div>
                </div>
              </div>
              <Badge state={twilio} />
            </div>

            <ul className="mt-3 text-sm text-white/70 space-y-1.5 list-disc pl-5">
              <li>Brand &amp; campaign registration (A2P 10DLC)</li>
              <li>Phone number purchase / port &amp; webhook setup</li>
              <li>Recording + transcription + storage</li>
            </ul>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={startTwilioSetup}
                className="rounded-lg bg-[var(--brand-orange)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--brand-orange2)]"
              >
                {twilio === 'connected' ? 'Manage' : 'Connect Twilio'}
              </button>
              <a
                href="https://www.twilio.com/docs/usage/a2p"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/60 hover:text-white underline"
              >
                What is A2P?
              </a>
            </div>
          </div>

          {/* Mailgun */}
          <div className="rounded-xl border border-white/10 bg-[#0f141a] p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
                  <Mail size={18} />
                </div>
                <div>
                  <div className="font-medium">Mailgun (Transactional Email)</div>
                  <div className="text-xs text-white/60">
                    Verify your domain and enable outbound email + tracking.
                  </div>
                </div>
              </div>
              <Badge state={mailgun} />
            </div>

            <ul className="mt-3 text-sm text-white/70 space-y-1.5 list-disc pl-5">
              <li>Domain verification (DKIM/SPF)</li>
              <li>From/Reply-To addresses and routing</li>
              <li>Open/click tracking webhooks</li>
            </ul>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={startMailgunSetup}
                className="rounded-lg bg-[var(--brand-orange)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--brand-orange2)]"
              >
                {mailgun === 'connected' ? 'Manage' : 'Connect Mailgun'}
              </button>
              <a
                href="https://documentation.mailgun.com/en/latest/"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/60 hover:text-white underline"
              >
                Mailgun docs
              </a>
            </div>
          </div>

          {/* Security note */}
          <div className="md:col-span-2 rounded-xl border border-white/10 bg-[#0f141a] p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} className="text-emerald-300" />
              Security & Compliance
            </div>
            <div className="mt-2 text-xs text-white/70">
              API keys are encrypted at rest. Rotate credentials anytime from your provider. We’ll guide
              you to complete A2P 10DLC compliance (brand, use-case, and messaging sample) and set up
              DNS records for Mailgun (DKIM/SPF).
            </div>
          </div>
        </div>
      )}

      {tab === 'company' && (
        <div className="rounded-xl border border-white/10 bg-[#0f141a] p-4">
          <div className="text-sm text-white/80 mb-2 font-medium">Company Profile</div>
          <div className="text-sm text-white/60">
            Company profile, service areas, working hours… (coming soon)
          </div>
        </div>
      )}
    </div>
  )
}