// x-fleet-back/lib/estimate.ts
import axios from "axios";

export type EstimateItem = {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  notes?: string;
};

export type AiEstimateResult = {
  items: EstimateItem[];
  notes?: string | null;
  raw?: string; // raw text fallback when JSON fails
};

type OpenAIChatChoice = { message?: { content?: string } };
type OpenAIChatResponse = { choices?: OpenAIChatChoice[] };

const pickJson = (s: string): string => {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return s.slice(start, end + 1);
  return s;
};

const fallbackEstimate = (): AiEstimateResult => ({
  items: [
    { name: "Labor", qty: 2, unit: "hr", unitPrice: 125, notes: "Tech + helper" },
    { name: "Materials", qty: 1, unit: "lot", unitPrice: 180, notes: "Sealant, shingles, nails" },
    { name: "Cleanup / Haul away", qty: 1, unit: "job", unitPrice: 65 },
  ],
  notes: "LLM unavailable; using baseline pricing.",
});

/**
 * Turns a free-text scope into structured estimate line items via LLM.
 * Supports optional image URLs (job-site photos, satellite, sketches).
 * Never throws: returns a fallback on error.
 */
export async function aiEstimate(
  prompt: string,
  images: string[] = []
): Promise<AiEstimateResult> {
  if (process.env.LLM_OFF === "1" || !process.env.OPENAI_API_KEY) {
    return fallbackEstimate();
  }

  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"; // vision-capable

  const system =
    [
      "You output concise residential trade estimates as JSON only.",
      "Return strictly this JSON shape:",
      `{
        "items":[
          {"name":"string","qty":number,"unit":"string","unitPrice":number,"notes":"string?"},
          ...
        ],
        "notes":"string?"
      }`,
      "Use USD; be realistic for New York region if not specified.",
      "No commentary/markdown/code fences; JSON only.",
    ].join("\n");

  // Keep message content untyped (no inline union annotations)
  const userContent: any[] = [{ type: "text", text: `Scope:\n${prompt}` }];
  for (const url of images) {
    if (typeof url === "string" && url.trim()) {
      userContent.push({ type: "image_url", image_url: { url } });
    }
  }

  try {
    const { data } = await axios.post<OpenAIChatResponse>(
      `${base}/chat/completions`,
      {
        model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const raw = (data?.choices?.[0]?.message?.content || "").trim();
    const jsonText = pickJson(raw);

    try {
      const parsed = JSON.parse(jsonText) as { items?: unknown; notes?: unknown };
      const items = Array.isArray(parsed.items) ? parsed.items : [];

      const normalized: EstimateItem[] = items
        .map((it: any): EstimateItem => ({
          name: String(it?.name || "").slice(0, 120),
          qty: Number(it?.qty ?? 1) || 1,
          unit: String(it?.unit || "").slice(0, 16),
          unitPrice: Math.max(0, Number(it?.unitPrice ?? 0)) || 0,
          notes: it?.notes ? String(it.notes).slice(0, 240) : undefined,
        }))
        .filter((x) => x.name);

      return { items: normalized, notes: parsed?.notes ? String(parsed.notes) : null, raw };
    } catch {
      return { items: [], raw };
    }
  } catch (err) {
    console.warn("[aiEstimate] OpenAI call failed, falling back:", (err as any)?.message || err);
    return fallbackEstimate();
  }
}