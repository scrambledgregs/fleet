export default function AlertList(){
  const alerts = [
    { id: 'A-1', title: 'Storm risk at 3pm near Thomas Rd', detail: 'Move Tech 2 earlier or shift to indoor task.' },
    { id: 'A-2', title: 'High-value job unassigned ($35k)', detail: 'Assign to Crew A; reduces drive by 22m.' }
  ]
  return <div className="space-y-3 overflow-auto" style={{maxHeight:'70vh'}}>
    {alerts.map(a => (<div key={a.id} className="glass rounded-none p-3"><div className="font-medium">{a.title}</div><div className="text-sm text-white/70 mt-1">{a.detail}</div></div>))}
  </div>
}
