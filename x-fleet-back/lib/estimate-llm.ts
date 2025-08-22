// x-fleet-back/lib/estimate-llm.ts
import axios from "axios";

export interface EstimateItem {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  notes?: string;
}

export interface EstimatePayload {
  items: EstimateItem[];
  notes?: string;
}

export interface ContactLite {
  name?: string;
  email?: string;
  phone?: string;
}

const apiBase = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

function requireKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  return apiKey;
}

const asNumber = (v: unknown, d = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : d;
};

function safeParse<T>(raw: unknown, fallback: T): T {
  try {
    if (typeof raw === "string") return JSON.parse(raw) as T;
  } catch {}
  return fallback;
}

// Ask the LLM for structured estimate line items based on a natural-language prompt.
export async function generateEstimateItems(prompt: string): Promise<EstimatePayload> {
  const apiKey = requireKey();

  const system =
    'You are a professional construction estimator for residential/exterior work. ' +
    'Return ONLY JSON with this exact shape: ' +
    '{ "items": [ { "name": string, "qty": number, "unit": string, "unitPrice": number, "notes": string? } ], "notes": string } ' +
    'Prices in USD; realistic market rates; concise item names. No prose.';

  type ChatResp = {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const { data } = await axios.post<ChatResp>(
    `${apiBase}/chat/completions`,
    {
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    }
  );

  const content = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = safeParse<{ items?: any[]; notes?: unknown }>(content, {});

  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
  const items: EstimateItem[] = itemsRaw
    .map((it) => ({
      name: String(it?.name ?? "Item").slice(0, 140),
      qty: asNumber(it?.qty, 1),
      unit: String(it?.unit ?? "ea").slice(0, 16),
      unitPrice: asNumber(it?.unitPrice, 0),
      notes: it?.notes ? String(it.notes).slice(0, 500) : undefined,
    }))
    .filter((x) => x.name && x.qty >= 0);

  const notes = typeof parsed.notes === "string" ? parsed.notes : "";
  return { items, notes };
}

// Draft a short SMS/email summary of the estimate for the customer.
export async function draftEstimateCopy(
  estimate: EstimatePayload,
  contact: ContactLite = {}
): Promise<string> {
  const apiKey = requireKey();
  const { items = [], notes = "" } = estimate;
  const name = contact.name || "there";

  const system =
    "You write ultra-brief, plain-text summaries of estimates. " +
    "Output <= 300 chars. No links. Friendly, professional.";

  const user =
    `Customer: ${name}\n` +
    `Items: ${items
      .map((i) => `${i.qty} ${i.unit} ${i.name} @ $${i.unitPrice}`)
      .join(" | ")}\n` +
    `Notes: ${notes}`;

  type ChatResp = {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const { data } = await axios.post<ChatResp>(
    `${apiBase}/chat/completions`,
    {
      model,
      temperature: 0.3,
      max_tokens: 120,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Write a one-paragraph SMS/email summary:\n${user}` },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 12000,
    }
  );

  let text = (data?.choices?.[0]?.message?.content || "").replace(/\s+/g, " ").trim();
  if (text.length > 300) text = text.slice(0, 297) + "...";
  return text;
}