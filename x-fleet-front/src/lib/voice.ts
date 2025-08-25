// src/lib/voice.ts
import { API_BASE } from '../config'
import { withTenant, getTenantId } from './socket'
import type { Socket } from 'socket.io-client'

const API_HTTP_BASE = `${API_BASE}`.endsWith('/api') ? API_BASE : `${API_BASE}/api`

/**
 * Call once (per page) to bridge app events:
 *  - window "voice:dial" -> POST /api/voice/call
 *  - socket "voice:status"/"voice:recording" -> window events
 */
export function initVoiceClient(socket: Socket, tenantId?: string) {
  const clientId = tenantId || getTenantId()

  // 1) Browser -> Backend (place a call)
  async function onDial(e: Event) {
    const detail = (e as CustomEvent).detail || {}
    const to = (detail.to || '').toString().trim()
    if (!to) return

    // announce immediately
    window.dispatchEvent(
      new CustomEvent('voice:status', {
        detail: { status: 'dialing', to, at: new Date().toISOString() }
      })
    )

    try {
      const r = await fetch(`${API_HTTP_BASE}/voice/call`, withTenant({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, clientId })
      }))
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent('voice:status', {
          detail: { status: 'error', to, error: err?.message || 'call failed', at: new Date().toISOString() }
        })
      )
    }
  }

  // 2) Backend -> Browser (status + recording)
  function onStatus(payload: any) {
    window.dispatchEvent(new CustomEvent('voice:status', { detail: payload }))
  }
  function onRecording(payload: any) {
    // Chatter.jsx already listens for this custom event name
    window.dispatchEvent(new CustomEvent('voice:recording-ready', { detail: payload }))
  }

  // idempotent guards
  const W = window as any
  if (!W.__voiceBridgeBound) {
    window.addEventListener('voice:dial', onDial as EventListener)
    W.__voiceBridgeBound = true
  }

  // attach socket listeners (avoid dupes)
  socket.off('voice:status', onStatus)
  socket.off('voice:recording', onRecording)
  socket.on('voice:status', onStatus)
  socket.on('voice:recording', onRecording)
}