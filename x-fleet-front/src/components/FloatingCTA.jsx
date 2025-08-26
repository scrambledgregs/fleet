// src/components/FloatingCTA.tsx
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const HIDE_KEY = 'floatingCtaHiddenUntil'

export default function FloatingCTA() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [hidden, setHidden] = useState(false)

  // Respect “hidden until” timestamp
  useEffect(() => {
    try {
      const ts = parseInt(localStorage.getItem(HIDE_KEY) || '0', 10)
      setHidden(Number.isFinite(ts) && Date.now() < ts)
    } catch {}
  }, [])

  // Hide on the Affiliate page itself
  if (pathname.startsWith('/affiliate') || hidden) return null

  function dismiss(days = 7) {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000))
    } catch {}
    setHidden(true)
  }

  return (
    <div
      className={[
        'fixed left-1/2 -translate-x-1/2',
        'bottom-[calc(env(safe-area-inset-bottom)+12px)]',
        'z-40'
      ].join(' ')}
    >
      <div
        className={[
          'pointer-events-auto',
          'inline-flex items-center gap-2',
          'px-3 py-2 rounded-md',
          'bg-zinc-900/80 text-white',
          'border border-white/10 shadow-lg',
          'backdrop-blur supports-[backdrop-filter]:backdrop-blur-md',
          'text-sm',
          'hover:bg-zinc-900/90 transition'
        ].join(' ')}
        role="complementary"
        aria-label="Affiliate earnings prompt"
      >
        <button
          type="button"
          onClick={() => navigate('/affiliate')}
          className="inline-flex items-center gap-2 focus:outline-none"
          aria-label="Open affiliate program"
          title="Earn 40% lifetime revenue"
        >
          <span aria-hidden>💸</span>
          <span className="font-medium">Earn 40%</span>
        </button>

        {/* tiny dismiss */}
        <button
          type="button"
          onClick={() => dismiss(7)}
          className={[
            'ml-1 h-6 w-6 inline-grid place-items-center',
            'rounded',
            'text-white/70 hover:text-white',
            'hover:bg-white/10',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
          ].join(' ')}
          aria-label="Dismiss for a week"
          title="Dismiss for a week"
        >
          ×
        </button>
      </div>
    </div>
  )
}