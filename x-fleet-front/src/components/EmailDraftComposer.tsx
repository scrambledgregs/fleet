// x-fleet-front/src/components/EmailDraftComposer.tsx
import React, { useState } from "react";
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

export default function EmailDraftComposer(props: {
  to?: string;
  replyTo?: string;
  defaultContext?: string;
  defaultTone?: Tone;
  /** conversation/contact to attach the email to */
  contactId?: string | null;
  /** notify parent so it can append the new message to the thread */
  onQueued?: (m: any) => void;
}) {
  const [to, setTo] = useState(props.to ?? "");
  const [replyTo, setReplyTo] = useState(props.replyTo ?? "");
  const [context, setContext] = useState(props.defaultContext ?? "");
  const [tone, setTone] = useState<Tone>(props.defaultTone ?? "friendly");

  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");

  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

      // 1) Send via Mailgun backend
      const r = await fetch(`${API_BASE}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, html, replyTo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Send failed");

      // 2) Log into the conversation so it shows in the thread
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
              meta: {
                subject,
                html,
                providerId: j.result?.id || null,
              },
            }),
          });
          const j2 = await r2.json().catch(() => ({}));
          savedMessage = j2?.message || null;
        } catch {
          // ignore, we’ll fall back to optimistic
        }
      }

// 3) Optimistic append (or use saved one)
if (props.onQueued) {
  props.onQueued(
    savedMessage || {
      id: `tmp_email_${Date.now()}`,
      direction: "outbound",
      channel: "email",
      text: `${subject || "(no subject)"} — ${htmlToSnippet(html)}`,
      createdAt: new Date().toISOString(),
      meta: { subject, html, providerId: j.result?.id || null }, // <-- add meta
    }
  );
}

      setSuccess(`Queued: ${j.result?.id || "OK"}`);
    } catch (e: any) {
      setError(e.message || "Send failed");
    } finally {
      setSending(false);
    }
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

    {/* Context + Tone + Draft button */}
    <label className="block">
      <div className="text-[11px] text-gray-500 mb-1">
        Context for AI (what should the email say?)
      </div>
      <textarea
        className="w-full rounded-md border px-2 py-1.5 h-20"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Customer asked for a Tuesday afternoon AC tune-up…"
      />
    </label>

    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500">Tone</span>
      <label className="flex items-center gap-1">
        <input type="radio" checked={tone === 'friendly'} onChange={() => setTone('friendly')} />
        Friendly
      </label>
      <label className="flex items-center gap-1">
        <input type="radio" checked={tone === 'professional'} onChange={() => setTone('professional')} />
        Professional
      </label>

      <button
        onClick={draftWithAI}
        disabled={generating || !context}
        className="ml-auto rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {generating ? 'Drafting…' : 'Draft with AI'}
      </button>
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
        {sending ? 'Sending…' : 'Send Edited'}
      </button>
    </div>

    {error && (
      <div className="rounded-md bg-red-50 text-red-800 px-3 py-1.5">{error}</div>
    )}
    {success && (
      <div className="rounded-md bg-emerald-50 text-emerald-800 px-3 py-1.5">{success}</div>
    )}

    <p className="text-[11px] text-gray-500">
      Tip: to track delivery/open/click, handle Mailgun webhooks at <code>/api/webhooks/mailgun</code> and
      correlate by the returned <code>id</code>.
    </p>
  </div>
);
}