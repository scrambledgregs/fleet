// src/packs.ts
export type Pack = {
  id: string;
  label: string;
  aiPrompt?: string;
  defaults?: {
    items: Array<{
      name: string;
      qty: number;
      unit: string;
      unitPrice: number;
      notes?: string;
    }>;
  };
};

export const PACKS: Record<string, Pack> = {
  general: {
    id: "general",
    label: "General",
  },
  roofing: {
    id: "roofing",
    label: "Roofing",
    aiPrompt:
      "Scope: shingle roof repair; architectural shingles; provide line items (squares, underlayment, nails, sealant, labor) with realistic NY pricing.",
    defaults: {
      items: [
        { name: "Architectural Shingles", qty: 2, unit: "square", unitPrice: 250, notes: "Includes ~10% waste" },
        { name: "Roofing Underlayment",   qty: 2, unit: "square", unitPrice: 50,  notes: "Synthetic" },
        { name: "Roofing Nails",          qty: 5, unit: "lb",     unitPrice: 5 },
        { name: "Labor",                  qty: 8, unit: "hour",   unitPrice: 75,  notes: "Skilled roofing labor" },
      ],
    },
  },
};