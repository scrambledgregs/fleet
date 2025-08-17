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
  // Normalize & filter out jobs without valid coordinates
  const points = useMemo(() => {
    return (jobs || [])
      .map((j) => {
        const lat = Number(j?.lat)
        const lng = Number(j?.lng)
        return Number.isFinite(lat) && Number.isFinite(lng)
          ? {
              id: j.id || j.appointmentId,
              lat,
              lng,
              value: Number(j.estValue) || 0,
              // if you have a real margin/score, drop it in here:
              margin: typeof j.margin === 'number' ? j.margin : 0.25,
              label: j?.jobType || 'Job',
            }
          : null
      })
      .filter(Boolean)
  }, [jobs])

  // Center on selected job if possible; otherwise first valid point; otherwise fallback
  const fallbackCenter = [33.45, -112.07] // Phoenix-ish
  const selected = points.find((p) => p.id === selectedJobId)
  const first = points[0]
  const center = selected ? [selected.lat, selected.lng] : first ? [first.lat, first.lng] : fallbackCenter

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
              click: () => onSelectJob?.(p.id),
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