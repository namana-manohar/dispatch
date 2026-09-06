# Dispatch Planner

A simple tool for a dispatcher to:
- Add delivery boys
- Add drop locations, with how long the work takes there
- Assign drops to delivery boys
- See a suggested route order, per-stop time, and total finish time

Data is saved in the browser (localStorage) — no login, no server, no database. Whoever opens the site on their own device sees their own saved data.

## Run it locally first

You'll need [Node.js](https://nodejs.org) installed (v18+).

```bash
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`).

## Deploy to Vercel (free)

**Easiest way — no GitHub needed:**
```bash
npm install -g vercel
vercel
```
Follow the prompts (log in, confirm project settings, deploy). It'll give you a live URL in under a minute.

**Or via GitHub (better if you'll keep updating it):**
1. Push this folder to a new GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. Vercel auto-detects Vite — just click Deploy.

Either way, you get a free `.vercel.app` URL you can share or bookmark.

## Notes on routing

- If you add latitude/longitude for a drop (long-press a pin in Google Maps to get coordinates), the app auto-orders stops and estimates travel time using straight-line distance and your average speed setting — it's an estimate, not real road routing.
- Without coordinates, you order stops manually with the up/down arrows, and the tool just totals up the on-site work time.
- Average speed and day start time are both editable at the top.

## Possible next steps (not built yet)

- Multiple dispatchers with logins (would need a real backend, e.g. Supabase)
- Real road-distance routing via a maps API
- Export the day's plan to WhatsApp/PDF
