// src/pages/sales/CashLog.tsx
import { useEffect, useMemo, useState } from "react";
import AmountFilter from "../../components/sales/AmountFilter";
import { listAllPayments, getReps, assignPaymentRep } from "../../lib/salesApi";
import type { Payment, Rep } from "../../types/sales";
import { resolveTenantId } from "../../lib/http";

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fromCents = (c?: number | null) => Number(c || 0) / 100;

type RangeKey = "mtd" | "last-month" | "qtd" | "ytd" | "custom";

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonthUTC(d: Date) {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
}
function computeRange(key: RangeKey, cs?: string, ce?: string) {
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  if (key === "custom" && cs && ce) {
    const s = new Date(`${cs}T00:00:00Z`);
    const e = new Date(`${ce}T23:59:59Z`);
    return { start: s, end: e };
  }
  if (key === "last-month") {
    const lm = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)
    );
    return { start: startOfMonthUTC(lm), end: endOfMonthUTC(lm) };
  }
  if (key === "qtd") {
    const m = today.getUTCMonth();
    const qStartMonth = m - (m % 3);
    const qs = new Date(Date.UTC(today.getUTCFullYear(), qStartMonth, 1));
    return { start: qs, end: endOfMonthUTC(today) };
  }
  if (key === "ytd") {
    const ys = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    return { start: ys, end: endOfMonthUTC(today) };
  }
  return { start: startOfMonthUTC(today), end: endOfMonthUTC(today) }; // MTD
}

export default function CashLog() {
  const tenantId = resolveTenantId();

  // data
  const [all, setAll] = useState<Payment[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [range, setRange] = useState<RangeKey>("mtd");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");
  const [minUsd, setMinUsd] = useState<number>(0);
  const [q, setQ] = useState("");
  const [repFilter, setRepFilter] = useState<string>("all"); // 'all' | 'unassigned' | repId

  // assign
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const [payments, repList] = await Promise.all([
          // all cash: pull everything (paged)
          listAllPayments({ max: 5000, pageSize: 250 }),
          getReps(),
        ]);
        if (!ok) return;
        setAll(payments || []);
        setReps(repList || []);
        if (repList?.length && !selectedRep) {
          setSelectedRep(repList[0].id);
        }
      } catch (e: any) {
        setErr(e?.message || "Failed to load payments");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, []);

  const repsById = useMemo(() => {
    const m = new Map<string, string>();
    reps.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [reps]);

  const filtered = useMemo(() => {
    const { start, end } = computeRange(range, cs, ce);
    const needle = q.trim().toLowerCase();

    return (all || [])
      .filter((p) => {
        // date
        const ts = p.paid_at ? new Date(p.paid_at) : null;
        if (!ts || ts < start || ts > end) return false;

        // amount (use gross `amount`, fallback to `net`)
        const grossUsd = fromCents(p.amount ?? p.net);
        if (grossUsd < (minUsd || 0)) return false;

        // text
        const textHit =
          !needle ||
          (p.customer_name || "").toLowerCase().includes(needle) ||
          (p.stripe_charge_id || "").toLowerCase().includes(needle);

        // rep filter
        const rid = (p as any).sales_rep_id as string | null | undefined;
        const repHit =
          repFilter === "all"
            ? true
            : repFilter === "unassigned"
            ? !rid
            : rid === repFilter;

        return textHit && repHit;
      })
      .sort((a, b) => {
        const ta = new Date(a.paid_at || 0).getTime();
        const tb = new Date(b.paid_at || 0).getTime();
        return tb - ta;
      });
  }, [all, range, cs, ce, minUsd, q, repFilter]);

  const totals = useMemo(() => {
    const count = filtered.length;
    const grossSumCents = filtered.reduce(
      (s, p) => s + (p?.amount ?? p?.net ?? 0),
      0
    );
    return { count, grossUsd: fromCents(grossSumCents) };
  }, [filtered]);

  async function handleAssign(chargeId: string) {
    if (!selectedRep) return;
    try {
      setAssigning(chargeId);
      await assignPaymentRep(chargeId, selectedRep);
      // update local row so it moves out of "unassigned" filter if active
      setAll((prev) =>
        prev.map((p) =>
          p.stripe_charge_id === chargeId
            ? ({ ...p, sales_rep_id: selectedRep } as any)
            : p
        )
      );
    } catch (e: any) {
      alert(e?.message || "Failed to assign");
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Filters toolbar */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { k: "mtd", label: "MTD" },
            { k: "last-month", label: "Last month" },
            { k: "qtd", label: "QTD" },
            { k: "ytd", label: "YTD" },
            { k: "custom", label: "Custom" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setRange(t.k as RangeKey)}
              className={[
                "px-3 py-1.5 rounded-full text-sm border",
                range === t.k
                  ? "bg-white/15 border-white/20 text-white"
                  : "border-white/15 text-white/80 hover:bg-white/10",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}

          <AmountFilter
            valueUsd={minUsd}
            onChange={setMinUsd}
            tenantId={tenantId}
            presetsUsd={[0, 500, 2500, 5000]}
          />

          {range === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="date"
                value={cs}
                onChange={(e) => setCs(e.target.value)}
                className="bg-black/30 border border-white/10 rounded-xl px-2 py-1.5 text-white"
              />
              <span className="text-white/60">→</span>
              <input
                type="date"
                value={ce}
                onChange={(e) => setCe(e.target.value)}
                className="bg-black/30 border border-white/10 rounded-xl px-2 py-1.5 text-white"
              />
            </div>
          )}

          <input
            placeholder="Search name or charge id…"
            className="border border-white/10 bg-black/30 rounded-xl px-3 py-2 w-full md:w-80 text-white placeholder-white/50"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="flex items-center gap-2 md:ml-auto">
            <label className="text-sm text-white/70">Show</label>
            <select
              className="border border-white/10 bg-black/30 rounded-xl px-3 py-2 text-white"
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="unassigned">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <label className="text-sm text-white/70 ml-3">Assign to</label>
            <select
              className="border border-white/10 bg-black/30 rounded-xl px-3 py-2 text-white"
              value={selectedRep}
              onChange={(e) => setSelectedRep(e.target.value)}
            >
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
              {!reps.length && <option value="">No reps</option>}
            </select>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">
            Visible payments
          </div>
          <div className="mt-1 text-3xl font-bold text-white">{totals.count}</div>
        </div>
        <div className="rounded-2xl p-4 text-white bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)]">
          <div className="text-[11px] uppercase tracking-wide font-semibold">
            Cash collected
          </div>
          <div className="mt-1 text-3xl font-extrabold">{usd(totals.grossUsd)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">
            Min shown
          </div>
          <div className="mt-1 text-3xl font-bold text-white">{usd(minUsd)}</div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/80">
          Loading…
        </div>
      ) : err ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-red-400">
          {String(err)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/80">
          No payments match your filter.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">Charge</th>
                <th className="text-left px-3 py-2">Rep</th>
                <th className="text-right px-3 py-2">Amount (gross)</th>
                <th className="text-right px-3 py-2 w-[1%]">Action</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {filtered.map((p) => {
                const paid = new Date(p.paid_at || 0);
                const grossUsd = fromCents(p?.amount ?? p?.net);
                const shortId = (p.stripe_charge_id || "").slice(0, 10);
                const repId = (p as any).sales_rep_id as string | null | undefined;
                const repLabel = repId ? repsById.get(repId) || repId : "Unassigned";

                return (
                  <tr key={p.stripe_charge_id} className="border-t border-white/5">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isNaN(paid.getTime())
                        ? "—"
                        : paid.toLocaleString(undefined, {
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                    </td>
                    <td className="px-3 py-2">{p.customer_name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{shortId}…</td>
                    <td className="px-3 py-2">{repLabel}</td>
                    <td className="px-3 py-2 text-right font-medium">{usd(grossUsd)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleAssign(p.stripe_charge_id)}
                        disabled={!selectedRep || assigning === p.stripe_charge_id}
                        className="rounded-xl border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
                        title={selectedRep ? "Assign / Change rep" : "Pick a rep to enable"}
                      >
                        {assigning === p.stripe_charge_id ? "Assigning…" : "Assign"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}