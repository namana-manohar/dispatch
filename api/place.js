// Vercel serverless function: find a business by name using Gemini with
// "Grounding with Google Maps", then turn its address into a pin.
// GET /api/place?q=shree%20biomed&city=Bengaluru&near=12.93,77.58
// Needs GEMINI_API_KEY (server-side secret). Returns 501 when unset.

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']

async function askGemini(key, model, q, city, near) {
  const prompt = `Find the business or place named "${q}" in ${city || 'India'} on Google Maps. ` +
    `Reply with exactly one line in this form and nothing else:\nADDRESS: <full street address as listed on Google Maps>\n` +
    `If you cannot find it, reply exactly: NONE`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleMaps: {} }],
    generationConfig: { temperature: 0 },
  }
  if (near) body.toolConfig = { retrievalConfig: { latLng: { latitude: near.lat, longitude: near.lng } } }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Gemini ${res.status}`)
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('\n').trim()
  const chunks = cand?.groundingMetadata?.groundingChunks || []
  const places = chunks.map((c) => c.maps).filter(Boolean).map((m) => ({ title: m.title, uri: m.uri, placeId: m.placeId }))
  return { text, places }
}

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'dispatch-planner/1.0 (vercel)', 'Accept-Language': 'en' } })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.length) return null
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: data[0].display_name }
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
  for (const model of GEMINI_MODELS) {
    try {
      const { text, places } = await askGemini(key, model, q, city, near)
      const am = text.match(/ADDRESS:\s*(.+)/i)
      const address = am ? am[1].trim() : null
      if (!address || /^NONE$/i.test(text)) return res.status(200).json({ found: false, model, text, places })
      // Address -> point. Try the full address, then progressively shorter versions.
      const parts = address.split(',').map((s) => s.trim()).filter(Boolean)
      let hit = null
      for (let n = parts.length; n >= 2 && !hit; n--) {
        hit = await nominatim(parts.slice(-n).join(', ') + (city && !address.toLowerCase().includes(city.toLowerCase()) ? `, ${city}` : ''))
        if (!hit) await new Promise((r) => setTimeout(r, 1100))
      }
      return res.status(200).json({ found: true, model, address, lat: hit?.lat ?? null, lng: hit?.lng ?? null, label: hit ? `${q}, ${address}` : null, places })
    } catch (e) {
      last = e
    }
  }
  return res.status(502).json({ error: last?.message || 'Gemini failed' })
}
