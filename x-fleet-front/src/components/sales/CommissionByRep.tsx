"use client";
import { useEffect, useState } from "react";
import type { CommissionRow, Rep } from "../../types/sales";
import {
  getCommissionByRep,
  getReps,
  createCommissionPayout,
} from "../../lib/salesApi";

export default function CommissionByRep() {
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, repList] = await Promise.all([
        getCommissionByRep("this-month"),
        getReps(),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setReps(Array.isArray(repList) ? repList : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load commissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pay(name: string, amountUsd: number) {
    const rep = reps.find((r) => r.name === name);
    if (!rep) return alert(`No repId found for "${name}".`);

    const ok = confirm(
      `Pay ${name} ${amountUsd.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      })}?`
    );
    if (!ok) return;

    setPaying((s) => ({ ...s, [name]: true }));
    try {
      await createCommissionPayout(rep.id, Number(amountUsd || 0), `Monthly commissions for ${name}`);
      alert("Payout recorded.");
      await load();
    } catch (e: any) {
      alert(`Payout failed: ${e?.message || e}`);
    } finally {
      setPaying((s) => ({ ...s, [name]: false }));
    }
  }

  return (
    <div className="rounded-2xl border">
      <div className="px-4 py-3 border-b font-medium">Commissions – This month</div>

      {error ? (
        <div className="p-4 text-sm text-red-600">{error}</div>
      ) : loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="divide-y">
          {rows.map((row) => (
            <div key={row.name} className="flex items-center justify-between px-4 py-3">
              <div>{row.name}</div>
              <div className="flex items-center gap-3">
                <div>
                  {Number(row.commission_usd || 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </div>
                <button
                  className="h-8 px-3 rounded-md border"
                  onClick={() => pay(row.name, Number(row.commission_usd || 0))}
                  disabled={!!paying[row.name]}
                >
                  {paying[row.name] ? "Paying…" : "Pay"}
                </button>
              </div>
            </div>
          ))}
          {!rows.length && (
            <div className="px-4 py-6 text-muted-foreground">No commissions due.</div>
          )}
        </div>
      )}
    </div>
  );
}