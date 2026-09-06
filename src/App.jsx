import { useState, useEffect, useMemo, useRef } from 'react'
import { parseText, parseFile } from './parseImport.js'

const STORAGE_KEY = 'dispatch-planner-v2'
const OLD_STORAGE_KEY = 'dispatch-planner-v1'

// Space is measured in "standard boxes": a material whose box is twice as big
// as a standard box takes 2 units of space per box.
const MATERIAL_PRESETS = [
  { name: 'Standard box', space: 1 },
  { name: 'Small box', space: 0.5 },
  { name: 'Large box', space: 2 },
]

const VEHICLE_PRESETS = [
  { type: 'TVS iQube', capacity: 15 },
  { type: 'Ather', capacity: 15 },
  { type: 'TVS', capacity: 15 },
]

const uid = () => crypto.randomUUID()

function freshState() {
  const materials = MATERIAL_PRESETS.map((m) => ({ id: uid(), ...m }))
  return {
    boys: [],
    materials,
    vehicles: VEHICLE_PRESETS.map((v) => ({ id: uid(), type: v.type, capacity: v.capacity, assignedBoyId: null })),
    drops: [],
    avgSpeed: 25,
    startTime: '09:00',
  }
}

function migrateV1(old) {
  const base = freshState()
  const standard = base.materials[0]
  return {
    ...base,
    boys: old.boys || [],
    vehicles: (old.vehicles || []).map((v) => ({ id: v.id, type: v.type, capacity: v.capacityBoxes ?? 15, assignedBoyId: v.assignedBoyId ?? null })),
    drops: (old.drops || []).map((d) => ({
      id: d.id, name: d.name || '', address: '', lat: d.lat ?? null, lng: d.lng ?? null,
      workMinutes: d.workMinutes ?? 10, lines: [{ materialId: standard.id, boxes: d.boxes ?? 1 }],
      assignedVehicleId: d.assignedVehicleId ?? null,
    })),
    avgSpeed: old.avgSpeed ?? 25,
    startTime: old.startTime ?? '09:00',
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
    const old = localStorage.getItem(OLD_STORAGE_KEY)
    if (old) return migrateV1(JSON.parse(old))
  } catch (e) {
    console.error('Could not load saved data', e)
  }
  return freshState()
}

function haversineKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const hasCoords = (d) => typeof d.lat === 'number' && typeof d.lng === 'number' && !isNaN(d.lat) && !isNaN(d.lng)

function orderByNearestNeighbor(drops) {
  if (drops.length <= 1) return drops
  const remaining = [...drops]
  const route = [remaining.shift()]
  while (remaining.length) {
    const last = route[route.length - 1]
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((d, i) => {
      const dist = haversineKm(last, d)
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

function computeRoute(vDrops, avgSpeed, startTime) {
  const allHaveCoords = vDrops.every(hasCoords)
  const ordered = allHaveCoords ? orderByNearestNeighbor(vDrops) : vDrops
  let clock = startTime
  let totalTravelKm = 0
  let totalMinutes = 0
  const stops = ordered.map((d, i) => {
    let travelKm = 0
    let travelMin = 0
    if (i > 0 && allHaveCoords) {
      travelKm = haversineKm(ordered[i - 1], d)
      travelMin = (travelKm / avgSpeed) * 60
    }
    clock = addMinutes(clock, travelMin)
    const arrival = clock
    clock = addMinutes(clock, d.workMinutes || 0)
    totalTravelKm += travelKm
    totalMinutes += travelMin + (d.workMinutes || 0)
    return { ...d, arrival, departure: clock, travelMin, travelKm }
  })
  return { stops, allHaveCoords, totalTravelKm, totalMinutes, finishTime: clock }
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function mapsLink(d) {
  const q = hasCoords(d) ? `${d.lat},${d.lng}` : d.address || d.name
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export default function App() {
  const [state, setState] = useState(loadState)
  const [boyName, setBoyName] = useState('')
  const [materialForm, setMaterialForm] = useState({ name: '', space: '1' })
  const [vehicleForm, setVehicleForm] = useState({ type: 'Auto', capacity: '40' })
  const emptyDrop = () => ({ name: '', address: '', lat: '', lng: '', workMinutes: '10', lines: [{ materialId: state.materials[0]?.id || '', boxes: '1' }] })
  const [dropForm, setDropForm] = useState(emptyDrop)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState(null)
  const [importError, setImportError] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const materialById = (id) => state.materials.find((m) => m.id === id)
  const spaceOfLines = (lines) => lines.reduce((sum, l) => sum + (l.boxes || 0) * (materialById(l.materialId)?.space ?? 1), 0)
  const boxesOfLines = (lines) => lines.reduce((sum, l) => sum + (l.boxes || 0), 0)
  const describeLines = (lines) => lines.map((l) => `${l.boxes} × ${materialById(l.materialId)?.name || 'box'}`).join(', ')

  // --- boys
  const addBoy = () => {
    if (!boyName.trim()) return
    setState((s) => ({ ...s, boys: [...s.boys, { id: uid(), name: boyName.trim() }] }))
    setBoyName('')
  }
  const removeBoy = (id) => setState((s) => ({
    ...s,
    boys: s.boys.filter((b) => b.id !== id),
    vehicles: s.vehicles.map((v) => (v.assignedBoyId === id ? { ...v, assignedBoyId: null } : v)),
  }))

  // --- materials
  const addMaterial = () => {
    if (!materialForm.name.trim()) return
    setState((s) => ({ ...s, materials: [...s.materials, { id: uid(), name: materialForm.name.trim(), space: parseFloat(materialForm.space) || 1 }] }))
    setMaterialForm({ name: '', space: '1' })
  }
  const setMaterialSpace = (id, space) => setState((s) => ({
    ...s, materials: s.materials.map((m) => (m.id === id ? { ...m, space: parseFloat(space) || 0 } : m)),
  }))
  const removeMaterial = (id) => setState((s) => {
    if (s.materials.length <= 1) return s
    const fallback = s.materials.find((m) => m.id !== id).id
    return {
      ...s,
      materials: s.materials.filter((m) => m.id !== id),
      drops: s.drops.map((d) => ({ ...d, lines: d.lines.map((l) => (l.materialId === id ? { ...l, materialId: fallback } : l)) })),
    }
  })

  // --- vehicles
  const addVehicle = () => {
    if (!vehicleForm.type.trim()) return
    setState((s) => ({ ...s, vehicles: [...s.vehicles, { id: uid(), type: vehicleForm.type.trim(), capacity: parseFloat(vehicleForm.capacity) || 1, assignedBoyId: null }] }))
    setVehicleForm({ type: 'Porter (booked)', capacity: '100' })
  }
  const removeVehicle = (id) => setState((s) => ({
    ...s,
    vehicles: s.vehicles.filter((v) => v.id !== id),
    drops: s.drops.map((d) => (d.assignedVehicleId === id ? { ...d, assignedVehicleId: null } : d)),
  }))
  const setVehicleBoy = (vehicleId, boyId) => setState((s) => ({
    ...s, vehicles: s.vehicles.map((v) => (v.id === vehicleId ? { ...v, assignedBoyId: boyId || null } : v)),
  }))
  const setVehicleCapacity = (vehicleId, capacity) => setState((s) => ({
    ...s, vehicles: s.vehicles.map((v) => (v.id === vehicleId ? { ...v, capacity: parseFloat(capacity) || 0 } : v)),
  }))

  // --- drops
  const normalizeLines = (lines) => lines
    .map((l) => ({ materialId: l.materialId || state.materials[0]?.id, boxes: parseInt(l.boxes, 10) || 0 }))
    .filter((l) => l.boxes > 0)

  const addDrop = () => {
    if (!dropForm.name.trim() && !dropForm.address.trim()) return
    const lat = parseFloat(dropForm.lat)
    const lng = parseFloat(dropForm.lng)
    const lines = normalizeLines(dropForm.lines)
    setState((s) => ({
      ...s,
      drops: [...s.drops, {
        id: uid(), name: dropForm.name.trim(), address: dropForm.address.trim(),
        lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng,
        workMinutes: parseInt(dropForm.workMinutes, 10) || 0,
        lines: lines.length ? lines : [{ materialId: s.materials[0].id, boxes: 1 }],
        assignedVehicleId: null,
      }],
    }))
    setDropForm(emptyDrop())
  }
  const removeDrop = (id) => setState((s) => ({ ...s, drops: s.drops.filter((d) => d.id !== id) }))
  const assignDrop = (dropId, vehicleId) => setState((s) => ({
    ...s, drops: s.drops.map((d) => (d.id === dropId ? { ...d, assignedVehicleId: vehicleId || null } : d)),
  }))
  const moveDrop = (vehicleId, index, dir) => setState((s) => {
    const vDrops = s.drops.filter((d) => d.assignedVehicleId === vehicleId)
    const otherDrops = s.drops.filter((d) => d.assignedVehicleId !== vehicleId)
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= vDrops.length) return s
    const reordered = [...vDrops]
    ;[reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]]
    return { ...s, drops: [...otherDrops, ...reordered] }
  })
  const clearDrops = () => {
    if (state.drops.length && window.confirm("Remove all of today's drops? Boys, fleet and materials stay.")) {
      setState((s) => ({ ...s, drops: [] }))
    }
  }

  // --- import
  const runImport = async (file) => {
    setImportError('')
    try {
      const rows = file ? await parseFile(file, state.materials) : parseText(importText, state.materials)
      if (!rows.length) { setImportError('No addresses found. Put one drop per line, e.g. "MG Road shop, 5 boxes tiles".'); return }
      setImportRows(rows.map((r) => ({
        key: uid(), include: true, name: r.name || '', address: r.address || '',
        workMinutes: r.workMinutes ?? 10, lat: r.lat, lng: r.lng,
        lines: r.lines.length
          ? r.lines.map((l) => ({ materialId: l.materialId || state.materials[0].id, boxes: l.boxes }))
          : [{ materialId: state.materials[0].id, boxes: 1 }],
      })))
    } catch (e) {
      setImportError(e.message || String(e))
    }
  }
  const updateImportRow = (key, patch) => setImportRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const confirmImport = () => {
    const chosen = importRows.filter((r) => r.include && (r.address || r.name))
    setState((s) => ({
      ...s,
      drops: [...s.drops, ...chosen.map((r) => {
        const lines = normalizeLines(r.lines)
        return {
          id: uid(), name: r.name.trim(), address: r.address.trim(), lat: r.lat, lng: r.lng,
          workMinutes: parseInt(r.workMinutes, 10) || 0,
          lines: lines.length ? lines : [{ materialId: s.materials[0].id, boxes: 1 }],
          assignedVehicleId: null,
        }
      })],
    }))
    setImportRows(null)
    setImportText('')
    setImportOpen(false)
  }

  const routesByVehicle = useMemo(() => {
    const map = {}
    state.vehicles.forEach((v) => {
      map[v.id] = computeRoute(state.drops.filter((d) => d.assignedVehicleId === v.id), state.avgSpeed, state.startTime)
    })
    return map
  }, [state.vehicles, state.drops, state.avgSpeed, state.startTime])

  const unassigned = state.drops.filter((d) => !d.assignedVehicleId)
  const totalBoxes = state.drops.reduce((sum, d) => sum + boxesOfLines(d.lines), 0)
  const totalSpace = state.drops.reduce((sum, d) => sum + spaceOfLines(d.lines), 0)
  const totalCapacity = state.vehicles.reduce((sum, v) => sum + (v.capacity || 0), 0)
  const unassignedSpace = unassigned.reduce((sum, d) => sum + spaceOfLines(d.lines), 0)

  const dropTitle = (d) => d.name || d.address
  const dropSub = (d) => (d.name && d.address ? d.address : null)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">DP</span>
          <div>
            <h1>Dispatch Planner</h1>
            <p>Load vehicles by space, order the route, know when the day ends.</p>
          </div>
        </div>
        <div className="global-settings">
          <Field label="Avg speed (km/h)">
            <input type="number" min="1" value={state.avgSpeed}
              onChange={(e) => setState((s) => ({ ...s, avgSpeed: parseFloat(e.target.value) || 1 }))} />
          </Field>
          <Field label="Day start">
            <input type="time" value={state.startTime}
              onChange={(e) => setState((s) => ({ ...s, startTime: e.target.value }))} />
          </Field>
        </div>
      </header>

      <div className="summary-bar">
        <div><strong>{state.drops.length}</strong><span>drops today</span></div>
        <div><strong>{totalBoxes}</strong><span>boxes</span></div>
        <div><strong>{fmt(totalSpace)}</strong><span>space needed</span></div>
        <div><strong>{fmt(totalCapacity)}</strong><span>fleet space</span></div>
        <div className={unassignedSpace > 0 ? 'warn-stat' : ''}>
          <strong>{fmt(unassignedSpace)}</strong><span>space unassigned</span>
        </div>
        {totalSpace > totalCapacity && (
          <div className="warn-stat"><strong>+{fmt(totalSpace - totalCapacity)}</strong><span>short — add auto / Porter</span></div>
        )}
      </div>

      <div className="layout">
        <aside className="panel">
          <section className="block">
            <h2>Delivery boys</h2>
            <div className="row">
              <input placeholder="Name" value={boyName} onChange={(e) => setBoyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addBoy()} />
              <button className="btn-accent" onClick={addBoy}>Add</button>
            </div>
            <ul className="list">
              {state.boys.map((b) => (
                <li key={b.id}>
                  <span>{b.name}</span>
                  <button className="btn-ghost" onClick={() => removeBoy(b.id)}>Remove</button>
                </li>
              ))}
              {state.boys.length === 0 && <li className="empty">No one added yet.</li>}
            </ul>
          </section>

          <section className="block">
            <h2>Materials &amp; box sizes</h2>
            <div className="row">
              <input placeholder="Material (e.g. Tiles, Cement)" value={materialForm.name}
                onChange={(e) => setMaterialForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addMaterial()} />
              <input type="number" min="0.1" step="0.1" placeholder="Space" className="capacity-input" value={materialForm.space}
                onChange={(e) => setMaterialForm((f) => ({ ...f, space: e.target.value }))} />
              <button className="btn-accent" onClick={addMaterial}>Add</button>
            </div>
            <p className="hint">Space is how much room one box of that material takes, measured in standard boxes. A tile box twice the size of a standard box = 2. Half the size = 0.5.</p>
            <ul className="list">
              {state.materials.map((m) => (
                <li key={m.id} className="vehicle-row">
                  <div className="drop-info">
                    <span>{m.name}</span>
                    <small>space per box</small>
                  </div>
                  <input type="number" min="0" step="0.1" className="capacity-input" value={m.space}
                    onChange={(e) => setMaterialSpace(m.id, e.target.value)} />
                  <button className="btn-ghost" onClick={() => removeMaterial(m.id)} disabled={state.materials.length <= 1}>×</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="block">
            <h2>Fleet</h2>
            <div className="row">
              <input placeholder="Vehicle (e.g. Auto, Porter)" value={vehicleForm.type}
                onChange={(e) => setVehicleForm((f) => ({ ...f, type: e.target.value }))} />
              <input type="number" min="1" placeholder="Space" className="capacity-input" value={vehicleForm.capacity}
                onChange={(e) => setVehicleForm((f) => ({ ...f, capacity: e.target.value }))} />
              <button className="btn-accent" onClick={addVehicle}>Add</button>
            </div>
            <p className="hint">Capacity is in standard boxes. iQube, Ather and TVS are pre-loaded. Add an Auto when you hire one, or a Porter trip when you book one.</p>
            <ul className="list">
              {state.vehicles.map((v) => (
                <li key={v.id} className="vehicle-row">
                  <div className="drop-info">
                    <span>{v.type}</span>
                    <small>fits (std boxes)</small>
                  </div>
                  <input type="number" min="0" className="capacity-input" value={v.capacity}
                    onChange={(e) => setVehicleCapacity(v.id, e.target.value)} />
                  <select value={v.assignedBoyId || ''} onChange={(e) => setVehicleBoy(v.id, e.target.value)}>
                    <option value="">No boy assigned</option>
                    {state.boys.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <button className="btn-ghost" onClick={() => removeVehicle(v.id)}>×</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Drop locations</h2>
              <div className="row" style={{ marginTop: 0 }}>
                <button className="btn-outline" onClick={() => { setImportOpen(true); setImportRows(null); setImportError('') }}>Import list</button>
                {state.drops.length > 0 && <button className="btn-ghost" onClick={clearDrops}>Clear day</button>}
              </div>
            </div>
            <div className="drop-form">
              <input placeholder="Customer / shop name (optional)" value={dropForm.name}
                onChange={(e) => setDropForm((f) => ({ ...f, name: e.target.value }))} />
              <input placeholder="Address" value={dropForm.address} style={{ marginTop: 8 }}
                onChange={(e) => setDropForm((f) => ({ ...f, address: e.target.value }))} />
              {dropForm.lines.map((l, i) => (
                <div className="row" key={i}>
                  <select value={l.materialId} onChange={(e) => setDropForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)) }))}>
                    {state.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min="1" placeholder="Boxes" className="capacity-input" value={l.boxes}
                    onChange={(e) => setDropForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, boxes: e.target.value } : x)) }))} />
                  {dropForm.lines.length > 1 && (
                    <button className="btn-ghost" onClick={() => setDropForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>×</button>
                  )}
                </div>
              ))}
              <button className="btn-link" onClick={() => setDropForm((f) => ({ ...f, lines: [...f.lines, { materialId: state.materials[0]?.id, boxes: '1' }] }))}>+ another material</button>
              <div className="row">
                <input placeholder="Latitude (optional)" value={dropForm.lat}
                  onChange={(e) => setDropForm((f) => ({ ...f, lat: e.target.value }))} />
                <input placeholder="Longitude (optional)" value={dropForm.lng}
                  onChange={(e) => setDropForm((f) => ({ ...f, lng: e.target.value }))} />
                <input type="number" min="0" placeholder="Min" title="Minutes of work at this stop" className="capacity-input" value={dropForm.workMinutes}
                  onChange={(e) => setDropForm((f) => ({ ...f, workMinutes: e.target.value }))} />
              </div>
              <button className="btn-accent" onClick={addDrop}>Add drop</button>
              <p className="hint">Have the day's list in WhatsApp, Excel or Word? Use <b>Import list</b>. One drop per line, like "Sharma tiles, 4th block Jayanagar, 6 boxes tiles, 2 cement".</p>
            </div>

            <ul className="list">
              {unassigned.map((d) => (
                <li key={d.id}>
                  <div className="drop-info">
                    <span>{dropTitle(d)}</span>
                    {dropSub(d) && <small>{dropSub(d)}</small>}
                    <small>{describeLines(d.lines)} · {fmt(spaceOfLines(d.lines))} space · {d.workMinutes}m</small>
                  </div>
                  <div className="row">
                    <select onChange={(e) => assignDrop(d.id, e.target.value)} value="">
                      <option value="" disabled>Load onto…</option>
                      {state.vehicles.map((v) => {
                        const used = spaceOfLines(routesByVehicle[v.id].stops.flatMap((s) => s.lines))
                        return <option key={v.id} value={v.id}>{v.type} ({fmt(v.capacity - used)} free)</option>
                      })}
                    </select>
                    <button className="btn-ghost" onClick={() => removeDrop(d.id)}>×</button>
                  </div>
                </li>
              ))}
              {unassigned.length === 0 && state.drops.length > 0 && <li className="empty">All drops loaded.</li>}
              {state.drops.length === 0 && <li className="empty">No drops added yet.</li>}
            </ul>
          </section>
        </aside>

        <main className="board">
          {state.vehicles.length === 0 && <div className="placeholder">Add a vehicle on the left to start loading drops.</div>}
          {state.vehicles.map((v) => {
            const route = routesByVehicle[v.id]
            const boy = state.boys.find((b) => b.id === v.assignedBoyId)
            const loadedSpace = route.stops.reduce((sum, s) => sum + spaceOfLines(s.lines), 0)
            const loadedBoxes = route.stops.reduce((sum, s) => sum + boxesOfLines(s.lines), 0)
            const overCapacity = loadedSpace > v.capacity
            return (
              <section className={`route-card${overCapacity ? ' over-capacity' : ''}`} key={v.id}>
                <div className="route-head">
                  <div>
                    <h3>{v.type}</h3>
                    <p className="boy-tag">{boy ? boy.name : 'No delivery boy assigned'}</p>
                  </div>
                  <div className="route-stats">
                    <div className={overCapacity ? 'stat-warn' : ''}>
                      <strong>{fmt(loadedSpace)}/{fmt(v.capacity)}</strong><span>space</span>
                    </div>
                    <div><strong>{loadedBoxes}</strong><span>boxes</span></div>
                    <div><strong>{route.stops.length}</strong><span>stops</span></div>
                    <div><strong>{route.totalTravelKm.toFixed(1)}</strong><span>km</span></div>
                    <div><strong>{Math.round(route.totalMinutes)}</strong><span>min</span></div>
                    <div><strong>{route.finishTime}</strong><span>finish</span></div>
                  </div>
                </div>
                {overCapacity && (
                  <p className="hint warn">Over by {fmt(loadedSpace - v.capacity)} standard boxes of space. Move a drop to another vehicle, an auto, or book a Porter trip.</p>
                )}
                {!route.allHaveCoords && route.stops.length > 0 && (
                  <p className="hint">No coordinates on some stops, so this is your manual order and travel time is not counted. Use the arrows to reorder.</p>
                )}
                <ol className="stops">
                  {route.stops.map((s, i) => (
                    <li key={s.id}>
                      <div className="stop-time">
                        <strong>{s.arrival}</strong>
                        <small>→ {s.departure}</small>
                      </div>
                      <div className="stop-info">
                        <span>{dropTitle(s)}</span>
                        {dropSub(s) && <small>{dropSub(s)}</small>}
                        <small>
                          {describeLines(s.lines)} · {fmt(spaceOfLines(s.lines))} space ·{' '}
                          {s.travelMin > 0 && `${s.travelKm.toFixed(1)}km · `}
                          {s.workMinutes}m work
                        </small>
                      </div>
                      <a className="btn-ghost" href={mapsLink(s)} target="_blank" rel="noreferrer" title="Open in Google Maps">Map</a>
                      {!route.allHaveCoords && (
                        <div className="reorder">
                          <button onClick={() => moveDrop(v.id, i, -1)} disabled={i === 0}>↑</button>
                          <button onClick={() => moveDrop(v.id, i, 1)} disabled={i === route.stops.length - 1}>↓</button>
                        </div>
                      )}
                      <button className="btn-ghost" onClick={() => assignDrop(s.id, '')}>Unload</button>
                    </li>
                  ))}
                  {route.stops.length === 0 && <li className="empty">Nothing loaded yet.</li>}
                </ol>
              </section>
            )
          })}
        </main>
      </div>

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Import today's drops</h2>
              <button className="btn-ghost" onClick={() => setImportOpen(false)}>Close</button>
            </div>
            {!importRows ? (
              <>
                <p className="hint">Paste the list (one drop per line) or upload a file. Works with WhatsApp text, Excel (.xlsx), Word (.docx), CSV and .txt. If a line mentions a material you have added, like "6 boxes tiles", the boxes and material are picked up automatically.</p>
                <textarea rows={8} value={importText} onChange={(e) => setImportText(e.target.value)}
                  placeholder={'Sharma Tiles, 4th Block Jayanagar, 6 tiles, 2 cement\nRavi, 12th Main Indiranagar, 3 boxes, 15 min\n...'} />
                <div className="row">
                  <button className="btn-accent" onClick={() => runImport(null)} disabled={!importText.trim()}>Read pasted text</button>
                  <button className="btn-outline" onClick={() => fileRef.current?.click()}>Upload file…</button>
                  <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,.md,.docx,.xlsx,.xls,.ods" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) runImport(f); e.target.value = '' }} />
                </div>
                {importError && <p className="hint warn">{importError}</p>}
              </>
            ) : (
              <>
                <p className="hint">Check what was read. Fix anything wrong, untick lines you don't want, then add them.</p>
                <div className="import-table-wrap">
                  <table className="import-table">
                    <thead>
                      <tr><th></th><th>Name</th><th>Address</th><th>Material</th><th>Boxes</th><th>Min</th></tr>
                    </thead>
                    <tbody>
                      {importRows.map((r) => (
                        <tr key={r.key} className={r.include ? '' : 'excluded'}>
                          <td><input type="checkbox" checked={r.include} onChange={(e) => updateImportRow(r.key, { include: e.target.checked })} /></td>
                          <td><input value={r.name} onChange={(e) => updateImportRow(r.key, { name: e.target.value })} /></td>
                          <td><input value={r.address} onChange={(e) => updateImportRow(r.key, { address: e.target.value })} /></td>
                          <td>
                            {r.lines.map((l, i) => (
                              <select key={i} value={l.materialId} onChange={(e) => updateImportRow(r.key, { lines: r.lines.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)) })}>
                                {state.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </select>
                            ))}
                          </td>
                          <td>
                            {r.lines.map((l, i) => (
                              <input key={i} type="number" min="1" className="capacity-input" value={l.boxes}
                                onChange={(e) => updateImportRow(r.key, { lines: r.lines.map((x, j) => (j === i ? { ...x, boxes: e.target.value } : x)) })} />
                            ))}
                          </td>
                          <td><input type="number" min="0" className="capacity-input" value={r.workMinutes} onChange={(e) => updateImportRow(r.key, { workMinutes: e.target.value })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row">
                  <button className="btn-accent" onClick={confirmImport}>Add {importRows.filter((r) => r.include).length} drops</button>
                  <button className="btn-outline" onClick={() => setImportRows(null)}>Back</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
