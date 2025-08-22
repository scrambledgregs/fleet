// src/pages/Contacts.jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'
import ContactsPanel from '../components/ContactsPanel'
import { Plus } from 'lucide-react'

export default function ContactsPage() {
  const navigate = useNavigate()
  const [compact, setCompact] = useState(false)

  // page-level filters/controls
  const [segment, setSegment] = useState('all') // 'all' | 'customers' | 'leads'
  const [query, setQuery] = useState('')
  const [sortBy] = useState('recent') // default behavior; no UI control

  const topSearchRef = useRef(null)
  const fileRef = useRef(null)

  // Press "/" to focus search (unless typing in an input/textarea)
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/') return
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      e.preventDefault()
      topSearchRef.current?.focus()
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

  return (
    <div className={'min-h-screen text-white ' + (compact ? 'compact-root' : '')}>
      <TopBar compact={compact} setCompact={setCompact} />

      <div className={'px-6 ' + (compact ? 'pt-2' : 'pt-4')}>
        <StatBar />
      </div>

      <main className={'grid grid-cols-12 ' + (compact ? 'gap-4 p-4' : 'gap-6 p-6')}>
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="contacts" />
        </aside>

        <section className="col-span-12 lg:col-span-10">
          <div className="glass rounded-none p-3 space-y-3">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-xl font-semibold">Contacts</h1>
                <div className="text-xs text-white/60">
                  Manage your people & companies. Press{' '}
                  <kbd className="px-1 py-0.5 bg-white/10 rounded">/</kbd> to search.
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
                >
                  <Plus size={16} /> New Contact
                </button>
              </div>
            </div>

            {/* Filters as tabs (no extra box/border) */}
            <nav className="flex items-center gap-1">
              {['all', 'customers', 'leads'].map((x) => {
                const active = segment === x
                return (
                  <button
                    key={x}
                    onClick={() => setSegment(x)}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'px-3 py-1.5 text-sm rounded-full border',
                      active
                        ? 'border-sky-400/40 bg-sky-500/20 text-white'
                        : 'border-white/10 text-white/70 hover:bg-white/5',
                    ].join(' ')}
                  >
                    {x === 'all' ? 'All' : x[0].toUpperCase() + x.slice(1)}
                  </button>
                )
              })}
            </nav>

            {/* List / details */}
            <ContactsPanel
              showToolbar={false}
              query={query}
              sortBy={sortBy}
              segment={segment}
              onCreateContact={openNewContact}
            />
          </div>
        </section>
      </main>
    </div>
  )
}