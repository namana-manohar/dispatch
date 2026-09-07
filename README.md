# Dispatch Planner

For a small delivery business. You pick which clients get a delivery today; the app tells you **how many people to send, how many autos and Porters to book, and the route for each one**.

Live: https://dispatch-seven-xi.vercel.app

## How a day works

1. **Once:** import the whole client list (paste from WhatsApp, or upload Excel / Word / CSV / text). Press **Locate all** so every client is on the map; for any that is not found by name, press **Pin** and place it on the map. Set the **Starting point** (where the boys load and start): search it, press **Use my location** while standing there, or **Pick on map** and drag the pin. A pasted Google Maps link works too. Under **Profile & settings** (the button at the bottom of the left panel, or your email at the top), add the delivery boys' names and tick "by Porter" on box sizes too big for a bike. The starting point and city can be changed there too. All of this is remembered. Two clients with the same name at different addresses are simply two entries; the address is shown under the name.
2. **Each morning:** in the top bar set how many people, autos and Porters you have today. Press **Send today** on each client getting a delivery: gate or department if the client has several, box sizes and counts, ⚡ urgent if it must reach within the urgent window (1–3 h, set at the top), "Collect first from …" if the boxes are picked up somewhere else, or "Collect only" for cheques and returns. The same client can be sent to more than once.
3. **Read the answer:** "Send 3 people on 3 routes + book 1 auto + 1 Porter (6 stops)". If the plan needs more autos or Porters than you entered, it says how many more to book. Each route card shows the stops in order, arrival times, boxes by size, distance, and when the person is back. Press **Map** for the route on a map, **Navigate** for turn-by-turn in Google Maps (long routes get one link per ten stops), **WhatsApp** to hand the route to the delivery boy.

**History.** Pressing **Clear day** saves the day into *Profile & settings → History*: every route, who took it, the stops in order with arrival times and boxes. "Save today's plan now" saves without clearing. Days can be removed from the history.

## What the planner guarantees

- All drops at one client (different gates or departments) go to the same person, one after another.
- A pickup is always visited before its delivery, by the same person.
- ⚡ Urgent stops go first on their route and are spread across routes so each is reached within the urgent window. If one still cannot make it, the plan says so.
- Collect-only stops (cheques, returns) come after the drops on their route.
- Drops with Porter-only boxes go on Porter trips.
- Routes stay under the *max stops* and *max hours* per person. If that needs more routes than you have people, the longest extra routes go to hired autos.
- Fewest people by default. "Use all N" spreads the drops evenly so everyone finishes early.
- Stops are ordered nearest-first and then untangled, so a route does not zigzag across the city. If you still disagree, use **Move…** on a stop to put it on another route.

Road distances and times come from OpenStreetMap routing once a route's map has been opened; before that the estimate uses straight-line distance and the average speed setting. Box sizes are labels only. The app does not decide what fits on which vehicle; the owner does.

## Accounts and sync

Sign in with email and password (Supabase). Everything is saved to the account within a second, so any phone or laptop signed in with the shop login sees the same clients and today's plan. Without the two `VITE_SUPABASE_*` variables the app runs in local-only mode (data stays in that browser). Schema: `supabase/schema.sql`.

## Finding shops by name

Address lookup uses OpenStreetMap's Nominatim, then a name-friendly search (Photon). When neither knows a shop, the server route `api/place.js` asks Gemini with Google Maps grounding (needs `GEMINI_API_KEY` as a server-side secret) and returns the Google Maps address, place id and link. The pin from that is approximate and flagged; navigation links use the place id so the delivery boy is sent to the exact business. Road routing uses the public OSRM server. These services are rate-limited, so lookups run one per second.

## Google Maps (optional, recommended)

With a Google Maps Platform key the app uses Google for shop-name suggestions as you type, place lookup, address geocoding and road routes. Without it, it falls back to OpenStreetMap services (free, weaker on shop names).

1. In Google Cloud, create a project, enable **Places API (New)**, **Geocoding API** and **Routes API**, attach billing (India's free allowance covers far more than this app uses).
2. Create an API key. Restrict it: *Application restrictions* → HTTP referrers → `https://dispatch-seven-xi.vercel.app/*` and `http://localhost:5174/*`; *API restrictions* → the three APIs above.
3. Set it as `VITE_GOOGLE_MAPS_KEY` (Vercel env var, or `.env.local` for local runs) and redeploy.

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

Project `dispatch` in the "drop" team (scope `drop22`). The Vercel CLI is a dev dependency.

```bash
npx vercel deploy --prod --yes --scope drop22
```

`npm run build` must be green first. If the CLI is logged out, `npx vercel login` first.

## Notes

- PDF import is not supported. Copy the text out of the PDF and paste it.
- Data from earlier versions of this app is migrated automatically.
