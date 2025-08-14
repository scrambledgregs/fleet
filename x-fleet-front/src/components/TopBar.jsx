import { Bolt, ToggleLeft, ToggleRight } from 'lucide-react'
export default function TopBar({ mode, setMode, compact, setCompact }){
  const isAuto = mode==='Auto'
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-white/5">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-none bg-accent/20 flex items-center justify-center"><Bolt className="text-accent" size={18}/></div>
          <div className="font-semibold tracking-tight">Smart Dispatch Companion</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-white/60 hidden sm:block">Dispatch Mode</div>
          <button onClick={()=>setMode(isAuto?'Approve':'Auto')} className="flex items-center gap-2 rounded-none px-2 py-1 glass hover:bg-panel/70 transition">
            {isAuto?<ToggleRight size={18}/>:<ToggleLeft size={18}/>}<span className="text-sm">{isAuto?'Auto':'Approve'}</span>
          </button>
          <button onClick={()=>setCompact(!compact)} className="flex items-center gap-2 rounded-none px-2 py-1 glass hover:bg-panel/70 transition">
            <span className="text-sm">{compact?'Compact: On':'Compact: Off'}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
