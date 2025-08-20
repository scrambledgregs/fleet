import { useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'

export default function Affiliate() {
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)
  const [email, setEmail] = useState('')
  const [refLink, setRefLink] = useState('')

  function handleGenerate(e) {
    e.preventDefault()
    if (!email.trim()) return
    // Fake link locally; you can swap for a backend later
    const slug = encodeURIComponent(email.trim().toLowerCase())
    setRefLink(`${window.location.origin}/signup?ref=${slug}`)
  }

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="affiliate" />
        </aside>

        <section className="col-span-12 lg:col-span-10 glass rounded-none p-4">
          <div className="max-w-3xl">
            <h1 className="text-xl font-semibold mb-1">Affiliate Program</h1>
            <p className="text-white/80 mb-4">
              Earn <span className="font-bold">40% lifetime revenue</span> for every account you refer. Payouts monthly.
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <div className="bg-white/5 border border-white/10 rounded-none p-3">
                <div className="text-sm font-semibold mb-2">How it works</div>
                <ul className="text-sm space-y-1 list-disc pl-4">
                  <li>Create your unique referral link.</li>
                  <li>Share it with your audience/clients.</li>
                  <li>Get 40% of their subscription for life.</li>
                </ul>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-none p-3">
                <div className="text-sm font-semibold mb-2">Fast approvals</div>
                <p className="text-sm text-white/80">
                  Most partners are approved within 1 business day. High-touch support available.
                </p>
              </div>
            </div>

            <form onSubmit={handleGenerate} className="bg-white/5 border border-white/10 rounded-none p-3">
              <div className="text-sm font-semibold mb-2">Get your link</div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="flex-1 min-w-[220px] bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30"
                />
                <button type="submit" className="px-3 py-2 rounded-none glass text-sm hover:bg-panel/70">
                  Generate
                </button>
              </div>
              {refLink && (
                <div className="mt-3 text-sm">
                  Your referral link:{' '}
                  <a href={refLink} className="underline text-blue-400 break-all">{refLink}</a>
                </div>
              )}
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}