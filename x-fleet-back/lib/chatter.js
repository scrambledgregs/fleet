// lib/chatter.js
// Central place to store SMS threads + helpers

// Key = normalized peer phone (e.g. +15165551234)
// Value = [{ direction: 'inbound'|'outbound', text, at, to, from }]
export const smsThreads = new Map();

/** Normalize a phone to E.164-ish: digits only, prepend 1 if 10 digits, add + */
export function normalizePhone(p) {
  if (!p) return p;
  let s = String(p).replace(/[^\d]/g, '');
  if (s.length === 10) s = '1' + s; // assume US if 10 digits
  if (!s.startsWith('+')) s = '+' + s;
  return s;
}

/** Append a message to the correct thread and return the logged entry */
export function recordSms({ to, from, direction, text }) {
  const peerRaw = direction === 'outbound' ? to : from;
  const peer = normalizePhone(peerRaw);
  const arr = smsThreads.get(peer) || [];
  const entry = {
    direction,
    text,
    at: new Date().toISOString(),
    to,
    from,
  };
  arr.push(entry);
  smsThreads.set(peer, arr);
  return entry;
}

/** Read a thread by phone (accepts messy input; returns [] if none) */
export function getThread(phone) {
  const peer = normalizePhone(phone || '');
  return smsThreads.get(peer) || [];
}