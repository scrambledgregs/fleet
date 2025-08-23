// x-fleet-front/src/components/EmailDraftComposer.tsx
import React, { useRef, useState } from "react";
import { API_BASE } from "../config";

type Tone = "friendly" | "professional";

function htmlToSnippet(html: string, max = 140) {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text || "(no body)";
}

// Treat default “Customer/Contact/Write a short…” seed as placeholder (i.e., empty)
function normalizeDefaultContext(s?: string) {
  const t = (s || "").trim();
  if (!t) return "";
  const collapsed = t.replace(/\s+/g, " ");
  const looksLikeSeed =
    /^Customer:\s*\.?\s*Contact:\s*\.?/i.test(collapsed) &&
    /Write a short/i.test(collapsed);
  return looksLikeSeed ? "" : t;
}

// Lightweight, generic suggestions (kept short deliberately)
const PROMPT_SUGGESTIONS: { key: string; label: string; text: string }[] = [
  {
    key: "missed",
    label: "Missed call follow-up",
    text:
      "We missed each other earlier. Ask for a good time to call back and confirm the best number.",
  },
  {
    key: "reschedule",
    label: "Reschedule options",
    text:
      "Customer requested to reschedule. Offer Tue/Wed afternoon windows, include direct line, keep it brief.",
  },
  {
    key: "estimate",
    label: "Estimate ready",
    text:
      "Let them know the estimate is ready. Summarize the scope in one line and ask for approval or questions.",
  },
  {
    key: "confirm",
    label: "Appointment confirmation",
    text:
      "Confirm date/time and address. Ask about gate/parking details and a preferred contact number.",
  },
  {
    key: "review",
    label: "Post-job review request",
    text:
      "Thank them for choosing us. Ask for a quick Google review and include a short, friendly link sentence.",
  },
];

export default function EmailDraftComposer(props: {
  to?: string;
  replyTo?: string;
  defaultContext?: string;
  defaultTone?: Tone;
  contactId?: string | null;
  onQueued?: (m: any) => void;
}) {
  const [to, setTo] = useState(props.to ?? "");
  const [replyTo, setReplyTo] = useState(props.replyTo ?? "");
  const [context, setContext] = useState(normalizeDefaultContext(props.defaultContext));
  const [tone, setTone] = useState<Tone>(props.defaultTone ?? "friendly");

  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");

  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasContext = context.trim().length > 0;
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  async function draftWithAI() {
    setError(null);
    setSuccess(null);
    setGenerating(true);
    try {
      const r = await fetch(`${API_BASE}/api/email/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, tone }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Draft failed");
      setSubject(j.draft.subject || "");
      setHtml(j.draft.html || "");
    } catch (e: any) {
      setError(e.message || "Draft failed");
    } finally {
      setGenerating(false);
    }
  }

  async function sendEmail() {
    setError(null);
    setSuccess(null);
    setSending(true);
    try {
      if (!to || !subject || !html) {
        throw new Error("to, subject, and html are required");
      }

      const r = await fetch(`${API_BASE}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, html, replyTo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Send failed");

      const snippet = `${subject || "(no subject)"} — ${htmlToSnippet(html)}`;
      let savedMessage: any = null;

      if (props.contactId) {
        try {
          const r2 = await fetch(`${API_BASE}/api/mock/ghl/send-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contactId: props.contactId,
              text: snippet,
              direction: "outbound",
              channel: "email",
              meta: { subject, html, providerId: j.result?.id || null },
            }),
          });
          const j2 = await r2.json().catch(() => ({}));
          savedMessage = j2?.message || null;
        } catch {
          // ignore
        }
      }

      props.onQueued?.(
        savedMessage || {
          id: `tmp_email_${Date.now()}`,
          direction: "outbound",
          channel: "email",
          text: `${subject || "(no subject)"} — ${htmlToSnippet(html)}`,
          createdAt: new Date().toISOString(),
          meta: { subject, html, providerId: j.result?.id || null },
        }
      );

      setSuccess(`Queued: ${j.result?.id || "OK"}`);
    } catch (e: any) {
      setError(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  function insertSuggestion(key: string) {
    const s = PROMPT_SUGGESTIONS.find((x) => x.key === key);
    if (!s) return;
    setContext((prev) => (prev.trim() ? `${prev.trim()}\n\n${s.text}` : s.text));
    // focus for quick edits
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  return (
    <div className="space-y-2 text-sm">
      {/* To / Reply-To */}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <div className="text-[11px] text-gray-500 mb-1">To</div>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="customer@example.com"
          />
        </label>

        <label className="block">
          <div className="text-[11px] text-gray-500 mb-1">Reply-To (optional)</div>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="dispatch@proto.nonstopautomation.com"
          />
        </label>
      </div>

      {/* AI prompt bar */}
      <div className="rounded-md border border-white/10 bg-black/30 p-2">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            className="inline-flex items-center gap-2 text-[11px] text-white/80 hover:opacity-90"
            onClick={() => {
              promptRef.current?.focus();
              promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            title={hasContext ? "Edit AI prompt" : "Add AI prompt"}
          >
            <span
              aria-hidden
              className="inline-flex h-4 w-4 items-center justify-center rounded bg-white/10"
            >
              ✨
            </span>
            <span className="font-medium">AI Prompt</span>
            {!hasContext && <span className="text-white/50">· Add…</span>}
          </button>

          {hasContext && (
            <span className="text-[11px] text-white/40 truncate max-w-[40%] sm:max-w-[55%]">
              {context.replace(/\s+/g, " ").slice(0, 60)}
              {context.length > 60 ? "…" : ""}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Suggestions dropdown */}
            <label className="text-[11px] text-white/60">
              <span className="sr-only">Prompt suggestions</span>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    insertSuggestion(e.target.value);
                    e.currentTarget.selectedIndex = 0; // reset to placeholder
                  }
                }}
                className="bg-black/30 border border-white/10 rounded-md px-2 py-1 text-[11px]"
                defaultValue=""
                title="Insert a prompt suggestion"
              >
                <option value="" disabled>
                  Suggestions…
                </option>
                {PROMPT_SUGGESTIONS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="inline-flex rounded-md overflow-hidden border border-white/10">
              <button
                onClick={() => setTone("friendly")}
                className={
                  "px-2 py-1 text-[11px] " +
                  (tone === "friendly" ? "bg-white/10" : "hover:bg-white/5")
                }
              >
                Friendly
              </button>
              <button
                onClick={() => setTone("professional")}
                className={
                  "px-2 py-1 text-[11px] border-l border-white/10 " +
                  (tone === "professional" ? "bg-white/10" : "hover:bg-white/5")
                }
              >
                Professional
              </button>
            </div>

            <button
              onClick={draftWithAI}
              disabled={generating || !hasContext}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              title={hasContext ? "Draft with AI" : "Add a prompt first"}
            >
              {generating ? "Drafting…" : "Draft with AI"}
            </button>
          </div>
        </div>

        <textarea
          ref={promptRef}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          className="w-full bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none focus:border-white/30"
          placeholder="" /* intentionally empty: no ghost text */
        />

        <div className="mt-1 text-[11px] text-white/40">
          Tip: keep it short and factual. Example: “Customer asked to reschedule next week.
          Offer Tue/Wed afternoon and include a direct phone number.”
        </div>
      </div>

      {/* Subject + HTML */}
      <label className="block">
        <div className="text-[11px] text-gray-500 mb-1">Subject</div>
        <input
          className="w-full rounded-md border px-2 py-1.5 text-sm"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
        />
      </label>

      <label className="block">
        <div className="text-[11px] text-gray-500 mb-1">HTML body</div>
        <textarea
          className="w-full rounded-md border px-2 py-1.5 h-28 font-mono text-sm"
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder="<p>Hello…</p>"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          onClick={sendEmail}
          disabled={!to || !subject || !html || sending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send Edited"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 text-red-800 px-3 py-1.5">{error}</div>
      )}
      {success && (
        <div className="rounded-md bg-emerald-50 text-emerald-800 px-3 py-1.5">
          {success}
        </div>
      )}
    </div>
  );
}