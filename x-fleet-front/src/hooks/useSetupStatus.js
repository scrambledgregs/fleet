import { useEffect, useState } from 'react'
import { API_BASE } from '../config'

export default function useSetupStatus() {
  const [loading, setLoading] = useState(true)
  const [ok, setOk] = useState(false)        // “setup complete?”
  const [data, setData] = useState({ techs: 0 })

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // super simple “complete” heuristic: has at least 1 tech
        const r = await fetch(`${API_BASE}/api/techs?clientId=default`)
        const j = await r.json()
        if (!alive) return
        const techs = Number(j?.count || 0)
        setData({ techs })
        setOk(techs > 0)
      } catch {
        if (!alive) return
        setOk(false)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return { loading, ok, data }
}