import { useEffect, useMemo, useState } from "react";

type Props = {
  /** cents → dollars happens internally */
  valueUsd?: number;
  onChange: (minUsd: number) => void;
  presetsUsd?: number[];
  tenantId?: string;
  className?: string;
};

export default function AmountFilter({
  valueUsd = 0,
  onChange,
  presetsUsd = [0, 500, 2500, 5000],
  tenantId = "default",
  className = "",
}: Props) {
  const key = useMemo(() => `minUsd:${tenantId}`, [tenantId]);
  const [minUsd, setMinUsd] = useState<number>(() => {
    const saved = window.localStorage.getItem(key);
    return saved ? Number(saved) : valueUsd;
  });

  useEffect(() => {
    onChange(minUsd);
    window.localStorage.setItem(key, String(minUsd));
  }, [minUsd, key, onChange]);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <label className="text-sm font-medium">Min amount</label>
      <div className="flex rounded-xl border px-3 py-2 items-center gap-2">
        <span className="opacity-70">$</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          className="w-24 outline-none"
          value={Number.isFinite(minUsd) ? String(minUsd) : ""}
          onChange={(e) => setMinUsd(Math.max(0, Number(e.target.value || 0)))}
        />
      </div>

      <div className="flex items-center gap-1">
        {presetsUsd.map((p) => (
          <button
            key={p}
            onClick={() => setMinUsd(p)}
            className={`text-xs rounded-full border px-2 py-1 ${
              p === minUsd ? "bg-black text-white" : "hover:bg-gray-100"
            }`}
            title={`Show ≥ $${p.toLocaleString()}`}
          >
            ${p.toLocaleString()}
          </button>
        ))}
      </div>

      {minUsd > 0 && (
        <button
          className="text-xs underline ml-1 opacity-70 hover:opacity-100"
          onClick={() => setMinUsd(0)}
        >
          clear
        </button>
      )}
    </div>
  );
}