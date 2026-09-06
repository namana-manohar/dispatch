# Dispatch Planner

For a small delivery business. You pick which clients get a delivery today; the app tells you **how many people to send and the route for each one**.

## How a day works

1. **Once:** import the whole client list (paste from WhatsApp, or upload Excel / Word / CSV / text). Press **Locate all** so every client is on the map. Under *Setup*, type the shop address and press Locate. All of this is remembered.
2. **Each morning:** press **Send today** on each client getting a delivery. Give the drop its gate or department if the client has several, and the box sizes and counts. The same client can be sent to more than once (different gates).
3. **Read the answer:** "Send 3 people on 3 routes". Each route card shows the stops in order, arrival times, boxes by size, distance, and when the person is back at the shop. Press **Map** for the route on a map, **Open in Google Maps** for turn-by-turn, **Send on WhatsApp** to hand the route to the delivery boy.

Routing is automatic. Drops are grouped by direction from the shop, each route is kept under the *max stops* and *max hours* per person set at the top, and stops are ordered nearest-first. Road distances and times come from OpenStreetMap routing once a route's map has been opened; before that the estimate uses straight-line distance and the average speed. If you disagree with a grouping, use **Move…** on a stop to put it on another route or a new one.

Box sizes are labels only (Small / Medium / Large by default, add your own). The app does not decide what fits on which vehicle. The owner does.

Data is saved in the browser (localStorage). No login, no server. Address lookup uses OpenStreetMap's Nominatim, road routing the public OSRM server. Both are free and rate-limited, so lookups run one per second.

## Run locally

Needs Node.js 18+.

```bash
npm install
npm run dev
```

## Deploy to Vercel

The Vercel CLI is a dev dependency, so no global install is needed.

```bash
npx vercel login        # sign in as the account that owns the "drop" team
npx vercel --prod       # first run: pick the "drop" scope, accept the Vite defaults
```

Later deploys are just `npx vercel --prod` again. `npm run build` must be green first.

## Notes

- PDF import is not supported. Copy the text out of the PDF and paste it.
- Data from earlier versions of this app (drops loaded onto vehicles) is migrated into clients and today's drops automatically.
