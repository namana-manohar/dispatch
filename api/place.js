// Vercel serverless function: find a business by name with Gemini's
// "Grounding with Google Maps" (Interactions API), and return its Google
// Maps address, place id and link, plus an approximate pin from the address.
// GET /api/place?q=shree%20biomed&city=Bengaluru&near=12.93,77.58
// Needs GEMINI_API_KEY (server-side secret). Returns 501 when unset.

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash']
const UA = 'dispatch-planner/1.0 (vercel)'

async function askGemini(key, model, q, city, near) {
  const input = `Find the business or place named "${q}" in ${city || 'India'} on Google Maps. ` +
    `Reply with exactly one line and nothing else:\nADDRESS: <full street address as listed on Google Maps>\n` +
    `If it is not on Google Maps, reply exactly: NONE`
  const tool = { type: 'google_maps' }
  if (near) { tool.latitude = near.lat; tool.longitude = near.lng }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model, input, tools: [tool] }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`)
  let text = ''
  const places = []
  for (const step of data.steps || []) {
    if (step.type === 'google_maps_result') {
      for (const r of step.result || []) for (const p of r.places || []) places.push({ placeId: p.place_id, name: (p.name || '').replace(/\s*-\s*Google Maps$/i, ''), url: p.url })
    }
    if (step.type === 'model_output') {
      for (const c of step.content || []) if (c.type === 'text' || c.text) text += (c.text || '') + '\n'
    }
  }
  return { text: text.trim(), places }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })
  if (!res.ok) return null
  return res.json()
}

async function nominatim(q) {
  const d = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)
  if (!d?.length) return null
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon), label: d[0].display_name }
}

async function photon(q, near) {
  let url = `https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(q)}`
  if (near) url += `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.6`
  const d = await fetchJson(url)
  const f = d?.features?.[0]
  if (!f) return null
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [f.properties?.name, f.properties?.street, f.properties?.district, f.properties?.city].filter(Boolean).join(', ') }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Approximate pin from the address: street + area first, then area, then postcode.
async function pinFromAddress(address, city, near) {
  const parts = address.split(',').map((s) => s.trim()).filter((s) => s && !/^india$/i.test(s))
  const pin = parts.find((p) => /\b\d{6}\b/.test(p))?.match(/\b(\d{6})\b/)?.[1]
  const cityTag = city && !address.toLowerCase().includes(city.toLowerCase()) ? `, ${city}` : ''
  const tries = []
  for (let n = Math.min(parts.length, 4); n >= 2; n--) tries.push(parts.slice(-n).join(', ') + cityTag)
  for (const t of tries) {
    const hit = await photon(t, near)
    if (hit) return { ...hit, level: 'street' }
  }
  for (const t of tries) {
    const hit = await nominatim(t)
    if (hit) return { ...hit, level: 'area' }
    await sleep(1100)
  }
  if (pin) {
    const hit = await nominatim(`${pin}, ${city || 'India'}`)
    if (hit) return { ...hit, level: 'postcode' }
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const key = process.env.GEMINI_API_KEY
  if (!key) return res.status(501).json({ error: 'GEMINI_API_KEY not set' })
  const q = String(req.query.q || '').trim()
  const city = String(req.query.city || '').trim()
  if (!q) return res.status(400).json({ error: 'q required' })
  let near = null
  const m = String(req.query.near || '').match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/)
  if (m) near = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }

  let last = null
  for (const model of MODELS) {
    try {
      const { text, places } = await askGemini(key, model, q, city, near)
      const am = text.match(/ADDRESS:\s*(.+)/i)
      const address = am ? am[1].trim() : null
      const place = places[0] || null
      if (!address && !place) return res.status(200).json({ found: false, model, text })
      const pin = address ? await pinFromAddress(address, city, near) : null
      return res.status(200).json({
        found: true, model, name: place?.name || q, address, placeId: place?.placeId || null, mapsUrl: place?.url || null,
        lat: pin?.lat ?? null, lng: pin?.lng ?? null, pinLevel: pin?.level || null, approx: true,
      })
    } catch (e) {
      last = e
    }
  }
  return res.status(502).json({ error: last?.message || 'Gemini failed' })
}
