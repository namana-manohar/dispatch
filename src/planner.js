// Turns today's located drops into routes automatically.
// Method: sweep around the shop (sort by bearing), fill a route until it
// hits the stop or time limit, then start the next. Every sweep start is
// tried and the plan with the fewest routes (then least time) wins.

import { legKey } from './geo.js'

export function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const hasCoords = (d) => !!d && typeof d.lat === 'number' && typeof d.lng === 'number' && !isNaN(d.lat) && !isNaN(d.lng)

function legMinutes(a, b, avgSpeed, legCache) {
  const leg = legCache?.[legKey(a, b)]
  if (leg) return { km: leg.km, min: leg.min }
  const km = haversineKm(a, b)
  return { km, min: (km / avgSpeed) * 60 }
}

function nearestNeighborOrder(drops, start) {
  if (drops.length <= 1) return [...drops]
  const remaining = [...drops]
  const route = []
  if (!start) route.push(remaining.shift())
  while (remaining.length) {
    const last = route.length ? route[route.length - 1] : start
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((d, i) => {
      // same client, another gate: keep together
      const dist = haversineKm(last, d) + (last.clientId && last.clientId === d.clientId ? -1 : 0)
      if (dist < bestDist) { bestDist = dist; bestIdx = i }
    })
    route.push(remaining.splice(bestIdx, 1)[0])
  }
  return route
}

function addMinutes(timeStr, minsToAdd) {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + Math.round(minsToAdd)
  return `${String(Math.floor((total / 60) % 24)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// Order the stops of one route and work out its timeline.
export function buildRoute(drops, { start, avgSpeed, startTime, legCache, manualOrder }) {
  const located = drops.every(hasCoords)
  const ordered = located && !manualOrder ? nearestNeighborOrder(drops, start) : [...drops]
  let clock = startTime
  let totalKm = 0
  let travelMin = 0
  let workMin = 0
  const stops = ordered.map((d, i) => {
    const prev = i > 0 ? ordered[i - 1] : start
    let leg = { km: 0, min: 0 }
    if (located && prev) leg = legMinutes(prev, d, avgSpeed, legCache)
    clock = addMinutes(clock, leg.min)
    const arrival = clock
    clock = addMinutes(clock, d.workMinutes || 0)
    totalKm += leg.km
    travelMin += leg.min
    workMin += d.workMinutes || 0
    return { ...d, arrival, departure: clock, travelKm: leg.km, travelMin: leg.min }
  })
  let backMin = 0
  let backKm = 0
  if (located && start && ordered.length) {
    const back = legMinutes(ordered[ordered.length - 1], start, avgSpeed, legCache)
    backMin = back.min
    backKm = back.km
  }
  const finishTime = clock
  const backTime = addMinutes(clock, backMin)
  return {
    stops, located, totalKm: totalKm + backKm, travelMin: travelMin + backMin, workMin,
    totalMin: travelMin + workMin + backMin, finishTime, backTime, hasStart: !!start,
  }
}

function bearing(center, p) {
  return Math.atan2(p.lng - center.lng, p.lat - center.lat)
}

function centroid(points) {
  const n = points.length || 1
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  }
}

function fits(route, limits) {
  return route.stops.length <= limits.maxStops && route.totalMin <= limits.maxHours * 60
}

function sweepPlan(drops, offset, opts, limits) {
  const routes = []
  let current = []
  for (let k = 0; k < drops.length; k++) {
    const d = drops[(offset + k) % drops.length]
    const trial = buildRoute([...current, d], opts)
    if (current.length && !fits(trial, limits)) {
      routes.push(current)
      current = [d]
    } else {
      current.push(d)
    }
  }
  if (current.length) routes.push(current)
  return routes
}

// drops: today's drops with lat/lng folded in. Returns { routes, unlocated }.
// A drop with `pin` = route number is kept in that route regardless.
export function planRoutes(drops, { depot, avgSpeed, startTime, legCache, maxStops, maxHours }) {
  const located = drops.filter(hasCoords)
  const unlocated = drops.filter((d) => !hasCoords(d))
  const start = hasCoords(depot) ? depot : null
  const opts = { start, avgSpeed, startTime, legCache }
  const limits = { maxStops: Math.max(1, maxStops || 8), maxHours: Math.max(0.5, maxHours || 4) }

  const pinned = located.filter((d) => Number.isInteger(d.pin) && d.pin >= 1)
  const free = located.filter((d) => !(Number.isInteger(d.pin) && d.pin >= 1))

  let best = null
  if (free.length) {
    const center = start || centroid(free)
    const sorted = [...free].sort((a, b) => bearing(center, a) - bearing(center, b))
    const tries = Math.min(sorted.length, 40)
    for (let o = 0; o < tries; o++) {
      const offset = Math.round((o * sorted.length) / tries)
      const groups = sweepPlan(sorted, offset, opts, limits)
      const totalMin = groups.reduce((s, g) => s + buildRoute(g, opts).totalMin, 0)
      if (!best || groups.length < best.groups.length || (groups.length === best.groups.length && totalMin < best.totalMin)) {
        best = { groups, totalMin }
      }
    }
  }
  const groups = best ? best.groups : []

  // Pinned drops go to their route number, creating routes if needed.
  pinned.forEach((d) => {
    while (groups.length < d.pin) groups.push([])
    groups[d.pin - 1].push(d)
  })

  const routes = groups
    .map((g, i) => ({ number: i + 1, ...buildRoute(g, opts) }))
    .filter((r) => r.stops.length > 0)
    .map((r, i) => ({ ...r, number: i + 1 }))

  return { routes, unlocated, limits }
}
