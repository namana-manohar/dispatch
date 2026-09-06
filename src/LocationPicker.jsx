import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geocode, currentPosition, hasCoords } from './geo.js'

const pinIcon = L.divIcon({ className: 'stop-marker', html: '<div class="stop-pin" style="background:#F2A93B">●</div>', iconSize: [28, 28], iconAnchor: [14, 14] })

// Pick a point like in a maps app: search a name or address, use the phone's
// location, or drag the pin to the exact spot. Calls onPick({lat, lng, address}).
export default function LocationPicker({ title, initial, city, onPick, onClose }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [query, setQuery] = useState(initial?.address || '')
  const [point, setPoint] = useState(hasCoords(initial) ? { lat: initial.lat, lng: initial.lng } : null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const place = (p, zoom) => {
    setPoint(p)
    const map = mapRef.current
    if (!map) return
    if (!markerRef.current) {
      markerRef.current = L.marker([p.lat, p.lng], { icon: pinIcon, draggable: true }).addTo(map)
      markerRef.current.on('dragend', () => { const ll = markerRef.current.getLatLng(); setPoint({ lat: ll.lat, lng: ll.lng }) })
    } else {
      markerRef.current.setLatLng([p.lat, p.lng])
    }
    map.setView([p.lat, p.lng], zoom || Math.max(map.getZoom(), 16))
  }

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    map.on('click', (e) => place({ lat: e.latlng.lat, lng: e.latlng.lng }))
    mapRef.current = map
    if (point) place(point, 16)
    else {
      map.setView([12.9716, 77.5946], 11)
      geocode(city || 'Bengaluru').then((c) => { if (c && !markerRef.current) map.setView([c.lat, c.lng], 12) }).catch(() => {})
    }
    setTimeout(() => map.invalidateSize(), 50)
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async () => {
    if (!query.trim()) return
    setBusy(true)
    setMsg('Searching…')
    try {
      const hit = await geocode(query, city)
      if (hit) { place(hit, 17); setMsg(`Found: ${hit.label || query}. Drag the pin if it is not exact.`) }
      else setMsg('Not found. Tap the spot on the map, or use your location while standing there.')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const useMine = async () => {
    setBusy(true)
    setMsg('Getting your location…')
    try {
      const p = await currentPosition()
      place(p, 17)
      setMsg(`Your location (about ${Math.round(p.accuracy)} m accuracy). Drag the pin if needed.`)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-map" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title || 'Pick the spot on the map'}</h2>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="row">
          <input placeholder="Shop name, area or address… or paste a Google Maps link" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button className="btn-outline" onClick={search} disabled={busy || !query.trim()}>Search</button>
          <button className="btn-outline" onClick={useMine} disabled={busy} title="Use this phone's GPS">Use my location</button>
        </div>
        <p className="hint">{msg || 'Search, or tap the exact spot on the map. You can drag the pin.'}</p>
        <div ref={mapEl} className="map-canvas" />
        <div className="row">
          <button className="btn-accent" disabled={!point} onClick={() => onPick({ ...point, address: query.trim() })}>
            {point ? `Save this spot${query.trim() ? ` as "${query.trim()}"` : ''}` : 'Place the pin first'}
          </button>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
