// src/components/FloatingCTA.tsx
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const LS_KEY = 'floatingCtaCollapsed'

export default function FloatingCTA() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  // Restore persisted state
  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_KEY)
      if (v != null) setCollapsed(v === '1')
    } catch {}
  }, [])

  // Persist state
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, collapsed ? '1' : '0')
    } catch {}
  }, [collapsed])

  // Hide on the Affiliate page itself
  if (pathname.startsWith('/affiliate')) return null

  const handleClasses =
    [
      'h-10 w-10 inline-grid place-items-center rounded-full',
      'bg-white/95 text-zinc-900',
      'shadow-xl ring-1 ring-black/20',
      'backdrop-blur supports-[backdrop-filter]:backdrop-blur-md',
      'transition transform hover:scale-105 hover:shadow-2xl',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
    ].join(' ')

  return (
    <div
      className={[
        'fixed left-6',
        'bottom-[calc(env(safe-area-inset-bottom)+1.5rem)]',
        'z-40',
        'pointer-events-none', // prevent stray clicks when swapping
      ].join(' ')}
    >
      {/* Force remount when state changes to avoid ghost elements */}
      <div
        key={collapsed ? 'collapsed' : 'expanded'}
        className="flex items-center gap-2 pointer-events-auto"
      >
        {collapsed ? (
          <>
            {/* Small round CTA (navigates) */}
            <button
              type="button"
              onClick={() => navigate('/affiliate')}
              aria-label="Join the affiliate program (earn 40% lifetime revenue)"
              title="Earn 40% lifetime revenue"
              className={[
                'inline-grid place-items-center h-12 w-12 rounded-full',
                'bg-gradient-to-r from-sky-500 to-indigo-600',
                'text-white text-xl font-semibold shadow-lg ring-1 ring-white/20',
                'hover:from-sky-400 hover:to-indigo-500',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
              ].join(' ')}
            >
              💸
            </button>

            {/* Expand handle – use pointerDown to avoid click race */}
            <button
              type="button"
              aria-label="Expand affiliate button"
              title="Expand"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCollapsed(false)
              }}
              className={handleClasses}
            >
              ⤢
            </button>
          </>
        ) : (
          <>
            {/* Full pill CTA */}
            <button
              type="button"
              onClick={() => navigate('/affiliate')}
              aria-label="Join the affiliate program (earn 40% lifetime revenue)"
              className={[
                'inline-flex items-center gap-2 rounded-full px-4 h-12',
                'bg-gradient-to-r from-sky-500 to-indigo-600',
                'text-white font-semibold shadow-lg ring-1 ring-white/20',
                'hover:from-sky-400 hover:to-indigo-500',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
              ].join(' ')}
            >
              Earn 40% lifetime revenue
            </button>

            {/* Collapse handle – pointerDown + stopPropagation */}
            <button
              type="button"
              aria-label="Collapse affiliate button"
              title="Collapse"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setCollapsed(true)
              }}
              className={handleClasses}
            >
              −
            </button>
          </>
        )}
      </div>
    </div>
  )
}