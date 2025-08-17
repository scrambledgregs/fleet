// src/components/JobListByDay.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import JobCard from './JobCard'

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item)
    ;(acc[k] ||= []).push(item)
    return acc
  }, {})
}

export default function JobListByDay({
  jobs = [],
  paydayThreshold = 2500,
  selectedJobId,          // used to highlight/scroll
  onSelect,               // <-- expects a JOB OBJECT
  onMap,
}) {
  // stable id getter
  const getId = (j) => j?.appointmentId || j?.id

  // optional: de-dupe if your API can double-return
  const uniqJobs = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const j of jobs) {
      const id = getId(j) || `${j.startTime}-${j.address}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(j)
    }
    return out
  }, [jobs])

  const grouped = useMemo(() => {
    return groupBy(uniqJobs, (j) => {
      try {
        const d = new Date(j.startTime)
        return d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      } catch {
        return j.day || 'Unknown'
      }
    })
  }, [uniqJobs])

  // expand all groups by default
  const [open, setOpen] = useState(() =>
    Object.fromEntries(Object.keys(grouped).map((k) => [k, true]))
  )

  useEffect(() => {
    setOpen(Object.fromEntries(Object.keys(grouped).map((k) => [k, true])))
  }, [grouped])

  // scroll selected card into view
  const itemRefs = useRef(new Map())
  useEffect(() => {
    if (!selectedJobId) return
    const el = itemRefs.current.get(selectedJobId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedJobId])

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([label, list]) => {
        const total = list.reduce((sum, j) => sum + (Number(j.estValue) || 0), 0)
        return (
          <div key={label} className="rounded-xl border border-white/10 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10"
              onClick={() => setOpen((s) => ({ ...s, [label]: !s[label] }))}
              aria-expanded={!!open[label]}
            >
              <div className="font-medium">{label}</div>
              <div className="flex items-center gap-3 text-xs text-white/70">
                <span>{list.length} jobs</span>
                <span>${Math.round(total).toLocaleString()}</span>
                <ChevronDown
                  className={'transition ' + (open[label] ? 'rotate-180 opacity-80' : 'opacity-50')}
                  size={16}
                />
              </div>
            </button>

            {open[label] && (
              <div className="p-2 grid gap-2">
                {list
                  .slice()
                  .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
                  .map((job) => {
                    const id = getId(job)
                    return (
                      <div
                        key={id}
                        ref={(el) => {
                          if (el) itemRefs.current.set(id, el)
                          else itemRefs.current.delete(id)
                        }}
                      >
                        <JobCard
                          job={job}
                          paydayThreshold={paydayThreshold}
                          isSelected={id === selectedJobId}
                          onClick={() => onSelect?.(job)}    
                          onMapClick={() => onMap?.(job)}
                        />
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}