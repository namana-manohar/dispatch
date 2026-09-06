// Dry run of the planner on a sample day, no browser needed:
//   node scripts/plan-scenario.mjs
import { planRoutes } from '../src/planner.js'

const C = [['Sharma Tiles',12.9303,77.5904],['Ravi Enterprises',12.9695,77.6383],['Anand Stores',12.9998,77.5713],['Bosch',12.9430,77.6100],['Prakash Hardware',12.9166,77.6101],['Kumar Traders',12.9352,77.6245],['Meena Agencies',12.9121,77.6446],['Lakshmi Stores',12.9420,77.5680],['Gopal Marbles',12.9250,77.5460],['Nandini Ceramics',12.8890,77.5860],['Sri Sai Traders',12.9490,77.5960],['Hebbal Depot',13.0350,77.5970],['Rajajinagar Mart',12.9910,77.5520],['Vijayanagar Supply',12.9720,77.5320],['Whitefield Interiors',12.9698,77.7500],['Marathahalli Decor',12.9560,77.7010],['Yelahanka Builders',13.1000,77.5960],['Electronic City Homes',12.8450,77.6600],['Kengeri Stores',12.9110,77.4830],['Shivajinagar Traders',12.9850,77.6070]]
const large = new Set(['Whitefield Interiors','Gopal Marbles','Hebbal Depot','Electronic City Homes','Nandini Ceramics','Kengeri Stores'])
let n = 0
const drops = []
C.forEach(([name, lat, lng]) => {
  const clientId = `c${n++}`
  if (name === 'Bosch') ['Dept A', 'Dept B', 'Stores'].forEach((note) => drops.push({ id: `d${drops.length}`, clientId, name, note, lat, lng, workMinutes: 15, porter: false }))
  else drops.push({ id: `d${drops.length}`, clientId, name, note: '', lat, lng, workMinutes: large.has(name) ? 15 : 10, porter: large.has(name) })
})
const depot = { lat: 12.9265737, lng: 77.5835041 }
const common = { depot, avgSpeed: 22, startTime: '09:00', legCache: {} }

function show(label, plan) {
  console.log(`\n== ${label}: ${plan.routes.length} routes (needed ${plan.needed}${plan.squeezed ? ', squeezed' : ''})`)
  plan.routes.forEach((r) => {
    console.log(`Route ${r.number}${r.overLimit ? ' OVER' : ''}: ${r.stops.length} stops, ${r.totalKm.toFixed(1)} km, ${Math.round(r.totalMin)} min, back ${r.backTime}`)
    console.log('   ' + r.stops.map((s) => s.name + (s.note ? ' (' + s.note + ')' : '')).join(' → '))
  })
}

const bikes = drops.filter((d) => !d.porter)
const porter = drops.filter((d) => d.porter)
show('fewest people', planRoutes(bikes, { ...common, maxStops: 8, maxHours: 4, people: 4 }))
show('use all 4', planRoutes(bikes, { ...common, maxStops: 8, maxHours: 4, people: 4, useAll: true }))
show('only 1 person', planRoutes(bikes, { ...common, maxStops: 8, maxHours: 4, people: 1 }))
show('porter', planRoutes(porter, { ...common, maxStops: 999, maxHours: 8 }))

// Pickup then delivery: collect at Kumar Traders, deliver to Yelahanka Builders
const kumar = bikes.find((d) => d.name === 'Kumar Traders')
const yel = bikes.find((d) => d.name === 'Yelahanka Builders')
const pickup = { ...kumar, id: 'pickup1', jobId: 'job1', kind: 'pickup', clientId: kumar.clientId, name: 'Collect at Kumar Traders', note: '' }
const delivery = { ...yel, id: 'job1', jobId: 'job1', after: 'pickup1', name: 'Yelahanka Builders (from Kumar)' }
const withPickup = [...bikes.filter((d) => d !== yel), pickup, delivery]
const pp = planRoutes(withPickup, { ...common, maxStops: 8, maxHours: 4, people: 4, useAll: true })
show('with a pickup job, all 4', pp)
pp.routes.forEach((r) => {
  const ip = r.stops.findIndex((s) => s.id === 'pickup1')
  const idl = r.stops.findIndex((s) => s.id === 'job1')
  if (ip >= 0 || idl >= 0) console.log(`Pickup at position ${ip + 1}, delivery at ${idl + 1} in route ${r.number}:`, ip >= 0 && idl > ip ? 'OK' : 'WRONG')
})

// Only 2 boys: the rest goes to hired autos
show('only 2 boys (autos take the rest)', planRoutes(bikes, { ...common, maxStops: 6, maxHours: 3, people: 2 }))

// Urgent: Yelahanka (far north) and Whitefield-ish Marathahalli must be reached within 2 h
const urgentSet = new Set(['Yelahanka Builders', 'Marathahalli Decor', 'Kengeri Stores'])
const withUrgent = bikes.map((d) => (urgentSet.has(d.name) ? { ...d, urgent: true } : d))
const up = planRoutes(withUrgent, { ...common, maxStops: 8, maxHours: 4, people: 4, urgentHours: 2 })
show('urgent stops within 2h', up)
up.routes.forEach((r) => r.stops.forEach((s, i) => { if (s.urgent) console.log(`  urgent ${s.name} at position ${i + 1}, arrives ${s.arrival}${s.late ? ' LATE' : ''}`) }))

// Collect-only (cheque) at Sharma Tiles must come after the drops on its route
const collect = { ...bikes.find((d) => d.name === 'Sharma Tiles'), id: 'cheque1', clientId: 'cheque-client', jobId: 'cheque1', collect: true, name: 'Cheque at Sharma', workMinutes: 5 }
const cp = planRoutes([...bikes, collect], { ...common, maxStops: 8, maxHours: 4, people: 4 })
cp.routes.forEach((r) => { const i = r.stops.findIndex((s) => s.id === 'cheque1'); if (i >= 0) console.log(`\nCheque stop is ${i + 1} of ${r.stops.length} on route ${r.number}:`, i === r.stops.length - 1 ? 'OK (last)' : 'NOT LAST') })

// Bosch must never be split
for (const [label, plan] of [['fewest', planRoutes(bikes, { ...common, maxStops: 8, maxHours: 4, people: 4 })], ['all', planRoutes(bikes, { ...common, maxStops: 8, maxHours: 4, people: 4, useAll: true })]]) {
  const where = plan.routes.filter((r) => r.stops.some((s) => s.name === 'Bosch')).map((r) => r.number)
  console.log(`\nBosch in routes (${label}):`, where, where.length === 1 ? 'OK' : 'SPLIT!')
}
