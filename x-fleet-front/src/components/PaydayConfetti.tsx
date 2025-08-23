// src/components/PaydayConfetti.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { getTenantId, withTenant, makeSocket } from '../lib/socket';

type WeekAppt = {
  startTime?: string;
  startTimeISO?: string;
  estValue?: number;
};

function apiBase(): string {
  const env =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE) || '';
  if (env) return String(env).replace(/\/$/, '');
  return (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');
}

function isSameLocalDay(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function PaydayConfetti() {
  const tenantId = useMemo(() => (getTenantId() || 'default').toLowerCase(), []);
  const [goal, setGoal] = useState<number | null>(null);
  const [todayTotal, setTodayTotal] = useState<number>(0);
  const firedRef = useRef(false);

  async function refresh() {
    const base = apiBase();

    // 1) fetch per-tenant threshold
    const s = await fetch(`${base}/api/client-settings?clientId=${tenantId}`, withTenant());
    const sj = await s.json().catch(() => ({}));
    const threshold = Number(sj?.settings?.paydayThreshold ?? 2500);
    setGoal(threshold);

    // 2) sum today's booked value
    const r = await fetch(`${base}/api/week-appointments?clientId=${tenantId}`, withTenant());
    const items = (await r.json().catch(() => [])) as WeekAppt[];
    const sum = items
      .filter((it) => isSameLocalDay(it.startTimeISO || it.startTime))
      .reduce((acc, it) => acc + (Number(it.estValue) || 0), 0);

    setTodayTotal(sum);

    if (!firedRef.current && sum >= threshold) {
      firedRef.current = true;
      burst();
    }
  }

  function burst() {
    const end = Date.now() + 1200;
    (function frame() {
      confetti({ particleCount: 3, startVelocity: 35, spread: 55, origin: { x: 0.2, y: 0.7 } });
      confetti({ particleCount: 3, startVelocity: 35, spread: 55, origin: { x: 0.8, y: 0.7 } });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
    setTimeout(() => confetti({ particleCount: 80, spread: 70, origin: { y: 0.5 } }), 250);
  }

  useEffect(() => {
    refresh();

    const socket = makeSocket(tenantId);
    const bump = () => refresh();

    socket.on('ai:booking', bump);
    socket.on('job:created', bump);
    socket.on('job:updated', bump);

    return () => {
      socket.off('ai:booking', bump);
      socket.off('job:created', bump);
      socket.off('job:updated', bump);
      // we don't close here since makeSocket is a shared connection
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (goal == null) return null;

  const pct = Math.min(100, Math.round((todayTotal / goal) * 100));

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="glass-strong rounded-xl shadow-lg px-3 py-2 min-w-56">
        <div className="text-xs opacity-70 mb-1">Today’s booked value</div>
        <div className="flex items-baseline gap-2">
          <div className="text-lg font-semibold">${todayTotal.toLocaleString()}</div>
          <div className="text-xs opacity-70">/ ${goal.toLocaleString()}</div>
        </div>
        <div className="mt-2 h-2 w-full rounded bg-black/10 overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${pct}%`, transition: 'width 400ms ease' }}
          />
        </div>
      </div>
    </div>
  );
}