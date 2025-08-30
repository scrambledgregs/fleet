'use client';

import * as React from 'react';

type CommMonthlyApi = {
  ok: boolean;
  tenantId: string;
  months: Array<{
    month: string; // "YYYY-MM"
    totals: { earnedUsd: number; paidUsd: number; netUsd: number };
    rows: Array<{ repId: string; repName: string; earnedUsd: number; paidUsd: number; netUsd: number }>;
  }>;
};

export type MonthlyReportsProps = {
  months?: number;          // how many months to pull (default 12)
  tenantId?: string;        // optional tenant override; defaults to server's resolution
  className?: string;
};

export default function MonthlyReports({
  months = 12,
  tenantId,
  className,
}: MonthlyReportsProps): JSX.Element {
  const [data, setData] = React.useState<CommMonthlyApi | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const qs = new URLSearchParams({ months: String(months) });
        if (tenantId) qs.set('tenantId', tenantId);
        const r = await fetch(`/api/commissions/monthly?${qs.toString()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: CommMonthlyApi = await r.json();
        if (!alive) return;
        setData(j);
        setSelected(j.months?.[0]?.month ?? null); // newest by default
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load monthly report');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [months, tenantId]);

  const month = React.useMemo(
    () => data?.months.find((m) => m.month === selected) || null,
    [data, selected]
  );

  const downloadCsv = React.useCallback(() => {
    if (!month) return;
    const header = ['Month', 'Rep ID', 'Rep Name', 'Earned USD', 'Paid USD', 'Net Due USD'];
    const rows = month.rows.map((r) => [
      month.month,
      r.repId,
      r.repName,
      r.earnedUsd.toFixed(2),
      r.paidUsd.toFixed(2),
      r.netUsd.toFixed(2),
    ]);
    const totals = [
      '',
      '',
      'TOTAL',
      month.totals.earnedUsd.toFixed(2),
      month.totals.paidUsd.toFixed(2),
      month.totals.netUsd.toFixed(2),
    ];
    const csv = [header, ...rows, totals]
      .map((line) =>
        line
          .map((cell) => {
            const s = String(cell ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commissions-earned-vs-paid-${month.month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [month]);

  return (
    <div className={['p-4 md:p-5', className || ''].join(' ')}>
      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-400">Month</label>
          <div className="relative">
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value || null)}
              className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-3 pr-8 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              {(data?.months ?? []).map((m) => (
                <option key={m.month} value={m.month}>
                  {formatMonthLabel(m.month)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
  <button
    onClick={downloadCsv}
    disabled={!month}
    className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
  >
    Export CSV
  </button>

  {/* Dev-only: quick payout entry */}
  <DevPayoutForm />
</div>


      </div>

      {/* States */}
      {loading && (
        <div className="animate-pulse text-neutral-400 text-sm">Loading monthly report…</div>
      )}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}
      {!loading && !error && !data?.months?.length && (
        <div className="text-neutral-400 text-sm">No data yet.</div>
      )}

      {/* Content */}
      {month && (
        <div className="space-y-4">
          {/* Totals row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <MiniStat label="Selected Month" value={formatMonthLabel(month.month)} />
            <MiniStat label="Earned" value={fmtUsd(month.totals.earnedUsd)} />
            <MiniStat label="Paid" value={fmtUsd(month.totals.paidUsd)} />
            <MiniStat label="Net Due" value={fmtUsd(month.totals.netUsd)} accent />
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="min-w-full text-sm">
              <thead className="text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Rep</th>
                  <th className="text-left px-4 py-3 font-medium">Rep ID</th>
                  <th className="text-right px-4 py-3 font-medium">Earned</th>
                  <th className="text-right px-4 py-3 font-medium">Paid</th>
                  <th className="text-right px-4 py-3 font-medium">Net Due</th>
                </tr>
              </thead>
              <tbody>
                {month.rows.map((r) => (
                  <tr key={r.repId} className="border-t border-neutral-800/60">
                    <td className="px-4 py-3">{r.repName || r.repId}</td>
                    <td className="px-4 py-3 text-neutral-400">{r.repId}</td>
                    <td className="px-4 py-3 text-right">{fmtUsd(r.earnedUsd)}</td>
                    <td className="px-4 py-3 text-right">{fmtUsd(r.paidUsd)}</td>
                    <td
                      className={[
                        'px-4 py-3 text-right font-medium',
                        r.netUsd > 0 ? 'text-red-300' : 'text-neutral-200',
                      ].join(' ')}
                    >
                      {fmtUsd(r.netUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-neutral-800 bg-neutral-900/40">
                  <td className="px-4 py-3 font-semibold">Total</td>
                  <td />
                  <td className="px-4 py-3 text-right font-semibold">
                    {fmtUsd(month.totals.earnedUsd)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {fmtUsd(month.totals.paidUsd)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{fmtUsd(month.totals.netUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
            Earned = (payment net or gross) × default rep commission% for that rep. Paid = recorded
            payouts via API.
          </p>
        </div>
      )}
    </div>
    
  );
}

function DevPayoutForm(): JSX.Element {
  const [reps, setReps] = React.useState<Array<{ id: string; name: string }>>([]);
  const [repId, setRepId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/reps', { cache: 'no-store' });
        const list = await r.json();
        if (!alive) return;
        const safe = Array.isArray(list) ? list : [];
        setReps(safe);
        if (!repId && safe[0]?.id) setRepId(safe[0].id);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  async function submit() {
    try {
      setSaving(true);
      setErr(null);
      const amt = Number(amount);
      if (!repId || !Number.isFinite(amt) || amt <= 0) {
        setErr('Pick a rep and enter a positive amount');
        return;
      }
      const r = await fetch('/api/commissions/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId, amountUsd: amt }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      setAmount('');
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e: any) {
      setErr(e?.message || 'Failed to record payout');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 hidden md:inline">Dev:</span>
      <select
        value={repId}
        onChange={(e) => setRepId(e.target.value)}
        className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-2 pr-6 text-sm text-neutral-200 hover:bg-neutral-800"
      >
        {reps.map((r) => (
          <option key={r.id} value={r.id}>{r.name || r.id}</option>
        ))}
      </select>
      <input
        inputMode="decimal"
        placeholder="Amount USD"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="h-9 w-[120px] rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
      />
      <button
        onClick={submit}
        disabled={saving || !reps.length}
        className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Record payout'}
      </button>
      {err ? <span className="text-xs text-red-400 ml-1">{err}</span> : null}
    </div>
  );
}

/* ----------------------- local helpers / minis ----------------------- */

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function formatMonthLabel(key: string): string {
  // key like "2025-09"
  const [yy, mm] = (key || '').split('-').map(Number);
  const d = new Date(yy || 1970, (mm || 1) - 1, 1);
  if (isNaN(d.getTime())) return key || '—';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={['mt-1 text-xl font-semibold', accent ? 'text-red-300' : 'text-neutral-100'].join(' ')}>
        {value}
      </div>
    </div>
  );
}