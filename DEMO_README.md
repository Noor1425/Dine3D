# Frontend Demo (fully standalone)

This folder is a self-contained copy of `../frontend` for demoing the UI —
**it has no dependency on anything else in this project.** No backend
process, no Postgres, no Redis. You can zip up just this `frontend-demo`
folder, hand it to someone else, and it runs on their laptop with:

```bash
npm install
npm run dev
```

Then open **http://localhost:3002/admin/login** and click **"Try Demo
(Restaurant Owner)"**.

## How it works

Every `/api/*` call is answered in-process by
[`src/app/api/[...path]/route.js`](src/app/api/%5B...path%5D/route.js),
which dispatches to a mock router
([`src/mocks/router.js`](src/mocks/router.js)) reading and writing an
in-memory "database" seeded in
[`src/mocks/seed.js`](src/mocks/seed.js). There is no real backend, no
database, and no network call to anything outside this Node process.

The seed data is a mix of:
- **Real data**, captured live from an actual seeded Dine3D restaurant
  (26 menu items across 7 categories, with real variants/modifiers/prices) —
  see `src/mocks/seed/menu.json` and `categories.json`.
- **Hand-authored demo data** for everything else — orders, inventory,
  staff, riders, invoices, locations, tables, promos, etc. — built to look
  and behave like a real, active restaurant.

The subscription plan is set to a fully-featured "Business" plan so no
screen shows an upsell/entitlement wall during a demo.

## What's covered

Nearly every module in the sidebar has working, populated mock data:
Dashboard, POS Terminal, Kitchen (KDS), Order History, Menu Items,
Categories, Inventory, Delivery, Team, Locations (multi-branch), Activity
log, Data & History (exports), Billing, Subscription, Settings/Theme, and
Tables & QR — plus the customer-facing storefront itself, reachable at
`http://foodpanda-pk.localhost:3002/<tableQrToken>` (get a token from the
Tables page, or from `GET /api/tables` while logged in).

A long tail of deeper sub-features (purchase orders, supplier CRM, waste/
margin/food-cost analytics, cost trends, stock-transfer detail flows) falls
back to a generic empty-but-safe response rather than a hand-built one — the
screen loads without crashing, just without rich data.

## Data lifecycle

The mock database lives in memory for the life of the Node process (a
module-level singleton). Any changes you make in the UI (creating an order,
editing a menu item, etc.) persist until the dev server restarts, then reset
to the original seed. That's intentional for a demo — every run starts from
the same clean state.

Dates in the seed (today's orders, "last 30 days" charts, etc.) are computed
relative to when the server process starts, so if it's been running across
a midnight rollover, restart it before a demo so "today's" numbers line up.

## Known limitations

- **Live Socket.IO updates won't connect** (console shows repeated
  WebSocket connection failures to port 4000) — this is cosmetic. Nothing in
  the UI depends on it; all data loads over plain REST, which is fully
  mocked. Real-time push updates (e.g. a new order appearing on the KDS
  without a refresh) just won't fire.
- **Login is a fixed demo account.** The Demo button and the manual form
  both only accept the seeded owner: restaurant code `DINE-1000`, email
  `asjad@gmail.com`, password `Velvet-Lantern-Sky-731!`. There's no real
  registration/password flow — it's not backed by anything.
- **Export downloads** (Data & History → Download Excel/CSV) hit the
  generic fallback and won't produce a real spreadsheet file.
- Some deep, rarely-demoed sub-screens (see "What's covered" above) show
  empty states rather than hand-built data.
