import { MapContainer, TileLayer, Circle, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
const jobs = [
  { id:'J-158', value:35000, pos:[33.455,-112.05], margin:0.32 },
  { id:'J-221', value:2200,  pos:[33.442,-112.08], margin:0.18 },
  { id:'J-412', value:18000, pos:[33.436,-112.06], margin:0.28 }
]
function color(m){ if(m===0) return '#7e7e7e'; if(m<0.15) return '#ff3b3b'; if(m<0.25) return '#ffab40'; return '#00e676' }
export default function MapPanel({compact}){
  return (
    <div className={"relative " + (compact ? "h-[66vh]" : "h-[70vh]")}>
      <MapContainer center={[33.45,-112.07]} zoom={12} className="h-full w-full">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        {jobs.map(j => (
          <Circle key={j.id} center={j.pos} radius={80} pathOptions={{ color: color(j.margin), fillColor: color(j.margin), fillOpacity: 0.25 }}>
            <Tooltip permanent direction="top"><div style={{fontSize:12,fontWeight:600}}>${j.value.toLocaleString()}</div></Tooltip>
          </Circle>
        ))}
      </MapContainer>
    </div>
  )
}
