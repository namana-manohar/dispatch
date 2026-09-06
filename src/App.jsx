import { useState, useEffect, useMemo, useRef } from 'react'
import { parseText, parseFile } from './parseImport.js'
import { geocode, sleep, googleDirectionsLegs, routeShareText, whatsappUrl } from './geo.js'
import { planRoutes, hasCoords } from './planner.js'
import RouteMap from './RouteMap.jsx'

const STORAGE_KEY = 'dispatch-planner-v4'
const OLD_KEYS = ['dispatch-planner-v3', 'dispatch-planner-v2', 'dispatch-planner-v1']

const SIZE_PRESETS = [{ name: 'Medium box' }, { name: 'Small box' }, { name: 'Large box' }]
const uid = () => crypto.randomUUID()

function freshState() {
  return {
    boys: [],
    materials: SIZE_PRESETS.map((m) => ({ id: uid(), ...m })),
    clients: [],   // the whole client list, kept across days
    drops: [],     // today's deliveries, each pointing at a client
    people: {},    // route number -> boy id
    peopleToday: 4,
    autosToday: 0,
    portersToday: 0,
    useAll: false,
    urgentHours: 3,
    avgSpeed: 25,
    startTime: '09:00',
    maxStops: 8,
    maxHours: 4,
    depot: { address: '', lat: null, lng: null },
    city: 'Bengaluru',
    legCache: {},
  }
}

// Older saves: drops carried name/address themselves, and were loaded onto vehicles.
function migrateOld(old) {
  const base = freshState()
  const materials = old.materials?.length ? old.materials.map((m) => ({ id: m.id, name: m.name })) : base.materials
  const std = materials[0]
  const clients = (old.clients || []).map((c) => ({ ...c }))
  const drops = (old.drops || []).map((d) => {
    let clientId = d.clientId
    if (!clientId) {
      const name = d.name || ''
      const address = d.address || ''
      let c = clients.find((x) => x.name === name && x.address === address)
      if (!c) {
        c = { id: uid(), name, address, note: '', lat: d.lat ?? null, lng: d.lng ?? null, workMinutes: d.workMinutes ?? 10 }
        clients.push(c)
      }
      clientId = c.id
    }
    return {
      id: d.id, clientId, note: d.note || '', pin: null,
      lines: d.lines || [{ materialId: std.id, boxes: d.boxes ?? 1 }],
      workMinutes: d.workMinutes ?? 10,
    }
  })
  return {
    ...base,
    boys: old.boys || [],
    materials, clients, drops,
    avgSpeed: old.avgSpeed ?? 25,
    startTime: old.startTime ?? '09:00',
    depot: old.depot || base.depot,
    city: old.city || base.city,
    legCache: old.legCache || {},
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...freshState(), ...JSON.parse(raw) }
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k)
      if (old) return migrateOld(JSON.parse(old))
    }
  } catch (e) {
    console.error('Could not load saved data', e)
  }
  return freshState()
}

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

const clientLabel = (c) => c.name || c.address

export default function App() {
  const [state, setState] = useState(loadState)
  const [boyName, setBoyName] = useState('')
  const [sizeName, setSizeName] = useState('')
  const [clientForm, setClientForm] = useState({ name: '', address: '', note: '', workMinutes: '10' })
  const [clientSearch, setClientSearch] = useState('')
  const [sendForm, setSendForm] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importRows, setImportRows] = useState(null)
  const [importError, setImportError] = useState('')
  const [mapRouteNo, setMapRouteNo] = useState(null)
  const [locating, setLocating] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const sizeById = (id) => state.materials.find((m) => m.id === id)
  const clientById = (id) => state.clients.find((c) => c.id === id)
  const boxesOfLines = (lines) => lines.reduce((sum, l) => sum + (l.boxes || 0), 0)
  const describeLines = (lines) => lines.length ? lines.map((l) => `${l.boxes} × ${sizeById(l.materialId)?.name || 'box'}`).join(', ') : 'collect only, no boxes'
  const normalizeLines = (lines) => lines
    .map((l) => ({ materialId: l.materialId || state.materials[0]?.id, boxes: parseInt(l.boxes, 10) || 0 }))
    .filter((l) => l.boxes > 0)
  const sizeBreakdown = (drops) => {
    const counts = {}
    drops.forEach((d) => d.lines.forEach((l) => { const n = sizeById(l.materialId)?.name || 'box'; counts[n] = (counts[n] || 0) + (l.boxes || 0) }))
    return Object.entries(counts).map(([n, c]) => `${c} ${n.replace(/\s*boxe?s?$/i, '')}`).join(', ')
  }

  // Today's drops with each client's name/address folded in. A drop that is
  // collected elsewhere first becomes two stops: the pickup, then the delivery.
  const resolvedDrops = useMemo(() => state.drops.map((d) => {
    const c = clientById(d.clientId) || {}
    const pc = d.pickupClientId ? clientById(d.pickupClientId) : null
    return {
      ...d, jobId: d.id, kind: 'deliver', name: c.name || '', address: c.address || '', lat: c.lat ?? null, lng: c.lng ?? null,
      pickupName: pc ? clientLabel(pc) : null, pickupLocated: pc ? hasCoords(pc) : true,
    }
  }), [state.drops, state.clients]) // eslint-disable-line react-hooks/exhaustive-deps
  const resolvedStops = useMemo(() => resolvedDrops.flatMap((d) => {
    if (!d.pickupClientId) return [d]
    const pc = clientById(d.pickupClientId) || {}
    const pickup = {
      ...d, id: `${d.id}:pickup`, kind: 'pickup', clientId: d.pickupClientId, note: '',
      name: pc.name || '', address: pc.address || '', lat: pc.lat ?? null, lng: pc.lng ?? null,
      workMinutes: pc.workMinutes ?? 10, deliverTo: d.name || d.address,
    }
    return [pickup, { ...d, after: pickup.id }]
  }), [resolvedDrops]) // eslint-disable-line react-hooks/exhaustive-deps

  // The plan: how many routes, who goes where, in what order.
  // Drops with a Porter-only box size go on Porter trips (Porters are unlimited).
  // Routes the boys cannot cover within the limits go to hired autos (also unlimited).
  const plan = useMemo(() => {
    const isPorterDrop = (d) => d.lines.some((l) => sizeById(l.materialId)?.porter)
    const porterDrops = resolvedStops.filter(isPorterDrop)
    const bikeDrops = resolvedStops.filter((d) => !isPorterDrop(d))
    const common = { depot: state.depot, avgSpeed: state.avgSpeed, startTime: state.startTime, legCache: state.legCache, urgentHours: state.urgentHours }
    const bikes = planRoutes(bikeDrops, { ...common, maxStops: state.maxStops, maxHours: state.maxHours, people: state.peopleToday || 0, useAll: state.useAll })
    const porter = planRoutes(porterDrops, { ...common, maxStops: 999, maxHours: state.maxHours * 2 })
    let autoNo = 0
    const bikeRoutes = bikes.routes.filter((r) => !r.hired).map((r) => ({ ...r, kind: 'bike', label: `Route ${r.number}` }))
    const autoRoutes = bikes.routes.filter((r) => r.hired).map((r) => ({ ...r, kind: 'auto', label: `Auto ${++autoNo}` }))
    const porterRoutes = porter.routes.map((r, i) => ({ ...r, kind: 'porter', number: bikes.routes.length + i + 1, label: porter.routes.length > 1 ? `Porter ${i + 1}` : 'Porter' }))
    const routes = [...bikeRoutes, ...autoRoutes, ...porterRoutes]
    return { routes, bikeRoutes, autoRoutes, porterRoutes, unlocated: [...bikes.unlocated, ...porter.unlocated], needed: bikes.needed, late: bikes.late + porter.late }
  }, [resolvedStops, state.depot, state.avgSpeed, state.startTime, state.legCache, state.maxStops, state.maxHours, state.peopleToday, state.useAll, state.urgentHours, state.materials]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- start point & address lookup (Nominatim, one request at a time)
  const setDepotField = (patch) => setState((s) => ({ ...s, depot: { ...s.depot, ...patch } }))
  const locateDepot = async () => {
    if (!state.depot.address.trim()) return
    setLocating('Looking up the Loading point…')
    try {
      const hit = await geocode(state.depot.address, state.city)
      if (hit) setDepotField({ lat: hit.lat, lng: hit.lng })
      setLocating(hit ? '' : 'Loading point not found. Try a fuller address.')
    } catch (e) { setLocating(e.message) }
  }
  const pinClient = (id, hit) => setState((s) => ({ ...s, clients: s.clients.map((c) => (c.id === id ? { ...c, lat: hit.lat, lng: hit.lng } : c)) }))
  const locateClient = async (id) => {
    const c = clientById(id)
    if (!c) return
    setLocating(`Looking up ${clientLabel(c)}…`)
    try {
      const hit = await geocode(c.address || c.name, state.city)
      if (hit) pinClient(id, hit)
      setLocating(hit ? '' : `Could not find "${c.address || c.name}". Edit the address and try again.`)
    } catch (e) { setLocating(e.message) }
  }
  const locateAll = async () => {
    const todo = state.clients.filter((c) => !hasCoords(c) && (c.address || c.name))
    const missed = []
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i]
      setLocating(`Looking up ${i + 1} of ${todo.length}: ${clientLabel(c)}…`)
      try {
        const hit = await geocode(c.address || c.name, state.city)
        if (hit) pinClient(c.id, hit)
        else missed.push(clientLabel(c))
      } catch (e) { missed.push(clientLabel(c)) }
      if (i < todo.length - 1) await sleep(1100)
    }
    setLocating(missed.length ? `Not found: ${missed.join(', ')}. Edit those addresses and try again.` : '')
  }
  const applyLegs = (legs) => setState((s) => {
    const next = { ...s.legCache }
    legs.forEach((l) => { next[l.key] = { km: l.km, min: l.min } })
    return { ...s, legCache: next }
  })

  // --- boys & sizes
  const addBoy = () => {
    if (!boyName.trim()) return
    setState((s) => ({ ...s, boys: [...s.boys, { id: uid(), name: boyName.trim() }] }))
    setBoyName('')
  }
  const removeBoy = (id) => setState((s) => {
    const people = {}
    Object.entries(s.people).forEach(([k, v]) => { if (v !== id) people[k] = v })
    return { ...s, boys: s.boys.filter((b) => b.id !== id), people }
  })
  const addSize = () => {
    if (!sizeName.trim()) return
    setState((s) => ({ ...s, materials: [...s.materials, { id: uid(), name: sizeName.trim(), porter: false }] }))
    setSizeName('')
  }
  const toggleSizePorter = (id) => setState((s) => ({ ...s, materials: s.materials.map((m) => (m.id === id ? { ...m, porter: !m.porter } : m)) }))
  const removeSize = (id) => setState((s) => {
    if (s.materials.length <= 1) return s
    const fallback = s.materials.find((m) => m.id !== id).id
    return {
      ...s,
      materials: s.materials.filter((m) => m.id !== id),
      drops: s.drops.map((d) => ({ ...d, lines: d.lines.map((l) => (l.materialId === id ? { ...l, materialId: fallback } : l)) })),
    }
  })

  // --- clients (the master list)
  const addClient = () => {
    if (!clientForm.name.trim() && !clientForm.address.trim()) return
    setState((s) => ({
      ...s,
      clients: [...s.clients, {
        id: uid(), name: clientForm.name.trim(), address: clientForm.address.trim(), note: clientForm.note.trim(),
        lat: null, lng: null, workMinutes: parseInt(clientForm.workMinutes, 10) || 10,
      }],
    }))
    setClientForm({ name: '', address: '', note: '', workMinutes: '10' })
  }
  const removeClient = (id) => {
    const inUse = state.drops.some((d) => d.clientId === id)
    if (inUse && !window.confirm('This client has a drop today. Remove the client and the drop?')) return
    setState((s) => ({ ...s, clients: s.clients.filter((c) => c.id !== id), drops: s.drops.filter((d) => d.clientId !== id) }))
  }

  // --- today's drops
  const openSend = (c) => setSendForm({
    clientId: c.id, note: c.note || '', workMinutes: String(c.workMinutes ?? 10), pickupClientId: '', urgent: false, collect: false,
    lines: [{ materialId: state.materials[0]?.id, boxes: '1' }],
  })
  const confirmSend = () => {
    if (!sendForm) return
    const lines = normalizeLines(sendForm.lines)
    setState((s) => ({
      ...s,
      drops: [...s.drops, {
        id: uid(), clientId: sendForm.clientId, note: sendForm.note.trim(), pin: null,
        pickupClientId: sendForm.collect ? null : (sendForm.pickupClientId || null), urgent: !!sendForm.urgent, collect: !!sendForm.collect,
        lines: sendForm.collect ? [] : (lines.length ? lines : [{ materialId: s.materials[0].id, boxes: 1 }]),
        workMinutes: parseInt(sendForm.workMinutes, 10) || 0,
      }],
    }))
    setSendForm(null)
  }
  const removeDrop = (id) => setState((s) => ({ ...s, drops: s.drops.filter((d) => d.id !== id) }))
  const toggleUrgent = (id) => setState((s) => ({ ...s, drops: s.drops.map((d) => (d.id === id ? { ...d, urgent: !d.urgent } : d)) }))
  const pinDrop = (id, routeNo) => setState((s) => ({
    ...s, drops: s.drops.map((d) => (d.id === id ? { ...d, pin: routeNo ? parseInt(routeNo, 10) : null } : d)),
  }))
  const clientOptions = [...state.clients].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)))
  const resetPins = () => setState((s) => ({ ...s, drops: s.drops.map((d) => ({ ...d, pin: null })) }))
  const clearDrops = () => {
    if (state.drops.length && window.confirm("Clear today's drops? The client list, boys and box sizes stay.")) {
      setState((s) => ({ ...s, drops: [], people: {} }))
    }
  }
  const setRoutePerson = (routeNo, boyId) => setState((s) => ({ ...s, people: { ...s.people, [routeNo]: boyId || null } }))

  // --- import (into the client list)
  const runImport = async (file) => {
    setImportError('')
    try {
      const rows = file ? await parseFile(file, state.materials) : parseText(importText, state.materials)
      if (!rows.length) { setImportError('No addresses found. Put one client per line, e.g. "Sharma Tiles, 4th Block Jayanagar".'); return }
      setImportRows(rows.map((r) => ({
        key: uid(), include: true, name: r.name || '', address: r.address || '', note: '',
        workMinutes: r.workMinutes ?? 10, lat: r.lat, lng: r.lng,
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
      clients: [...s.clients, ...chosen.map((r) => ({
        id: uid(), name: r.name.trim(), address: r.address.trim(), note: r.note.trim(),
        lat: r.lat, lng: r.lng, workMinutes: parseInt(r.workMinutes, 10) || 10,
      }))],
    }))
    setImportRows(null)
    setImportText('')
    setImportOpen(false)
  }

  const dropsTodayFor = (clientId) => state.drops.filter((d) => d.clientId === clientId).length
  const q = clientSearch.trim().toLowerCase()
  const visibleClients = q
    ? state.clients.filter((c) => `${c.name} ${c.address} ${c.note}`.toLowerCase().includes(q))
    : state.clients
  const stopTitle = (s) => {
    const base = `${s.name || s.address}${s.note ? ` · ${s.note}` : ''}`
    const flag = s.urgent ? '⚡ ' : ''
    if (s.collect) return `${flag}Collect from ${base}${s.note ? '' : ' (cheque / return)'}`
    if (s.kind === 'pickup') return `${flag}Collect at ${base} (for ${s.deliverTo})`
    if (s.pickupName) return `${flag}${base} · from ${s.pickupName}`
    return `${flag}${base}`
  }
  const stopSub = (s) => (s.name && s.address ? s.address : null)
  const sendClient = sendForm ? clientById(sendForm.clientId) : null
  const mapRoute = plan.routes.find((r) => r.number === mapRouteNo)
  const totalBoxes = state.drops.reduce((sum, d) => sum + boxesOfLines(d.lines), 0)
  const unlocatedClients = state.clients.filter((c) => !hasCoords(c)).length
  const anyPinned = state.drops.some((d) => d.pin)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">DP</span>
          <div>
            <h1>Dispatch Planner</h1>
            <p>Pick today's clients. It tells you how many people to send and the route for each.</p>
          </div>
        </div>
        <div className="global-settings">
          <Field label="People today">
            <input type="number" min="1" value={state.peopleToday}
              onChange={(e) => setState((s) => ({ ...s, peopleToday: parseInt(e.target.value, 10) || 1 }))} />
          </Field>
          <Field label="Autos today">
            <input type="number" min="0" value={state.autosToday}
              onChange={(e) => setState((s) => ({ ...s, autosToday: parseInt(e.target.value, 10) || 0 }))} />
          </Field>
          <Field label="Porters today">
            <input type="number" min="0" value={state.portersToday}
              onChange={(e) => setState((s) => ({ ...s, portersToday: parseInt(e.target.value, 10) || 0 }))} />
          </Field>
          <Field label="⚡ Urgent within (h)">
            <input type="number" min="0.5" step="0.5" value={state.urgentHours}
              onChange={(e) => setState((s) => ({ ...s, urgentHours: parseFloat(e.target.value) || 1 }))} />
          </Field>
          <Field label="Day start">
            <input type="time" value={state.startTime}
              onChange={(e) => setState((s) => ({ ...s, startTime: e.target.value }))} />
          </Field>
          <Field label="Max stops / person">
            <input type="number" min="1" value={state.maxStops}
              onChange={(e) => setState((s) => ({ ...s, maxStops: parseInt(e.target.value, 10) || 1 }))} />
          </Field>
          <Field label="Max hours / person">
            <input type="number" min="0.5" step="0.5" value={state.maxHours}
              onChange={(e) => setState((s) => ({ ...s, maxHours: parseFloat(e.target.value) || 0.5 }))} />
          </Field>
          <Field label="Avg speed (km/h)">
            <input type="number" min="1" value={state.avgSpeed}
              onChange={(e) => setState((s) => ({ ...s, avgSpeed: parseFloat(e.target.value) || 1 }))} />
          </Field>
        </div>
      </header>

      <div className="layout">
        <aside className="panel">
          <section className="block">
            <div className="block-head">
              <h2>Clients</h2>
              <div className="row" style={{ marginTop: 0 }}>
                <button className="btn-outline" onClick={() => { setImportOpen(true); setImportRows(null); setImportError('') }}>Import list</button>
                {unlocatedClients > 0 && <button className="btn-outline" onClick={locateAll}>Locate all</button>}
              </div>
            </div>
            {locating && <p className="hint warn" style={{ marginBottom: 8 }}>{locating}</p>}
            {state.clients.length > 5 && (
              <input placeholder="Search clients…" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} style={{ width: '100%' }} />
            )}
            <ul className="list">
              {visibleClients.map((c) => {
                const n = dropsTodayFor(c.id)
                return (
                  <li key={c.id} className={n ? 'client-today' : ''}>
                    <div className="drop-info">
                      <span>{clientLabel(c)}{c.note ? ` · ${c.note}` : ''}</span>
                      {c.name && c.address && <small>{c.address}</small>}
                      <small>{hasCoords(c) ? 'on map' : 'not on map yet'}{n ? ` · ${n} drop${n > 1 ? 's' : ''} today` : ''}</small>
                    </div>
                    <div className="row">
                      {!hasCoords(c) && <button className="btn-ghost" onClick={() => locateClient(c.id)} title="Find this address on the map">Locate</button>}
                      <button className="btn-accent btn-small" onClick={() => openSend(c)}>Send today</button>
                      <button className="btn-ghost" onClick={() => removeClient(c.id)}>×</button>
                    </div>
                  </li>
                )
              })}
              {state.clients.length === 0 && <li className="empty">No clients yet. Import your list, or add one below.</li>}
              {state.clients.length > 0 && visibleClients.length === 0 && <li className="empty">No client matches "{clientSearch}".</li>}
            </ul>
            <details className="details">
              <summary>Add a client by hand</summary>
              <div className="drop-form">
                <input placeholder="Client / shop name" value={clientForm.name}
                  onChange={(e) => setClientForm((f) => ({ ...f, name: e.target.value }))} />
                <input placeholder="Address" value={clientForm.address} style={{ marginTop: 8 }}
                  onChange={(e) => setClientForm((f) => ({ ...f, address: e.target.value }))} />
                <div className="row">
                  <input placeholder="Gate / department (optional)" value={clientForm.note}
                    onChange={(e) => setClientForm((f) => ({ ...f, note: e.target.value }))} />
                  <input type="number" min="0" placeholder="Min" title="Usual minutes of work at this client" className="capacity-input" value={clientForm.workMinutes}
                    onChange={(e) => setClientForm((f) => ({ ...f, workMinutes: e.target.value }))} />
                </div>
                <button className="btn-accent" onClick={addClient}>Add client</button>
              </div>
            </details>
          </section>

          <section className="block">
            <div className="block-head">
              <h2>Today's drops</h2>
              {state.drops.length > 0 && <button className="btn-ghost" onClick={clearDrops}>Clear day</button>}
            </div>
            <ul className="list" style={{ marginTop: 0 }}>
              {resolvedDrops.map((d) => (
                <li key={d.id}>
                  <div className="drop-info">
                    <span>{stopTitle(d)}</span>
                    <small>{describeLines(d.lines)} · {d.workMinutes}m{hasCoords(d) && d.pickupLocated ? '' : ' · not on map yet'}</small>
                  </div>
                  <div className="row">
                    <button className={`btn-ghost urgent-toggle${d.urgent ? ' on' : ''}`} onClick={() => toggleUrgent(d.id)} title={d.urgent ? 'Urgent: must reach within the hours set at the top' : 'Mark urgent (1–3 h)'}>⚡</button>
                    {!hasCoords(d) && <button className="btn-ghost" onClick={() => locateClient(d.clientId)}>Locate</button>}
                    {hasCoords(d) && !d.pickupLocated && <button className="btn-ghost" onClick={() => locateClient(d.pickupClientId)}>Locate pickup</button>}
                    <button className="btn-ghost" onClick={() => removeDrop(d.id)}>×</button>
                  </div>
                </li>
              ))}
              {state.drops.length === 0 && <li className="empty">Nothing yet. Press "Send today" on a client.</li>}
            </ul>
          </section>

          <section className="block">
            <button className="btn-link" onClick={() => setShowSetup((v) => !v)}>{showSetup ? '▾ Hide setup' : '▸ Setup: city, delivery boys, box sizes'}</button>
            {showSetup && (
              <>
                <h2 style={{ marginTop: 12 }}>City</h2>
                <div className="row" style={{ marginTop: 0 }}>
                  <input placeholder="City (helps address lookup)" value={state.city}
                    onChange={(e) => setState((s) => ({ ...s, city: e.target.value }))} />
                </div>
                <p className="hint">Added to every address lookup so "4th Block Jayanagar" finds the right city.</p>

                <h2 style={{ marginTop: 20 }}>Delivery boys</h2>
                <div className="row" style={{ marginTop: 0 }}>
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
                  {state.boys.length === 0 && <li className="empty">Optional. Names let you put a person on each route.</li>}
                </ul>

                <h2 style={{ marginTop: 20 }}>Box sizes</h2>
                <div className="row" style={{ marginTop: 0 }}>
                  <input placeholder="Size name (e.g. Tile box)" value={sizeName}
                    onChange={(e) => setSizeName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSize()} />
                  <button className="btn-accent" onClick={addSize}>Add</button>
                </div>
                <ul className="list">
                  {state.materials.map((m) => (
                    <li key={m.id}>
                      <span>{m.name}</span>
                      <label className="check" title="Boxes of this size go on the Porter, not on a bike"><input type="checkbox" checked={!!m.porter} onChange={() => toggleSizePorter(m.id)} /> by Porter</label>
                      <button className="btn-ghost" onClick={() => removeSize(m.id)} disabled={state.materials.length <= 1}>×</button>
                    </li>
                  ))}
                </ul>
                <p className="hint">Tick "by Porter" on sizes too big for a bike. Those drops always go on a Porter trip (Porters and autos are booked as needed).</p>
              </>
            )}
          </section>
        </aside>

        <main className="board">
          <div className={`loading-point${hasCoords(state.depot) ? '' : ' unset'}`}>
            <span className="lp-label">Loading point</span>
            <input placeholder="Where the boys load and start from (address)" value={state.depot.address}
              onChange={(e) => setDepotField({ address: e.target.value, lat: null, lng: null })}
              onKeyDown={(e) => e.key === 'Enter' && locateDepot()} />
            {hasCoords(state.depot)
              ? <span className="lp-ok">on map · every route starts and ends here</span>
              : <button className="btn-accent btn-small" onClick={locateDepot} disabled={!state.depot.address.trim()}>Locate</button>}
          </div>
          {locating && locating.includes('Loading') && <p className="hint warn">{locating}</p>}

          <div className="answer">
            {state.drops.length === 0 ? (
              <>
                <h2>No drops yet today</h2>
                <p>Press <b>Send today</b> on each client getting a delivery. The plan appears here.</p>
              </>
            ) : plan.routes.length === 0 ? (
              <>
                <h2>{state.drops.length} drop{state.drops.length > 1 ? 's' : ''} waiting for locations</h2>
                <p>Press <b>Locate all</b> under Clients (once per client, it is remembered) and the routes will be drawn up.</p>
              </>
            ) : (
              <>
                <h2>
                  {[
                    plan.bikeRoutes.length > 0 && `Send ${plan.bikeRoutes.length} ${plan.bikeRoutes.length === 1 ? 'person' : 'people'} on ${plan.bikeRoutes.length} route${plan.bikeRoutes.length > 1 ? 's' : ''}`,
                    plan.autoRoutes.length > 0 && `book ${plan.autoRoutes.length} auto${plan.autoRoutes.length > 1 ? 's' : ''}`,
                    plan.porterRoutes.length > 0 && `${plan.porterRoutes.length === 1 ? `1 Porter (${plan.porterRoutes[0].stops.length} stops)` : `${plan.porterRoutes.length} Porters`}`,
                  ].filter(Boolean).join(' + ')}
                </h2>
                <p>
                  {state.drops.length} drops · {totalBoxes} boxes ({sizeBreakdown(state.drops)}) · at most {state.maxStops} stops and {state.maxHours}h per person
                  {!hasCoords(state.depot) && ' · loading point not set, so routes start at the first stop'}
                </p>
                {plan.autoRoutes.length > 0 && (
                  <p className={plan.autoRoutes.length > state.autosToday ? 'warn-text' : ''}>
                    Within your limits this needs {plan.needed} routes and you have {state.peopleToday} people, so the {plan.autoRoutes.length} longest route{plan.autoRoutes.length > 1 ? 's go' : ' goes'} by auto.
                    {plan.autoRoutes.length > state.autosToday
                      ? ` You have ${state.autosToday} auto${state.autosToday === 1 ? '' : 's'} today: book ${plan.autoRoutes.length - state.autosToday} more, then update the number at the top. Or raise the limits / add a person.`
                      : ` Covered by the ${state.autosToday} auto${state.autosToday === 1 ? '' : 's'} you have.`}
                  </p>
                )}
                {plan.porterRoutes.length > state.portersToday && (
                  <p className="warn-text">Porter-only boxes need {plan.porterRoutes.length} Porter trip{plan.porterRoutes.length > 1 ? 's' : ''}; you have {state.portersToday} today. Book {plan.porterRoutes.length - state.portersToday} more, then update the number at the top.</p>
                )}
                {plan.late > 0 && (
                  <p className="warn-text">{plan.late} urgent stop{plan.late > 1 ? 's' : ''} cannot be reached within {state.urgentHours} h even going first. Send it separately or extend the urgent window.</p>
                )}
                {plan.autoRoutes.length === 0 && plan.needed > 0 && state.peopleToday > plan.needed && !state.useAll && (
                  <p>
                    Only {plan.needed} {plan.needed === 1 ? 'person is' : 'people are'} needed today. You have {state.peopleToday}.{' '}
                    <button className="btn-link inline" onClick={() => setState((x) => ({ ...x, useAll: true }))}>Use all {state.peopleToday} and everyone finishes earlier</button>
                  </p>
                )}
                {plan.autoRoutes.length === 0 && state.useAll && plan.bikeRoutes.length > plan.needed && (
                  <p>
                    Spread over all {state.peopleToday} people; {plan.needed} would have been enough.{' '}
                    <button className="btn-link inline" onClick={() => setState((x) => ({ ...x, useAll: false }))}>Use the fewest people instead</button>
                  </p>
                )}
                {plan.unlocated.length > 0 && (
                  <p className="warn-text">{plan.unlocated.length} drop{plan.unlocated.length > 1 ? 's' : ''} not on the map yet, not in any route: {plan.unlocated.map(stopTitle).join(', ')}. Press Locate on them.</p>
                )}
                {anyPinned && <button className="btn-link" onClick={resetPins}>Undo my manual moves, plan again</button>}
              </>
            )}
          </div>

          {plan.routes.map((r) => {
            const person = state.boys.find((b) => b.id === state.people[r.number])
            const boxes = r.stops.reduce((sum, s) => sum + boxesOfLines(s.lines), 0)
            return (
              <section className={`route-card${r.kind === 'porter' ? ' porter-card' : ''}${r.kind === 'auto' ? ' auto-card' : ''}${r.overLimit ? ' over-capacity' : ''}`} key={r.number}>
                <div className="route-head route-head-clickable" onClick={() => setMapRouteNo(r.number)} title="Show this route on the map">
                  <div>
                    <h3>{r.label}</h3>
                    {r.kind === 'bike' ? (
                      <select className="person-select" value={state.people[r.number] || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setRoutePerson(r.number, e.target.value)}>
                        <option value="">Who takes this?</option>
                        {state.boys.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <p className="boy-tag">{r.kind === 'auto' ? 'Hired auto' : 'Hired Porter'}</p>
                    )}
                  </div>
                  <div className="row route-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-outline" onClick={() => setMapRouteNo(r.number)}>Map</button>
                    {googleDirectionsLegs(state.depot, r.stops).map((l) => (
                      <a key={l.url} className="btn-outline" href={l.url} target="_blank" rel="noreferrer" title="Open turn-by-turn directions in Google Maps">{l.label}</a>
                    ))}
                    {r.stops.length > 0 && (
                      <a className="btn-accent btn-small" target="_blank" rel="noreferrer" title="Send this route to the delivery boy"
                        href={whatsappUrl(routeShareText({
                          title: r.label, person: person?.name, startTime: state.startTime, start: state.depot,
                          stops: r.stops.map((s) => ({ ...s, name: stopTitle(s) === s.address ? '' : stopTitle(s), summary: describeLines(s.lines) })),
                          legs: googleDirectionsLegs(state.depot, r.stops),
                        }))}>WhatsApp</a>
                    )}
                  </div>
                  <div className="route-stats">
                    <div><strong>{r.stops.length}</strong><span>stops</span></div>
                    <div><strong>{boxes}</strong><span>boxes</span></div>
                    <div><strong className="stat-text">{sizeBreakdown(r.stops)}</strong><span>by size</span></div>
                    <div><strong>{r.totalKm.toFixed(1)}</strong><span>km</span></div>
                    <div><strong>{Math.round(r.totalMin)}</strong><span>min</span></div>
                    <div><strong>{r.hasStart ? r.backTime : r.finishTime}</strong><span>{r.hasStart ? 'back at shop' : 'last stop done'}</span></div>
                  </div>
                </div>
                {r.overLimit && (
                  <p className="hint warn">Over the limit: {r.stops.length} stops, {(r.totalMin / 60).toFixed(1)}h. Move a stop elsewhere, or raise the limits if that is fine.</p>
                )}
                <ol className="stops">
                  {r.stops.map((s, i) => (
                    <li key={s.id}>
                      <div className={`stop-time${s.late ? ' late' : ''}`}>
                        <strong>{s.arrival}</strong>
                        <small>{s.late ? 'LATE' : `→ ${s.departure}`}</small>
                      </div>
                      <div className="stop-info">
                        <span>{i + 1}. {stopTitle(s)}</span>
                        {stopSub(s) && <small>{stopSub(s)}</small>}
                        <small>{describeLines(s.lines)} · {s.travelMin > 0 && `${s.travelKm.toFixed(1)}km · `}{s.workMinutes}m work</small>
                      </div>
                      <a className="btn-ghost" href={mapsLink(s)} target="_blank" rel="noreferrer" title="Open in Google Maps">Map</a>
                      <select className="move-select" value={s.pin || ''} onChange={(e) => pinDrop(s.jobId || s.id, e.target.value)} title="Move this stop to another route">
                        <option value="">{s.pin ? 'Auto' : 'Move…'}</option>
                        {plan.bikeRoutes.map((o) => <option key={o.number} value={o.number}>Route {o.number}</option>)}
                        <option value={plan.bikeRoutes.length + 1}>New route</option>
                      </select>
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </main>
      </div>

      {mapRoute && (
        <RouteMap
          vehicle={{ type: mapRoute.label }}
          boy={state.boys.find((b) => b.id === state.people[mapRoute.number])}
          route={{
            ...mapRoute,
            stops: mapRoute.stops.map((s) => ({
              ...s, name: s.name ? `${s.name}${s.note ? ' · ' + s.note : ''}` : s.note, summary: describeLines(s.lines),
            })),
          }}
          depot={state.depot}
          startTime={state.startTime}
          onClose={() => setMapRouteNo(null)}
          onLegs={applyLegs}
        />
      )}

      {sendForm && sendClient && (
        <div className="modal-backdrop" onClick={() => setSendForm(null)}>
          <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2>Send today: {clientLabel(sendClient)}</h2>
                {sendClient.address && sendClient.name && <p className="hint" style={{ margin: 0 }}>{sendClient.address}</p>}
              </div>
              <button className="btn-ghost" onClick={() => setSendForm(null)}>Close</button>
            </div>
            <div className="drop-form" style={{ marginTop: 12 }}>
              <input placeholder="Gate / department for this drop (optional)" value={sendForm.note}
                onChange={(e) => setSendForm((f) => ({ ...f, note: e.target.value }))} autoFocus />
              <label className="check" style={{ padding: '8px 0 0' }}>
                <input type="checkbox" checked={!!sendForm.urgent} onChange={(e) => setSendForm((f) => ({ ...f, urgent: e.target.checked }))} />
                ⚡ Urgent: deliver within {state.urgentHours} h (goes first on its route)
              </label>
              <label className="check" style={{ padding: '4px 0 0' }}>
                <input type="checkbox" checked={!!sendForm.collect} onChange={(e) => setSendForm((f) => ({ ...f, collect: e.target.checked }))} />
                Collect only (cheque, return), no boxes. Done after the drops on that route.
              </label>
              <div className="row">
                <select value={sendForm.pickupClientId} onChange={(e) => setSendForm((f) => ({ ...f, pickupClientId: e.target.value }))} title="Collect the boxes somewhere else first">
                  <option value="">Boxes come from the shop</option>
                  {clientOptions.filter((c) => c.id !== sendForm.clientId).map((c) => (
                    <option key={c.id} value={c.id}>Collect first from {clientLabel(c)}{c.name && c.address ? ` (${c.address})` : ''}</option>
                  ))}
                </select>
              </div>
              {!sendForm.collect && sendForm.lines.map((l, i) => (
                <div className="row" key={i}>
                  <select value={l.materialId} onChange={(e) => setSendForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)) }))}>
                    {state.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="number" min="1" placeholder="No." title="Number of boxes of this size" className="capacity-input" value={l.boxes}
                    onChange={(e) => setSendForm((f) => ({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, boxes: e.target.value } : x)) }))} />
                  {sendForm.lines.length > 1 && (
                    <button className="btn-ghost" onClick={() => setSendForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}>×</button>
                  )}
                </div>
              ))}
              {!sendForm.collect && <button className="btn-link" onClick={() => setSendForm((f) => ({ ...f, lines: [...f.lines, { materialId: state.materials[0]?.id, boxes: '1' }] }))}>+ another box size</button>}
              <div className="row">
                <Field label="Minutes at this stop">
                  <input type="number" min="0" value={sendForm.workMinutes}
                    onChange={(e) => setSendForm((f) => ({ ...f, workMinutes: e.target.value }))} />
                </Field>
              </div>
              <p className="hint">Same client, another gate or department? Press "Send today" on them again and give the second drop its own note.</p>
              <div className="row">
                <button className="btn-accent" onClick={confirmSend}>Add to today</button>
                <button className="btn-outline" onClick={() => setSendForm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop" onClick={() => setImportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Import client list</h2>
              <button className="btn-ghost" onClick={() => setImportOpen(false)}>Close</button>
            </div>
            {!importRows ? (
              <>
                <p className="hint">Paste the list (one client per line) or upload a file. Works with WhatsApp text, Excel (.xlsx), Word (.docx), CSV and .txt. Name and address are split automatically; a spreadsheet with a header row (name / address / phone / minutes) is mapped by column.</p>
                <textarea rows={8} value={importText} onChange={(e) => setImportText(e.target.value)}
                  placeholder={'Sharma Tiles, 4th Block Jayanagar\nRavi Enterprises - 12th Main Indiranagar\nBosch, Adugodi, 20 min\n...'} />
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
                <p className="hint">Check what was read. Fix anything wrong, untick lines you don't want, then add them to the client list.</p>
                <div className="import-table-wrap">
                  <table className="import-table">
                    <thead>
                      <tr><th></th><th>Name</th><th>Address</th><th>Gate / dept</th><th>Min</th></tr>
                    </thead>
                    <tbody>
                      {importRows.map((r) => (
                        <tr key={r.key} className={r.include ? '' : 'excluded'}>
                          <td><input type="checkbox" checked={r.include} onChange={(e) => updateImportRow(r.key, { include: e.target.checked })} /></td>
                          <td><input value={r.name} onChange={(e) => updateImportRow(r.key, { name: e.target.value })} /></td>
                          <td><input value={r.address} onChange={(e) => updateImportRow(r.key, { address: e.target.value })} /></td>
                          <td><input value={r.note} onChange={(e) => updateImportRow(r.key, { note: e.target.value })} /></td>
                          <td><input type="number" min="0" className="capacity-input" value={r.workMinutes} onChange={(e) => updateImportRow(r.key, { workMinutes: e.target.value })} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row">
                  <button className="btn-accent" onClick={confirmImport}>Add {importRows.filter((r) => r.include).length} clients</button>
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
