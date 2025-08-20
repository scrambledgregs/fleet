// src/components/WeekPlanner.jsx
import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../config";

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function formatHM(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function WeekPlanner() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("day"); // "day" | "week"
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/week-appointments`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      // j can be array; standardize fields we use
      const normalized = (Array.isArray(j) ? j : []).map((row) => ({
        id: row.id,
        day: row.day, // e.g., "Mon"
        dateText: row.dateText, // e.g., "Aug 20"
        time: row.time ?? formatHM(row.startTime || row.startTimeISO),
        startTime: row.startTime || row.startTimeISO,
        jobType: row.jobType || "—",
        address:
          typeof row.address === "string"
            ? row.address
            : row.address?.fullAddress ||
              row.address?.full_address ||
              [
                row.address?.address,
                row.address?.city,
                row.address?.state,
                row.address?.postalCode,
              ]
                .filter(Boolean)
                .join(", "),
        estValue: Number(row.estValue || 0),
        territory: row.territory || "—",
        assignedRepName: row.assignedRepName || null,
        travelMinutesFromPrev:
          typeof row.travelMinutesFromPrev === "number"
            ? row.travelMinutesFromPrev
            : null,
      }));
      setItems(normalized);
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // ---- derived structures
  const byDay = useMemo(() => {
    // Map "Mon" -> [rows...], sorted by start time
    const m = groupBy(items, (row) => row.day || "");
    for (const [k, v] of m) {
      v.sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      m.set(k, v);
    }
    return m;
  }, [items]);

  // pick today's day label if present, else first key
  const todayKey = useMemo(() => {
    const label = new Date().toLocaleDateString(undefined, { weekday: "short" });
    if (byDay.has(label)) return label;
    const first = [...byDay.keys()][0];
    return first || label;
  }, [byDay]);

  // Column order for week view — use natural order found in data, falling back to Mon–Sun
  const weekOrder = useMemo(() => {
    const keys = [...byDay.keys()];
    if (keys.length) return keys;
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }, [byDay]);

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <button
          className={`px-2 py-1 rounded-none glass ${
            mode === "day" ? "bg-panel/70" : "hover:bg-panel/70"
          } text-xs`}
          onClick={() => setMode("day")}
        >
          By Day
        </button>
        <button
          className={`px-2 py-1 rounded-none glass ${
            mode === "week" ? "bg-panel/70" : "hover:bg-panel/70"
          } text-xs`}
          onClick={() => setMode("week")}
        >
          By Week
        </button>
        <button
          className="ml-auto px-2 py-1 rounded-none glass hover:bg-panel/70 text-xs"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-400 mb-2">Error: {error}</div>
      )}

      {loading && !items.length ? (
        <div className="text-sm text-white/60">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-white/60">No jobs scheduled for this week.</div>
      ) : mode === "day" ? (
        <DayView dayKey={todayKey} byDay={byDay} />
      ) : (
        <WeekView weekOrder={weekOrder} byDay={byDay} />
      )}
    </div>
  );
}

function DayCard({ row }) {
  return (
    <div className="glass rounded-none p-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="font-medium">{row.time}</div>
        <div className="text-white/60">{row.dateText}</div>
      </div>
      <div className="text-white/90 mt-1">{row.jobType}</div>
      <div className="text-white/70 text-xs truncate">{row.address || "—"}</div>
      <div className="text-white/60 text-xs mt-1">
        {row.assignedRepName ? `Tech: ${row.assignedRepName}` : "Unassigned"}
        {typeof row.travelMinutesFromPrev === "number" &&
          ` • +${row.travelMinutesFromPrev}m travel`}
      </div>
    </div>
  );
}

function DayView({ dayKey, byDay }) {
  const rows = byDay.get(dayKey) || [];
  return (
    <div>
      <div className="text-xs text-white/60 mb-2">{dayKey}</div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <DayCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function WeekView({ weekOrder, byDay }) {
  return (
    <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-3">
      {weekOrder.map((day) => {
        const rows = byDay.get(day) || [];
        return (
          <div key={day} className="glass rounded-none p-2">
            <div className="text-xs text-white/60 mb-2">{day}</div>
            <div className="grid gap-2">
              {rows.length === 0 ? (
                <div className="text-xs text-white/50">—</div>
              ) : (
                rows.map((row) => <DayCard key={row.id} row={row} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}