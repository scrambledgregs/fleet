// lib/llm.js
import axios from 'axios';

/**
 * Returns a short, SMS-friendly assistant reply.
 * - If no OPENAI_API_KEY (or LLM_OFF=1), returns null so the agent falls back to canned text.
 * - Keeps replies concise and focused on booking.
 */
export async function coachReply(state = {}, userMessage = '') {
  try {
    if (process.env.LLM_OFF === '1') return null;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null; // safe fallback -> agent uses default copy

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const stage = state.stage || 'idle';
    const knownAddress = state?.data?.address || null;
    const knownDate = state?.data?.date || null;

    const system = [
      'You are a scheduling assistant for Nonstop Automation Dispatch (SMS).',
      'Your job: help book or reschedule a service appointment through short, natural replies.',
      'Rules:',
      '- Be concise (<= 240 characters). One or two sentences.',
      '- No links or markdown. Plain text only.',
      '- If user typed STOP/START/HELP, the main app handles compliance—do not duplicate.',
      '- If address is unknown and stage suggests asking for it, politely ask for the service address.',
      '- If date is unknown and stage=need_day, ask for a day in YYYY-MM-DD or a phrase like “Tue morning”.',
      '- If user proposes time/day, acknowledge and move toward confirming.',
      '- Never promise exact availability; we check the calendar after collecting address and day.',
      '- Friendly, professional tone.',
    ].join('\n');

    const context = `Current stage: ${stage}\nKnown address: ${knownAddress || 'none'}\nKnown date: ${knownDate || 'none'}`;

    const { data } = await axios.post(
      (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions',
      {
        model,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${context}\n\nCustomer: ${userMessage}` },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 12000,
      }
    );

    let text = (data?.choices?.[0]?.message?.content || '').trim();
    if (!text) return null;

    // SMS guardrails: collapse whitespace & cap length
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 240) text = text.slice(0, 237) + '...';
    return text;
  } catch (e) {
    console.warn('[LLM coachReply] fallback due to error:', e?.message || e);
    return null; // fallback to canned copy
  }
}