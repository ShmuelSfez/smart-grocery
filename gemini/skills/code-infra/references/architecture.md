# SmartCart Architecture & Data Flows

## 1. End-to-End Data Flows

### Flow A: Daily Official Price Transparency Pipeline (`pipeline/` → GitHub Pages `data/v1/`)
1. `pipeline/build.mjs` runs `sources/shufersal.mjs` (`prices.shufersal.co.il`), `sources/ramilevy.mjs` (`url.publishedprices.co.il`), and `sources/carrefour.mjs` (`prices.carrefour.co.il`, merging today + yesterday folders so early-morning runs never miss branches).
2. `parse.mjs` gunzips and decodes UTF-8 / UTF-16LE / Windows-1255 XML for `Stores` and `PriceFull`; `cities.mjs` maps numeric CBS locality codes (`סמל ישוב`, e.g. `6400` → `הרצליה`) using `pipeline/data/cbs-cities.json` (+ live `data.gov.il` refresh).
3. `promos.mjs` parses `PromoFull` and keeps **only** active, unconditional, non-coupon promotions open to all customers (`ClubID` empty or starting with `0`), producing `{ type: 'price', price }` or `{ type: 'bundle', qty, price }`.
4. Output written to `data/v1/` (gitignored on `main`, published to orphan `gh-pages` via `pipeline/publish-pages.mjs`):
   - `meta.json` — build timestamp and per-chain branch/product/promo counts.
   - `cities.json` — `cityName -> [{ chain, storeId, name, address }]` (only physical branches with valid price files).
   - `online.json` — `chainId -> [{ storeId, name, address, itemsCount, quick }]` (`StoreType=2` online fulfilment stores for home delivery pricing).
   - `<chain>/catalog.json` — `code -> [name, manufacturer, qty, unit, weighted]`.
   - `<chain>/stores/<storeId>.json` — `code -> [price, unitPrice, promo?]`.

### Flow B: Browser City/Branch Selection & Honest Basket Comparison (`web/js/prices.js` + `pricing.js`)
1. On boot, `app.js` loads `web/data/delivery.json`, `web/data/sponsored.json`, `meta.json`, and `cities.json` (using `/data/v1` locally if built, else `https://shmuelsfez.github.io/smart-grocery/data/v1`).
2. When the user selects a city (and optionally changes any chain's `סניף ▾` dropdown), `prices.js` loads `<chain>/catalog.json` (cached per chain) and `<chain>/stores/<storeId>.json`. Failed requests are evicted from cache rather than cached as empty.
3. `matchLineAcrossChains()` implements **Q15 hybrid matching**:
   - **Pinned product:** matches exact normalized barcode (`kind: 'exact'`); if a chain lacks that barcode, picks the closest normalized Hebrew name match in that branch (`kind: 'substitute'`).
   - **Generic unpinned item:** picks each chain's best stem-aware name match without mutating `it.product` or `mappings`.
4. `compareBasket()` in `pricing.js` computes per-chain subtotals, all-customer promo savings, verified delivery fees, missing items, substitutes, and weight estimates. Only chains with `complete === true` (zero missing items) are eligible for `cheapestId`.

### Flow C: Google Sheets Smart Import & Export (`web/js/sheets.js` + `api/sheet.js`)
1. `GET /api/sheet?url=<google-sheet-url>` (shared between Vercel `api/sheet.js` and local `serve.mjs`) fetches only `docs.google.com/spreadsheets/d/<id>/export?format=csv` and validates every redirect hop.
2. `analyzeSheetGrid()` separates supermarket items from section headers, hardware/DIY (`ציוד בניה`), furniture, electronics, and durable kitchenware.

### Flow D: Optional Desktop Cart Fill (`extension/` v2.3.0)
1. `capture.js` stores `#smartlist=` with `autoAdd: false`.
2. `panel.js` never auto-submits on page load and never overwrites saved `mappings` or `shufAuth` from incoming link payloads:
   - **Shufersal:** previews items and POSTs `/online/he/cart/addGrid` **only** when the user clicks `"הוסף לסל"`.
   - **Rami Levy:** runs in **guided search-and-add** mode (`/he/online/search?q=...` + manual checkoff) so existing carts are never overwritten.

---

## 2. Security & Quality Boundaries
- **Strict CSP (No `'unsafe-inline'`):** Configured in `serve.mjs` and `vercel.json`. `connect-src` allows `'self'`, `https://shmuelsfez.github.io`, and `https://generativelanguage.googleapis.com`.
- **Decompression Bomb Cap:** `SLCodec` enforces a 32 KB encoded cap, 256 KB streaming decompressed cap (`deflate` `'d'`, legacy `deflate-raw` `'z'`, plain `'p'`), 200-item cap, and image host allowlist.
- **Feature-Flagged Family Sync:** `FEATURES.familySync` is enabled only on `localhost`/`127.0.0.1`, uses 96-bit `crypto.getRandomValues` room IDs, sanitizes room payloads, and never polls when inactive.
- **PWA Shell Caching:** `web/sw.js` uses network-first caching strictly for static shell files and excludes `/api/*` and `/data/*`.
