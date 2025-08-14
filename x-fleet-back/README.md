# Smart Dispatch Companion — Backend (GHL+ Contacts)

Adds **GHL Contact Card enrichment** so every job in your fleet system contains the same fields you see in GHL.

## What’s new
- On `/ghl/appointment-created`, backend now fetches the **GHL contact** (by `contactId`/email/phone) and stores a snapshot in `job.contact`.
- New endpoints:
  - `GET /api/week-appointments` — returns each job **with contact snapshot** for the Planner.
  - `GET /api/job/:id` — full job details + contact card.
- Use these to render the **same fields** in your Job Details panel that GHL shows in its contact card.

## Contact schema (snapshot)
```json
{
  "id": "ghl-contact-id",
  "name": "Jane Doe",
  "company": "Doe Roofing LLC",
  "emails": ["jane@example.com"],
  "phones": ["+1 (555) 010-2000"],
  "address": "123 Palm Ln, Phoenix, AZ 85004",
  "tags": ["Reroof", "VIP"],
  "custom": { "roofType":"Tile", "insuranceCarrier":"ACME Mutual", "leadSource":"Web" },
  "pipeline": { "name":"Roofing Sales", "stage":"Proposal Sent" }
}
```

## Run
```bash
cp .env.example .env
npm install
npm run dev
```

> Replace the stubbed contact fetch in `lib/ghl.js` with real GHL endpoints when you’re ready.
