// src/pages/RoofMeasure.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import SideNav from '../components/SideNav.jsx'
import StatBar from '../components/StatBar.jsx'

import * as turf from '@turf/turf'
import type { Feature, Polygon, Position } from 'geojson'
import L from 'leaflet'
import 'leaflet-draw' // runtime only; TS types are thin so we cast where needed

type Measure = {
  planSqft: number
  pitchFactor: number
  roofSqft: number
  squares: number
  perimeterFt: number
}

const toCurrency = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

const PRICE = {
  shinglesPerSquare: 250,
  underlaymentPerSquare: 50,
  nailsPerLb: 5,
  laborPerHour: 75,
}

// Reusable primary button classes (match brand blue used elsewhere)
const BTN_PRIMARY =
  'px-3 py-1.5 text-sm rounded-none bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white border border-sky-400/30 disabled:opacity-60 disabled:cursor-not-allowed'

export default function RoofMeasure() {
  const navigate = useNavigate()
  const mapRef = useRef<HTMLDivElement>(null)
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const mapInstRef = useRef<L.Map | null>(null)

  const [mode, setMode] = useState<'Approve' | 'Schedule' | 'Dispatch'>('Approve')
  const [compact, setCompact] = useState(false)
  const [addr, setAddr] = useState('')
  const [searching, setSearching] = useState(false)
  const [pitch, setPitch] = useState('6/12')
  const [measure, setMeasure] = useState<Measure>({
    planSqft: 0,
    pitchFactor: 1.118,
    roofSqft: 0,
    squares: 0,
    perimeterFt: 0,
  })

  const PITCH_FACTORS: Record<string, number> = {
    '3/12': 1.035,
    '4/12': 1.054,
    '5/12': 1.083,
    '6/12': 1.118,
    '7/12': 1.158,
    '8/12': 1.202,
    '9/12': 1.25,
    '10/12': 1.302,
    '12/12': 1.414,
  }

  // --- recompute (stable via refs, no “map” shadowing) ---
  const recompute = React.useCallback(() => {
    const fg = featureGroupRef.current
    if (!fg) return

    const layers = (fg.getLayers() as L.Layer[]).filter(
      (l: L.Layer): l is L.Polygon => l instanceof L.Polygon
    )
    const poly = layers[0]
    if (!poly) {
      setMeasure((m) => ({
        ...m,
        planSqft: 0,
        roofSqft: 0,
        squares: 0,
        perimeterFt: 0,
      }))
      return
    }

    const gj = poly.toGeoJSON() as unknown as Feature<Polygon>

    // area (plan view)
    const planM2 = turf.area(gj)
    const planSqft = planM2 * 10.7639

    // perimeter (outer ring -> LineString). Ensure closed ring for robust length.
    const outer: Position[] = (gj.geometry?.coordinates?.[0] ?? []) as Position[]
    const closed = outer.length && (outer[0][0] !== outer[outer.length - 1][0] || outer[0][1] !== outer[outer.length - 1][1])
      ? [...outer, outer[0]]
      : outer
    const perimMeters = turf.length(turf.lineString(closed), { units: 'meters' })
    const perimeterFt = perimMeters * 3.28084

    const pitchFactor = PITCH_FACTORS[pitch] ?? 1.118
    const roofSqft = planSqft * pitchFactor
    const squares = roofSqft / 100

    setMeasure((m) => ({ ...m, planSqft, pitchFactor, roofSqft, squares, perimeterFt }))
  }, [pitch])

  // --- init map once ---
  useEffect(() => {
    if (mapInstRef.current || !mapRef.current) return

    const mapObj = L.map(mapRef.current, {
      center: [40.7128, -74.006],
      zoom: 19,
      zoomControl: true,
    })
    mapInstRef.current = mapObj

    // satellite tiles
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles © Esri' }
    ).addTo(mapObj)

    // feature group + draw control
    const fg = new L.FeatureGroup()
    featureGroupRef.current = fg
    mapObj.addLayer(fg)

    const drawCtrl = new (L as any).Control.Draw({
      edit: { featureGroup: fg },
      draw: {
        polygon: true,
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    })
    mapObj.addControl(drawCtrl)

    // events (typed as any to avoid leaflet-draw type dependency)
    const onCreated = (e: any) => {
      fg.clearLayers()
      fg.addLayer(e.layer)
      try {
        const b = (e.layer as L.Polygon).getBounds?.()
        if (b) mapObj.fitBounds(b, { padding: [16, 16] })
      } catch {}
      recompute()
    }
    const onEdited = (_e: any) => recompute()
    const onDeleted = (_e: any) => {
      fg.clearLayers()
      recompute()
    }

    mapObj.on((L as any).Draw.Event.CREATED, onCreated)
    mapObj.on((L as any).Draw.Event.EDITED, onEdited)
    mapObj.on((L as any).Draw.Event.DELETED, onDeleted)

    return () => {
      mapObj.off((L as any).Draw.Event.CREATED, onCreated)
      mapObj.off((L as any).Draw.Event.EDITED, onEdited)
      mapObj.off((L as any).Draw.Event.DELETED, onDeleted)
      try {
        mapObj.removeControl(drawCtrl)
      } catch {}
      try {
        mapObj.removeLayer(fg)
      } catch {}
    }
  }, [recompute])

  // recompute when pitch changes
  useEffect(() => {
    recompute()
  }, [recompute])

  async function lookup() {
    if (!addr.trim() || searching) return
    setSearching(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`
      const r = await fetch(url, {
        headers: {
          Accept: 'application/json',
          // Nominatim recommends a descriptive UA/email
          'User-Agent': 'NonstopJobs/1.0 (roof-measure)'
        },
      })
      const j = await r.json().catch(() => [])
      if (Array.isArray(j) && j[0]) {
        const { lat, lon } = j[0]
        const m = mapInstRef.current
        if (m) m.setView([Number(lat), Number(lon)], 19)
      }
    } finally {
      setSearching(false)
    }
  }

  function clearDrawing() {
    const fg = featureGroupRef.current
    if (!fg) return
    fg.clearLayers()
    setMeasure((m) => ({ ...m, planSqft: 0, roofSqft: 0, squares: 0, perimeterFt: 0 }))
  }

  const summary = useMemo(() => {
    const waste = 1.1
    const shinglesSquares = Math.ceil(measure.squares * waste * 100) / 100
    const underlaymentSquares = shinglesSquares
    const laborHours = Math.max(2, Math.round(measure.squares * 3 * 10) / 10)
    const nailsLbs = Math.ceil(measure.squares * 2)

    const items = [
      {
        name: 'Architectural Shingles',
        qty: shinglesSquares,
        unit: 'square',
        unitPrice: PRICE.shinglesPerSquare,
        notes: 'Includes 10% waste',
      },
      {
        name: 'Roofing Underlayment',
        qty: underlaymentSquares,
        unit: 'square',
        unitPrice: PRICE.underlaymentPerSquare,
        notes: 'Synthetic',
      },
      { name: 'Roofing Nails', qty: nailsLbs, unit: 'lb', unitPrice: PRICE.nailsPerLb },
      {
        name: 'Labor',
        qty: laborHours,
        unit: 'hour',
        unitPrice: PRICE.laborPerHour,
        notes: 'Skilled roofing crew',
      },
    ]
    const subtotal = items.reduce((s, it) => s + it.qty * it.unitPrice, 0)
    return { items, subtotal }
  }, [measure])

  function sendToEstimator() {
    const draft = {
      items: summary.items,
      notes: `Measured ~${measure.squares.toFixed(2)} squares (plan ${Math.round(
        measure.planSqft
      )} ft², pitch factor ${measure.pitchFactor}). Perimeter ~${Math.round(
        measure.perimeterFt
      )} ft.`,
    }
    localStorage.setItem('estimatorDraft', JSON.stringify(draft))
    navigate('/estimator?pack=roofing')
  }

  return (
    <div className="glass rounded-none p-4">

      <main
        className={
          'flex-1 min-h-0 overflow-hidden grid grid-cols-12 ' +
          (compact ? 'gap-4 p-4' : 'gap-6 p-6')
        }
      >
        <aside className="col-span-12 lg:col-span-2">
          <SideNav active="packs" onChange={(id: string) => { if (id !== 'packs') navigate('/') }} />
        </aside>

        <section className="col-span-12 lg:col-span-10 h-full min-h-0">
          <div className="glass rounded-none p-3 md:p-4 flex flex-col gap-3 min-h-[70vh]">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Roof Measure (Satellite)</div>
              <div className="flex items-center gap-2">
                <select
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                  className="bg-black/30 border border-white/10 rounded-none px-2 py-1 text-sm"
                >
                  {Object.keys(PITCH_FACTORS).map((p: string) => (
                    <option key={p} value={p}>
                      {p} pitch
                    </option>
                  ))}
                </select>
                <button
                  onClick={sendToEstimator}
                  className={BTN_PRIMARY}
                  disabled={measure.squares <= 0}
                  title={measure.squares <= 0 ? 'Draw a polygon to enable' : 'Send items to Estimator'}
                >
                  Use in Estimator
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 min-h-[60vh]">
              <div className="col-span-12 lg:col-span-9">
                <div className="flex gap-2 mb-2">
                  <input
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
                    placeholder="Search address…"
                    className="flex-1 bg-black/30 border border-white/10 rounded-none px-2 py-2 text-sm"
                  />
                  <button
                    onClick={lookup}
                    className={BTN_PRIMARY}
                    disabled={searching || !addr.trim()}
                    title={!addr.trim() ? 'Enter an address' : 'Search'}
                  >
                    {searching ? 'Finding…' : 'Find'}
                  </button>
                  <button
                    onClick={clearDrawing}
                    className="px-3 py-1.5 text-sm rounded-none border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-60"
                    title="Clear drawing"
                  >
                    Clear
                  </button>
                </div>
                <div ref={mapRef} className="w-full h-[60vh] rounded-none border border-white/10" />
              </div>

              <div className="col-span-12 lg:col-span-3 border border-white/10 rounded-none p-2 bg-white/5 space-y-2">
                <div className="text-sm font-semibold">Measurement</div>
                <div className="text-sm">Plan area: {Math.round(measure.planSqft)} ft²</div>
                <div className="text-sm">Pitch factor: {measure.pitchFactor.toFixed(3)}</div>
                <div className="text-sm">Roof surface: {Math.round(measure.roofSqft)} ft²</div>
                <div className="text-sm">Squares: {measure.squares.toFixed(2)}</div>
                <div className="text-sm">Perimeter: {Math.round(measure.perimeterFt)} ft</div>
                <div className="h-px bg-white/10 my-2" />
                <div className="text-sm font-semibold">Quick Estimate</div>
                <div className="text-sm">Subtotal seed: {toCurrency(summary.subtotal)}</div>
                <div className="text-xs opacity-70">Adjust details in Estimator after sending.</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}