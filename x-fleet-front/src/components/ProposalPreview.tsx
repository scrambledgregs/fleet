// src/components/ProposalPreview.tsx
import React, { useMemo, useRef, useState } from 'react'
import {
  X,
  Download,
  Loader2,
  Phone,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  Link as LinkIcon,
  Copy as CopyIcon,
} from 'lucide-react'

type Item = { id?: string; name: string; qty: number; unit: string; unitPrice: number; notes?: string }
type Totals = { subtotal: number; discount: number; tax: number; total: number }
type Customer = { name: string; phone: string; email?: string; address?: string }
type Sender = { name?: string; title?: string; phone?: string; email?: string }

type DeclineReason = 'competitor' | 'pricing' | 'partner' | 'no_response' | 'timing' | 'other'

type Props = {
  open: boolean
  onClose: () => void
  companyName: string
  brandingAccent?: string

  items: Item[]
  totals: Totals
  customer: Customer
  notes?: string

  coverLetter?: string
  onRegenerate?: (opts?: { tone?: 'shorter' | 'friendly' | 'formal' | 'rewrite' }) => void | Promise<void>
  generating?: boolean
  sender?: Sender

  /** Deposit CTA (optional) */
  depositPct?: number
  showDepositCta?: boolean
  onAcceptDeposit?: () => void | Promise<void>

  /** Optional public (customer) link to copy/open from review */
  publicUrl?: string

  /** Logo (optional controlled / uncontrolled) */
  logoUrl?: string
  onLogoChange?: (dataUrl: string) => void

  /** Decline → pass to dispositions (optional) */
  onDecline?: (payload: { reason: DeclineReason; note?: string }) => void | Promise<void>
}

const currency = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export default function ProposalPreview({
  open,
  onClose,
  companyName,
  brandingAccent = 'from-sky-500 to-blue-500',
  items,
  totals,
  customer,
  notes,
  coverLetter,
  onRegenerate,
  generating,
  sender,
  depositPct = 30,
  showDepositCta,
  onAcceptDeposit,
  publicUrl,
  logoUrl,
  onLogoChange,
  onDecline,
}: Props) {
  const printRef = useRef<HTMLDivElement | null>(null)

  // Uncontrolled logo convenience (persist in localStorage)
  const storedLogo = typeof window !== 'undefined' ? localStorage.getItem('brand.logo') : null
  const [internalLogo, setInternalLogo] = useState<string | null>(logoUrl ?? storedLogo)
  const logo = logoUrl ?? internalLogo

  const depositDue = useMemo(() => {
    const pct = Math.max(0, Math.min(100, depositPct))
    return totals.total * (pct / 100)
  }, [totals.total, depositPct])

  /** Export clean PDF via print-only window */
  function exportPDF() {
    const node = printRef.current
    if (!node) return
    const win = window.open('', '_blank', 'noopener,noreferrer')
    if (!win) return
    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Proposal</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color: #000; background:#fff; }
    .wrap { max-width: 1000px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; }
    th { font-size:12px; text-align:left; background:#f3f4f6; padding:8px; border-bottom:1px solid #e5e7eb; }
    td { font-size:13px; padding:8px; border-bottom:1px solid #eee; vertical-align:top; }
  </style>
</head>
<body>
  <div class="wrap">${node.innerHTML}</div>
  <script>window.onload=()=>{setTimeout(()=>{window.print(); window.close();}, 30)}</script>
</body>
</html>`
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  function handlePickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result || '')
      onLogoChange?.(url)
      if (!onLogoChange) {
        setInternalLogo(url)
        try { localStorage.setItem('brand.logo', url) } catch {}
      }
    }
    reader.readAsDataURL(f)
  }

  // Decline flow
  const [declineOpen, setDeclineOpen] = useState(false)
  const [reason, setReason] = useState<DeclineReason>('competitor')
  const [note, setNote] = useState('')
  async function saveDecline() {
    await onDecline?.({ reason, note: note.trim() || undefined })
    setDeclineOpen(false); setReason('competitor'); setNote('')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100000]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Safe-area wrapper to keep content below app topbar; also allows whole dialog to scroll if needed */}
      <div className="relative z-10 h-full overflow-y-auto pt-16 pb-6 px-3 sm:px-5 flex items-start justify-center">
        {/* Sheet */}
        <div
          className="w-[min(1100px,calc(100vw-2rem))] max-w-[1100px] rounded-2xl bg-white text-neutral-900 shadow-[0_22px_70px_rgba(0,0,0,.35)] ring-1 ring-black/5 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Proposal preview"
        >
          {/* Sticky actions (light, wraps on small screens) */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white/90 px-3 py-2 backdrop-blur">
            <div className="text-sm font-medium text-neutral-700">Proposal preview</div>
            <div className="flex flex-wrap items-center gap-2">
              {publicUrl && (
                <div className="flex items-center gap-1 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded px-2 py-1">
                  <LinkIcon size={12} />
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-neutral-400 hover:decoration-neutral-700"
                  >
                    Customer link
                  </a>
                  <button
                    className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 border border-neutral-200 rounded text-[11px] hover:bg-neutral-100"
                    onClick={async () => { try { await navigator.clipboard.writeText(publicUrl) } catch {} }}
                    title="Copy link"
                  >
                    <CopyIcon size={11} /> Copy
                  </button>
                </div>
              )}

              <button
                onClick={() => onRegenerate?.({ tone: 'rewrite' })}
                disabled={!!generating}
                className="px-3 py-1.5 text-sm border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 rounded"
                title="Regenerate cover letter"
              >
                {generating
                  ? <span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Regenerating…</span>
                  : <span className="inline-flex items-center gap-1"><Sparkles size={14} /> Regenerate letter</span>}
              </button>
              <button
                onClick={exportPDF}
                className="px-3 py-1.5 text-sm border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 rounded"
                title="Export as PDF"
              >
                <span className="inline-flex items-center gap-1"><Download size={14} /> Export PDF</span>
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 rounded"
              >
                <span className="inline-flex items-center gap-1"><X size={14} /> Close</span>
              </button>
            </div>
          </div>

          {/* Print area */}
          <div ref={printRef}>
            {/* Brand header (kept for contrast; content stays on white) */}
            <div className={`bg-gradient-to-r ${brandingAccent} text-white`}>
              <div className="px-4 py-4 sm:px-6 sm:py-6">
                <div className="flex items-center gap-3">
                  {logo ? (
                    <img
                      src={logo}
                      alt="Logo"
                      className="h-10 w-auto bg-white/95 p-1 border border-white/40"
                      style={{ objectFit: 'contain' }}
                    />
                  ) : (
                    <label className="text-xs bg-white/10 border border-white/30 px-2 py-1 cursor-pointer rounded hover:bg-white/20">
                      Add logo
                      <input type="file" accept="image/*" className="hidden" onChange={handlePickLogo} />
                    </label>
                  )}
                  <div>
                    <div className="text-xl sm:text-2xl font-semibold tracking-tight">{companyName}</div>
                    <div className="text-white/90 text-xs">Proposal &amp; Estimate</div>
                  </div>
                </div>

                {/* Meta row */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                  <div className="text-white/95">
                    <div className="opacity-80">Customer</div>
                    <div className="font-semibold">{customer?.name || 'Customer'}</div>
                  </div>
                  <div className="text-white/95">
                    <div className="opacity-80">Project total</div>
                    <div className="font-semibold">{currency(totals.total)}</div>
                  </div>
                  <div className="text-white/95">
                    <div className="opacity-80">Deposit due</div>
                    <div className="font-semibold">
                      {currency(depositDue)} <span className="opacity-80">({Math.round(depositPct)}%)</span>
                    </div>
                  </div>
                  <div className="text-white/95">
                    <div className="opacity-80">Questions?</div>
                    <div className="inline-flex items-center gap-1">
                      <Phone size={14} /> <span>Reply here or call us.</span>
                    </div>
                  </div>
                </div>

                {/* Prominent accept CTA */}
                {showDepositCta && (
                  <div className="mt-3">
                    <button
                      onClick={onAcceptDeposit}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold shadow-lg border border-emerald-400/30 px-4 py-2.5 text-sm sm:text-base"
                      title="Create the deposit invoice and send payment link"
                    >
                      <CheckCircle2 size={18} /> Accept &amp; Pay {Math.round(depositPct)}% Deposit
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Body on white */}
            <div className="px-4 py-4 sm:px-6 sm:py-6">
              {/* Cover letter (no heading; clean card) */}
              <section className="mb-4">
                <div className="rounded-md border border-neutral-200 bg-white p-4 text-[15px] leading-7 text-neutral-900">
                  <pre className="whitespace-pre-wrap font-sans">
                    {coverLetter || 'Thanks for the opportunity. Please review the estimate below.'}
                  </pre>
                </div>

                {/* Inline AI tone presets */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-neutral-700">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-50 border border-neutral-200">
                    <Sparkles size={12} /> AI help
                  </span>
                  <button
                    className="px-2 py-0.5 rounded border border-neutral-200 hover:bg-neutral-50"
                    onClick={() => onRegenerate?.({ tone: 'rewrite' })}
                    disabled={!!generating}
                  >
                    Rewrite
                  </button>
                  <button
                    className="px-2 py-0.5 rounded border border-neutral-200 hover:bg-neutral-50"
                    onClick={() => onRegenerate?.({ tone: 'shorter' })}
                    disabled={!!generating}
                  >
                    Shorter
                  </button>
                  <button
                    className="px-2 py-0.5 rounded border border-neutral-200 hover:bg-neutral-50"
                    onClick={() => onRegenerate?.({ tone: 'friendly' })}
                    disabled={!!generating}
                  >
                    More friendly
                  </button>
                  <button
                    className="px-2 py-0.5 rounded border border-neutral-200 hover:bg-neutral-50"
                    onClick={() => onRegenerate?.({ tone: 'formal' })}
                    disabled={!!generating}
                  >
                    More formal
                  </button>
                </div>
              </section>

              {/* Trust badges */}
              <section className="mb-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-neutral-200 bg-white p-3">
                  <div className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Licensed &amp; Insured</div>
                  <div className="text-sm text-neutral-600 mt-1">Full coverage and permits where required.</div>
                </div>
                <div className="rounded-md border border-neutral-200 bg-white p-3">
                  <div className="flex items-center gap-2 font-medium"><Clock size={16} /> On-Time Promise</div>
                  <div className="text-sm text-neutral-600 mt-1">Clear schedule and updates at each step.</div>
                </div>
                <div className="rounded-md border border-neutral-200 bg-white p-3">
                  <div className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} /> Satisfaction Guarantee</div>
                  <div className="text-sm text-neutral-600 mt-1">We’re not done until you’re happy.</div>
                </div>
              </section>

              {/* Estimate table */}
              <section className="mb-4 overflow-hidden rounded-md border border-neutral-200 bg-white">
                <div className="bg-neutral-50 border-b border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-800">
                  Estimate
                </div>
                <div className="overflow-auto">
                  <table className="min-w-[720px] w-full">
                    <thead>
                      <tr>
                        <th className="text-left p-2">Item</th>
                        <th className="text-left p-2">Qty</th>
                        <th className="text-left p-2">Unit</th>
                        <th className="text-left p-2">Unit Price</th>
                        <th className="text-right p-2">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const line = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
                        return (
                          <tr key={it.id || `${idx}-${it.name}`} className="border-t">
                            <td className="p-2">
                              <div className="font-medium text-neutral-800">{it.name}</div>
                              {it.notes ? <div className="text-[12px] text-neutral-600">{it.notes}</div> : null}
                            </td>
                            <td className="p-2">{it.qty}</td>
                            <td className="p-2">{it.unit}</td>
                            <td className="p-2">{currency(it.unitPrice)}</td>
                            <td className="p-2 text-right">{currency(line)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="flex justify-end p-3">
                  <div className="w-full sm:w-80 text-sm">
                    <div className="flex items-center justify-between py-1"><span>Subtotal</span><span>{currency(totals.subtotal)}</span></div>
                    {!!totals.discount && (
                      <div className="flex items-center justify-between py-1"><span>Discount</span><span>-{currency(totals.discount)}</span></div>
                    )}
                    <div className="flex items-center justify-between py-1"><span>Tax</span><span>{currency(totals.tax)}</span></div>
                    <div className="h-px bg-neutral-200 my-2" />
                    <div className="flex items-center justify-between text-base font-semibold"><span>Total</span><span>{currency(totals.total)}</span></div>
                  </div>
                </div>
              </section>

              {/* Notes / terms */}
              {notes?.trim() ? (
                <section className="mb-6">
                  <div className="text-sm font-semibold mb-1">Notes / terms</div>
                  <div className="rounded-md border border-neutral-200 bg-white p-3 text-[14px] whitespace-pre-wrap">
                    {notes}
                  </div>
                </section>
              ) : null}

              {/* Prepared by */}
              {(sender?.name || sender?.title || sender?.phone || sender?.email) && (
                <section className="mb-2">
                  <div className="text-sm font-semibold mb-1">Prepared by</div>
                  <div className="rounded-md border border-neutral-200 bg-white p-3 text-[14px]">
                    <div className="font-medium">{sender?.name}</div>
                    <div className="text-neutral-700">{sender?.title}</div>
                    <div className="text-neutral-700">{[sender?.phone, sender?.email].filter(Boolean).join(' • ')}</div>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Decline mini-modal */}
      {declineOpen && (
        <div className="absolute inset-0 z-[100100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDeclineOpen(false)} />
          <div className="relative z-10 w-[min(520px,calc(100vw-2rem))] bg-white text-neutral-900 rounded-md shadow-xl border border-neutral-200 p-3">
            <div className="text-sm font-semibold mb-2">Not moving forward</div>
            <label className="block text-xs text-neutral-700 mb-1">Reason</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as DeclineReason)}
              className="w-full bg-white border border-neutral-300 rounded px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
            >
              <option value="competitor">Lost — Went with Competitor</option>
              <option value="pricing">Lost — Pricing</option>
              <option value="partner">Lost — Partner Didn’t Like</option>
              <option value="no_response">Lost — No Response</option>
              <option value="timing">Lost — Timing / Delayed</option>
              <option value="other">Other</option>
            </select>

            <label className="block text-xs text-neutral-700 mt-2 mb-1">Note (optional)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-white border border-neutral-300 rounded px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
              placeholder="Anything we could improve?"
            />

            <div className="mt-3 flex justify-end gap-2">
              <button className="px-3 py-1.5 text-sm border border-neutral-300 bg-white hover:bg-neutral-50 rounded" onClick={() => setDeclineOpen(false)}>Cancel</button>
              <button className="px-3 py-1.5 text-sm bg-rose-600 hover:bg-rose-500 text-white rounded" onClick={saveDecline}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}