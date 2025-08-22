// src/pages/Affiliate.jsx
import { useState } from 'react'

export default function Affiliate() {
  const [email, setEmail] = useState('')
  const [refLink, setRefLink] = useState('')

  function handleGenerate(e) {
    e.preventDefault()
    if (!email.trim()) return
    const slug = encodeURIComponent(email.trim().toLowerCase())
    setRefLink(`${window.location.origin}/signup?ref=${slug}`)
  }

  return (
    <div className="glass rounded-none p-4">
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
            <div className="mt-3 text-sm flex items-center gap-2">
              <span>Your referral link:</span>
              <a href={refLink} className="underline text-blue-400 break-all">{refLink}</a>
              <button
                type="button"
                className="px-2 py-1 border border-white/15 bg-white/5 hover:bg-white/10 rounded-none text-xs"
                onClick={async () => { try { await navigator.clipboard.writeText(refLink) } catch {} }}
                title="Copy to clipboard"
              >
                Copy
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}