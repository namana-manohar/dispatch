# Dispatch Planner

A small tool for one dispatcher running a few delivery boys and vehicles:

- **Delivery boys** — add names, assign each to a vehicle.
- **Materials & box sizes** — each material has a *space per box*, measured in standard boxes. A tile box twice the size of a standard box = 2; half the size = 0.5. Standard / Small / Large are pre-loaded; add Tiles, Cement, etc. with their real sizes.
- **Fleet** — iQube, Ather and TVS pre-loaded with a capacity in standard boxes. Add an Auto when you hire one for the day or a Porter trip when you book one. Every vehicle card shows *space used / capacity* and turns red when over, telling you what to move to an auto or Porter.
- **Drops** — a drop has a name, address, one or more material lines (e.g. 6 × Tiles + 2 × Cement), work minutes at the stop, and optional coordinates.
- **Import list** — paste the day's list from WhatsApp, or upload Excel (.xlsx), Word (.docx), CSV or .txt. One drop per line, e.g. `Sharma Tiles, 4th Block Jayanagar, 6 boxes tiles, 2 cement`. Names, addresses, materials, box counts, minutes and coordinates are picked up automatically, shown in a preview table you can correct before adding. Spreadsheets with a header row (name / address / material / boxes / minutes / lat / lng / phone) are mapped by column.
- **Routes** — with coordinates on every stop, stops are auto-ordered by nearest-neighbour with estimated travel time; without, you order by hand. Each stop has a Google Maps link.

Data is saved in the browser (localStorage). No login, no server. Whoever opens the site on their own device sees their own saved data.

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

- Travel time uses straight-line distance and the average speed set at the top. It is an estimate, not road routing.
- PDF import is not supported yet. Copy the text out of the PDF and paste it instead.
- Old data from the first version of this app (boxes without materials) is migrated automatically as standard boxes.
