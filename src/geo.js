// Free geodata helpers: Nominatim (OpenStreetMap) for address lookup,
// OSRM public demo server for road routes. Both are free, no API key,
// but rate-limited — lookups are run one at a time with a pause.

export const hasCoords = (d) =>
  d && typeof d.lat === 'number' && typeof d.lng === 'number' && !isNaN(d.lat) && !isNaN(d.lng)

export async function geocode(address, city) {
  const a = (address || '').trim()
  if (!a) return null
  const q = city && !a.toLowerCase().includes(city.toLowerCase()) ? `${a}, ${city}` : a
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`)
  const data = await res.json()
  if (!data.length) return null
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const legKey = (a, b) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`

// Road route through the given points, in order. Returns the polyline
// (as [lat, lng] pairs) and per-leg distance/time.
export async function osrmRoute(points) {
  if (points.length < 2) return null
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Routing failed (${res.status})`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No road route found')
  const r = data.routes[0]
  return {
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    legs: r.legs.map((l, i) => ({ key: legKey(points[i], points[i + 1]), km: l.distance / 1000, min: l.duration / 60 })),
    km: r.distance / 1000,
    min: r.duration / 60,
  }
}

const pointText = (p) => (hasCoords(p) ? `${p.lat},${p.lng}` : p.address || p.name || '')

// Google Maps turn-by-turn link the delivery boy can open on his phone.
export function googleDirectionsUrl(start, stops) {
  const pts = [start, ...stops].filter((p) => p && pointText(p))
  if (pts.length < 2) return null
  const origin = pointText(pts[0])
  const destination = pointText(pts[pts.length - 1])
  const waypoints = pts.slice(1, -1).map(pointText).join('|')
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`
  return url
}

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`
