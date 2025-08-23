// src/components/FloatingCTA.tsx
import { useNavigate, useLocation } from 'react-router-dom'

export default function FloatingCTA() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Hide on the Affiliate page itself
  if (pathname.startsWith('/affiliate')) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/affiliate')}
      aria-label="Join the affiliate program (earn 40% lifetime revenue)"
      className={[
        // placement (bottom-left, safe-area aware)
        'fixed left-6',
        'bottom-[calc(env(safe-area-inset-bottom)+1.5rem)]',
        'z-40', // below PhoneDock/PowerDialer (use z-50 there)
        // pill styling
        'inline-flex items-center gap-2 rounded-full px-4 h-12',
        'bg-gradient-to-r from-sky-500 to-indigo-600',
        'text-white font-semibold shadow-lg ring-1 ring-white/20',
        'hover:from-sky-400 hover:to-indigo-500',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30'
      ].join(' ')}
    >
      Earn 40% lifetime revenue
    </button>
  )
}