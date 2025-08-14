const Stat = ({label,value,sub}) => (<div className="glass rounded-none px-3 py-2 flex-1">
  <div className="text-xs text-white/60">{label}</div><div className="text-xl font-semibold tracking-tight">{value}</div>
  {sub && <div className="text-xs text-white/50 mt-1">{sub}</div>}
</div>)
export default function StatBar(){
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <Stat label="Miles Saved (est.)" value="18.4" sub="vs. baseline"/>
    <Stat label="On-Time Rate" value="94%" sub="last 7 days"/>
    <Stat label="Avg. Drive / Stop" value="11m" sub="today"/>
  </div>
}
