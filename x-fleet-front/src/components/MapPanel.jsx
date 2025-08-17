// src/components/MapPanel.jsx
import { useMemo } from 'react'
import { MapContainer, TileLayer, Circle, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

function color(m) {
  if (m === 0) return '#7e7e7e'
  if (m < 0.15) return '#ff3b3b'
  if (m < 0.25) return '#ffab40'
  return '#00e676'
}

export default function MapPanel({ compact, jobs = [], selectedJobId, onSelectJob }) {
  // Fast lookup: id -> full job
  const byId = useMemo(() => {
    const m = new Map()
    for (const j of jobs || []) {
      const id = j?.appointmentId || j?.id
      if (id) m.set(id, j)
    }
    return m
  }, [jobs])

  // Normalize & keep only jobs with valid coordinates
  const points = useMemo(() => {
    return (jobs || [])
      .map((j) => {
        const lat = Number(j?.lat)
        const lng = Number(j?.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return {
          id: j.appointmentId || j.id,
          lat,
          lng,
          value: Number(j.estValue) || 0,
          margin: typeof j.margin === 'number' ? j.margin : 0.25,
          label: j?.jobType || 'Job',
        }
      })
      .filter(Boolean)
  }, [jobs])

  // Center on selected job if possible
  const fallbackCenter = [33.45, -112.07] // Phoenix-ish
  const selected = points.find((p) => p.id === selectedJobId)
  const first = points[0]
  const center = selected
    ? [selected.lat, selected.lng]
    : first
    ? [first.lat, first.lng]
    : fallbackCenter

  return (
    <div className={'relative ' + (compact ? 'h-[66vh]' : 'h-[70vh]')}>
      <MapContainer center={center} zoom={12} className="h-full w-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {points.map((p) => (
          <Circle
            key={p.id}
            center={[p.lat, p.lng]}
            radius={80}
            eventHandlers={{
              click: () => onSelectJob?.(byId.get(p.id) || null),
            }}
            pathOptions={{
              color: color(p.margin),
              fillColor: color(p.margin),
              fillOpacity: 0.25,
            }}
          >
            <Tooltip permanent direction="top">
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                ${Math.round(p.value).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>{p.label}</div>
            </Tooltip>
          </Circle>
        ))}
      </MapContainer>
    </div>
  )
}