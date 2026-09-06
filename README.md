# Dispatch Planner

For a small delivery business. You pick which clients get a delivery today; the app tells you **how many people to send and the route for each one**.

## How a day works

1. **Once:** import the whole client list (paste from WhatsApp, or upload Excel / Word / CSV / text). Press **Locate all** so every client is on the map. Under *Setup*, type the shop address and press Locate, add the delivery boys' names, and tick "by Porter" on box sizes too big for a bike. All of this is remembered. Two clients with the same name at different addresses are simply two entries; the address is shown under the name.
2. **Each morning:** set how many people are available and whether a Porter is booked (top bar). Press **Send today** on each client getting a delivery: gate or department if the client has several, box sizes and counts, and "Collect first from …" if the boxes are picked up somewhere else. The same client can be sent to more than once.
3. **Read the answer:** "Send 3 people on 3 routes + Porter: 1 trip, 6 stops". Each route card shows the stops in order, arrival times, boxes by size, distance, and when the person is back at the shop. Press **Map** for the route on a map, **Open in Google Maps** for turn-by-turn, **Send on WhatsApp** to hand the route to the delivery boy.

## What the planner guarantees

- All drops at one client (different gates or departments) go to the same person, one after another.
- A pickup is always visited before its delivery, by the same person.
- Drops with Porter-only boxes go on the Porter route when a Porter is booked. Without one they are planned with the rest and flagged.
- Routes stay under the *max stops* and *max hours* per person set at the top. If that needs more people than you have, the work is shared over the people you have and the routes that run over are marked.
- Fewest people by default. "Use all N" spreads the drops evenly so everyone finishes early.
- Stops are ordered nearest-first and then untangled, so a route does not zigzag across the city. If you still disagree, use **Move…** on a stop to put it on another route.

Road distances and times come from OpenStreetMap routing once a route's map has been opened; before that the estimate uses straight-line distance and the average speed setting. Box sizes are labels only. The app does not decide what fits on which vehicle; the owner does.

Data is saved in the browser (localStorage). No login, no server. Address lookup uses OpenStreetMap's Nominatim, road routing the public OSRM server. Both are free and rate-limited, so lookups run one per second.

## Run locally

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Dry-run the planner on a sample day without a browser:

```bash
node scripts/plan-scenario.mjs
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
- Data from earlier versions of this app is migrated automatically.
