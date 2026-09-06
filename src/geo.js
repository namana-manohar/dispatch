// Free geodata helpers: Nominatim (OpenStreetMap) for address lookup,
// OSRM public demo server for road routes. Both are free, no API key,
// but rate-limited — lookups are run one at a time with a pause.

import { googleEnabled, googleGeocode, googleTextSearch, googleRoute } from './google.js'

export const hasCoords = (d) =>
  d && typeof d.lat === 'number' && typeof d.lng === 'number' && !isNaN(d.lat) && !isNaN(d.lng)

// Coordinates pasted as "12.93, 77.58" or inside a Google Maps link
// (…/@12.93,77.58,17z, ?q=12.93,77.58, …!3d12.93!4d77.58).
export function parseCoords(text) {
  const t = (text || '').trim()
  let m = t.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
  if (!m) m = t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/)
  if (!m) m = t.match(/[?&](?:q|query|ll|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  if (!m) m = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/)
  if (!m) return null
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
}

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': 'en', ...(typeof window === 'undefined' ? { 'User-Agent': 'dispatch-planner/1.0' } : {}) } })
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`)
  const data = await res.json()
  if (!data.length) return null
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name }
}

// Photon (komoot) is better at partial names and shop names; biased to a point.
async function photon(q, near) {
  let url = `https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(q)}`
  if (near) url += `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.6`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const f = data.features?.[0]
  if (!f) return null
  const p = f.properties || {}
  const label = [p.name, p.street, p.district, p.city, p.state].filter(Boolean).join(', ')
  // Fuzzy matches like "Shree Hanuman Temple Road" for "shree biomed" would
  // pin the wrong spot: every meaningful word of the query must appear.
  const hay = label.toLowerCase()
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
  if (words.length && !words.every((w) => hay.includes(w))) return null
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label }
}

const cityCache = {}
async function cityPoint(city) {
  if (!city) return null
  if (cityCache[city] !== undefined) return cityCache[city]
  try { cityCache[city] = await nominatim(city) } catch { cityCache[city] = null }
  return cityCache[city]
}

// Address or place name -> point. Tries pasted coordinates / Maps links,
// then OpenStreetMap by address, then a name-friendly search near the city.
export async function geocode(address, city) {
  const a = (address || '').trim()
  if (!a) return null
  const direct = parseCoords(a)
  if (direct) return { ...direct, label: a }
  const withCity = city && !a.toLowerCase().includes(city.toLowerCase()) ? `${a}, ${city}` : a
  if (googleEnabled) {
    // Google knows shop names: try the place search first, then the address geocoder.
    const near = await cityPoint(city)
    const place = await googleTextSearch(withCity, near)
    if (place) return place
    return googleGeocode(withCity, near)
  }
  let hit = null
  let firstError = null
  try { hit = await nominatim(withCity) } catch (e) { firstError = e }
  if (hit) return hit
  const near = await cityPoint(city)
  await sleep(firstError ? 0 : 1000)
  try {
    const p = await photon(a, near)
    if (p) return p
  } catch (e) { if (firstError) throw firstError }
  return null
}

// Where this device is right now (the shop, when standing in it).
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device cannot share its location.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === 1 ? 'Location permission was refused. Allow it in the browser and try again.' : 'Could not get the location. Try again or pick on the map.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
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

// Road route: Google when a key is set, else the free OSRM demo server.
export const roadRoute = (points) => (googleEnabled ? googleRoute(points, legKey) : osrmRoute(points))

const pointText = (p) => (hasCoords(p) ? `${p.lat},${p.lng}` : p.address || p.name || '')

function directionsLink(pts) {
  const origin = pointText(pts[0])
  const destination = pointText(pts[pts.length - 1])
  const waypoints = pts.slice(1, -1).map(pointText).join('|')
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`
  return url
}

// Google Maps turn-by-turn links the delivery boy can open on his phone.
// Google allows 9 waypoints per link, so a long route becomes several legs:
// each leg starts where the previous one ended. Returns [{label, url, from, to}].
export function googleDirectionsLegs(start, stops, backToStart = false) {
  const hasStart = !!(start && pointText(start))
  // points: [start?] + stops + [start again?]; stop k sits at index k - 1 + (hasStart ? 1 : 0)
  const pts = [...(hasStart ? [start] : []), ...stops.filter((p) => p && pointText(p)), ...(backToStart && hasStart ? [start] : [])]
  if (pts.length < 2) return []
  const n = stops.length
  const stopNoAt = (idx) => Math.min(Math.max(idx - (hasStart ? 1 : 0) + 1, 1), n)
  const MAX = 11 // origin + 9 waypoints + destination
  const legs = []
  for (let i = 0; i < pts.length - 1; i += MAX - 1) {
    const j = Math.min(i + MAX - 1, pts.length - 1)
    legs.push({ url: directionsLink(pts.slice(i, j + 1)), from: stopNoAt(i === 0 && hasStart ? 1 : i), to: stopNoAt(j) })
  }
  return legs.map((l) => ({ ...l, label: legs.length === 1 ? 'Navigate' : `Navigate stops ${l.from}–${l.to}` }))
}

export const googleDirectionsUrl = (start, stops) => googleDirectionsLegs(start, stops)[0]?.url || null

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

// The message a delivery boy gets: stops in order with times, then the
// navigation link(s). `stops` need arrival, name, address, summary.
export function routeShareText({ title, person, startTime, start, stops, legs }) {
  const lines = [
    `${title}${person ? ' — ' + person : ''} — start ${startTime}${start?.address ? ' from ' + start.address : ''}`,
    ...stops.map((s, i) => `${i + 1}. ${s.arrival} ${s.name || ''}${s.name && s.address ? ' — ' : ''}${s.address || ''}${s.summary ? ' — ' + s.summary : ''}`),
  ]
  if (legs?.length === 1) lines.push(`Navigate: ${legs[0].url}`)
  else if (legs?.length > 1) legs.forEach((l) => lines.push(`${l.label}: ${l.url}`))
  return lines.join('\n')
}
