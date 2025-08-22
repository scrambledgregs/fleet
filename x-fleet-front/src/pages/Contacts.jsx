// src/pages/Contacts.jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'
import ContactsPanel from '../components/ContactsPanel.jsx'
import { Plus } from 'lucide-react'

export default function ContactsPage() {
  const navigate = useNavigate()
  const [compact, setCompact] = useState(false)

  // page-level filters/controls (plain JS strings)
  const [segment, setSegment] = useState('all') // 'all' | 'customers' | 'leads'
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent') // 'recent' | 'name'

  const topSearchRef = useRef(null)
  const subSearchRef = useRef(null)
  const fileRef = useRef(null)

  // Press "/" to focus search (unless typing in an input/textarea)
  useEffect(() => {
    function onKey(e) {
      if (e.key !== '/') return
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      e.preventDefault()
      ;(topSearchRef.current || subSearchRef.current)?.focus()
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
                <button
                  className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10"
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

            {/* Sub-toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border border-white/10 rounded-xl bg-white/[0.035] p-2">
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md overflow-hidden border border-white/10">
                  {['all', 'customers', 'leads'].map((x) => (
                    <button
                      key={x}
                      className={'px-3 py-1.5 text-sm ' + (segment === x ? 'bg-white/10' : 'hover:bg-white/5')}
                      onClick={() => setSegment(x)}
                    >
                      {x === 'all' ? 'All' : x[0].toUpperCase() + x.slice(1)}
                    </button>
                  ))}
                </div>

                <input
                  ref={subSearchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, phone, email, address…"
                  className="w-[min(52ch,70vw)] bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm outline-none focus:border-white/30"
                />

                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="appearance-none bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm pr-7"
                    title="Sort contacts"
                  >
                    <option value="recent">Sort: Recent first</option>
                    <option value="name">Sort: A → Z</option>
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/50">▾</span>
                </div>
              </div>

              <button
                className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-2"
                onClick={openNewContact}
              >
                <Plus size={16} /> New Contact
              </button>
            </div>

            {/* List / details */}
            <ContactsPanel
              showToolbar={false}
              query={query}
              sortBy={sortBy}
              segment={segment}
            />
          </div>
        </section>
      </main>
    </div>
  )
}