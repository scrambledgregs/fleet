// src/components/sales/SalesNav.tsx
import { NavLink } from 'react-router-dom';

export default function SalesNav() {
  const Link = (to: string, label: string) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "px-3 py-2 rounded-xl border text-sm",
          isActive ? "bg-white/10 border-white/20 text-white"
                   : "border-white/10 text-white/70 hover:bg-white/5",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
  return (
    <div className="flex gap-2 mb-4">
      {Link("/sales/cash", "Cash Log")}
      {Link("/sales/unassigned", "Unassigned")}
      {Link("/sales/reps", "By Rep")}
    </div>
  );
}