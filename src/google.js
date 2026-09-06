// Google Maps Platform through its HTTP endpoints (no JS SDK download).
// Active only when VITE_GOOGLE_MAPS_KEY is set. The key must be restricted to
// this site's domain in Google Cloud, so it is safe to ship in the page.

export const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''
export const googleEnabled = !!GOOGLE_KEY

const bias = (near, km = 40) => (near ? { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: km * 1000 } } : undefined)

async function post(url, body, fieldMask) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Google request failed (${res.status})`)
  return data
}

// Suggestions as you type: [{ placeId, text, secondary }]
export async function googleAutocomplete(input, near) {
  if (!input.trim()) return []
  const data = await post('https://places.googleapis.com/v1/places:autocomplete', {
    input, includedRegionCodes: ['in'], locationBias: bias(near, 50),
  })
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({ placeId: p.placeId, text: p.structuredFormat?.mainText?.text || p.text?.text || '', secondary: p.structuredFormat?.secondaryText?.text || '' }))
}

export async function googlePlaceDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'location,displayName,formattedAddress' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Google request failed (${res.status})`)
  return { lat: data.location.latitude, lng: data.location.longitude, label: [data.displayName?.text, data.formattedAddress].filter(Boolean).join(', ') }
}

// Free-text search for a shop or place name.
export async function googleTextSearch(q, near) {
  const data = await post('https://places.googleapis.com/v1/places:searchText', {
    textQuery: q, regionCode: 'IN', locationBias: bias(near, 50), pageSize: 1,
  }, 'places.location,places.displayName,places.formattedAddress')
  const p = data.places?.[0]
  if (!p) return null
  return { lat: p.location.latitude, lng: p.location.longitude, label: [p.displayName?.text, p.formattedAddress].filter(Boolean).join(', ') }
}

// Street address to a point.
export async function googleGeocode(address, near) {
  let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=in&key=${GOOGLE_KEY}`
  if (near) url += `&bounds=${near.lat - 0.4},${near.lng - 0.4}|${near.lat + 0.4},${near.lng + 0.4}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status === 'ZERO_RESULTS') return null
  if (data.status !== 'OK') throw new Error(data.error_message || `Geocoding failed (${data.status})`)
  const r = data.results[0]
  if (['APPROXIMATE'].includes(r.geometry.location_type) && r.types?.includes('locality')) return null // just the city: not useful
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, label: r.formatted_address }
}

// Google's encoded polyline -> [[lat, lng], ...]
function decodePolyline(str) {
  const out = []
  let index = 0, lat = 0, lng = 0
  while (index < str.length) {
    let b, shift = 0, result = 0
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

// Road route through the points in order (Routes API, traffic-unaware to stay
// in the cheapest tier). Same shape as osrmRoute().
export async function googleRoute(points, legKey) {
  if (points.length < 2) return null
  const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })
  const data = await post('https://routes.googleapis.com/directions/v2:computeRoutes', {
    origin: wp(points[0]),
    destination: wp(points[points.length - 1]),
    intermediates: points.slice(1, -1).map(wp),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    regionCode: 'IN',
  }, 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration')
  const r = data.routes?.[0]
  if (!r) throw new Error('No road route found')
  const secs = (d) => parseFloat(String(d || '0s').replace('s', ''))
  return {
    geometry: decodePolyline(r.polyline?.encodedPolyline || ''),
    legs: r.legs.map((l, i) => ({ key: legKey(points[i], points[i + 1]), km: l.distanceMeters / 1000, min: secs(l.duration) / 60 })),
    km: r.distanceMeters / 1000,
    min: secs(r.duration) / 60,
  }
}
