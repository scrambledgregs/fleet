import React from 'react'
import clsx from 'clsx'

type Status = 'disconnected' | 'listening' | 'receiving' | undefined

export interface CardRadioProps {
  /** Unique value for this option */
  value: string
  /** Title at the top-left of the card */
  label: string
  /** Short one-line helper under the title */
  subtitle?: string
  /** Small pill shown next to the title */
  recommended?: boolean
  /** Connection status pill (optional) */
  status?: Status
  /** Is this card currently selected? */
  selected: boolean
  /** Called when user selects this card */
  onChange: (value: string) => void
  /** Extra content inside the card (e.g., URL token row, “Show setup”) */
  children?: React.ReactNode
  /** Optional right-aligned accessories next to pills (e.g., action buttons) */
  accessories?: React.ReactNode
  /** Extra class names */
  className?: string
  /** Disable interactions */
  disabled?: boolean
  /** aria-describedby id for accessibility (optional) */
  describedById?: string
}

/**
 * A11y pattern:
 * - Use role="radio" and aria-checked for screen readers
 * - Entire card is clickable/focusable
 * - Works inside a parent with role="radiogroup"
 */
export default function CardRadio({
  value,
  label,
  subtitle,
  recommended,
  status,
  selected,
  onChange,
  children,
  accessories,
  className,
  disabled,
  describedById,
}: CardRadioProps) {
  const statusPill = (() => {
    if (!status) return null
    const text =
      status === 'receiving'
        ? '● Receiving'
        : status === 'listening'
        ? '● Listening'
        : '● Not connected'
    const tone =
      status === 'receiving'
        ? 'bg-emerald-400/15 text-emerald-200'
        : status === 'listening'
        ? 'bg-sky-400/15 text-sky-200'
        : 'bg-white/10 text-white/60'
    return (
      <span className={clsx('text-[11px] px-2 py-0.5 rounded-full', tone)}>
        {text}
      </span>
    )
  })()

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-describedby={describedById}
      disabled={disabled}
      onClick={() => !disabled && onChange(value)}
      className={clsx(
        'w-full text-left rounded-2xl border transition outline-none',
        'focus-visible:ring-2 focus-visible:ring-white/40',
        selected
          ? 'border-white/30 bg-white/[0.06] ring-1 ring-white/20'
          : 'border-white/10 bg-white/[0.04] hover:border-white/20',
        disabled && 'opacity-60 cursor-not-allowed',
        className
      )}
    >
      <div className="p-4 md:p-5">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Big radio dot */}
          <span
            aria-hidden
            className={clsx(
              'mt-0.5 h-5 w-5 rounded-full border flex-shrink-0 transition',
              selected
                ? 'border-white bg-white/80'
                : 'border-white/40 bg-transparent'
            )}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-white truncate">{label}</div>
              {recommended && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200">
                  Recommended
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {statusPill}
                {accessories}
              </div>
            </div>

            {subtitle && (
              <div className="mt-1 text-sm text-white/70">{subtitle}</div>
            )}
          </div>
        </div>

        {/* Body */}
        {children && <div className="mt-4 space-y-3">{children}</div>}
      </div>
    </button>
  )
}