import { useEffect, useMemo, useState } from "react";
import { getUnassignedPayments, assignPaymentRep, getReps } from "../../lib/salesApi";
import type { Payment, Rep } from "../../types/sales";
import AmountFilter from "../../components/sales/AmountFilter";
import { resolveTenantId } from "../../lib/http";

function formatUsdCents(cents?: number) {
  const n = (Number(cents || 0) / 100);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function CommissionsUnassigned() {
  const tenantId = resolveTenantId();
  const [raw, setRaw] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [minUsd, setMinUsd] = useState<number>(0);
  const [reps, setReps] = useState<Rep[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [payments, team] = await Promise.all([getUnassignedPayments(), getReps()]);
        if (!mounted) return;
        setRaw(payments);
        setReps(team);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo(() => {
    const dollars = (p: Payment) => Number((p?.net ?? p?.amount) || 0) / 100;
    return raw
      .filter((p) => dollars(p) >= (minUsd || 0))
      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
  }, [raw, minUsd]);

  async function handleAssign(chargeId: string, repId: string) {
    setAssigning(chargeId);
    try {
      await assignPaymentRep(chargeId, repId);
      // Optimistically remove from list
      setRaw((prev) => prev.filter((p) => p.stripe_charge_id !== chargeId));
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Top bar: title + amount filter */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Unassigned Payments</h1>
          <p className="text-sm opacity-70">
            Filter by amount on the client. No backend thresholds.
          </p>
        </div>
        <AmountFilter
          valueUsd={Number(localStorage.getItem(`minUsd:${tenantId}`) || 0)}
          onChange={setMinUsd}
          tenantId={tenantId}
          presetsUsd={[0, 500, 2500, 5000]}
        />
      </div>

      {/* Stats */}
      <div className="text-sm opacity-80">
        Showing <b>{rows.length.toLocaleString()}</b> of{" "}
        {raw.length.toLocaleString()} payments{minUsd ? ` (≥ $${minUsd.toLocaleString()})` : ""}.
      </div>

      {/* Table */}
      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Paid</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-right px-3 py-2">Net</th>
              <th className="text-right px-3 py-2">Gross</th>
              <th className="text-left px-3 py-2">Charge Id</th>
              <th className="text-right px-3 py-2">Assign</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                  No payments match your filter.
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.stripe_charge_id} className="border-t">
                <td className="px-3 py-2">
                  {new Date(p.paid_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{p.customer_name || "—"}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {formatUsdCents((p.net ?? p.amount ?? 0))}
                </td>
                <td className="px-3 py-2 text-right">{formatUsdCents(p.amount)}</td>
                <td className="px-3 py-2">{p.stripe_charge_id}</td>
                <td className="px-3 py-2 text-right">
                  <AssignMenu
                    reps={reps}
                    disabled={assigning === p.stripe_charge_id}
                    onPick={(repId) => handleAssign(p.stripe_charge_id, repId)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <div className="text-sm opacity-70">Loading…</div>}
    </div>
  );
}

function AssignMenu({
  reps,
  onPick,
  disabled,
}: {
  reps: Rep[];
  onPick: (repId: string) => void;
  disabled?: boolean;
}) {
  if (!reps?.length) {
    return <span className="text-xs opacity-60">No reps</span>;
  }
  return (
    <select
      disabled={disabled}
      className="border rounded-lg px-2 py-1"
      defaultValue=""
      onChange={(e) => {
        const v = e.target.value;
        if (v) onPick(v);
      }}
    >
      <option value="" disabled>
        Assign…
      </option>
      {reps.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}