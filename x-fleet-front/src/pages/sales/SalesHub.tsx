// src/pages/sales/SalesHub.tsx
import { useSearchParams } from "react-router-dom";
import { useEffect, useState, type ReactNode, type ChangeEvent } from "react";

import CashLog from "./CashLog";                    // all cash (assigned + unassigned)
import UnassignedPaymentsPage from "./UnassignedPaymentsPage"; // only unassigned
import Leaderboard from "./Leaderboard";            // per-rep commission view
import { getReps, createRep } from "../../lib/salesApi";
import type { Rep } from "../../types/sales";

type TabKey = "cash" | "unassigned" | "leaderboard" | "reps";

const TABS: { key: TabKey; label: string }[] = [
  { key: "cash",        label: "Cash Log" },
  { key: "unassigned",  label: "Unassigned" },
  { key: "leaderboard", label: "Reps (Commission)" },
  { key: "reps",        label: "Manage Reps" },
];

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-4 py-2 rounded-full text-sm md:text-[15px] font-medium transition",
        active
          ? "bg-white/15 text-white ring-1 ring-white/20"
          : "text-white/80 hover:text-white hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function RepsTab() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [pct, setPct] = useState<string>("15");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadReps() {
    setLoading(true);
    try {
      const list = await getReps();
      setReps(Array.isArray(list) ? list : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadReps();
  }, []);

  async function addRep() {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const pctNum = Math.max(0, Math.min(100, Number(pct || 0)));
      await createRep({ name: name.trim(), defaultCommissionPct: pctNum / 100 });
      setName("");
      setPct("15");
      await loadReps();
    } catch (e: any) {
      setErr(e?.message || "Failed to create rep");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 p-4">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="grow">
            <label className="block text-xs text-white/60 mb-1">Rep name</label>
            <input
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2"
              placeholder="e.g. Ethan Graham"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-white/60 mb-1">Default % (optional)</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-right"
                placeholder="15"
                value={pct}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPct(e.target.value)}
              />
              <span className="opacity-70 text-sm">%</span>
            </div>
          </div>
          <button
            onClick={addRep}
            disabled={saving || !name.trim()}
            className="rounded-xl px-4 py-2 bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)] font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add rep"}
          </button>
        </div>
        {err && <div className="mt-2 text-sm text-red-400">{err}</div>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/80">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">ID</th>
              <th className="text-right px-3 py-2">Default %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-white/60">
                  Loading…
                </td>
              </tr>
            ) : reps.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-white/60">
                  No reps yet.
                </td>
              </tr>
            ) : (
              reps.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-white/70">{r.id}</td>
                  <td className="px-3 py-2 text-right">
                    {Math.round((r.defaultCommissionPct ?? 0) * 100)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SalesHub() {
  const [params, setParams] = useSearchParams();
  const active = (params.get("tab") as TabKey) || "cash"; // default to Cash

  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(params);
    next.set("tab", k);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <div className="pt-2 flex justify-center">
        <div className="flex items-center gap-3">
          {TABS.map((t) => (
            <Tab key={t.key} active={active === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
      </div>

      <div>
        {active === "cash" && <CashLog />}
        {active === "unassigned" && <UnassignedPaymentsPage />}
        {active === "leaderboard" && <Leaderboard />}
        {active === "reps" && <RepsTab />}
      </div>
    </div>
  );
}