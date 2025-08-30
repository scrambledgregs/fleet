"use client";
import { useEffect, useMemo, useState } from "react";
import type { CustomerSummary, Rep } from "../../types/sales";
import {
  getCustomersBreakdown,
  getReps,
  listCustomerReps,
  assignCustomerRep,
} from "../../lib/salesApi";
import type { CustomerRepRow } from "../../lib/salesApi";

const fmtUSD = (cents: number) =>
  ((Number.isFinite(cents) ? cents : 0) / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });

type SortKey = "name" | "created_at" | "total_paid_cents";

export default function CustomersBreakdown() {
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({}); // customerId -> repId
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_paid_cents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function load() {
    setError(null);
    try {
      const [customers, allReps, existing] = await Promise.all([
        getCustomersBreakdown(),
        getReps(),
        listCustomerReps(),
      ]);
      setRows(Array.isArray(customers) ? customers : []);
      setReps(Array.isArray(allReps) ? allReps : []);

      // build a safe map (guard null/undefined keys)
      const mapInit: Record<string, string> = {};
      for (const a of ((existing as CustomerRepRow[]) || [])) {
        const cid = (a?.customerId ?? "").trim();
        if (!cid) continue;
        mapInit[cid] = a?.repId ?? "";
      }
      // seed with assignment present in analytics row
      for (const c of customers || []) {
        if (c.assigned_rep_id && !mapInit[c.id]) mapInit[c.id] = c.assigned_rep_id;
      }
      setAssign(mapInit);
    } catch (e: any) {
      console.error("[CustomersBreakdown] load", e);
      setError(e?.message || "Failed to load customers");
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rows || []).filter(r => (ql ? (r.name || "").toLowerCase().includes(ql) : true));
  }, [rows, q]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (sortKey === "name") {
        return sortDir === "asc"
          ? (a.name || "").localeCompare(b.name || "")
          : (b.name || "").localeCompare(a.name || "");
      }
      if (sortKey === "created_at") {
        const an = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bn = b.created_at ? new Date(b.created_at).getTime() : 0;
        return sortDir === "asc" ? an - bn : bn - an;
      }
      const an = Number(a.total_paid_cents || 0);
      const bn = Number(b.total_paid_cents || 0);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function setSort(k: SortKey) {
    setSortDir(d => (k === sortKey ? (d === "asc" ? "desc" : "asc") : "desc"));
    setSortKey(k);
  }

  async function onAssign(customerId: string, repId: string) {
    setSaving(s => ({ ...s, [customerId]: true }));
    setAssign(s => ({ ...s, [customerId]: repId }));
    try {
      await assignCustomerRep(customerId, repId || null);
    } catch (e) {
      console.error("assignCustomerRep failed", e);
    } finally {
      setSaving(s => ({ ...s, [customerId]: false }));
    }
  }

  const totalAll = useMemo(
    () => sorted.reduce((s, r) => s + (r.total_paid_cents || 0), 0),
    [sorted]
  );

  return (
    <div className="rounded-2xl border">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="font-medium">Customers — assignments</div>
        <div className="flex items-center gap-3 text-sm">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customer…"
            className="h-8 px-2 rounded-md border bg-transparent"
          />
          <div className="text-muted-foreground">
            {sorted.length} • {fmtUSD(totalAll)}
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4 text-sm text-red-600">{error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-black/5">
              <tr className="[&>th]:px-4 [&>th]:py-2 text-left">
                <th className="cursor-pointer" onClick={() => setSort("name")}>
                  Customer {sortKey === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="cursor-pointer" onClick={() => setSort("created_at")}>
                  Created {sortKey === "created_at" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th>Payments</th>
                <th className="w-[220px]">Rep</th>
                <th
                  className="cursor-pointer text-right"
                  onClick={() => setSort("total_paid_cents")}
                >
                  Total paid {sortKey === "total_paid_cents" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b">
              {sorted.map((r) => {
                const current = assign[r.id] || r.assigned_rep_id || "";
                return (
                  <tr key={r.id} className="[&>td]:px-4 [&>td]:py-2">
                    <td>{r.name || "—"}</td>
                    <td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                    <td>{r.payments ?? 0}</td>
                    <td>
                      <select
                        className="w-full border rounded-md px-2 py-1 h-8 bg-transparent"
                        value={current}
                        disabled={!!saving[r.id]}
                        onChange={(e) => onAssign(r.id, e.target.value)}
                      >
                        <option value="">— Unassigned —</option>
                        {reps.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.name} • {Math.round(rep.defaultCommissionPct * 100)}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">{fmtUSD(r.total_paid_cents || 0)}</td>
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                    No customers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}