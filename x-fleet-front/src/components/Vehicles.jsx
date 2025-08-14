export default function Vehicles(){
  const rows = [
    { id:'V-101', name:'Truck 1 — Crew A', routeValue:42500, status:'On Site' },
    { id:'V-102', name:'Truck 2 — Crew B', routeValue:18750, status:'En Route' }
  ]
  return <div className="space-y-2 overflow-auto" style={{maxHeight:'70vh'}}>
    {rows.map(r => (<div key={r.id} className="glass rounded-none p-2 flex items-center justify-between">
      <div className="font-medium">{r.name}</div>
      <div className="text-xs text-white/70">${r.routeValue.toLocaleString()} • {r.status}</div>
    </div>))}
  </div>
}
