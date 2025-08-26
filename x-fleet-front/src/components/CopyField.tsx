import React, { useState } from 'react'
import { Clipboard, Check } from 'lucide-react'

type CopyFieldProps = {
  value: string
  label?: string
  className?: string
  ariaLabel?: string
}

export default function CopyField({ value, label, className, ariaLabel }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Fallback for rare cases
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }

  return (
    <div className={['w-full', className].filter(Boolean).join(' ')}>
      {label && <div className="text-[11px] mb-1 text-white/60">{label}</div>}
      <div className="relative flex items-center">
        <input
          readOnly
          value={value}
          aria-label={ariaLabel || label || 'Copy field'}
          className="w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 pr-10 text-sm text-white/90
                     focus:outline-none focus:ring-2 focus:ring-white/20"
        />
        <button
          type="button"
          onClick={doCopy}
          className="absolute right-1.5 inline-flex items-center justify-center rounded-lg
                     px-2.5 py-1.5 border border-white/10 bg-white/[0.06] hover:bg-white/[0.12] transition"
          aria-label="Copy to clipboard"
          title="Copy"
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </button>
      </div>
      {copied && (
        <div className="mt-1 text-[11px] text-emerald-300">Copied!</div>
      )}
    </div>
  )
}