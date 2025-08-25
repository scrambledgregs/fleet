import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ContactsPanel from '../components/ContactsPanel'
import { Plus } from 'lucide-react'

export default function ContactsPage() {
  const navigate = useNavigate()

  // page-level filters/controls
  const [segment, setSegment] = useState('all') // 'all' | 'customers' | 'leads'
  const [query, setQuery] = useState('')
  const [sortBy] = useState('recent') // default behavior; no UI control
  const [counts, setCounts] = useState({ all: 0, customers: 0, leads: 0 })

  const topSearchRef = useRef(null)
  const fileRef = useRef(null)

  // Keyboard: '/', 'c', 'i', 'Esc'
  useEffect(() => {
    function onKey(e) {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea'

      if (e.key === '/' && !isTyping) {
        e.preventDefault()
        topSearchRef.current?.focus()
        return
      }
      if (e.key.toLowerCase() === 'c' && !isTyping) {
        e.preventDefault()
        openNewContact()
        return
      }
      if (e.key.toLowerCase() === 'i' && !isTyping) {
        e.preventDefault()
        fileRef.current?.click()
        return
      }
      if (e.key === 'Escape') {
        setQuery('')
        try { topSearchRef.current?.blur() } catch {}
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openNewContact() {
    navigate('/contacts/new')
  }

  async function importCsv(file) {
    if (!file) return
    // TODO: wire up your real importer endpoint
    console.log('Import CSV selected:', file.name)
  }

  // CONTENT ONLY — AppShell provides TopBar/StatBar/SideNav
  return (
    <div className="glass rounded-none p-3 space-y-3 min-h-0">
      {/* Sticky header (controls stay visible while list scrolls) */}
      <div className="sticky top-2 z-10 backdrop-blur bg-black/20 rounded-xl p-2 border border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-white/60">
              Manage your people & companies. Press{' '}
              <kbd className="px-1 py-0.5 bg-white/10 rounded">/</kbd> to search,{' '}
              <kbd className="px-1 py-0.5 bg-white/10 rounded">c</kbd> to create,{' '}
              <kbd className="px-1 py-0.5 bg-white/10 rounded">i</kbd> to import.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                ref={topSearchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts…"
                className="w-[min(44ch,60vw)] bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/40">/</span>
            </div>

            {/* Make Import subtle so New Contact is the hero */}
            <button
              className="px-3 py-1.5 text-sm rounded-none border border-white/10 bg-transparent hover:bg-white/5"
              onClick={() => fileRef.current?.click()}
              title="Import CSV (i)"
            >
              Import CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => importCsv(e.target.files?.[0] || null)}
            />

            <button
              className="px-3 py-1.5 text-sm rounded-none bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white border border-sky-400/30 inline-flex items-center gap-2"
              onClick={openNewContact}
              title="New Contact (c)"
            >
              <Plus size={16} /> New Contact
            </button>
          </div>
        </div>

        {/* Filters as tabs (with counts) */}
        <nav className="mt-2 flex items-center gap-1">
          {(['all', 'customers', 'leads'] as const).map((x) => {
            const active = segment === x
            const count = counts[x] || 0
            return (
              <button
                key={x}
                onClick={() => setSegment(x)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'px-3 py-1.5 text-sm rounded-full border inline-flex items-center gap-2',
                  active
                    ? 'border-sky-400/40 bg-sky-500/20 text-white'
                    : 'border-white/10 text-white/70 hover:bg-white/5',
                ].join(' ')}
              >
                {x === 'all' ? 'All' : x[0].toUpperCase() + x.slice(1)}
                <span className="text-xs opacity-70">({count})</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* List / details */}
      <div className="min-h-0">
        <ContactsPanel
          showToolbar={false}
          query={query}
          sortBy={sortBy}
          segment={segment}
          onCreateContact={openNewContact}
          // 👇 receive counts from the panel so tabs can show them
          onCounts={(c) => setCounts(c)}
        />
      </div>
    </div>
  )
}