import { useState } from 'react'
import TopBar from './components/TopBar.jsx'
import StatBar from './components/StatBar.jsx'
import LeftPanel from './components/LeftPanel.jsx'
import MapPanel from './components/MapPanel.jsx'

export default function App(){
  const [mode, setMode] = useState('Approve')
  const [compact, setCompact] = useState(false)
  return (
    <div className={"min-h-screen text-white " + (compact ? "compact-root" : "")}>
      <TopBar mode={mode} setMode={setMode} compact={compact} setCompact={setCompact} />
      <div className={"px-6 " + (compact ? "pt-2" : "pt-4")}><StatBar/></div>
      <main className={"grid grid-cols-12 " + (compact ? "gap-4 p-4" : "gap-6 p-6")}>
        <section className="col-span-12 lg:col-span-5 glass rounded-none p-3"><LeftPanel mode={mode}/></section>
        <section className="col-span-12 lg:col-span-7 glass rounded-none overflow-hidden"><MapPanel compact={compact}/></section>
      </main>
    </div>
  )
}
