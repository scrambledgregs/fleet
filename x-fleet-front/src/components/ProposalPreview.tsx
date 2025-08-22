// src/components/ProposalPreview.tsx
import React from 'react'

type LineItem = {
  id: string
  name: string
  qty: number
  unit: string
  unitPrice: number
  notes?: string
}
type Totals = { subtotal: number; discount: number; tax: number; total: number }
type Customer = { name: string; phone: string; email?: string; address?: string }
type Sender = { id?: string; name?: string; title?: string; phone?: string; email?: string }

const currency = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export default function ProposalPreview({
  open,
  onClose,
  companyName = 'NONSTOP JOBS',
  brandingAccent = 'from-sky-500 to-blue-500', // tailwind gradient tokens
  items,
  totals,
  customer,
  notes,
  coverLetter,
  onRegenerate,
  generating,
  sender,
}: {
  open: boolean
  onClose: () => void
  companyName?: string
  brandingAccent?: string
  items: LineItem[]
  totals: Totals
  customer: Customer
  notes?: string
  coverLetter: string
  onRegenerate: () => void
  generating: boolean
  sender?: Sender
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-3xl bg-neutral-950 border-l border-white/10 overflow-auto">
        {/* Print CSS */}
        <style>{`
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
            .print-block { display: block !important; }
            .print-page {
              width: 8.5in;
              min-height: 11in;
              margin: 0 auto;
              padding: 0.75in 0.75in;
              background: white;
              color: #0b1220;
            }
            .print-header-gradient {
              background: linear-gradient(135deg, #38bdf8, #3b82f6) !important;
              -webkit-print-color-adjust: exact;
              color: white !important;
            }
            .screen-only { display: none !important; }
          }
        `}</style>

        {/* Header actions */}
        <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-neutral-950/80 backdrop-blur px-4 py-3">
          <div className="text-sm opacity-80">Proposal preview</div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={onRegenerate}
              disabled={generating}
              title="Ask AI to regenerate the cover letter"
            >
              {generating ? 'Generating…' : 'Regenerate letter'}
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={() => window.print()}
              title="Print / Save as PDF"
            >
              Export PDF
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-none glass"
              onClick={onClose}
              title="Close preview"
            >
              Close
            </button>
          </div>
        </div>

        {/* Printable page */}
        <div className="print-page text-neutral-900">
          {/* Brand Header */}
          <div className={`print-header-gradient bg-gradient-to-r ${brandingAccent} text-white px-5 py-4 mb-6`}>
            <div className="text-xl font-semibold tracking-wide">{companyName}</div>
            <div className="text-xs opacity-90">Proposal & Estimate</div>
          </div>

          {/* Lead section */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <div className="text-xs font-semibold text-neutral-500">Prepared for</div>
              <div className="text-base font-semibold">{customer?.name || 'Customer'}</div>
              {customer?.address ? <div className="text-sm opacity-80">{customer.address}</div> : null}
              <div className="text-sm opacity-80">{customer?.phone}</div>
              {customer?.email ? <div className="text-sm opacity-80">{customer.email}</div> : null}
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-neutral-500">Prepared by</div>
              <div className="text-base font-semibold">{sender?.name || companyName}</div>
              {sender?.title ? <div className="text-sm opacity-80">{sender.title}</div> : null}
              {sender?.phone ? <div className="text-sm opacity-80">{sender.phone}</div> : null}
              {sender?.email ? <div className="text-sm opacity-80">{sender.email}</div> : null}
            </div>
          </div>

          {/* Cover Letter */}
          <div className="mb-6">
            <div className="text-sm font-semibold mb-2">Cover letter</div>
            <div className="bg-white border border-neutral-200 rounded p-4 leading-6 whitespace-pre-wrap">
              {coverLetter || 'We appreciate the opportunity to earn your business. The following proposal outlines our recommended scope and pricing.'}
            </div>
          </div>

          {/* Estimate Table */}
          <div className="mb-6">
            <div className="text-sm font-semibold mb-2">Estimate</div>
            <div className="overflow-hidden rounded border border-neutral-200">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs bg-neutral-100 text-neutral-600">
                <div className="col-span-6">Item</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Unit</div>
                <div className="col-span-2 text-right">Line</div>
              </div>
              {items.map((it) => {
                const line = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)
                return (
                  <div key={it.id} className="grid grid-cols-12 gap-2 px-3 py-2 border-t border-neutral-200 text-sm">
                    <div className="col-span-6">
                      <div className="font-medium">{it.name}</div>
                      {it.notes ? <div className="text-xs opacity-70">{it.notes}</div> : null}
                    </div>
                    <div className="col-span-2">{Number(it.qty) || 0}</div>
                    <div className="col-span-2">{it.unit || ''}</div>
                    <div className="col-span-2 text-right">{currency(line)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Totals */}
          <div className="ml-auto w-full max-w-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-80">Subtotal</span>
              <span>{currency(totals.subtotal)}</span>
            </div>
            {totals.discount ? (
              <div className="flex items-center justify-between text-sm">
                <span className="opacity-80">Discount</span>
                <span>-{currency(totals.discount)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-80">Tax</span>
              <span>{currency(totals.tax)}</span>
            </div>
            <div className="h-px bg-neutral-200 my-3" />
            <div className="flex items-center justify-between text-base font-semibold">
              <span>Total</span>
              <span>{currency(totals.total)}</span>
            </div>
          </div>

          {/* Notes / Terms */}
          {notes ? (
            <div className="mt-6">
              <div className="text-sm font-semibold mb-2">Notes / Terms</div>
              <div className="bg-white border border-neutral-200 rounded p-4 leading-6 whitespace-pre-wrap">
                {notes}
              </div>
            </div>
          ) : null}

          {/* Footer */}
          <div className="mt-10 text-center text-xs text-neutral-500">
            Thank you for choosing {companyName}. We look forward to working with you.
          </div>
        </div>
      </div>
    </div>
  )
}