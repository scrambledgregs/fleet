// src/pages/RequestAppointment.jsx
import { useMemo, useState } from 'react'
import { Calendar, Clock, MapPin, Mail, Phone, User, Wrench, Package, ArrowLeft, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { API_BASE } from '../config'

const jobTypes = [
  { key: 'Repair', icon: Wrench, label: 'Repair' },
  { key: 'Install', icon: Package, label: 'Install' },
]

const territories = ['EAST', 'WEST', 'NORTH', 'SOUTH']

function Label({ children }) {
  return <label className="text-sm font-medium text-white/80">{children}</label>
}

function FieldWrap({ children }) {
  return <div className="space-y-1.5">{children}</div>
}

function Input(props) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-white placeholder-white/40',
        'focus:outline-none focus:ring-2 focus:ring-white/20',
        props.className || '',
      ].join(' ')}
    />
  )
}

function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
    >
      {children}
    </select>
  )
}

function Section({ title, children, right }) {
  return (
    <div className="glass rounded-2xl p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white/90">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

export default function RequestAppointment() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    jobType: 'Repair',
    estValue: '',
    territory: 'EAST',
    date: '',
  })

  const [suggestions, setSuggestions] = useState([])
  const [selectedTime, setSelectedTime] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const localTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuggestions([])
    setSelectedTime(null)

    try {
      const res = await fetch(`${API_BASE}/api/suggest-times`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,                // required
          timezone: localTz || 'America/New_York',
          address: form.address,
          jobType: form.jobType,
          estValue: form.estValue,
          territory: form.territory,
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions)
        if (data.suggestions.length === 0) setError('No openings that fit the route on this day.')
      } else {
        setError(data.error || 'No suggestions available')
      }
    } catch (err) {
      setError('Failed to fetch suggestions')
    } finally {
      setLoading(false)
    }
  }

  async function confirmAppointment() {
    if (!selectedTime) return
    setSubmitting(true)
    setError('')

    try {
      const payload = {
        contact: {
          name: form.name,
          email: form.email,
          phone: form.phone,
        },
        address: form.address,
        jobType: form.jobType,
        estValue: form.estValue,
        territory: form.territory,
        // send UTC ISO — backend already normalizes
        startTime: new Date(selectedTime.start).toISOString(),
        endTime: new Date(selectedTime.end).toISOString(),
      }

      const res = await fetch(`${API_BASE}/api/create-appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok) {
        setConfirmed(true)
      } else {
        setError(data.error || 'Unable to confirm appointment')
      }
    } catch (e) {
      setError('Unexpected error while confirming')
    } finally {
      setSubmitting(false)
    }
  }

  const showStep2 = suggestions.length > 0 && !confirmed

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 md:py-10 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-yellow-300/90" />
          <h1 className="text-2xl font-semibold">Request an Appointment</h1>
        </div>

        {/* Step 1 — Details */}
        {!showStep2 && !confirmed && (
          <Section
            title="Tell us what you need"
            right={
              <div className="text-xs text-white/50">
                Your local timezone: <span className="font-mono">{localTz}</span>
              </div>
            }
          >
            <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <FieldWrap>
                <Label>Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                  <Input
                    name="name"
                    placeholder="Full name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </FieldWrap>

              <FieldWrap>
                <Label>Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                  <Input
                    name="phone"
                    placeholder="(555) 123-4567"
                    value={form.phone}
                    onChange={handleChange}
                    required
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </FieldWrap>

              <FieldWrap>
                <Label>Email (optional)</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                  <Input
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={handleChange}
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </FieldWrap>

              <FieldWrap className="md:col-span-2">
                <Label>Service Address</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                  <Input
                    name="address"
                    placeholder="123 Main St, City, ST"
                    value={form.address}
                    onChange={handleChange}
                    required
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </FieldWrap>

              <FieldWrap>
                <Label>Job Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {jobTypes.map(({ key, icon: Icon, label }) => {
                    const active = form.jobType === key
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setForm((p) => ({ ...p, jobType: key }))}
                        className={[
                          'flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5',
                          active
                            ? 'border-white/20 bg-white/10'
                            : 'border-white/10 bg-white/5 hover:border-white/20',
                        ].join(' ')}
                        aria-pressed={active}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-sm">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </FieldWrap>

              <FieldWrap>
                <Label>Estimated Value (optional)</Label>
                <Input
                  name="estValue"
                  placeholder="$"
                  value={form.estValue}
                  onChange={handleChange}
                />
              </FieldWrap>

              <FieldWrap>
                <Label>Territory</Label>
                <Select name="territory" value={form.territory} onChange={handleChange}>
                  {territories.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </FieldWrap>

              <FieldWrap>
                <Label>Preferred Day</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
                  <Input
                    type="date"
                    name="date"
                    value={form.date}
                    onChange={handleChange}
                    required
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </FieldWrap>

              <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
                {error ? <div className="text-sm text-red-300">{error}</div> : <div />}
                <button
                  type="submit"
                  disabled={loading}
                  className={[
                    'inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium',
                    'hover:bg-blue-500 disabled:opacity-60',
                  ].join(' ')}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                  {loading ? 'Checking...' : 'Check Available Times'}
                </button>
              </div>
            </form>
          </Section>
        )}

        {/* Step 2 — Suggestions */}
        {showStep2 && (
          <>
            <button
              onClick={() => {
                setSuggestions([])
                setSelectedTime(null)
                setError('')
              }}
              className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" /> Edit details
            </button>

            <Section title="Available Times">
              {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {suggestions.map((s, i) => {
                  const start = new Date(s.start).toLocaleString('en-US', {
                    timeZone: localTz,
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                  const end = new Date(s.end).toLocaleTimeString('en-US', {
                    timeZone: localTz,
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                  const active = selectedTime === s
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedTime(s)}
                      className={[
                        'text-left rounded-2xl border p-4 transition',
                        active
                          ? 'border-blue-400/40 bg-blue-500/10 ring-2 ring-blue-400/30'
                          : 'border-white/10 bg-white/5 hover:border-white/20',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{start} – {end}</div>
                        <div className="text-xs rounded-full bg-white/10 px-2 py-0.5">
                          {s.territory || form.territory}
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-white/70">
                        {s.reason || 'Fits route'}
                      </div>
                      {typeof s?.travel?.total === 'number' && (
                        <div className="mt-2 text-xs text-white/60">
                          Travel: {s.travel.total}m
                          {s.travel.fromPrev ? ` (from prev ${s.travel.fromPrev}m)` : ''}
                          {s.travel.toNext ? ` (to next ${s.travel.toNext}m)` : ''}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={confirmAppointment}
                  disabled={!selectedTime || submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {submitting ? 'Booking…' : 'Confirm Appointment'}
                </button>
              </div>
            </Section>
          </>
        )}

        {/* Step 3 — Confirmation */}
        {confirmed && selectedTime && (
          <Section
            title="Appointment Confirmed"
            right={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          >
            <div className="space-y-2">
              <div className="text-white/90">
                We’ve booked your appointment for{' '}
                <strong>
                  {new Date(selectedTime.start).toLocaleString('en-US', {
                    timeZone: localTz,
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </strong>
                .
              </div>
              <div className="text-sm text-white/70">
                You’ll get a confirmation message shortly. Need to make a change? Just reply to that
                message or contact support.
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}