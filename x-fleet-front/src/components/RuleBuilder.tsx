// src/components/RuleBuilder.tsx
import React, { useMemo, useState } from 'react'

type Trigger =
  | { kind: 'event'; event: string; delayMinutes?: number; match?: Record<string, any> }
  | { kind: 'schedule'; every?: 'day'|'week'|'month'|'year'; at?: string }

type Action =
  | { kind: 'sms'; to?: 'contact'|'assignee'|'custom'; customPhone?: string; text: string }
  | { kind: 'email'; to?: 'contact'|'assignee'|'custom'; customEmail?: string; subject: string; body: string }

export default function RuleBuilder({ onCreate, onCancel }: {
  onCreate: (payload: {
    title: string
    enabled: boolean
    trigger: Trigger
    action: Action
    meta?: Record<string, any>
  }) => Promise<void> | void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('New rule')
  const [enabled, setEnabled] = useState(true)
  const [mode, setMode] = useState<'event'|'schedule'>('event')
  const [event, setEvent] = useState('lead.created')
  const [delay, setDelay] = useState(60)
  const [every, setEvery] = useState<'day'|'week'|'month'|'year'>('week')
  const [at, setAt] = useState('09:00')
  const [actKind, setActKind] = useState<'sms'|'email'>('sms')
  const [to, setTo] = useState<'contact'|'assignee'|'custom'>('contact')
  const [customPhone, setCustomPhone] = useState('')
  const [customEmail, setCustomEmail] = useState('')
  const [text, setText] = useState("Hi {contact.firstName}, thanks for reaching out!")
  const [subject, setSubject] = useState("Quick check-in from NONSTOP")
  const [body, setBody] = useState("Hi {contact.firstName},\n\nJust checking in…\n\n— {user.name}")
  const [busy, setBusy] = useState(false)

  const sentence = useMemo(() => {
    const when = mode === 'event'
      ? `When **${event}** happens${delay ? `, wait **${delay}m**` : ''}`
      : `**Every ${every}** at **${at}**`
    const who = to === 'contact' ? 'the contact'
            : to === 'assignee' ? 'the assignee'
            : (actKind === 'sms' ? (customPhone || 'custom number') : (customEmail || 'custom email'))
    const what = actKind === 'sms'
      ? `send **SMS** to **${who}**: “${text.slice(0, 60)}${text.length>60?'…':''}”`
      : `send **Email** to **${who}**: “${subject.slice(0, 40)}${subject.length>40?'…':''}”`
    return `${when}, then ${what}.`
  }, [mode, event, delay, every, at, actKind, to, customPhone, customEmail, text, subject])

  async function handleCreate() {
    setBusy(true)
    try {
      const trigger: Trigger = mode === 'event'
        ? { kind: 'event', event, delayMinutes: delay || undefined }
        : { kind: 'schedule', every, at }
      const action: Action = actKind === 'sms'
        ? { kind: 'sms', to, customPhone: to==='custom'?customPhone:undefined, text }
        : { kind: 'email', to, customEmail: to==='custom'?customEmail:undefined, subject, body }
      await onCreate({ title, enabled, trigger, action, meta: { category: 'custom' } })
    } finally { setBusy(false) }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">Title
          <input value={title} onChange={e=>setTitle(e.target.value)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
        </label>
        <label className="text-xs">Status
          <select value={String(enabled)} onChange={e=>setEnabled(e.target.value==='true')} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm">
            <option value="true">Active</option>
            <option value="false">Paused</option>
          </select>
        </label>
      </div>

      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium">Trigger</div>
        <div className="flex gap-2">
          <button className={'px-2 py-1 text-xs rounded-none border ' + (mode==='event'?'bg-white/10 border-white/20':'border-white/10')} onClick={()=>setMode('event')}>Event</button>
          <button className={'px-2 py-1 text-xs rounded-none border ' + (mode==='schedule'?'bg-white/10 border-white/20':'border-white/10')} onClick={()=>setMode('schedule')}>Schedule</button>
        </div>

        {mode==='event' ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs">Event
              <select value={event} onChange={e=>setEvent(e.target.value)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm">
                <option value="lead.created">lead.created</option>
                <option value="disposition.recorded">disposition.recorded</option>
                <option value="appointment.created">appointment.created</option>
                <option value="job.completed">job.completed</option>
              </select>
            </label>
            <label className="text-xs">Delay (min)
              <input type="number" min={0} value={delay} onChange={e=>setDelay(parseInt(e.target.value||'0',10))} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs">Every
              <select value={every} onChange={e=>setEvery(e.target.value as any)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm">
                <option value="day">day</option><option value="week">week</option>
                <option value="month">month</option><option value="year">year</option>
              </select>
            </label>
            <label className="text-xs">At
              <input value={at} onChange={e=>setAt(e.target.value)} placeholder="09:00" className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
          </div>
        )}
      </div>

      <div className="glass rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium">Action</div>
        <div className="flex gap-2">
          <button className={'px-2 py-1 text-xs rounded-none border ' + (actKind==='sms'?'bg-white/10 border-white/20':'border-white/10')} onClick={()=>setActKind('sms')}>SMS</button>
          <button className={'px-2 py-1 text-xs rounded-none border ' + (actKind==='email'?'bg-white/10 border-white/20':'border-white/10')} onClick={()=>setActKind('email')}>Email</button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">Recipient
            <select value={to} onChange={e=>setTo(e.target.value as any)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm">
              <option value="contact">contact</option>
              <option value="assignee">assignee</option>
              <option value="custom">custom</option>
            </select>
          </label>
          {to==='custom' && actKind==='sms' && (
            <label className="text-xs">Phone
              <input value={customPhone} onChange={e=>setCustomPhone(e.target.value)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
          )}
          {to==='custom' && actKind==='email' && (
            <label className="text-xs">Email
              <input value={customEmail} onChange={e=>setCustomEmail(e.target.value)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
          )}
        </div>

        {actKind==='sms' ? (
          <label className="text-xs">Text
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={4} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
          </label>
        ) : (
          <>
            <label className="text-xs">Subject
              <input value={subject} onChange={e=>setSubject(e.target.value)} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
            <label className="text-xs">Body
              <textarea value={body} onChange={e=>setBody(e.target.value)} rows={6} className="w-full mt-1 px-2 py-1 bg-black/30 border border-white/10 rounded-none text-sm" />
            </label>
          </>
        )}
      </div>

      <div className="text-xs text-white/60">
        Preview: <span className="ml-1" dangerouslySetInnerHTML={{__html: sentence.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}} />
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10">Cancel</button>
        <button disabled={busy} onClick={handleCreate} className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/10 hover:bg-white/20">{busy?'Creating…':'Create rule'}</button>
      </div>
    </div>
  )
}