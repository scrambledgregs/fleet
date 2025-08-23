import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  UserPlus,
  Calendar as CalendarIcon,
  MessageSquare,
  FileText,
  Settings,
} from "lucide-react";

/** Extend window events so TS is happy */
declare global {
  interface WindowEventMap {
    "commandpalette:open": CustomEvent<{ query?: string }>;
    "ui:toggle-compact": CustomEvent<void>;
  }
}

type Command = {
  id: string;
  title: string;
  subtitle?: string;
  group?: "Create" | "Navigate" | "Settings" | "Suggested" | "Recent" | string;
  keywords?: string[];
  icon?: React.ReactNode;
  run: () => void;
  shortcut?: string;
};

interface CommandBarProps {
  /** Optionally inject more commands */
  extraCommands?: Command[];
}

/** simple recents persistence */
const RECENTS_KEY = "ns_command_recents";
function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function saveRecents(ids: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {}
}

const HINTS = [
  `“new booking”`,
  `“contact”`,
  `“calendar”`,
  `“messages”`,
  `“toggle density”`,
];

const CommandBar: React.FC<CommandBarProps> = ({ extraCommands = [] }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // ---------- Base command set ----------
  const base: Command[] = useMemo(
    () => [
      // Create
      {
        id: "new-booking",
        group: "Create",
        title: "New Booking",
        subtitle: "Book a job / appointment",
        icon: <Plus size={16} />,
        keywords: ["job", "appointment", "request", "book"],
        run: () => navigate("/requestappointment"),
        shortcut: "B",
      },
      {
        id: "new-contact",
        group: "Create",
        title: "New Contact",
        subtitle: "Add a person or company",
        icon: <UserPlus size={16} />,
        keywords: ["lead", "customer", "person", "company"],
        run: () => navigate("/contacts?new=1"),
        shortcut: "C",
      },

      // Navigate
      {
        id: "goto-contacts",
        group: "Navigate",
        title: "Go to Contacts",
        icon: <UserPlus size={16} />,
        keywords: ["people", "leads", "customers"],
        run: () => navigate("/contacts"),
      },
      {
        id: "goto-bookings",
        group: "Navigate",
        title: "Go to Bookings",
        icon: <FileText size={16} />,
        keywords: ["dashboard", "dispatch", "jobs"],
        run: () => navigate("/"),
      },
      {
        id: "goto-calendar",
        group: "Navigate",
        title: "Go to Calendar",
        icon: <CalendarIcon size={16} />,
        keywords: ["schedule", "week", "day"],
        run: () => navigate("/calendar"),
      },
      {
        id: "goto-messages",
        group: "Navigate",
        title: "Go to Messages",
        icon: <MessageSquare size={16} />,
        keywords: ["sms", "email", "chatter", "inbox"],
        run: () => navigate("/chatter"),
      },

      // Settings / UI
      {
        id: "toggle-density",
        group: "Settings",
        title: "Toggle Compact Density",
        subtitle: "Switch between cozy and dense layout",
        icon: <Settings size={16} />,
        keywords: ["compact", "density", "spacing"],
        run: () => window.dispatchEvent(new CustomEvent("ui:toggle-compact")),
        shortcut: "D",
      },
    ],
    [navigate]
  );

  const allCommands = useMemo(
    () => [...base, ...extraCommands],
    [base, extraCommands]
  );

  // ---------- Open / close state ----------
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rotate placeholder hints
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setHintIdx((i) => (i + 1) % HINTS.length), 5000);
    return () => clearInterval(t);
  }, [open]);

  // Keyboard + custom open event
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (open && k === "escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent<{ query?: string }>;
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      if (ce.detail?.query != null) {
        setQ(ce.detail.query);
      } else {
        setQ("");
      }
      setSel(0);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("commandpalette:open", onOpen as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("commandpalette:open", onOpen as EventListener);
    };
  }, [open]);

  // Focus the input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // ---------- Filter + ranking ----------
  // Simple fuzzy scoring
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return allCommands;
    const score = (cmd: Command) => {
      const hay = [cmd.title, cmd.subtitle ?? "", ...(cmd.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      if (hay.includes(qq)) return 2;
      const words = qq.split(/\s+/g);
      const matches = words.filter((w) => w && hay.includes(w)).length;
      return matches > 0 ? 1 : 0;
    };
    return allCommands
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q, allCommands]);

  // ---------- Suggested + Recent sections (only when empty query) ----------
  const recents = useMemo(loadRecents, [open]); // reload each open
  const recentCommands = useMemo(
    () =>
      recents
        .map((id) => allCommands.find((c) => c.id === id))
        .filter(Boolean) as Command[],
    [recents, allCommands]
  );

  const suggestedCommands = useMemo(() => {
    if (q.trim()) return [] as Command[];
    // simple route-aware suggestions
    if (pathname.startsWith("/contacts"))
      return [
        allCommands.find((c) => c.id === "new-contact"),
        allCommands.find((c) => c.id === "goto-contacts"),
      ].filter(Boolean) as Command[];
    if (pathname.startsWith("/calendar"))
      return [
        allCommands.find((c) => c.id === "new-booking"),
        allCommands.find((c) => c.id === "goto-calendar"),
      ].filter(Boolean) as Command[];
    if (pathname.startsWith("/chatter"))
      return [
        allCommands.find((c) => c.id === "goto-messages"),
        allCommands.find((c) => c.id === "new-contact"),
      ].filter(Boolean) as Command[];
    // default (dashboard/bookings)
    return [
      allCommands.find((c) => c.id === "new-booking"),
      allCommands.find((c) => c.id === "goto-bookings"),
    ].filter(Boolean) as Command[];
  }, [q, pathname, allCommands]);

  // Items we will render (respect query)
  const items = q.trim() ? filtered : allCommands;

  // fast lookup of item index for aria + highlight
  const indexMap = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [items]);

  // Group by section (plus Optional "Suggested" & "Recent")
  const grouped = useMemo(() => {
    const sections: Array<[string, Command[]]> = [];
    if (!q.trim() && suggestedCommands.length > 0) {
      sections.push(["Suggested", suggestedCommands.map((c) => ({ ...c, group: "Suggested" }))]);
    }
    if (!q.trim() && recentCommands.length > 0) {
      sections.push(["Recent", recentCommands.map((c) => ({ ...c, group: "Recent" }))]);
    }

    const map = new Map<string, Command[]>();
    for (const c of items) {
      const g = c.group ?? "Other";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    for (const [g, list] of map.entries()) {
      sections.push([g, list]);
    }
    return sections;
  }, [items, q, suggestedCommands, recentCommands]);

  // ---------- Keyboard navigation ----------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "arrowdown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (k === "arrowup") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (k === "enter") {
        e.preventDefault();
        const cmd = items[sel];
        if (cmd) {
          // bump recents
          const next = [cmd.id, ...loadRecents().filter((x) => x !== cmd.id)];
          saveRecents(next);
          setOpen(false);
          cmd.run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, sel]);

  if (!open) return null;

  const activeId = `cmdopt-${sel}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="mx-auto mt-24 w-[min(720px,92vw)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Shell */}
        <div className="glass rounded-2xl overflow-hidden shadow-xl/30">
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <Search size={16} className="text-white/70" aria-hidden />
            <input
              ref={inputRef}
              placeholder={`Type a command…  (Try: ${HINTS[hintIdx]})`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-transparent outline-none text-sm placeholder-white/50"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-expanded
              role="combobox"
            />
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-white/60">
              <kbd className="px-1 py-[1px] rounded bg-white/10">⌘</kbd>
              <span>K</span>
            </span>
          </div>

          {/* Results */}
          <div
            className="max-h-[60vh] overflow-auto"
            role="listbox"
            aria-label="Command results"
          >
            {items.length === 0 ? (
              <div className="px-4 py-6 text-sm text-white/60">
                No matches. Try different keywords.
              </div>
            ) : (
              grouped.map(([group, list]) => (
                <div key={group} className="px-2 py-2">
                  <div className="px-2 text-[11px] uppercase tracking-wide text-white/40 mb-1">
                    {group}
                  </div>
                  {list.map((cmd) => {
                    const index = indexMap.get(cmd.id)!; // exists by construction
                    const active = index === sel;
                    const optionId = `cmdopt-${index}`;
                    return (
                      <button
                        key={cmd.id}
                        id={optionId}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setSel(index)}
                        onClick={() => {
                          const next = [cmd.id, ...loadRecents().filter((x) => x !== cmd.id)];
                          saveRecents(next);
                          setOpen(false);
                          cmd.run();
                        }}
                        className={[
                          "w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left relative",
                          active ? "bg-white/8" : "hover:bg-white/5",
                        ].join(" ")}
                      >
                        {/* Brand rail when active */}
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-gradient-to-b from-[var(--brand-orange)] to-[var(--brand-orange2)]" />
                        )}

                        <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-white/10 text-white/90">
                          {cmd.icon ?? <Search size={14} />}
                        </span>

                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate">{cmd.title}</span>
                          {cmd.subtitle && (
                            <span className="block text-xs text-white/60 truncate">
                              {cmd.subtitle}
                            </span>
                          )}
                        </span>

                        {/* Right-aligned shortcut column */}
                        {cmd.shortcut ? (
                          <span className="ml-auto min-w-[28px] text-right text-[11px] text-white/60">
                            {cmd.shortcut}
                          </span>
                        ) : (
                          <span className="ml-auto min-w-[28px]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hints */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/10 text-[11px] text-white/60">
            <div className="flex items-center gap-3">
              <span>↑↓ to navigate</span>
              <span>Enter to run</span>
              <span>Esc to close</span>
            </div>
            <div>Type: booking · contact · calendar · messages</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CommandBar;