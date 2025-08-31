import { useEffect, useMemo, useState } from "react";
import AmountFilter from "../../components/sales/AmountFilter";
import {
  getUnassignedPayments,
  getReps,
  assignPaymentRep,
} from "../../lib/salesApi";
import type { Payment, Rep } from "../../types/sales";
import { resolveTenantId } from "../../lib/http";

function usd(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function centsToUsd(cents?: number | null) {
  const v = Number(cents || 0) / 100;
  return Number.isFinite(v) ? v : 0;
}

export default function UnassignedPaymentsPage() {
  const tenantId = resolveTenantId();

  const [all, setAll] = useState<Payment[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [minUsd, setMinUsd] = useState<number>(0);
  const [q, setQ] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selectedRep, setSelectedRep] = useState<string>("");

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const [payments, repsList] = await Promise.all([
          getUnassignedPayments(),
          getReps(),
        ]);
        if (!ok) return;
        setAll(payments || []);
        setReps(repsList || []);
        if (repsList?.length && !selectedRep) {
          setSelectedRep(repsList[0].id);
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all || [])
      .filter((p) => {
        // amount filter uses GROSS (amount) with net as fallback if missing
        const amountUsd = centsToUsd(p?.amount ?? p?.net);
        const passesAmount = amountUsd >= (minUsd || 0);
        const passesText =
          !needle ||
          (p.customer_name || "").toLowerCase().includes(needle) ||
          (p.stripe_charge_id || "").toLowerCase().includes(needle);
        const unassigned = !("sales_rep_id" in p) || (p as any).sales_rep_id == null;
        return passesAmount && passesText && unassigned;
      })
      .sort((a, b) => {
        const ta = new Date(a.paid_at || 0).getTime();
        const tb = new Date(b.paid_at || 0).getTime();
        return tb - ta;
      });
  }, [all, minUsd, q]);

  const totals = useMemo(() => {
    const count = filtered.length;
    const sumGross = filtered.reduce(
      (s, p) => s + (p?.amount ?? p?.net ?? 0),
      0
    );
    return { count, grossUsd: centsToUsd(sumGross) };
  }, [filtered]);

  async function handleAssign(chargeId: string) {
    if (!selectedRep) return;
    try {
      setAssigning(chargeId);
      await assignPaymentRep(chargeId, selectedRep);
      setAll((prev) => prev.filter((p) => p.stripe_charge_id !== chargeId));
    } catch (e: any) {
      alert(e?.message || "Failed to assign");
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar (compact, edge-to-edge; no page title) */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <AmountFilter
            valueUsd={minUsd}
            onChange={setMinUsd}
            tenantId={tenantId}
            presetsUsd={[0, 500, 2500, 5000]}
          />
          <input
            placeholder="Search name or charge id…"
            className="border border-white/10 bg-black/30 rounded-xl px-3 py-2 w-full md:w-96 text-white placeholder-white/50"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex items-center gap-2 md:ml-auto">
            <label className="text-sm text-white/70">Assign to</label>
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

      {/* KPI tiles (bigger, strong contrast; middle is red gradient) */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr,1.15fr,1fr] gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">Visible payments</div>
          <div className="mt-1 text-3xl font-bold text-white">{totals.count}</div>
        </div>

        <div className="rounded-2xl p-4 text-white bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)]">
          <div className="text-[11px] uppercase tracking-wide font-semibold">Cash collected</div>
          <div className="mt-1 text-3xl font-extrabold">{usd(totals.grossUsd)}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">Min shown</div>
          <div className="mt-1 text-3xl font-bold text-white">{usd(minUsd)}</div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/80">Loading…</div>
      ) : err ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-red-400">{String(err)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/80">
          No unassigned payments match your filter.
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">Charge</th>
                <th className="text-right px-3 py-2">Amount (gross)</th>
                <th className="text-right px-3 py-2 w-[1%]">Action</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {filtered.map((p) => {
                const paid = new Date(p.paid_at || 0);
                const grossUsd = centsToUsd(p?.amount ?? p?.net);
                const shortId = (p.stripe_charge_id || "").slice(0, 10);
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
                    <td className="px-3 py-2 text-right font-medium">{usd(grossUsd)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => handleAssign(p.stripe_charge_id)}
                        disabled={!selectedRep || assigning === p.stripe_charge_id}
                        className="rounded-xl border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
                        title={selectedRep ? "Assign to selected rep" : "Pick a rep to enable"}
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