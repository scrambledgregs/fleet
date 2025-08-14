import { useState } from 'react'
import AlertList from './AlertList.jsx'
import Inbox from './Inbox.jsx'
import Vehicles from './Vehicles.jsx'
import WeekPlanner from './WeekPlanner.jsx'

export default function LeftPanel({ mode }){
  const [tab, setTab] = useState('planner')
  const TabBtn = ({id,label}) => (
    <button onClick={()=>setTab(id)} className={"px-2 py-1.5 rounded-none text-xs transition " + (tab===id ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5")}>{label}</button>
  )
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <TabBtn id="planner" label="Week Planner"/>
          <TabBtn id="alerts" label="AI Alerts"/>
          <TabBtn id="inbox" label="Inbox"/>
          <TabBtn id="vehicles" label="Vehicles"/>
        </div>
        <div className="text-xs text-white/60">Mode: <span className="text-white">{mode}</span></div>
      </div>
      <div className="flex-1 min-h-0">
        {tab==='planner' ? <WeekPlanner/> : tab==='alerts' ? <AlertList mode={mode}/> : tab==='inbox' ? <Inbox/> : <Vehicles/>}
      </div>
    </div>
  )
}
