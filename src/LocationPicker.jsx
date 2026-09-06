import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geocode, currentPosition, hasCoords } from './geo.js'
import { googleEnabled, googleAutocomplete, googlePlaceDetails } from './google.js'


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
  const [suggestions, setSuggestions] = useState([])
  const suggestTimer = useRef(null)
  const cityRef = useRef(null)

  // Google suggestions as you type (only when a Google key is set)
  const onQuery = (value) => {
    setQuery(value)
    if (!googleEnabled) return
    clearTimeout(suggestTimer.current)
    if (value.trim().length < 2) { setSuggestions([]); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const near = point || cityRef.current
        setSuggestions(await googleAutocomplete(value, near))
      } catch (e) { setMsg(e.message) }
    }, 300)
  }
  const chooseSuggestion = async (sug) => {
    setSuggestions([])
    setQuery(sug.text)
    setBusy(true)
    setMsg('Fetching the spot…')
    try {
      const hit = await googlePlaceDetails(sug.placeId)
      place(hit, 17)
      setMsg(`${hit.label}. Move the map if the pin is not exact.`)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  // The pin is fixed in the middle of the map; moving the map moves the pin.
  const [touched, setTouched] = useState(hasCoords(initial))
  const place = (p, zoom) => {
    setPoint(p)
    setTouched(true)
    markerRef.current = true
    const map = mapRef.current
    if (!map) return
    map.setView([p.lat, p.lng], zoom || Math.max(map.getZoom(), 16))
  }

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    map.on('click', (e) => place({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.on('dragstart', () => { setTouched(true); markerRef.current = true })
    map.on('moveend', () => { const c = map.getCenter(); setPoint((prev) => (markerRef.current ? { lat: c.lat, lng: c.lng } : prev)) })
    mapRef.current = map
    if (point) place(point, 16)
    else {
      map.setView([12.9716, 77.5946], 11)
      geocode(city || 'Bengaluru').then((c) => { cityRef.current = c; if (c && !markerRef.current) map.setView([c.lat, c.lng], 12) }).catch(() => {})
    }
    setTimeout(() => map.invalidateSize(), 50)
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const search = async () => {
    if (!query.trim()) return
    setSuggestions([])
    setBusy(true)
    setMsg('Searching…')
    try {
      const hit = await geocode(query, city)
      if (hit) { place(hit, 17); setMsg(`Found: ${hit.label || query}. Move the map if the pin is not exact.`) }
      else setMsg('Not found. Tap the spot on the map, or use your location while standing there.')
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  const useMine = async () => {
    setBusy(true)
    setMsg('Getting your location…')
    try {
      const p = await currentPosition()
      place(p, 17)
      setMsg(`Your location (about ${Math.round(p.accuracy)} m accuracy). Move the map if needed.`)
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-map" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title || 'Pick the spot on the map'}</h2>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
        <div className="row suggest-wrap">
          <input placeholder={googleEnabled ? 'Type the shop name or address…' : 'Shop name, area or address… or paste a Google Maps link'} value={query}
            onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} autoComplete="off" />
          <button className="btn-outline" onClick={search} disabled={busy || !query.trim()}>Search</button>
          <button className="btn-outline" onClick={useMine} disabled={busy} title="Use this phone's GPS">Use my location</button>
          {suggestions.length > 0 && (
            <ul className="suggest-list">
              {suggestions.map((sug) => (
                <li key={sug.placeId} onClick={() => chooseSuggestion(sug)}>
                  <span>{sug.text}</span>
                  {sug.secondary && <small>{sug.secondary}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="hint">{msg || 'Search, or move the map until the pin sits on the exact spot. Pinch or scroll to zoom in.'}</p>
        <div className="map-frame">
          <div ref={mapEl} className="map-canvas" />
          <div className="center-pin" aria-hidden="true"><div className="stop-pin" style={{ background: '#F2A93B' }}>●</div><div className="center-pin-tail" /></div>
        </div>
        <div className="row">
          <button className="btn-accent" disabled={!point || !touched} onClick={() => onPick({ ...point, address: query.trim() })}>
            {point && touched ? `Save this spot${query.trim() ? ` as "${query.trim()}"` : ''}` : 'Move the map to the spot first'}
          </button>
          <button className="btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
