import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import { getTenantId } from "../lib/socket";

type Role = "owner" | "admin" | "member";

type Member = {
  name: string;
  email?: string;
  title?: string;
  role: Role;
};

const steps = ["Company Info", "Team Members", "Connect CRM", "Finish Setup"] as const;

function slugifyUserId(m: Member): string {
  // Prefer email local-part, otherwise a slug of the name.
  if (m.email && m.email.includes("@")) {
    return m.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }
  return (m.name || "user")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function OnboardingWizard() {
  const [step, setStep] = useState<number>(0);
  const navigate = useNavigate();
  const tenantId = useMemo(() => getTenantId(), []);

  // Step 0: company info (purely cosmetic for now)
  const [companyName, setCompanyName] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");

  // Step 1: team & welcome
  const [members, setMembers] = useState<Member[]>([]);
  const [draft, setDraft] = useState<Member>({ name: "", email: "", title: "", role: "member" });
  const [welcomeMessage, setWelcomeMessage] = useState<string>("Welcome to #homebase! 🎉");
  const [seedWelcome, setSeedWelcome] = useState<boolean>(true);

  // Step 3: submission state
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  function addMember() {
    const name = (draft.name || "").trim();
    if (!name) return;
    setMembers((prev) => [...prev, { ...draft, name }]);
    setDraft({ name: "", email: "", title: "", role: "member" });
  }

  function removeMember(idx: number) {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  }

  async function finishSetup() {
    setSubmitting(true);
    setError(null);
    try {
      // Build payload expected by /api/team/bootstrap
      const payloadMembers = members.map((m) => ({
        userId: slugifyUserId(m),
        name: m.name,
        title: m.title,
        role: m.role,
      }));

      // It’s okay if `payloadMembers` is empty; the channel will still be ensured on first profile create later.
      const r = await fetch(`${API_BASE}/api/team/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": tenantId,
        },
        body: JSON.stringify({
          clientId: tenantId,
          members: payloadMembers,
          welcomeMessage,
          seedWelcome, // if true, a system message is posted to #homebase now
          // You could also pass along companyName/industry to your own company settings endpoint later.
        }),
      });

      const j = await r.json();
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || `Failed with ${r.status}`);
      }

      // Head straight to Team → Chat
      navigate("/team?tab=chat", { replace: true });
    } catch (e: any) {
      setError(e?.message || "Something went wrong finishing setup.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Stepper */}
      <div className="flex justify-between items-center mb-6">
        {steps.map((label, i) => (
          <div
            key={label}
            className={`flex-1 text-center text-sm ${i === step ? "text-red-400 font-semibold" : "text-white/50"}`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[260px] flex flex-col gap-4">
        {step === 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-white/70">Company Name</span>
              <input
                type="text"
                placeholder="Acme Roofing"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-white/70">Industry</span>
              <input
                type="text"
                placeholder="Roofing, HVAC, Electrical…"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm text-white/70">Add teammates who should get access:</p>

            {/* Add member row */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <input
                type="text"
                placeholder="Full name"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none md:col-span-2"
                value={draft.name}
                onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                type="email"
                placeholder="email@example.com"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
                value={draft.email}
                onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Title (e.g., Estimator)"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
                value={draft.title}
                onChange={(e) => setDraft((s) => ({ ...s, title: e.target.value }))}
              />
              <select
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
                value={draft.role}
                onChange={(e) => setDraft((s) => ({ ...s, role: e.target.value as Role }))}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>

            <div>
              <button onClick={addMember} className="glass px-3 py-1.5 rounded-md mt-1">
                Add teammate
              </button>
            </div>

            {/* List */}
            <div className="border border-white/10 rounded-md divide-y divide-white/10">
              {members.length === 0 && (
                <div className="p-3 text-white/60 text-sm">No teammates added yet.</div>
              )}
              {members.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-white/60">
                      {m.email || "—"} · {m.title || "—"} · {m.role}
                    </div>
                  </div>
                  <button className="text-xs glass px-2 py-1 rounded-md" onClick={() => removeMember(idx)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {/* Welcome message (customizable) */}
            <div className="mt-3 space-y-2">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-white/70">Welcome message for #homebase</span>
                <textarea
                  className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none min-h-[84px]"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Write the first message everyone will see…"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={seedWelcome}
                  onChange={(e) => setSeedWelcome(e.target.checked)}
                />
                Post this message automatically during team setup
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-white/70">Connect your CRM to sync jobs and contacts:</p>
            <div className="flex gap-2 flex-wrap">
              <button className="glass px-4 py-2 rounded-md hover:bg-white/10">Connect ServiceTitan</button>
              <button className="glass px-4 py-2 rounded-md hover:bg-white/10">Connect JobNimbus</button>
              <button className="glass px-4 py-2 rounded-md hover:bg-white/10">Connect Housecall Pro</button>
            </div>
            <p className="text-xs text-white/50">
              (You can connect these later from Settings → Integrations.)
            </p>
          </>
        )}

        {step === 3 && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">You’re all set 🎉</h2>
            <p className="text-white/70 mb-4">
              Click finish to create your team in chat and jump in.
            </p>
            {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
            <button
              onClick={finishSetup}
              className="inline-block bg-red-500 hover:bg-red-600 px-6 py-2 rounded-md font-semibold disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? "Finishing…" : "Finish & go to Team"}
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < steps.length - 1 && (
        <div className="flex justify-between mt-6">
          <button onClick={back} disabled={step === 0} className="px-4 py-2 rounded-md glass disabled:opacity-40">
            Back
          </button>
          <button onClick={next} className="px-4 py-2 rounded-md bg-red-500 hover:bg-red-600">
            Next
          </button>
        </div>
      )}
    </div>
  );
}