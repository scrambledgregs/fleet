import { useEffect, useMemo, useRef, useState } from 'react'

type VoiceStatusPayload = {
  sid?: string
  status?: string
  from?: string
  to?: string
  at?: string
  dir?: string
}

type VoiceRecordingPayload = {
  callSid?: string
  recordingSid?: string
  url?: string
  durationSec?: number | null
  status?: string
  to?: string
  from?: string
  at?: string
}

type CallLogItem = {
  at: string
  to: string | null
  from: string | null
  status: string
  callSid: string | null
  recordingSid: string | null
  url: string | null
  durationSec: number | null
}

declare global {
  interface WindowEventMap {
    'voice:status': CustomEvent<VoiceStatusPayload>
    'voice:recording-ready': CustomEvent<VoiceRecordingPayload>
  }
}

const STORAGE_KEY = 'xfleet_call_log_v1'
const MAX_ITEMS = 50

function loadSaved(): CallLogItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr as CallLogItem[]) : []
  } catch {
    return []
  }
}
function save(items: CallLogItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {}
}
function fmtTime(iso?: string | null) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso || ''
  }
}

function displayWho(it: CallLogItem) {
  const parts = [it.from, '→', it.to].filter(Boolean)
  return parts.length ? (parts as string[]).join(' ') : 'Call'
}
function colorByStatus(s?: string) {
  const k = String(s || '').toLowerCase()
  if (k.includes('answered') || k.includes('completed') || k === 'recorded') return '#22c55e' // green
  if (k.includes('ring')) return '#eab308' // amber
  if (k.includes('queued') || k.includes('initiated')) return '#60a5fa' // blue
  if (k.includes('busy') || k.includes('failed') || k.includes('no-answer')) return '#ef4444' // red
  return '#9ca3af' // gray
}

export default function CallLog() {
  const [items, setItems] = useState<CallLogItem[]>(loadSaved)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // keep localStorage in sync
  useEffect(() => {
    save(items)
  }, [items])

  // Merge/update helper by callSid (or push if new)
  function upsertBySid(partial: Partial<CallLogItem> & { callSid?: string | null; sid?: string }) {
    setItems(prev => {
      const next = [...prev]
      const sid = partial.callSid ?? partial.sid ?? null
      const idx = sid ? next.findIndex(x => x.callSid === sid) : -1
      const base: CallLogItem = {
        at: new Date().toISOString(),
        to: partial.to ?? null,
        from: partial.from ?? null,
        status: partial.status ?? 'unknown',
        callSid: sid,
        recordingSid: partial.recordingSid ?? null,
        url: partial.url ?? null,
        durationSec:
          typeof partial.durationSec === 'number'
            ? partial.durationSec
            : partial.durationSec == null
            ? null
            : Number(partial.durationSec),
      }
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...base }
      } else {
        next.unshift(base)
      }
      return next.slice(0, MAX_ITEMS)
    })
  }

  // Listen for events from the bridge
  useEffect(() => {
    const onStatus = (e: Event) => {
      const p = (e as CustomEvent<VoiceStatusPayload>).detail || {}
      upsertBySid({
        sid: p.sid,
        status: p.status,
        from: p.from ?? null,
        to: p.to ?? null,
      })
    }

    const onRecording = (e: Event) => {
      const p = (e as CustomEvent<VoiceRecordingPayload>).detail || {}
      upsertBySid({
        callSid: p.callSid ?? null,
        recordingSid: p.recordingSid ?? null,
        url: p.url ?? null,
        durationSec: p.durationSec ?? null,
        status: p.status || 'recorded',
        to: p.to ?? null,
        from: p.from ?? null,
      })
    }

    window.addEventListener('voice:status', onStatus)
    window.addEventListener('voice:recording-ready', onRecording)
    return () => {
      window.removeEventListener('voice:status', onStatus)
      window.removeEventListener('voice:recording-ready', onRecording)
    }
  }, [])

  const recent = useMemo(() => items.slice(0, 10), [items])

  return (
    <div
      ref={wrapRef}
      className="fixed bottom-24 right-4 z-40 w-[360px] max-w-[92vw] rounded-2xl border border-white/10 bg-[#161b22] shadow-2xl"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="text-sm font-semibold">Call Log</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/60">{items.length} total</span>
          <button
            className="text-xs rounded-md px-2 py-1 bg-white/10 hover:bg-white/15"
            onClick={() => setItems([])}
            title="Clear log"
          >
            Clear
          </button>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="px-3 py-3 text-sm text-white/60">No calls yet.</div>
      ) : (
        <ul className="divide-y divide-white/10">
          {recent.map((it, idx) => (
            <li key={(it.callSid || '') + idx} className="px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <div
                  className="mt-0.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorByStatus(it.status) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{displayWho(it)}</span>
                    {it.durationSec != null && (
                      <span className="text-white/50 text-xs">{Math.round(it.durationSec)}s</span>
                    )}
                    <span className="ml-auto text-white/40 text-xs">{fmtTime(it.at)}</span>
                  </div>
                  <div className="text-white/60 text-xs mt-0.5">
                    {it.status || '—'} {it.callSid ? `• ${it.callSid}` : ''}
                  </div>
                  {it.url && (
                    <div className="mt-1">
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-2 text-xs rounded-md border border-white/15 px-2 py-1 hover:bg-white/10"
                      >
                        Open recording
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}