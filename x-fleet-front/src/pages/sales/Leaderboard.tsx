import { useEffect, useMemo, useState } from "react";
import { listAllPayments, getReps, createCommissionPayout } from "../../lib/salesApi";
import type { Payment, Rep } from "../../types/sales";
import api from "../../lib/api";

// ---------------- helpers ----------------
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
function monthKeyUTC(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`; // e.g. 2025-08
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
  // MTD default
  return { start: startOfMonthUTC(today), end: endOfMonthUTC(today) };
}

// Commission bump: whole-month rate applied to the month's entire gross cash
function monthRate(grossUsd: number) {
  if (grossUsd >= 135_000) return 0.2;
  if (grossUsd >= 50_000) return 0.17;
  return 0.15;
}

type RepRow = {
  repId: string;
  repName: string;
  grossUsd: number;
  commissionUsd: number;
  effectiveRate: number;
  months: {
    key: string;
    grossUsd: number;
    rate: number;
    commissionUsd: number;
  }[];
};

// ---------------- server fallback ----------------
type LeaderboardRow = { name: string; commission_usd: number };

function toServerRange(r: RangeKey): "mtd" | "qtd" | "ytd" | "last-30" {
  if (r === "last-month") return "last-30";
  if (r === "qtd") return "qtd";
  if (r === "ytd") return "ytd";
  return "mtd";
}

export async function loadLeaderboard(
  range: "mtd" | "qtd" | "ytd" | "last-30" = "mtd"
): Promise<LeaderboardRow[]> {
  const { data } = await api.get<LeaderboardRow[]>(
    "/api/analytics/commission-by-rep",
    { params: { range } }
  );
  const rows = Array.isArray(data) ? data : [];
  return rows
    .slice()
    .sort(
      (a, b) => (b.commission_usd ?? 0) - (a.commission_usd ?? 0)
    );
}

// ---------------- page ----------------
export default function Leaderboard() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("mtd");
  const [cs, setCs] = useState("");
  const [ce, setCe] = useState("");

  // server fallback state
  const [serverRows, setServerRows] = useState<LeaderboardRow[] | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const [open, setOpen] = useState<Record<string, boolean>>({}); // per-rep drawer

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [pays, repList] = await Promise.all([
          // pulls paged results (assigned + unassigned); client filters by rep
          listAllPayments({ max: 5000, pageSize: 250 }),
          getReps(),
        ]);
        if (!alive) return;
        setPayments(pays || []);
        setReps(repList || []);
      } catch (e: any) {
        setErr(e?.message || "Failed to load leaderboard");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // load server leaderboard whenever range changes (used as fallback UI)
  useEffect(() => {
    (async () => {
      try {
        const r = await loadLeaderboard(toServerRange(range));
        setServerRows(r);
        setServerErr(null);
      } catch (e: any) {
        setServerErr(e?.message || "Failed to load server leaderboard");
        setServerRows(null);
      }
    })();
  }, [range]);

  const repNameById = useMemo(() => {
    const m = new Map<string, string>();
    reps.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [reps]);

  const rows = useMemo<RepRow[]>(() => {
    if (!payments?.length) return [];
    const { start, end } = computeRange(range, cs, ce);

    // Assigned, in-range
    const assigned = payments.filter((p) => {
      const repId = (p as any).sales_rep_id as string | null | undefined;
      if (!repId) return false;
      const ts = p.paid_at ? new Date(p.paid_at) : null;
      return ts != null && ts >= start && ts <= end;
    });

    // rep -> month -> gross
    const byRepMonth = new Map<string, Map<string, number>>();
    for (const p of assigned) {
      const repId = (p as any).sales_rep_id as string;
      const grossUsd = fromCents(p.amount ?? p.net ?? 0);
      const mk = monthKeyUTC(new Date(p.paid_at!));
      if (!byRepMonth.has(repId)) byRepMonth.set(repId, new Map());
      const inner = byRepMonth.get(repId)!;
      inner.set(mk, (inner.get(mk) || 0) + grossUsd);
    }

    const out: RepRow[] = [];
    for (const [repId, monthMap] of byRepMonth.entries()) {
      let grossUsd = 0;
      let commissionUsd = 0;
      const months: RepRow["months"] = [];
      for (const [k, g] of Array.from(monthMap.entries()).sort()) {
        const r = monthRate(g);
        const c = g * r;
        months.push({ key: k, grossUsd: g, rate: r, commissionUsd: c });
        grossUsd += g;
        commissionUsd += c;
      }
      out.push({
        repId,
        repName: repNameById.get(repId) || repId,
        grossUsd,
        commissionUsd,
        effectiveRate: grossUsd > 0 ? commissionUsd / grossUsd : 0,
        months,
      });
    }

    out.sort((a, b) => b.commissionUsd - a.commissionUsd);
    return out;
  }, [payments, range, cs, ce, repNameById]);

  const kpis = useMemo(() => {
    const gross = rows.reduce((s, r) => s + r.grossUsd, 0);
    const comm = rows.reduce((s, r) => s + r.commissionUsd, 0);
    const eff = gross > 0 ? comm / gross : 0;
    return { gross, comm, eff };
  }, [rows]);

  async function recordPayout(r: RepRow) {
    try {
      await createCommissionPayout(
        r.repId,
        Math.round(r.commissionUsd),
        `Commission payout (${range})`
      );
      alert(`Recorded payout for ${r.repName}: ${usd(r.commissionUsd)}`);
    } catch (e: any) {
      alert(e?.message || "Failed to record payout");
    }
  }

  return (
    <div className="space-y-4">
      {/* Range chips (top; no big page title) */}
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
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">
            Total cash collected
          </div>
          <div className="mt-1 text-3xl font-bold text-white">
            {usd(kpis.gross)}
          </div>
        </div>

        <div className="rounded-2xl p-4 text-white bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)]">
          <div className="text-[11px] uppercase tracking-wide font-semibold">
            Commission due
          </div>
          <div className="mt-1 text-3xl font-extrabold">{usd(kpis.comm)}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/70">
            Effective rate
          </div>
          <div className="mt-1 text-3xl font-bold text-white">
            {(kpis.eff * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Schedule hint */}
      <div className="text-xs text-white/60">
        Commissions are calculated per calendar month (whole-month bump):{" "}
        <span className="text-white/80 font-medium">15%</span> for &lt; $50k,{" "}
        <span className="text-white/80 font-medium">17%</span> for $50k–$135k,{" "}
        <span className="text-white/80 font-medium">20%</span> for &gt;= $135k.
        The rate applies to the month’s entire cash collected.
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
      ) : rows.length === 0 ? (
        serverRows?.length ? (
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-3 py-2 bg-white/5 text-white/80 text-sm">
              No assigned payments returned by /api/payments; showing server leaderboard.
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/80">
                <tr>
                  <th className="text-left px-3 py-2">Rep</th>
                  <th className="text-right px-3 py-2">Commission due</th>
                </tr>
              </thead>
              <tbody className="text-white/90">
                {serverRows.map((r) => (
                  <tr key={r.name} className="border-t border-white/5">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {usd(r.commission_usd ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 p-6 text-sm text-white/80">
            {serverErr ? serverErr : "No assigned payments in this range."}
          </div>
        )
      ) : (
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/80">
              <tr>
                <th className="text-left px-3 py-2">Rep</th>
                <th className="text-right px-3 py-2">Cash (gross)</th>
                <th className="text-right px-3 py-2">Effective rate</th>
                <th className="text-right px-3 py-2">Commission due</th>
                <th className="text-right px-3 py-2 w-[1%]">Action</th>
              </tr>
            </thead>
            <tbody className="text-white/90">
              {rows.map((r) => (
                <RepRowView
                  key={r.repId}
                  row={r}
                  open={!!open[r.repId]}
                  onToggle={() =>
                    setOpen((s) => ({ ...s, [r.repId]: !s[r.repId] }))
                  }
                  onPayout={() => recordPayout(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RepRowView({
  row,
  open,
  onToggle,
  onPayout,
}: {
  row: {
    repId: string;
    repName: string;
    grossUsd: number;
    commissionUsd: number;
    effectiveRate: number;
    months: {
      key: string;
      grossUsd: number;
      rate: number;
      commissionUsd: number;
    }[];
  };
  open: boolean;
  onToggle: () => void;
  onPayout: () => void;
}) {
  return (
    <>
      <tr className="border-t border-white/5">
        <td className="px-3 py-2">
          <button
            onClick={onToggle}
            className="mr-2 rounded-md px-2 py-0.5 text-xs border border-white/15 text-white/70 hover:bg-white/10"
          >
            {open ? "▾" : "▸"}
          </button>
          {row.repName}
        </td>
        <td className="px-3 py-2 text-right">{usd(row.grossUsd)}</td>
        <td className="px-3 py-2 text-right">
          {(row.effectiveRate * 100).toFixed(1)}%
        </td>
        <td className="px-3 py-2 text-right font-medium">
          {usd(row.commissionUsd)}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={onPayout}
            className="rounded-xl border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Record payout
          </button>
        </td>
      </tr>

      {open && row.months.length > 0 && (
        <tr className="border-t border-white/5 bg-white/[0.03]">
          <td colSpan={5} className="px-3 py-3">
            <div className="flex flex-wrap gap-2">
              {row.months.map((m) => (
                <div
                  key={m.key}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm"
                >
                  <div className="text-white/70">{m.key}</div>
                  <div className="text-white/90">
                    {usd(m.grossUsd)} @ {(m.rate * 100).toFixed(0)}% ={" "}
                    <span className="font-medium">{usd(m.commissionUsd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}