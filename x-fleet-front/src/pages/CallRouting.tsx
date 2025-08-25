// x-fleet-front/src/pages/CallRouting.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Save, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { withTenant, getTenantId } from "../lib/socket";
import { API_BASE } from "../config";

const API_HTTP_BASE = `${API_BASE}`.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

// ---- Types (minimal but expressive) ----
type IVRMode = "ai" | "ivr";

type IVRNodeType = "menu" | "transfer" | "voicemail" | "ai";

type MenuOption = { digit: string; next: string };

type IVRNode = {
  id: string;
  type: IVRNodeType;
  prompt?: string;              // TTS text or SSML
  options?: MenuOption[];       // for type: "menu"
  transferTo?: string;          // for type: "transfer" (E.164 or SIP)
  // future: recording ids, schedules, etc.
};

type IVRFlow = { entry: string; nodes: IVRNode[] };

// ---- Helpers ----
const digits = ["0","1","2","3","4","5","6","7","8","9","*","#"];

function newId(prefix = "n"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyFlow(): IVRFlow {
  const rootId = "root";
  return {
    entry: rootId,
    nodes: [
      {
        id: rootId,
        type: "menu",
        prompt: "Thanks for calling! Press 1 for sales, 2 for support, or 0 for the operator.",
        options: [
          { digit: "1", next: "sales" },
          { digit: "2", next: "support" },
          { digit: "0", next: "operator" },
        ],
      },
      { id: "sales", type: "transfer", prompt: "Connecting you to sales.", transferTo: "+15551230011" },
      { id: "support", type: "transfer", prompt: "Connecting you to support.", transferTo: "+15551230022" },
      { id: "operator", type: "transfer", prompt: "Please hold for the operator.", transferTo: "+15551230000" },
    ],
  };
}

function useTenant() {
  return useMemo(() => getTenantId(), []);
}

export default function CallRouting(): JSX.Element {
  const tenantId = useTenant();

  // inbound mode
  const [mode, setMode] = useState<IVRMode>("ai");
  const [savingMode, setSavingMode] = useState(false);

  // flow
  const [flow, setFlow] = useState<IVRFlow>(emptyFlow());
  const [selectedId, setSelectedId] = useState<string>(flow.entry);
  const selected = flow.nodes.find((n) => n.id === selectedId) || flow.nodes[0];
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  // ---- Load state from backend ----
  async function loadAll() {
    try {
      setLoading(true);
      // current inbound mode
      const rState = await fetch(`${API_HTTP_BASE}/voice/state`, withTenant());
      const jState = await rState.json().catch(() => ({}));
      if (jState?.mode === "ivr" || jState?.mode === "ai") setMode(jState.mode);

      // flow (if any)
      const rFlow = await fetch(`${API_HTTP_BASE}/voice/ivr`, withTenant());
      const jFlow = await rFlow.json().catch(() => ({}));
      if (jFlow?.ok && jFlow?.flow?.nodes?.length) {
        setFlow(jFlow.flow);
        setSelectedId(jFlow.flow.entry);
      } else {
        // seed with default if backend has none
        setFlow(emptyFlow());
        setSelectedId("root");
      }
      setChanged(false);
    } catch {
      // ignore; keep defaults
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // ---- Save mode ----
  async function saveMode(next: IVRMode) {
    try {
      setSavingMode(true);
      const r = await fetch(`${API_HTTP_BASE}/voice/state`, {
        method: "POST",
        ...withTenant({ headers: { "Content-Type": "application/json" } }),
        body: JSON.stringify({ mode: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) throw new Error(j?.error || "failed");
      setMode(next);
    } catch (e: any) {
      alert(`Failed to update mode: ${e?.message || e}`);
    } finally {
      setSavingMode(false);
    }
  }

  // ---- Save flow ----
  async function saveFlow() {
    try {
      setSaving(true);
      const r = await fetch(`${API_HTTP_BASE}/voice/ivr`, {
        method: "POST",
        ...withTenant({ headers: { "Content-Type": "application/json" } }),
        body: JSON.stringify({ flow }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) throw new Error(j?.error || "failed");
      setChanged(false);
    } catch (e: any) {
      alert(`Save failed: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  // ---- Flow editing helpers ----
  function updateNode(mut: (n: IVRNode) => void) {
    setFlow((f) => {
      const next = { ...f, nodes: f.nodes.map((n) => ({ ...n })) };
      const n = next.nodes.find((x) => x.id === selectedId);
      if (!n) return f;
      mut(n);
      setChanged(true);
      return next;
    });
  }

  function addNode(t: IVRNodeType) {
    const id = newId(t.slice(0, 1));
    const base: IVRNode =
      t === "menu"
        ? { id, type: "menu", prompt: "New menu. Add options below.", options: [] }
        : t === "transfer"
        ? { id, type: "transfer", prompt: "Connecting you now.", transferTo: "+1" }
        : t === "voicemail"
        ? { id, type: "voicemail", prompt: "Please leave a message after the tone." }
        : { id, type: "ai", prompt: "Switching to AI assistant…" };
    setFlow((f) => ({ ...f, nodes: [...f.nodes, base] }));
    setSelectedId(id);
    setChanged(true);
  }

  function removeNode(id: string) {
    if (!confirm("Delete this node? References pointing to it will break.")) return;
    setFlow((f) => {
      const nodes = f.nodes.filter((n) => n.id !== id);
      // remove orphan references in menus
      nodes.forEach((n) => {
        if (n.type === "menu" && n.options) {
          n.options = n.options.filter((o) => o.next !== id);
        }
      });
      const entry = f.entry === id ? (nodes[0]?.id || "root") : f.entry;
      setSelectedId(entry);
      setChanged(true);
      return { ...f, nodes, entry };
    });
  }

  function addMenuOption() {
    if (selected?.type !== "menu") return;
    updateNode((n) => {
      const used = new Set((n.options || []).map((o) => o.digit));
      const free = digits.find((d) => !used.has(d));
      if (!free) return;
      n.options = [...(n.options || []), { digit: free, next: flow.entry }];
    });
  }

  // ---- UI ----
  return (
    <div className="p-4 grid grid-cols-12 gap-4">
      <div className="col-span-12 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Call Routing</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAll}
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 hover:bg-white/10"
            title="Reload from server"
          >
            <RefreshCcw size={14} /> Reload
          </button>
          <button
            onClick={saveFlow}
            disabled={!changed || saving}
            className="text-xs inline-flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "Saving…" : "Save Flow"}
          </button>
        </div>
      </div>

      {/* LEFT: inbound mode + nodes list */}
      <div className="col-span-12 md:col-span-3 space-y-3">
        <div className="glass rounded-none p-3">
          <div className="text-xs text-white/70 mb-1">Inbound mode</div>
          <div className="inline-flex rounded-md overflow-hidden border border-white/10">
            <button
              onClick={() => saveMode("ai")}
              className={"px-3 py-1.5 text-xs " + (mode === "ai" ? "bg-white/10" : "hover:bg-white/5")}
              disabled={savingMode}
            >
              AI
            </button>
            <button
              onClick={() => saveMode("ivr")}
              className={"px-3 py-1.5 text-xs border-l border-white/10 " + (mode === "ivr" ? "bg-white/10" : "hover:bg-white/5")}
              disabled={savingMode}
            >
              IVR
            </button>
          </div>
          <div className="mt-2 text-[11px] text-white/60">
            AI = stream audio to your assistant.<br />
            IVR = follow the call-tree below.
          </div>
        </div>

        <div className="glass rounded-none p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">Nodes</div>
            <div className="flex gap-1">
              <button onClick={() => addNode("menu")} className="text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10">+ Menu</button>
              <button onClick={() => addNode("transfer")} className="text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10">+ Transfer</button>
              <button onClick={() => addNode("voicemail")} className="text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10">+ Voicemail</button>
              <button onClick={() => addNode("ai")} className="text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10">+ AI</button>
            </div>
          </div>

          <ul className="space-y-1 max-h-[45vh] overflow-auto pr-1">
            {flow.nodes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSelectedId(n.id)}
                  className={
                    "w-full text-left px-2 py-1 rounded-none transition flex items-center justify-between " +
                    (selectedId === n.id ? "bg-white/15 border border-white/10" : "hover:bg-white/10")
                  }
                >
                  <span className="truncate">
                    <span className="text-[11px] uppercase text-white/60">{n.type}</span>{" "}
                    <code className="font-mono">{n.id}</code>
                    {flow.entry === n.id && <span className="ml-2 text-[10px] text-emerald-300">entry</span>}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); removeNode(n.id); }}
                    className="inline-flex items-center text-rose-400 hover:text-rose-300"
                    title="Delete node"
                  >
                    <Trash2 size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* CENTER: node editor */}
      <div className="col-span-12 md:col-span-6 glass rounded-none p-3 min-h-[300px]">
        {!selected && <div className="text-sm text-white/60">No node selected.</div>}
        {selected && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-xs text-white/60">Editing node</div>
                <div className="text-sm font-semibold"><code>{selected.id}</code> <span className="text-white/60">({selected.type})</span></div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={flow.entry === selected.id}
                    onChange={(e) =>
                      setFlow((f) => ({ ...f, entry: e.target.checked ? selected.id : f.entry }))
                    }
                  />
                  Make entry
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs text-white/70 mb-1">Prompt (spoken to caller)</label>
              <textarea
                rows={3}
                value={selected.prompt || ""}
                onChange={(e) => updateNode((n) => (n.prompt = e.target.value))}
                className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
              />
            </div>

            {selected.type === "menu" && (
              <div className="space-y-2">
                <div className="text-xs text-white/70">Options</div>
                {(selected.options || []).map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={o.digit}
                      onChange={(e) =>
                        updateNode((n) => { n.options![i].digit = e.target.value; })
                      }
                      className="w-20 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm"
                    >
                      {digits.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <span className="text-xs text-white/60">go to</span>
                    <select
                      value={o.next}
                      onChange={(e) =>
                        updateNode((n) => { n.options![i].next = e.target.value; })
                      }
                      className="flex-1 bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm"
                    >
                      {flow.nodes.map((n) => <option key={n.id} value={n.id}>{n.id} ({n.type})</option>)}
                    </select>
                    <button
                      onClick={() => updateNode((n) => { n.options = n.options!.filter((_, idx) => idx !== i); })}
                      className="text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={addMenuOption}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-white/10 rounded hover:bg-white/10"
                >
                  <Plus size={12} /> Add option
                </button>
              </div>
            )}

            {selected.type === "transfer" && (
              <div>
                <label className="block text-xs text-white/70 mb-1">Transfer to (E.164 or SIP)</label>
                <input
                  value={selected.transferTo || ""}
                  onChange={(e) => updateNode((n) => (n.transferTo = e.target.value))}
                  placeholder="+15551230000"
                  className="w-full bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm outline-none focus:border-white/30"
                />
              </div>
            )}

            {selected.type === "voicemail" && (
              <div className="text-xs text-white/60">
                Caller will be sent to voicemail after this prompt. (Server will record & store the message.)
              </div>
            )}

            {selected.type === "ai" && (
              <div className="text-xs text-white/60">
                Handoff to your AI assistant **within the call** after playing the prompt.
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: simple text preview */}
      <div className="col-span-12 md:col-span-3 glass rounded-none p-3">
        <div className="text-sm font-semibold mb-2">Flow Preview</div>
        <div className="text-xs whitespace-pre-wrap leading-5">
{`mode: ${mode}
entry: ${flow.entry}

`}{flow.nodes.map((n) => {
  const head = `• ${n.id} (${n.type})`;
  if (n.type === "menu") {
    const opts = (n.options || []).map((o) => `    - [${o.digit}] → ${o.next}`).join("\n");
    return `${head}\n${opts || "    (no options)"}`;
  }
  if (n.type === "transfer") return `${head}\n    → ${n.transferTo || "—"}`;
  return `${head}`;
}).join("\n\n")}
        </div>
      </div>
    </div>
  );
}