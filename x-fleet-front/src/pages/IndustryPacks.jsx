import { useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'
import { API_BASE } from '../config'
import { HVAC_PACK, PLUMBING_PACK, ELECTRICAL_PACK, ROOFING_PACK } from '../packs/presets'

const PACKS = [HVAC_PACK, PLUMBING_PACK, ELECTRICAL_PACK, ROOFING_PACK]
const BASE = typeof API_BASE === 'string' ? API_BASE : ''

function downloadPack(pack, filename = `${pack.id}.json`) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function IndustryPacks() {
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [result, setResult] = useState(null)

  async function install(p) {
    setBusyId(p.id)   // <-- use p.id here
    setResult(null)
    try {
      const r = await fetch(`${BASE}/api/packs/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),   // <-- send the pack directly
      })
      const j = await r.json()
      setResult(j)
    } catch (e) {
      setResult({ ok: false, error: e.message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="packs" />
        </aside>

        <section className="col-span-12 lg:col-span-10 glass rounded-none p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold">Industry Packs</h1>
            <a
              className="text-sm underline opacity-80"
              href={`${BASE}/api/packs/installed?clientId=default`}
              target="_blank"
              rel="noreferrer"
            >
              View installed snapshot
            </a>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PACKS.map(p => (
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-none p-4 flex flex-col">
                <div className="text-lg font-semibold mb-1">{p.name}</div>
                <div className="text-xs uppercase tracking-wide opacity-70 mb-1">{p.trade}</div>
                <div className="text-sm text-white/80 flex-1">{p.description}</div>
                <ul className="mt-2 text-xs opacity-80 list-disc pl-4">
                  <li>{p.pipelines?.[0]?.stages.length || 6} pipeline stages</li>
                  <li>{p.jobTypes?.length || 0} job types</li>
                  <li>{p.customFields?.length || 0} custom fields</li>
                  <li>{p.pricebook?.length || 0} pricebook items</li>
                  <li>{(p.templates?.sms?.length || 0) + (p.templates?.email?.length || 0)} templates</li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => install(p)}
                    disabled={busyId === p.id}
                    className="px-3 py-2 rounded-none glass text-sm hover:bg-panel/70"
                  >
                    {busyId === p.id ? 'Installing…' : 'Install'}
                  </button>
                    <button
    onClick={() => alert(`Demo for ${p.name} coming soon!`)}
    className="px-3 py-2 glass rounded-none text-sm hover:bg-panel/70"
  >
    See Demo
  </button>
</div>
              </div>
            ))}
          </div>

          {result && (
            <div className="mt-4 text-sm">
              {result.ok
                ? <div className="text-green-300">Installed! (job types/fields/templates merged for this client)</div>
                : <div className="text-red-300">Install failed: {String(result.error || 'unknown')}</div>}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}