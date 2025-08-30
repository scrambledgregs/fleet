import { useEffect, useState } from "react";
import type { OutstandingRow } from "../../types/sales";
import { getOutstandingByCustomer } from "../../lib/salesApi";

export default function OutstandingByCustomer() {
  const [rows, setRows] = useState<OutstandingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOutstandingByCustomer()
      .then(setRows)
      .catch((e) => setError(e?.message || "Failed to load"));
  }, []);

  return (
    <div className="rounded-2xl border">
      <div className="px-4 py-3 border-b font-medium">Outstanding by customer</div>
      <ul className="p-4 space-y-2 text-sm">
        {error && <li className="text-red-600">{error}</li>}
        {!error &&
          rows.map((r) => (
            <li key={r.name} className="flex justify-between">
              <span>{r.name}</span>
              <span>${r.outstanding_usd.toLocaleString()}</span>
            </li>
          ))}
        {!error && !rows.length && (
          <li className="text-muted-foreground">No open balances</li>
        )}
      </ul>
    </div>
  );
}