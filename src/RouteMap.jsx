import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { hasCoords, osrmRoute, googleDirectionsLegs, routeShareText, whatsappUrl } from './geo.js'

const numberIcon = (n, color) =>
  L.divIcon({
    className: 'stop-marker',
    html: `<div class="stop-pin" style="background:${color}">${n}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

export default function RouteMap({ vehicle, boy, route, depot, startTime, onClose, onLegs }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const [status, setStatus] = useState('')
  const [road, setRoad] = useState(null)

  const located = route.stops.filter(hasCoords)
  const missing = route.stops.filter((s) => !hasCoords(s))
  const start = hasCoords(depot) ? depot : null
  const points = [...(start ? [start] : []), ...located]

  // Build the map once, refresh layers when stops change.
  useEffect(() => {
    if (!mapEl.current) return
    if (!mapRef.current) {
      mapRef.current = L.map(mapEl.current, { zoomControl: true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(mapRef.current)
    }
    const map = mapRef.current
    const layer = L.layerGroup().addTo(map)

    if (start) {
      L.marker([start.lat, start.lng], { icon: numberIcon('S', '#3FB68B') })
        .bindPopup(`<b>Start</b><br>${start.address || ''}`)
        .addTo(layer)
    }
    located.forEach((s, i) => {
      const idx = route.stops.indexOf(s) + 1
      L.marker([s.lat, s.lng], { icon: numberIcon(idx, '#F2A93B') })
        .bindPopup(`<b>${idx}. ${s.name || s.address}</b><br>${s.name ? s.address + '<br>' : ''}${s.arrival} → ${s.departure}`)
        .addTo(layer)
    })

    if (points.length >= 2) {
      const line = road?.geometry || points.map((p) => [p.lat, p.lng])
      L.polyline(line, { color: '#F2A93B', weight: 4, opacity: 0.85, dashArray: road ? null : '6 8' }).addTo(layer)
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40] })
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14)
    } else {
      map.setView([12.9716, 77.5946], 11)
    }
    setTimeout(() => map.invalidateSize(), 50)
    return () => { layer.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.stops, depot, road])

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null }, [])

  // Ask OSRM for the road route through the points in order.
  const pointsKey = points.map((p) => `${p.lat},${p.lng}`).join(';')
  useEffect(() => {
    let cancelled = false
    setRoad(null)
    if (points.length < 2) { setStatus(''); return }
    setStatus('Fetching road route…')
    osrmRoute(points)
      .then((r) => {
        if (cancelled) return
        setRoad(r)
        setStatus(`${r.km.toFixed(1)} km by road · about ${Math.round(r.min)} min driving`)
        onLegs?.(r.legs)
      })
      .catch((e) => { if (!cancelled) setStatus(`Road route unavailable (${e.message}). Showing straight lines.`) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey])

  const legs = googleDirectionsLegs(start, route.stops)
  const shareText = routeShareText({ title: vehicle.type, person: boy?.name, startTime, start, stops: route.stops, legs })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-map" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{vehicle.type}{boy ? ` · ${boy.name}` : ''}</h2>
            <p className="hint" style={{ margin: 0 }}>{route.stops.length} stops · finish {route.finishTime}{status ? ` · ${status}` : ''}</p>
          </div>
          <div className="row" style={{ marginTop: 0 }}>
            {legs.map((l) => <a key={l.url} className="btn-outline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}
            {route.stops.length > 0 && <a className="btn-accent" href={whatsappUrl(shareText)} target="_blank" rel="noreferrer">Send on WhatsApp</a>}
            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        {!start && <p className="hint warn">No start point set. Add the shop address under "Start point" so the route begins from there.</p>}
        {missing.length > 0 && (
          <p className="hint warn">{missing.length} stop{missing.length > 1 ? 's' : ''} not on the map yet: {missing.map((s) => s.name || s.address).join(', ')}. Use "Locate" on those drops.</p>
        )}
        <div ref={mapEl} className="map-canvas" />
        <ol className="map-legend">
          {route.stops.map((s, i) => (
            <li key={s.id}>
              <span className="stop-pin small" style={{ background: hasCoords(s) ? '#F2A93B' : '#556' }}>{i + 1}</span>
              <span>{s.arrival} · {s.name || s.address}{s.name && s.address ? ` · ${s.address}` : ''}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
