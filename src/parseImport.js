// Turns pasted text or an uploaded file into candidate drops.
// Supported: plain text, CSV/TSV, Word (.docx), Excel (.xlsx/.xls).

const HEADER_WORDS = {
  name: ['name', 'customer', 'party', 'shop', 'client'],
  address: ['address', 'location', 'place', 'area', 'site', 'drop'],
  boxes: ['boxes', 'box', 'qty', 'quantity', 'nos', 'count', 'pcs', 'bags'],
  material: ['material', 'item', 'product', 'type'],
  workMinutes: ['minutes', 'mins', 'time', 'work'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  phone: ['phone', 'mobile', 'contact', 'number'],
}

function normalize(s) {
  return String(s ?? '').trim()
}

function splitCsvLine(line, sep) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === sep && !inQ) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function detectHeader(row) {
  const cells = row.map((c) => normalize(c).toLowerCase())
  let hits = 0
  const map = {}
  cells.forEach((cell, i) => {
    for (const [field, words] of Object.entries(HEADER_WORDS)) {
      if (map[field] !== undefined) continue
      if (words.some((w) => cell === w || cell.startsWith(w + ' ') || cell.endsWith(' ' + w) || cell === w + 's')) {
        map[field] = i
        hits++
        break
      }
    }
  })
  // A header needs at least an address-ish or name-ish column and no numeric cells
  const numeric = cells.filter((c) => c && !isNaN(Number(c))).length
  return hits >= 2 && numeric === 0 && (map.address !== undefined || map.name !== undefined) ? map : null
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const UNIT = '(?:boxes?|bags?|nos\\.?|pcs|pieces|units|cartons?|packs?|bundles?)'

// Pull "5 boxes tiles", "tiles x 3", "3 cement bags" etc. out of a free-text line.
export function extractLines(text, materials) {
  const found = []
  let rest = text
  for (const m of materials) {
    const name = escapeRe(m.name)
    const patterns = [
      new RegExp(`(\\d+)\\s*${UNIT}?\\s*(?:of\\s+)?${name}\\b\\s*${UNIT}?`, 'i'),
      new RegExp(`\\b${name}\\b\\s*${UNIT}?\\s*[x×:\\-–=]?\\s*(\\d+)\\s*${UNIT}?`, 'i'),
    ]
    for (const re of patterns) {
      const hit = rest.match(re)
      if (hit) {
        found.push({ materialId: m.id, boxes: parseInt(hit[1], 10) || 1 })
        rest = rest.replace(hit[0], ' ')
        break
      }
    }
  }
  if (found.length === 0) {
    const bare = rest.match(new RegExp(`(\\d+)\\s*${UNIT}`, 'i')) || rest.match(/\bx\s*(\d+)\b/i)
    if (bare) {
      found.push({ materialId: null, boxes: parseInt(bare[1], 10) || 1 })
      rest = rest.replace(bare[0], ' ')
    }
  }
  return { lines: found, rest }
}

function parseFreeLine(line, materials) {
  let text = line
  let workMinutes = null
  let lat = null
  let lng = null

  const mins = text.match(/(\d+)\s*(?:min|mins|minutes)\b/i)
  if (mins) { workMinutes = parseInt(mins[1], 10); text = text.replace(mins[0], ' ') }

  const coords = text.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/)
  if (coords) { lat = parseFloat(coords[1]); lng = parseFloat(coords[2]); text = text.replace(coords[0], ' ') }

  const { lines, rest } = extractLines(text, materials)
  let address = rest.replace(/\s{2,}/g, ' ').replace(/^[\s,;\-–|]+|[\s,;\-–|]+$/g, '').replace(/\s*,\s*,\s*/g, ', ').trim()
  // "Sharma Tiles, 4th Block Jayanagar" or "Ravi - 12th Main": a short leading
  // segment without digits is the customer's name.
  let name = ''
  const sep = address.match(/^([^,\-–:]{2,40}?)\s*(?:,|\s[-–:]\s)\s*(.+)$/)
  if (sep && !/\d/.test(sep[1]) && sep[1].trim().split(/\s+/).length <= 4 && sep[2].trim()) {
    name = sep[1].trim()
    address = sep[2].trim()
  }
  return { name, address, workMinutes, lat, lng, lines }
}

function rowsToDrops(rows, materials) {
  const clean = rows
    .map((r) => (Array.isArray(r) ? r.map(normalize) : [normalize(r)]))
    .filter((r) => r.some((c) => c))
  if (clean.length === 0) return []

  const header = clean[0].length > 1 ? detectHeader(clean[0]) : null
  if (header) {
    return clean.slice(1).map((r) => {
      const get = (f) => (header[f] !== undefined ? r[header[f]] || '' : '')
      const matName = get('material').toLowerCase()
      const mat = materials.find((m) => m.name.toLowerCase() === matName) ||
        materials.find((m) => matName && (matName.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(matName)))
      const boxes = parseInt(get('boxes'), 10)
      const lat = parseFloat(get('lat'))
      const lng = parseFloat(get('lng'))
      const minutes = parseInt(get('workMinutes'), 10)
      const phone = get('phone')
      let address = get('address')
      if (phone) address = address ? `${address} · ${phone}` : phone
      return {
        name: get('name'),
        address,
        workMinutes: isNaN(minutes) ? null : minutes,
        lat: isNaN(lat) ? null : lat,
        lng: isNaN(lng) ? null : lng,
        lines: [{ materialId: mat ? mat.id : null, boxes: isNaN(boxes) ? 1 : boxes }],
      }
    }).filter((d) => d.address || d.name)
  }

  // No header: join the cells of each row into one line and parse it freely
  return clean
    .map((r) => parseFreeLine(r.filter(Boolean).join(', '), materials))
    .filter((d) => d.address)
}

export function parseText(text, materials) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, ''))
    .filter((l) => l.trim())
  const tab = lines.filter((l) => l.includes('\t')).length
  if (tab > lines.length / 2) return rowsToDrops(lines.map((l) => splitCsvLine(l, '\t')), materials)
  const comma = lines.filter((l) => l.split(',').length >= 3).length
  if (comma > lines.length / 2) {
    const rows = lines.map((l) => splitCsvLine(l, ','))
    if (detectHeader(rows[0])) return rowsToDrops(rows, materials)
  }
  return rowsToDrops(lines, materials)
}

export async function parseFile(file, materials) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const rows = []
    wb.SheetNames.forEach((n) => {
      rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }))
    })
    return rowsToDrops(rows, materials)
  }
  if (ext === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser.js')
    const buf = await file.arrayBuffer()
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
    return parseText(value, materials)
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === 'md' || !ext) {
    const text = await file.text()
    if (ext === 'csv') return rowsToDrops(text.split(/\r?\n/).map((l) => splitCsvLine(l, ',')), materials)
    if (ext === 'tsv') return rowsToDrops(text.split(/\r?\n/).map((l) => splitCsvLine(l, '\t')), materials)
    return parseText(text, materials)
  }
  throw new Error(`Can't read .${ext} files yet. Use Excel, Word (.docx), CSV or plain text, or paste the addresses.`)
}
