// src/pages/Vehicles.jsx
import VehiclesPanel from '../components/VehiclesPanel.jsx'

export default function VehiclesPage() {
  return (
    <div className="glass rounded-none p-3">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-sm font-semibold">Vehicles</h1>
      </div>
      <VehiclesPanel />
    </div>
  )
}