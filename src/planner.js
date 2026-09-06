// Turns today's located stops into routes automatically.
//
// 1. Stops that must travel together (same client's gates, a pickup and its
//    delivery) are bound into units.
// 2. A first grouping sweeps around the loading point by bearing.
// 3. An improvement pass moves and swaps units between routes while the
//    total time (and the longest route) keeps dropping. Urgent stops that
//    would arrive late are heavily penalised, so they get spread out.
// 4. Inside each route: urgent stops first, nearest-first, then untangled
//    with 2-opt. A delivery never comes before its pickup.
// 5. Boys take as many routes as there are boys; any further routes go to
//    hired autos (unlimited). Porter-only drops are planned separately.

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

function addMinutes(timeStr, minsToAdd) {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + Math.round(minsToAdd)
  return `${String(Math.floor((total / 60) % 24)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ---------- ordering inside one route ----------

// Pickups before their deliveries; urgent stops first; collect-only stops
// (cheques, returns) after all the deliveries.
function precedenceOk(order) {
  const seen = new Set()
  let sawNormal = false
  let sawCollect = false
  for (const s of order) {
    if (s.after && !seen.has(s.after)) return false
    if (s.urgent && sawNormal) return false
    if (!s.urgent) sawNormal = true
    if (s.collect) sawCollect = true
    else if (sawCollect) return false
    seen.add(s.id)
  }
  return true
}

function routeMinutes(order, start, avgSpeed, legCache) {
  let min = 0
  let prev = start
  for (const s of order) {
    if (prev) min += legMinutes(prev, s, avgSpeed, legCache).min
    prev = s
  }
  if (start && order.length) min += legMinutes(order[order.length - 1], start, avgSpeed, legCache).min
  return min
}

function nearestNeighborOrder(stops, start, avgSpeed, legCache) {
  if (stops.length <= 1) return [...stops]
  const remaining = [...stops]
  const route = []
  const visited = new Set()
  while (remaining.length) {
    const last = route.length ? route[route.length - 1] : start
    const eligible = remaining.filter((s) => !s.after || visited.has(s.after))
    let pool = eligible
    if (pool.some((s) => s.urgent)) pool = pool.filter((s) => s.urgent)
    else if (pool.some((s) => !s.collect)) pool = pool.filter((s) => !s.collect)
    let best = pool[0] || remaining[0]
    let bestCost = Infinity
    pool.forEach((s, i) => {
      let cost = last ? legMinutes(last, s, avgSpeed, legCache).min : i
      if (last && last.clientId && last.clientId === s.clientId) cost -= 5 // same client, another gate
      if (cost < bestCost) { bestCost = cost; best = s }
    })
    remaining.splice(remaining.indexOf(best), 1)
    route.push(best)
    visited.add(best.id)
  }
  return route
}

function twoOpt(order, start, avgSpeed, legCache) {
  if (order.length < 4) return order
  let best = order
  let bestMin = routeMinutes(best, start, avgSpeed, legCache)
  let improved = true
  let guard = 0
  while (improved && guard++ < 50) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)]
        if (!precedenceOk(cand)) continue
        const m = routeMinutes(cand, start, avgSpeed, legCache)
        if (m + 0.01 < bestMin) { best = cand; bestMin = m; improved = true }
      }
    }
  }
  return best
}

// Order the stops of one route and work out its timeline.
// urgentMin: minutes after the day start by which an urgent stop must be reached.
export function buildRoute(stops, { start, avgSpeed, startTime, legCache, manualOrder, urgentMin }) {
  const located = stops.every(hasCoords)
  let ordered = [...stops]
  if (located && !manualOrder) {
    ordered = nearestNeighborOrder(stops, start, avgSpeed, legCache)
    ordered = twoOpt(ordered, start, avgSpeed, legCache)
  }
  let clock = startTime
  let elapsed = 0
  let totalKm = 0
  let travelMin = 0
  let workMin = 0
  let late = 0
  const out = ordered.map((d, i) => {
    const prev = i > 0 ? ordered[i - 1] : start
    let leg = { km: 0, min: 0 }
    if (located && prev) leg = legMinutes(prev, d, avgSpeed, legCache)
    clock = addMinutes(clock, leg.min)
    elapsed += leg.min
    const arrival = clock
    const isLate = !!d.urgent && urgentMin != null && elapsed > urgentMin
    if (isLate) late++
    clock = addMinutes(clock, d.workMinutes || 0)
    elapsed += d.workMinutes || 0
    totalKm += leg.km
    travelMin += leg.min
    workMin += d.workMinutes || 0
    return { ...d, arrival, departure: clock, travelKm: leg.km, travelMin: leg.min, late: isLate }
  })
  let backMin = 0
  let backKm = 0
  if (located && start && ordered.length) {
    const back = legMinutes(ordered[ordered.length - 1], start, avgSpeed, legCache)
    backMin = back.min
    backKm = back.km
  }
  return {
    stops: out, located, totalKm: totalKm + backKm, travelMin: travelMin + backMin, workMin, late,
    totalMin: travelMin + workMin + backMin, finishTime: clock, backTime: addMinutes(clock, backMin), hasStart: !!start,
  }
}

// ---------- grouping into routes ----------

function bearing(center, p) {
  return Math.atan2(p.lng - center.lng, p.lat - center.lat)
}

function centroid(points) {
  const n = points.length || 1
  return { lat: points.reduce((s, p) => s + p.lat, 0) / n, lng: points.reduce((s, p) => s + p.lng, 0) / n }
}

function fits(route, limits) {
  return route.stops.length <= limits.maxStops && route.totalMin <= limits.maxHours * 60
}

// Stops at one client, and a pickup with its delivery, travel as one unit.
function makeUnits(stops) {
  const parent = new Map()
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x }
  const union = (a, b) => { parent.set(find(a), find(b)) }
  stops.forEach((s) => parent.set(s.id, s.id))
  const byClient = new Map()
  const byJob = new Map()
  stops.forEach((s) => {
    if (s.clientId) { if (byClient.has(s.clientId)) union(s.id, byClient.get(s.clientId)); else byClient.set(s.clientId, s.id) }
    if (s.jobId) { if (byJob.has(s.jobId)) union(s.id, byJob.get(s.jobId)); else byJob.set(s.jobId, s.id) }
  })
  const groups = new Map()
  stops.forEach((s) => { const r = find(s.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s) })
  return [...groups.values()]
}

function sweepUnits(units, offset, opts, limits) {
  const routes = []
  let current = []
  for (let k = 0; k < units.length; k++) {
    const u = units[(offset + k) % units.length]
    const trial = buildRoute([...current.flat(), ...u], opts)
    if (current.length && (!fits(trial, limits) || trial.late > 0)) { routes.push(current); current = [u] }
    else current.push(u)
  }
  if (current.length) routes.push(current)
  return routes
}

function chunkUnits(units, offset, count) {
  const n = units.length
  const groups = []
  for (let g = 0; g < count; g++) {
    const from = Math.round((g * n) / count)
    const to = Math.round(((g + 1) * n) / count)
    const grp = []
    for (let k = from; k < to; k++) grp.push(units[(offset + k) % n])
    if (grp.length) groups.push(grp)
  }
  return groups
}

// Lower is better: total time, a share of the longest route (fairness),
// heavy penalties for breaking limits (when strict) and for late urgent stops.
function score(groups, opts, limits, strict) {
  const routes = groups.map((g) => buildRoute(g.flat(), opts))
  const total = routes.reduce((s, r) => s + r.totalMin, 0)
  const longest = routes.reduce((m, r) => Math.max(m, r.totalMin), 0)
  const broken = strict ? routes.filter((r) => !fits(r, limits)).length : 0
  const late = routes.reduce((s, r) => s + r.late, 0)
  const fairness = strict ? 0.5 : 10
  return total + fairness * longest + broken * 10000 + late * 5000
}

function improve(groups, opts, limits, strict) {
  let best = groups.map((g) => [...g])
  let bestScore = score(best, opts, limits, strict)
  let improved = true
  let guard = 0
  while (improved && guard++ < 400) {
    improved = false
    for (let a = 0; a < best.length && !improved; a++) {
      for (let i = 0; i < best[a].length && !improved; i++) {
        for (let b = 0; b < best.length && !improved; b++) {
          if (a === b || best[a].length === 1) continue
          const cand = best.map((g) => [...g])
          const [u] = cand[a].splice(i, 1)
          cand[b].push(u)
          const sc = score(cand, opts, limits, strict)
          if (sc + 0.01 < bestScore) { best = cand; bestScore = sc; improved = true }
        }
        for (let b = a + 1; b < best.length && !improved; b++) {
          for (let j = 0; j < best[b].length && !improved; j++) {
            const cand = best.map((g) => [...g])
            const ua = cand[a][i]
            cand[a][i] = cand[b][j]
            cand[b][j] = ua
            const sc = score(cand, opts, limits, strict)
            if (sc + 0.01 < bestScore) { best = cand; bestScore = sc; improved = true }
          }
        }
      }
    }
  }
  return best
}

function bestSweep(stops, start, opts, limits, forceCount) {
  if (!stops.length) return []
  const center = start || centroid(stops)
  const units = makeUnits(stops).sort((a, b) => bearing(center, a[0]) - bearing(center, b[0]))
  const tries = Math.min(units.length, 40)
  let best = null
  for (let o = 0; o < tries; o++) {
    const offset = Math.round((o * units.length) / tries)
    const groups = forceCount ? chunkUnits(units, offset, Math.min(forceCount, units.length)) : sweepUnits(units, offset, opts, limits)
    const sc = score(groups, opts, limits, !forceCount)
    if (!best || groups.length < best.groups.length || (groups.length === best.groups.length && sc < best.sc)) best = { groups, sc }
  }
  return improve(best.groups, opts, limits, !forceCount).map((g) => g.flat())
}

// stops: today's stops with lat/lng folded in.
// people: how many delivery boys. Routes beyond that are marked hired (autos).
// useAll: spread over all the boys even when fewer would do.
// urgentHours: an urgent stop must be reached within this many hours of the start.
// A stop with `pin` = route number is kept in that route regardless.
export function planRoutes(stops, { depot, avgSpeed, startTime, legCache, maxStops, maxHours, people, useAll, urgentHours }) {
  const located = stops.filter(hasCoords)
  const unlocated = stops.filter((d) => !hasCoords(d))
  const start = hasCoords(depot) ? depot : null
  const opts = { start, avgSpeed, startTime, legCache, urgentMin: urgentHours ? urgentHours * 60 : null }
  const limits = { maxStops: Math.max(1, maxStops || 8), maxHours: Math.max(0.5, maxHours || 4) }

  const isPinned = (d) => Number.isInteger(d.pin) && d.pin >= 1
  const pinned = located.filter(isPinned)
  const free = located.filter((d) => !isPinned(d))

  let groups = bestSweep(free, start, opts, limits)
  const needed = groups.length
  const unitCount = makeUnits(free).length
  if (people && useAll && needed < people && unitCount >= people) {
    groups = bestSweep(free, start, opts, limits, people)
  }

  pinned.forEach((d) => {
    while (groups.length < d.pin) groups.push([])
    groups[d.pin - 1].push(d)
  })

  let routes = groups
    .map((g) => buildRoute(g, opts))
    .filter((r) => r.stops.length > 0)

  // Boys take the routes; the longest extra ones go to hired autos.
  if (people != null && people >= 0 && routes.length > people) {
    const byLength = [...routes].sort((a, b) => a.totalMin - b.totalMin)
    const hiredSet = new Set(byLength.slice(people))
    routes = [...routes.filter((r) => !hiredSet.has(r)), ...routes.filter((r) => hiredSet.has(r)).map((r) => ({ ...r, hired: true }))]
  }
  routes = routes.map((r, i) => ({ ...r, number: i + 1, overLimit: !fits(r, limits) }))

  return { routes, unlocated, limits, needed, hired: routes.filter((r) => r.hired).length, late: routes.reduce((s, r) => s + r.late, 0) }
}
