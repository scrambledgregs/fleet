// lib/emailDraft.ts
import axios from 'axios';

export type EmailDraft = { subject: string; html: string };

export async function draftEmail(
  context: string,
  tone: 'friendly' | 'professional' = 'friendly'
): Promise<EmailDraft> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');

  const system = 'You write concise service-appointment emails. Emails are properly spaced and use human-like punctuation. Return JSON with subject and html: {"subject": "...", "html": "..."}';
  const user = `Tone: ${tone}\nContext:\n${context}`;

  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.6,
      response_format: { type: 'json_object' }
    },
    { headers: { Authorization: `Bearer ${key}` }, timeout: 15000 }
  );

  const text = data?.choices?.[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { subject: 'Follow up', html: `<p>${text}</p>` };
  }
}