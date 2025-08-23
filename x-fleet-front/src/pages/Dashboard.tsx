// src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { withTenant } from '../lib/socket'
import { API_BASE } from "../config";
import {
  Briefcase,
  DollarSign,
  TrendingUp,
  Headphones,
  Zap,
  ClipboardList,
  Ban,
  RefreshCwOff,
  RefreshCw,
  CalendarClock,
  Calculator,
  Settings as Cog,
  X,
  ExternalLink,
} from "lucide-react";

/* ---------------- Types ---------------- */
type EventRow = {
  id: string;
  type: string;
  at: string;   // ISO
  payload?: any;
  meta?: any;
};

type WeekItem = {
  id: string;
  startTime: string;    // ISO
  startTimeISO?: string;
  address?: string;
  jobType?: string;
  estValue?: number;
  territory?: string | null;
  contact?: { id?: string | null; name?: string | null; tags?: string[] };
  travelMinutesFromPrev?: number | null;
  assignedRepName?: string | null;
};

type RangeMode = "rolling" | "custom";

/* ---------------- Utils ---------------- */
const MARGIN_KEY = "ns-margin-pct";
const PREFS_KEY  = "ns-dash-prefs";

const clamp01 = (n: number) => Math.min(0.99, Math.max(0, n));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const money0 = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtMoney(n: number | null | undefined) { return money0(Number(n || 0)); }
function shortTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function cx(...a: Array<string | false | null | undefined>) { return a.filter(Boolean).join(" "); }
function daysBetween(a: Date, b: Date) {
  const ms = endOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

/* ---------------- Page ---------------- */
export default function Dashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [week, setWeek] = useState<WeekItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ---- Range (rolling or custom) ----
  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling");
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(7);
  const [customStart, setCustomStart] = useState<string>(""); // YYYY-MM-DD
  const [customEnd, setCustomEnd] = useState<string>("");     // YYYY-MM-DD

  // ---- Visible panels (persisted) ----
  const [showSales, setShowSales] = useState(true);
  const [showLeads, setShowLeads] = useState(true);
  const [showBusiest, setShowBusiest] = useState(true);
  const [showSchedule, setShowSchedule] = useState(true);
  const [showCustomizer, setShowCustomizer] = useState(false);

  // ---- Editable margin (persisted) ----
  const [marginPct, setMarginPct] = useState<number>(() => {
    const saved = localStorage.getItem(MARGIN_KEY);
    if (saved != null && !Number.isNaN(Number(saved))) return clamp01(parseFloat(saved));
    const env = Number((import.meta as any).env?.VITE_MARGIN_PCT || 0.45);
    return clamp01(env);
  });
  useEffect(() => localStorage.setItem(MARGIN_KEY, String(marginPct)), [marginPct]);

  // ---- Load persisted prefs on mount ----
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (j.rangeMode) setRangeMode(j.rangeMode);
      if (j.rangeDays) setRangeDays(j.rangeDays);
      if (j.customStart) setCustomStart(j.customStart);
      if (j.customEnd) setCustomEnd(j.customEnd);
      if (typeof j.showSales === "boolean") setShowSales(j.showSales);
      if (typeof j.showLeads === "boolean") setShowLeads(j.showLeads);
      if (typeof j.showBusiest === "boolean") setShowBusiest(j.showBusiest);
      if (typeof j.showSchedule === "boolean") setShowSchedule(j.showSchedule);
    } catch {}
  }, []);
  useEffect(() => {
    const prefs = { rangeMode, rangeDays, customStart, customEnd, showSales, showLeads, showBusiest, showSchedule };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [rangeMode, rangeDays, customStart, customEnd, showSales, showLeads, showBusiest, showSchedule]);

  // ---- Data fetch (StrictMode-safe single poller) ----
  const pollRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = async () => {
    try {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const opt = withTenant({ signal: controller.signal });

      const [eRes, wRes] = await Promise.all([
        fetch(`${API_BASE}/api/events?limit=1000`, opt).then(r => r.json()).catch(() => ({ ok:false })),
        fetch(`${API_BASE}/api/week-appointments`, opt).then(r => r.json()).catch(() => []),
      ]);

      if (eRes?.ok && Array.isArray(eRes.events)) setEvents(eRes.events);
      if (Array.isArray(wRes)) setWeek(wRes);
    } catch (e) {
      // ignore aborts
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pollRef.current !== null) return; // guard duplicate intervals (StrictMode/dev)

    setLoading(true);
    load();

    pollRef.current = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
    }, 30000);

    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      controllerRef.current?.abort();
    };
  }, []);

  async function manualRefresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  // ---- Range helpers ----
  const rangeInfo = useMemo(() => {
    if (rangeMode === "rolling") {
      return {
        label: `Last ${rangeDays} days`,
        lengthDays: rangeDays as number,
        endTs: Date.now(),
      };
    }
    const start = customStart ? startOfDay(new Date(customStart)) : null;
    const end   = customEnd   ? endOfDay(new Date(customEnd))     : null;
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      // Fallback
      return { label: `Last ${rangeDays} days`, lengthDays: rangeDays as number, endTs: Date.now() };
    }
    return {
      label: `${start.toLocaleDateString()} → ${end.toLocaleDateString()}`,
      lengthDays: daysBetween(start, end),
      endTs: end.getTime(),
    };
  }, [rangeMode, rangeDays, customStart, customEnd]);

  const inWindow = (iso: string, lenDays: number, offsetDays = 0, endAnchor = Date.now()) => {
    const end = endAnchor - offsetDays * 86400000;
    const start = end - lenDays * 86400000;
    const t = new Date(iso).getTime();
    return t > start && t <= end;
  };
  const inSelected = (iso: string, offsetPeriods = 0) =>
    inWindow(iso, rangeInfo.lengthDays, offsetPeriods * rangeInfo.lengthDays, rangeInfo.endTs);

  // ---------- Derived ----------
  const now = new Date();

  const apptEvents = useMemo(
    () => events.filter(e => e.type === "appointment.created"),
    [events]
  );

  // Today
  const todaysJobs = useMemo(
    () => week.filter(w => {
      const d = new Date(w.startTime || w.startTimeISO || Date.now());
      return startOfDay(d).getTime() === startOfDay(now).getTime();
    }),
    [week, now]
  );
  const todaysRevenue = useMemo(
    () => todaysJobs.reduce((sum, j) => sum + (Number(j.estValue) || 0), 0),
    [todaysJobs]
  );
  const demosToday = useMemo(
    () => todaysJobs.filter(j => /demo/i.test(j.jobType || "")).length,
    [todaysJobs]
  );

  // Range slices
  const apptRange     = useMemo(() => apptEvents.filter(e => inSelected(e.at, 0)), [apptEvents, rangeInfo]);
  const apptPrevRange = useMemo(() => apptEvents.filter(e => inSelected(e.at, 1)), [apptEvents, rangeInfo]);

  // Revenue series for range
  const revenueSeries = useMemo(() => {
    const map = new Map<string, number>();
    const days = rangeInfo.lengthDays;
    const end = rangeInfo.endTs;
    for (let i = 0; i < days; i++) {
      const d = startOfDay(new Date(end - (days - 1 - i) * 86400000));
      map.set(d.toISOString().slice(0,10), 0);
    }
    for (const e of apptRange) {
      const key = startOfDay(new Date(e.at)).toISOString().slice(0,10);
      if (map.has(key)) map.set(key, (map.get(key) || 0) + Number(e.payload?.estValue || 0));
    }
    return Array.from(map.entries()).map(([date, value]) => ({ date, value }));
  }, [apptRange, rangeInfo]);

  const revenuePrevTotal = useMemo(
    () => apptPrevRange.reduce((s, e) => s + Number(e.payload?.estValue || 0), 0),
    [apptPrevRange]
  );
  const revenueTotal = useMemo(
    () => revenueSeries.reduce((s, r) => s + r.value, 0),
    [revenueSeries]
  );

  const jobsTotal = useMemo(() => apptRange.length || 0, [apptRange.length]);
  const jobsPrevTotal = useMemo(() => apptPrevRange.length || 0, [apptPrevRange.length]);
  const avgRevPerJob = useMemo(() => (jobsTotal ? Math.round(revenueTotal / jobsTotal) : 0), [revenueTotal, jobsTotal]);

  // Other counters in range
  const countRange = (pred: (e: EventRow) => boolean) => events.filter(e => inSelected(e.at, 0) && pred(e)).length;
  const automationsN = useMemo(() => countRange(e => e.type?.startsWith("automation.")), [events, rangeInfo]);
  const estimatesN   = useMemo(() => countRange(e => e.type?.startsWith("estimate.")),   [events, rangeInfo]);
  const invoicesN    = useMemo(() => countRange(e => e.type?.startsWith("invoice.")),    [events, rangeInfo]);

  const cancelsN = useMemo(
    () => countRange(e => e.type === "contact.disposition.created" && /cancel/i.test(String(e.payload?.label || e.payload?.key || ""))),
    [events, rangeInfo]
  );
  const reschedulesN = useMemo(
    () => countRange(e => e.type === "contact.disposition.created" && /resched/i.test(String(e.payload?.label || e.payload?.key || ""))),
    [events, rangeInfo]
  );

  // Recorded calls (24h)
  const recordings24 = useMemo(
    () => events.filter(e => e.type === "call.recording.completed" && inWindow(e.at, 1)),
    [events]
  );
  const avgRecordingSec = useMemo(() => {
    const durs = recordings24.map(r => Number(r.payload?.durationSec) || 0).filter(n => n > 0);
    return durs.length ? Math.round(durs.reduce((a,b)=>a+b,0)/durs.length) : 0;
  }, [recordings24]);

  // Sales team / leads (this week)
  const salesByRep = useMemo(() => {
    const map = new Map<string, { jobs: number; revenue: number }>();
    for (const j of week) {
      const name = j.assignedRepName || "Unassigned";
      const row = map.get(name) || { jobs: 0, revenue: 0 };
      row.jobs += 1;
      row.revenue += Number(j.estValue || 0);
      map.set(name, row);
    }
    return Array.from(map.entries())
      .map(([rep, v]) => ({ rep, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [week]);

  const leadSources = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    const norm = (t: string) => t.trim().toLowerCase();
    for (const j of week) {
      const tags = Array.isArray(j.contact?.tags) ? (j.contact!.tags as string[]) : [];
      const src =
        tags.find(t => /google|ppc|ads|lsa|facebook|bing|yelp|referr|website|homeadvisor|angi/i.test(t)) ||
        "Unknown";
      const key = norm(String(src));
      const row = map.get(key) || { count: 0, revenue: 0 };
      row.count += 1;
      row.revenue += Number(j.estValue || 0);
      map.set(key, row);
    }
    const pretty = (k: string) => (k === "unknown" ? "Unknown" : k.replace(/\b\w/g, s => s.toUpperCase()));
    return Array.from(map.entries())
      .map(([k, v]) => ({ source: pretty(k), ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [week]);

  // Profit estimate (uses editable margin)
  const estProfitToday = Math.round(todaysRevenue * marginPct);

  // Deltas vs prev period
  const delta = (cur: number, prev: number) => {
    if (prev <= 0) return cur > 0 ? +100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  };
  const revenueDeltaPct = delta(revenueTotal, revenuePrevTotal);
  const jobsDeltaPct = delta(jobsTotal, jobsPrevTotal);

  /* ---------- Drill (click-to-drill) ---------- */
  type Drill = { title: string; rows: EventRow[] } | null;
  const [drill, setDrill] = useState<Drill>(null);

  const openDrill = (kind: string) => {
    let rows: EventRow[] = [];
    switch (kind) {
      case "revenue":
      case "jobs":
        rows = events.filter(e => inSelected(e.at, 0) && e.type === "appointment.created")
                     .sort((a,b)=>+new Date(b.at)-+new Date(a.at));
        break;
      case "automations":
        rows = events.filter(e => inSelected(e.at, 0) && e.type?.startsWith("automation."));
        break;
      case "estimates":
        rows = events.filter(e => inSelected(e.at, 0) && e.type?.startsWith("estimate."));
        break;
      case "invoices":
        rows = events.filter(e => inSelected(e.at, 0) && e.type?.startsWith("invoice."));
        break;
      case "cancellations":
        rows = events.filter(e => inSelected(e.at, 0) &&
          e.type === "contact.disposition.created" &&
          /cancel/i.test(String(e.payload?.label || e.payload?.key || "")));
        break;
      case "reschedules":
        rows = events.filter(e => inSelected(e.at, 0) &&
          e.type === "contact.disposition.created" &&
          /resched/i.test(String(e.payload?.label || e.payload?.key || "")));
        break;
      case "recordings":
        rows = events.filter(e => e.type === "call.recording.completed" && inWindow(e.at, 1));
        break;
      default:
        rows = [];
    }
    setDrill({ title: labelForKind(kind), rows });
  };

  /* ---------- UI ---------- */
  return (
    <div className="grid grid-cols-12 gap-4 p-3 sm:p-4">
      {/* Header */}
      <div className="col-span-12 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 text-sm text-white/85">
          <CalendarClock size={16} className="text-white/70" />
          Today • {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Margin */}
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#0b0f14] px-2.5 py-1.5">
            <span className="text-xs text-white/70">Margin</span>
            <input
              type="range" min={0} max={0.9} step={0.01}
              value={marginPct}
              onChange={(e) => setMarginPct(clamp01(parseFloat(e.target.value)))}
              className="h-1 w-24 sm:w-28 accent-[var(--brand-orange)]"
              aria-label="Margin percent"
            />
            <input
              type="number" min={0} max={90} step={1}
              value={Math.round(marginPct * 100)}
              onChange={(e) => setMarginPct(clamp01(Number(e.target.value) / 100))}
              className="w-14 h-7 rounded bg-white/5 border border-white/15 px-2 text-xs text-white"
              aria-label="Margin percent number"
            />
            <span className="text-xs text-white/70">%</span>
          </div>

          {/* Range picker */}
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#0b0f14] px-2 py-1.5">
            <select
              value={rangeMode === "rolling" ? String(rangeDays) : "custom"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") setRangeMode("custom");
                else { setRangeMode("rolling"); setRangeDays(Number(v) as 7|30|90); }
              }}
              className="h-7 rounded-lg bg-white/5 px-2 text-xs text-white/90 border border-white/10"
              title="Time window"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom…</option>
            </select>

            {rangeMode === "custom" && (
              <div className="flex items-center gap-1">
                <input
                  type="date" value={customStart}
                  onChange={(e)=>setCustomStart(e.target.value)}
                  className="h-7 rounded bg-white/5 border border-white/10 px-2 text-xs text-white/90"
                  aria-label="Start date"
                />
                <span className="text-white/50 text-xs">→</span>
                <input
                  type="date" value={customEnd}
                  onChange={(e)=>setCustomEnd(e.target.value)}
                  className="h-7 rounded bg-white/5 border border-white/10 px-2 text-xs text-white/90"
                  aria-label="End date"
                />
              </div>
            )}

            <span className="hidden sm:inline text-[11px] text-white/60">{rangeInfo.label}</span>
          </div>

          {/* Customize */}
          <button
            onClick={() => setShowCustomizer(s => !s)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 h-8 text-xs bg-[#0b0f14] hover:bg-white/5 text-white/90"
            title="Customize panels"
          >
            <Cog className="h-3.5 w-3.5" />
            Customize
          </button>

          {/* Refresh */}
          <button
            onClick={manualRefresh}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl border border-white/15",
              "px-3 h-8 text-xs bg-[#0b0f14] hover:bg-white/5 text-white/90"
            )}
            title="Refresh"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Customizer popover */}
      {showCustomizer && (
        <div className="col-span-12">
          <div className="rounded-xl border border-white/15 bg-[#0b0f14] p-3 sm:p-4 flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold text-white/90 mr-2">Visible panels</span>
            <Toggle label="Sales Team" checked={showSales} onChange={setShowSales} />
            <Toggle label="Lead Sources" checked={showLeads} onChange={setShowLeads} />
            <Toggle label="Busiest Days" checked={showBusiest} onChange={setShowBusiest} />
            <Toggle label="Today’s Schedule" checked={showSchedule} onChange={setShowSchedule} />
            <div className="ml-auto text-[11px] text-white/60">{rangeInfo.label}</div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <KPI label="Jobs Today" value={todaysJobs.length} sub={demosToday ? `${demosToday} demos` : undefined} icon={<Briefcase size={18} />} />
        <KPI label="Potential Revenue Today" value={fmtMoney(todaysRevenue)} icon={<DollarSign size={18} />} />
        <KPI label="Est. Profit Today" value={fmtMoney(estProfitToday)} sub={`${Math.round(marginPct*100)}% margin`} icon={<TrendingUp size={18} />} />
        <KPI label={`Avg Revenue / Job (${rangeInfo.lengthDays}d)`} value={fmtMoney(avgRevPerJob)} onClick={()=>openDrill("jobs")} />
        <KPI label="Recorded Calls (24h)" value={recordings24.length} sub={avgRecordingSec ? `Avg ${avgRecordingSec}s` : undefined} icon={<Headphones size={18} />} onClick={()=>openDrill("recordings")} />
        <KPI label={`Automations (${rangeInfo.lengthDays}d)`} value={automationsN || "—"} icon={<Zap size={18} />} onClick={()=>openDrill("automations")} />
        <KPI label={`Estimates (${rangeInfo.lengthDays}d)`} value={estimatesN || "—"} icon={<ClipboardList size={18} />} onClick={()=>openDrill("estimates")} />
        <KPI label={`Invoices (${rangeInfo.lengthDays}d)`} value={invoicesN || "—"} onClick={()=>openDrill("invoices")} />
        <KPI label={`Cancellations (${rangeInfo.lengthDays}d)`} value={cancelsN || "—"} icon={<Ban size={18} />} onClick={()=>openDrill("cancellations")} />
        <KPI label={`Reschedules (${rangeInfo.lengthDays}d)`} value={reschedulesN || "—"} icon={<RefreshCwOff size={18} />} onClick={()=>openDrill("reschedules")} />
        <KPI label={`Revenue (${rangeInfo.lengthDays}d)`} value={fmtMoney(revenueTotal)} deltaPct={revenueDeltaPct} onClick={()=>openDrill("revenue")} />
        <KPI label={`Jobs (${rangeInfo.lengthDays}d)`} value={jobsTotal} deltaPct={jobsDeltaPct} onClick={()=>openDrill("jobs")} />
      </div>

      {/* Revenue Trend + Busiest Days + Schedule */}
      <div className="col-span-12 lg:col-span-7 space-y-4">
        <Panel title={`Revenue (${rangeInfo.label})`}>
          <SparkBars
            data={revenueSeries.map(r => r.value)}
            labels={revenueSeries.map(r => r.date.slice(5))}
            format={fmtMoney}
            brand
          />
        </Panel>

        {showBusiest && (
          <Panel title="Busiest Days (last 60 days)">
            <BusiestDays events={apptEvents} />
          </Panel>
        )}

        {showSchedule && (
          <Panel title="Today’s Schedule">
            <div className="max-h-[44vh] overflow-auto divide-y divide-white/8">
              {todaysJobs.length === 0 && <EmptyRow text="No jobs scheduled today." />}
              {todaysJobs.map((j) => (
                <div key={j.id} className="px-3 sm:px-4 py-3 flex items-start gap-3">
                  <div className="w-16 shrink-0 font-mono text-sm text-white/90">{shortTime(j.startTime)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="font-medium text-white">{j.contact?.name || "—"}</div>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-white/90">
                        {j.jobType || "Job"}
                      </span>
                      {j.assignedRepName && (
                        <span className="text-xs text-white/70">• {j.assignedRepName}</span>
                      )}
                    </div>
                    {j.address && <div className="text-xs text-white/65 mt-0.5 truncate">{j.address}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-white">{fmtMoney(j.estValue || 0)}</div>
                    {Number.isFinite(j.travelMinutesFromPrev as number) && (j.travelMinutesFromPrev ?? 0) > 0 && (
                      <div className="text-[11px] text-white/60">+{j.travelMinutesFromPrev}m travel</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* Sales, Leads, Margin Helper */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        {showSales && (
          <Panel title="Sales Team (this week)">
            <table className="w-full text-sm">
              <thead className="text-left text-white/70 text-[11px] border-b border-white/12">
                <tr>
                  <th className="py-2 pr-2">Rep</th>
                  <th className="py-2 pr-2">Jobs</th>
                  <th className="py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {salesByRep.length === 0 && <tr><td className="py-3 text-white/65" colSpan={3}>No assignments yet.</td></tr>}
                {salesByRep.map((r) => (
                  <tr key={r.rep} className="border-b border-white/8 last:border-0">
                    <td className="py-2 pr-2 text-white">{r.rep}</td>
                    <td className="py-2 pr-2 text-white/90">{r.jobs}</td>
                    <td className="py-2 text-white">{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {showLeads && (
          <Panel title="Lead Sources (this week)">
            <table className="w-full text-sm">
              <thead className="text-left text-white/70 text-[11px] border-b border-white/12">
                <tr>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2 pr-2">Leads</th>
                  <th className="py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {leadSources.length === 0 && <tr><td className="py-3 text-white/65" colSpan={3}>No sources tagged yet.</td></tr>}
                {leadSources.map((s) => (
                  <tr key={s.source} className="border-b border-white/8 last:border-0">
                    <td className="py-2 pr-2 text-white">{s.source}</td>
                    <td className="py-2 pr-2 text-white/90">{s.count}</td>
                    <td className="py-2 text-white">{fmtMoney(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        <Panel title="Margin Helper">
          <MarginHelper marginPct={marginPct} onSetMargin={(p) => setMarginPct(clamp01(p))} />
        </Panel>
      </div>

      {/* Drill modal */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-2" onClick={()=>setDrill(null)}>
          <div
            className="w-full sm:max-w-2xl rounded-2xl border border-white/15 bg-[#0b0f14] shadow-2xl overflow-hidden"
            onClick={(e)=>e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/12">
              <div className="text-sm font-semibold text-white">{drill.title}</div>
              <button className="p-1.5 rounded hover:bg-white/10" onClick={()=>setDrill(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto">
              {drill.rows.length === 0 && <EmptyRow text="No matching items in this period." />}
              {drill.rows.map((e) => (
                <div key={e.id} className="px-4 py-3 border-b border-white/8 last:border-0">
                  <div className="text-sm text-white">
                    <span className="font-medium">{labelForEvent(e.type)}</span>
                    {renderEventInline(e)}
                  </div>
                  <div className="text=[11px] text-white/60 mt-0.5">{new Date(e.at).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-white/12 flex items-center justify-between">
              <div className="text-[11px] text-white/60">{rangeInfo.label}</div>
              <Link
                to="/events"
                className="inline-flex items-center gap-1 text-xs rounded-lg border border-white/15 px-3 h-8 bg-white/5 hover:bg-white/10"
              >
                Open in Activity <ExternalLink size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Components ---------------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-[#0b0f14] shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-white/12">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-[var(--brand-orange)] to-[var(--brand-orange2)]" />
          <div className="text-sm font-semibold text-white">{title}</div>
        </div>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </div>
  );
}

function KPI({
  label, value, sub, icon, deltaPct, onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
  deltaPct?: number;
  onClick?: () => void;
}) {
  const Brand = "from-[var(--brand-orange)] to-[var(--brand-orange2)]";
  const Delta = typeof deltaPct === "number" ? (
    <span
      className={cx(
        "ml-2 inline-flex items-center rounded px-1.5 h-5 text-[10px] font-medium",
        deltaPct > 0 && "bg-emerald-500/15 text-emerald-300",
        deltaPct < 0 && "bg-red-500/15 text-red-300",
        deltaPct === 0 && "bg-white/10 text-white/70"
      )}
      title="vs previous period"
    >
      {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "•"} {Math.abs(deltaPct)}%
    </span>
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group relative overflow-hidden rounded-xl border border-white/15 bg-[#0b0f14] p-3 sm:p-3.5 shadow-lg text-left",
        onClick && "hover:bg-white/5"
      )}
    >
      <div className="absolute inset-x-0 -top-0.5 h-0.5 bg-gradient-to-r from-white/10 to-white/0" />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[.12em] text-white/70">{label}</div>
          <div className="mt-1 text-[22px] font-semibold leading-none text-white">
            {value}{Delta}
          </div>
          {sub && <div className="mt-1 text-[11px] text-white/65">{sub}</div>}
        </div>
        {icon && <div className="shrink-0 mt-0.5 text-white/75">{icon}</div>}
      </div>
      <div className="pointer-events-none absolute right-2 bottom-2 h-2 w-8 rounded bg-gradient-to-r opacity-40 group-hover:opacity-70 transition from-white/10 to-white/0" />
      <div className={`pointer-events-none absolute left-0 bottom-0 h-0.5 w-full bg-gradient-to-r ${Brand} opacity-0 group-hover:opacity-100 transition`} />
    </button>
  );
}

// Tiny inline bar chart (brand gradient + subtle motion)
function SparkBars({
  data, labels, format, brand,
}: { data: number[]; labels?: string[]; format?: (n:number)=>string; brand?: boolean }) {
  const max = Math.max(1, ...data);
  const barClass = brand
    ? "bg-gradient-to-t from-[var(--brand-orange)] to-[var(--brand-orange2)]"
    : "bg-white";
  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {data.map((v, i) => (
          <div key={i} className="group flex-1">
            <div
              className={cx(
                "w-full rounded-t transition-transform duration-150 origin-bottom",
                barClass,
                "group-hover:scale-y-[1.02]"
              )}
              style={{ height: `${(v / max) * 100}%` }}
              title={format ? format(v) : String(v)}
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="mt-1 overflow-x-auto scrollbar-none">
          <div className="flex gap-1 min-w-full text-[10px] text-white/70">
            {labels.map((l, i) => (
              <div key={i} className="text-center flex-1">{l}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-3 sm:px-4 py-6 text-sm text-white/70">{text}</div>;
}

/* -------- Busiest days (60d) -------- */
function BusiestDays({ events }: { events: EventRow[] }) {
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const counts = new Array(7).fill(0) as number[];
  for (const e of events) {
    if (e.type !== "appointment.created") continue;
    const age = Date.now() - new Date(e.at).getTime();
    if (age > 60 * 86400000) continue;
    counts[new Date(e.at).getDay()]++;
  }
  return <SparkBars data={counts} labels={days} brand />;
}

/* ---------------- Margin Helper ---------------- */
function MarginHelper({
  marginPct, onSetMargin,
}: { marginPct: number; onSetMargin: (p: number) => void }) {
  const [cost, setCost] = useState<number>(0);
  const [price, setPrice] = useState<number>(0);

  const marginActual = price > 0 ? (price - cost) / price : 0;
  const markupActual = cost > 0 ? (price - cost) / cost : 0;
  const recPriceForTarget = cost > 0 ? cost / (1 - marginPct) : 0;

  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <div className="text-[11px] text-white/70 mb-1">Cost (labor + materials)</div>
          <input
            type="number" min={0} step={1} value={cost}
            onChange={(e) => setCost(Math.max(0, Number(e.target.value)))}
            className="w-full h-9 rounded-lg bg-white/5 border border-white/15 px-3 text-sm text-white"
            placeholder="e.g. 250"
          />
        </label>
        <label className="block">
          <div className="text-[11px] text-white/70 mb-1">Current price (what you charge)</div>
          <input
            type="number" min={0} step={1} value={price}
            onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
            className="w-full h-9 rounded-lg bg-white/5 border border-white/15 px-3 text-sm text-white"
            placeholder="e.g. 500"
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Stat label="Actual margin" value={pct(marginActual)} strong />
        <Stat label="Actual markup" value={`${Math.round(markupActual * 100)}%`} />
        <Stat label="Target margin" value={pct(marginPct)} />
      </div>

      <div className="rounded-lg border border-white/12 bg-[#0b0f14] p-3">
        <div className="flex items-center gap-2 text-sm text-white/85 mb-1">
          <Calculator size={16} /> Recommended price for target margin
        </div>
        <div className="text-xl font-semibold text-white">
          {fmtMoney(recPriceForTarget)}
        </div>
        {cost > 0 && (
          <div className="mt-1 text-[11px] text-white/65">
            Formula: <code>price = cost / (1 - margin)</code>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setPrice(Math.round(recPriceForTarget))}
            className="rounded-lg bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange2)] text-white px-3 h-8 text-xs font-semibold shadow hover:opacity-95"
          >
            Use as price
          </button>
          <button
            onClick={() => onSetMargin(marginActual)}
            className="rounded-lg bg-white/10 border border-white/15 text-white px-3 h-8 text-xs hover:bg-white/15"
            title="Set target margin to your current calculated margin"
          >
            Set target to current
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-white/12 bg-[#0b0f14] p-3">
      <div className="text-[11px] text-white/70">{label}</div>
      <div className={cx("mt-0.5", strong ? "text-lg font-semibold text-white" : "text-base text-white/90")}>
        {value}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b:boolean)=>void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e)=>onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span className="text-white/90">{label}</span>
    </label>
  );
}

/* ---------------- helpers ---------------- */
function labelForEvent(t: string) {
  switch (t) {
    case "appointment.created": return "Appointment";
    case "call.recording.completed": return "Call Recording";
    case "contact.disposition.created": return "Disposition";
    default: return t.replace(/\./g, " ");
  }
}

function labelForKind(k: string) {
  const map: Record<string,string> = {
    revenue: "Appointments in range",
    jobs: "Appointments in range",
    automations: "Automations in range",
    estimates: "Estimates in range",
    invoices: "Invoices in range",
    cancellations: "Cancellations in range",
    reschedules: "Reschedules in range",
    recordings: "Recorded calls (24h)",
  };
  return map[k] || "Details";
}

function renderEventInline(e: EventRow) {
  if (e.type === "appointment.created") {
    const p = e.payload || {};
    const time = new Date(p.startTime || e.at).toLocaleString();
    const v = Number(p.estValue || 0);
    return (
      <span className="text-white/80">
        {" "}booked for <span className="font-mono">{time}</span>
        {v ? ` • ${fmtMoney(v)}` : ""}{p.address ? ` • ${String(p.address).slice(0, 60)}` : ""}
      </span>
    );
  }
  if (e.type === "call.recording.completed") {
    const d = e.payload?.durationSec ? ` • ${Math.round(e.payload.durationSec)}s` : "";
    return <span className="text-white/80"> completed{d}</span>;
  }
  if (e.type === "contact.disposition.created") {
    const p = e.payload || {};
    return (
      <span className="text-white/80">
        {" "}— <span className="font-medium">{p.label || p.key}</span>
        {p.note ? ` • ${String(p.note).slice(0, 60)}` : ""}
      </span>
    );
  }
  return null;
}