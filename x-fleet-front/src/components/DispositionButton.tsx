import React, { useEffect, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import {
  useFloating,
  flip,
  shift,
  offset,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react'

export type DispositionKey =
  | 'competitor'
  | 'pricing'
  | 'partner'
  | 'no_response'
  | 'timing'
  | 'other'

export type DispositionOption = { key: DispositionKey; label: string }

export type DispositionPayload = {
  contactId: string
  disposition: DispositionKey
  note?: string
}

const DEFAULT_DISPOSITIONS: DispositionOption[] = [
  { key: 'competitor',  label: 'Lost — Went with Competitor' },
  { key: 'pricing',     label: 'Lost — Pricing' },
  { key: 'partner',     label: 'Lost — Partner Didn’t Like' },
  { key: 'no_response', label: 'Lost — No Response' },
  { key: 'timing',      label: 'Lost — Timing / Delayed' },
  { key: 'other',       label: 'Other' },
]

type Props = {
  contactId: string
  onDispo?: (payload: DispositionPayload) => void | Promise<void>
  options?: DispositionOption[]
  className?: string
  disabled?: boolean
  /** If true, ask for a short note when selecting a dispo (recommended). */
  requireNote?: boolean
}

// Safely coerce Floating UI refs to real HTMLElements (ignore VirtualElement)
function getEl<T extends HTMLElement>(refOrEl: unknown): T | null {
  if (!refOrEl) return null
  if (refOrEl instanceof HTMLElement) return refOrEl as T
  // FloatingUI stores the current element on `.current` or `.elements`
  const anyRef = refOrEl as any
  const el: unknown =
    anyRef?.current ??
    anyRef?.contextElement ??
    anyRef?.elements?.reference ??
    anyRef?.elements?.floating
  return el instanceof HTMLElement ? (el as T) : null
}

export default function DispositionButton({
  contactId,
  onDispo,
  options = DEFAULT_DISPOSITIONS,
  className = '',
  disabled,
  requireNote = true,
}: Props) {
  const [open, setOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<DispositionKey | null>(null)
  const [note, setNote] = useState('')

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    if (!open) return

    function onDoc(e: MouseEvent) {
      const target = e.target as Node

      // prefer domReference; fall back to reference
      const refEl =
        getEl<HTMLElement>(refs.domReference) ??
        getEl<HTMLElement>(refs.reference)
      const floatEl = getEl<HTMLElement>(refs.floating)

      if (refEl?.contains(target)) return
      if (floatEl?.contains(target)) return

      setOpen(false)
      setPendingKey(null)
      setNote('')
    }

    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, refs])

  async function commit(selected: DispositionKey, noteText?: string) {
    const payload: DispositionPayload = {
      contactId,
      disposition: selected,
      note: noteText?.trim() ? noteText.trim() : undefined,
    }
    await onDispo?.(payload)
    setOpen(false)
    setPendingKey(null)
    setNote('')
  }

  function onPick(k: DispositionKey) {
    if (requireNote) {
      setPendingKey(k)
      return
    }
    void commit(k)
  }

  return (
    <div className={`inline-block ${className}`}>
      <button
        ref={refs.setReference}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="px-2 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 inline-flex items-center gap-1 disabled:opacity-50"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
        Disposition
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            role="menu"
            style={floatingStyles}
            className="w-[min(22rem,80vw)] bg-neutral-900 border border-white/10 shadow-xl z-[9999]"
          >
            <div className="py-1">
              {options.map(opt => (
                <button
                  key={opt.key}
                  role="menuitem"
                  onClick={() => onPick(opt.key)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {pendingKey && (
              <div className="border-t border-white/10 p-2">
                <label className="block text-[11px] text-white/60 mb-1">
                  Add a short note (optional)
                </label>
                <input
                  autoFocus
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commit(pendingKey, note)
                    if (e.key === 'Escape') { setPendingKey(null); setNote('') }
                  }}
                  placeholder="e.g., competitor X matched timeline"
                  className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1.5 text-sm outline-none focus:border-white/30"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    className="px-2 py-1 text-xs border border-white/15 bg-white/5 hover:bg-white/10 rounded-none"
                    onClick={() => { setPendingKey(null); setNote('') }}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-2 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white border border-sky-400/30 rounded-none"
                    onClick={() => pendingKey && commit(pendingKey, note)}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  )
}