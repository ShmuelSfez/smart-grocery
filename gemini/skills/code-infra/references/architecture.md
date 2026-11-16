# SmartCart Architecture & Data Flows

## 1. End-to-End Data Flows

### Flow A: Adding Items & Comparing All Supermarket Prices
1. User enters free text (`2 חלב, סלק לפחות 5`), selects a recipe, or imports from Google Sheets (`web/js/app.js`).
2. `parser.js` extracts `{ name, qty, unit, note }`; `categories.js` assigns an aisle (`produce`, `dairy`, etc.).
3. `app.js` calls `GET /api/search?q=<name>&limit=9` (rate-limited, coalesced, 10-min TTL cached):
   - **Local (`serve.mjs`):** Queries Shufersal (`/online/he/search/results`) and Rami Levy (`/api/catalog`) live, matches by barcode, computes 5-chain price matrix (`ramilevy`, `yochananof`, `victory`, `carrefour`, `shufersal`), and flags sponsored brands.
   - **Cloud (`api/search.js` on Vercel):** Attempts live queries; if supermarket WAFs block Vercel cloud IPs, serves `FALLBACK_CATALOG` (and marks `estimated: true`) until Phase 2 XML feed DB ingestion replaces scraping.
4. `computeChainTotals()` combines item quantities, selected brands, city coverage (`CITY_DELIVERY_PROFILES`), delivery fees, free-delivery thresholds, and preference (`cheapest` vs `fastest`) to pick the optimal chain automatically.

### Flow B: Google Sheets Smart Import & Export
1. User clicks **📊 ייבוא / ייצוא Google Sheets** (`#dlgSheets` in `web/index.html`).
2. Either:
   - Fetches via `GET /api/sheet?url=<google-sheet-url>` (strictly restricted to `docs.google.com/spreadsheets/d/<id>/export?format=csv`); if private (`403 PRIVATE_SHEET`), opens `#dlgSheetPerm` permission guide modal; OR
   - Reads pasted TSV directly from clipboard or uploaded `.csv` file.
3. `sheets.js` (`parseGrid` + `analyzeSheetGrid`) tracks active column headers top-down and splits cells into:
   - `relevant`: Supermarket items with normalized names, quantities, and aisles.
   - `skipped`: Column/section headers (`ציוד בניה`, `קניות כלליות`, `שמואל`, etc.) plus item-level rules for tools/hardware, furniture, durable kitchenware, electronics, and clothing.
4. Export builds a UTF-8 BOM CSV (`exportListToCsv`) or clipboard TSV.

### Flow C: 1-Click Cart Fill via Chrome Extension
1. Clicking **שלח סל ל...** encodes selected items + chosen product codes + optional email hint (`auth.user`, never passwords) via `SLCodec.encodeList()` into `#smartlist=<payload>` on the target store URL (`shufersal.co.il` or `rami-levy.co.il`).
2. Inside the store tab:
   - `extension/capture.js` (`document_start`) saves `#smartlist=` into `chrome.storage.local` (`pending`) and cleans the URL hash.
   - `extension/panel.js` (`document_idle`) decodes `pending` via `SLCodec.decodePayload()`:
     - On **Shufersal**: if not logged in, redirects to `/online/he/login` and pre-fills `#j_username` (email only); once logged in, reloads once to refresh CSRF and POSTs `/online/he/cart/addGrid`.
     - On **Rami Levy**: searches `/api/catalog` if needed and POSTs `/api/v2/cart`.
     - Items with placeholder codes (`SEARCH_*` from cloud fallback) are re-searched live inside the user's residential browser session before adding.

### Flow D: Real-Time Family Sync (Local Prototype)
- `?room=<id>` polls `GET /api/room?id=<id>` every 2.5s and pushes changes via `POST /api/room?id=<id>` in `serve.mjs` (in-memory `Map`, pending Phase 3 Supabase Realtime migration on Vercel).

---

## 2. Security & Deployment Boundaries
- **CSP & Headers:** Configured identically in `serve.mjs` (`SEC_HEADERS`) and `vercel.json` (`headers`). Allowlisted image hosts: `res.cloudinary.com`, `*.shufersal.co.il`, `img.rami-levy.co.il`.
- **Decompression Bomb Protection:** `SLCodec.streamBytesBounded()` aborts above 256 KB decompressed output; max 200 items per payload.
- **No Server Secrets Committed:** AI key stays optional in user's browser `localStorage` until Phase 3 server proxy (`/api/ai`).
