import { useEffect, useMemo, useState } from "react";
import type { Rep, Payment } from "../../types/sales";
import { getReps, assignPaymentRep } from "../../lib/salesApi";
import api, { resolveTenantId } from "../../lib/http";

type Range = "this-month" | "last-30" | "all";

const fmtUSD = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

function inRange(iso: string, range: Range): boolean {
  if (range === "all") return true;
  const d = new Date(iso).getTime();
  const now = Date.now();
  if (range === "last-30") {
    const start = now - 30 * 24 * 60 * 60 * 1000;
    return d >= start && d <= now;
  }
  // this-month
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  return d >= start && d <= now;
}

export default function UnassignedPaymentsTable({ range = "this-month" }: { range?: Range }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Payment[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({}); // chargeId -> repId
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // ✅ Back to the exact endpoint/shape that was known-good
      const tenant = resolveTenantId();
      const { data } = await api.get("/api/payments", {
        headers: { "X-Tenant-Id": tenant },
        params: { clientId: tenant, paged: 1, page: 1, pageSize: 100 },
      });

      // Server returns { ok, page, pageSize, total, items } when paged=1
      const items: Payment[] = Array.isArray(data) ? data : (data?.items ?? []);
      setRows(items);

      const repsResp = await getReps();
      setReps(Array.isArray(repsResp) ? repsResp : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows
      .filter((p) => inRange(p.paid_at, range))
      .filter((p) => (ql ? (p.customer_name || "").toLowerCase().includes(ql) : true))
      .sort((a, b) => +new Date(b.paid_at) - +new Date(a.paid_at));
  }, [rows, q, range]);

  const summary = useMemo(() => {
    const totalCents = filtered.reduce((s, p) => s + (p.net ?? p.amount), 0);
    return {
      count: filtered.length,
      totalUSD: (totalCents / 100).toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      }),
    };
  }, [filtered]);

  async function onAssign(chargeId: string) {
    const repId = assign[chargeId];
    if (!repId) return;
    await assignPaymentRep(chargeId, repId);
    await load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!filtered.length) return <div className="text-sm">No payments found.</div>;

  return (
    <div className="rounded-2xl border">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="font-medium">Unassigned payments</div>
        <div className="flex items-center gap-3 text-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer…"
            className="h-8 px-2 rounded-md border bg-transparent"
          />
          <div className="text-muted-foreground">
            {summary.count} • {summary.totalUSD}
          </div>
        </div>
      </div>

      <div className="divide-y">
        {filtered.map((p) => (
          <div
            key={p.stripe_charge_id}
            className="grid grid-cols-5 gap-3 items-center px-4 py-3"
          >
            <div className="text-sm">{new Date(p.paid_at).toLocaleString()}</div>
            <div className="text-sm">{p.customer_name ?? "—"}</div>
            <div className="text-sm">
              {fmtUSD(p.net ?? p.amount)}{" "}
              {p.net ? <span className="text-xs text-muted-foreground">(net)</span> : null}
            </div>
            <div>
              <select
                className="w-full border rounded-md px-2 py-1 text-sm"
                value={assign[p.stripe_charge_id] || ""}
                onChange={(e) =>
                  setAssign((s) => ({ ...s, [p.stripe_charge_id]: e.target.value }))
                }
              >
                <option value="" disabled>
                  Choose rep…
                </option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} • {Math.round(r.defaultCommissionPct * 100)}%
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                onClick={() => onAssign(p.stripe_charge_id)}
                disabled={!assign[p.stripe_charge_id]}
                className="w-full rounded-md bg-black text-white px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
              >
                Assign
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}