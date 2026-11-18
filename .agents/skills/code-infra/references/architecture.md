# SmartCart Architecture & End-to-End Data Flows

## 1. End-to-End Data Flows

### Flow A: Daily Official Price Transparency Pipeline (`pipeline/` → Orphan `gh-pages` `data/v1/`)
1. `pipeline/build.mjs` invokes `sources/shufersal.mjs` (`prices.shufersal.co.il` → Azure Blob), `sources/ramilevy.mjs` (`url.publishedprices.co.il` Cerberus session), and `sources/carrefour.mjs` (`prices.carrefour.co.il`, merging today + yesterday date folders so early-morning runs never miss branches).
2. `pipeline/parse.mjs` (`decodeFeedBuffer`) decompresses `.gz` (`0x1f 0x8b`) **and** disguised ZIP files carrying `.gz` filenames (`PK\x03\x04` via `web/js/zip.js`), then decodes `UTF-8`, `UTF-16LE`, `UTF-16BE`, or `Windows-1255` / `ISO-8859-8` XML for `Stores` and `PriceFull`.
3. `pipeline/cities.mjs` maps numeric CBS locality codes (`סמל ישוב`, e.g., `6400` → `הרצליה`) via `pipeline/data/cbs-cities.json` (+ live `data.gov.il` refresh and store-name fallback).
4. `pipeline/promos.mjs` parses `PromoFull` across both `<PromotionItem>` (Shufersal/Carrefour) and `<PromotionItems><Item>` (Rami Levy), keeping **only** active, unconditional, non-coupon promotions open to all customers (`ClubID` empty or starting with `0`) on non-weighted items (`{ type: 'price', price }` or `{ type: 'bundle', qty, price }`).
5. `serializeBranchItems()` writes compact tuples to `data/v1/` (gitignored on `main`, published as a single-commit orphan branch to `gh-pages` by `pipeline/publish-pages.mjs`):
   - `meta.json` — build timestamp, city count, and per-chain store/catalog/promo stats.
   - `cities.json` — `cityName -> [{ chain, storeId, name, address }]` (`StoreType=1` physical branches with `>0` parsed items).
   - `online.json` — `chainId -> [{ storeId, name, address, city, itemsCount, quick }]` (`StoreType=2` online fulfilment stores: Shufersal `413`, Rami Levy `39`, Carrefour `471/472/473`, sorted standard-first).
   - `<chain>/catalog.json` — `code -> [name, manufacturer, qty, unit, weighted]`.
   - `<chain>/stores/<storeId>.json` — `code -> [price, unitPrice, promo?]`.

### Flow B: Delivery vs. In-Store Mode & Honest Basket Comparison (`web/js/prices.js` + `pricing.js`)
1. On boot, `web/js/app.js` loads `web/data/{delivery,delivery-coverage,sponsored}.json` plus `meta.json`, `cities.json`, and `online.json` (from local `/data/v1` when present, else `https://shmuelsfez.github.io/smart-grocery/data/v1`).
2. **Mode Selection:**
   - **`🚚 משלוח הביתה` (Default):** Prices each live chain directly from its official `StoreType=2` online fulfilment store in `online.json`, surfacing human-verified city delivery coverage (`delivery-coverage.json`).
   - **`🏬 קנייה בסניף פיזי`:** Filters `cities.json` by user-selected city and per-chain `סניף ▾` dropdown.
   - Rejected fetches in `prices.js` are evicted from cache rather than cached as empty objects.
3. **Q15 Hybrid Product Matching (`matchLineAcrossChains`):**
   - Bare ambiguous terms (`it.ambiguous`) and unchecked/bought items (`it.checked === false`) are skipped from pricing; any unresolved `it.ambiguous` forces `cheapestId = null`.
   - **Pinned item (`it.product.code`):** Matches exact normalized barcode (`kind: 'exact'`); if absent at another chain, selects that branch's closest normalized Hebrew name match (`kind: 'substitute'`, badged `"חלופה"`) without mutating `it.product` or `mappings`.
   - **Generic unpinned item:** Picks each chain's best stem-aware catalog match without silently saving to `mappings`.
4. **Honest Basket Math (`compareBasket`):**
   - Computes `subtotal`, `promoSavings`, verified `deliveryFee`, `total`, `missing`, `substitutes`, and weight `estimated` flags.
   - Only chains with `complete === true` (`missing.length === 0`) can win `cheapestId`. When `includeDelivery` is active and complete chains mix numeric `fee` with `null` (`"לא ידוע"`), ranking and `savings` compare on product `subtotal` (`comparedOnSubtotalOnly: true`).

### Flow C: Unified Multi-Channel Import Engine (`importer.js` + `sheets.js` + `synonyms.js` + `xlsx.js` + `api/sheet.js`)
1. Free text / WhatsApp paste (`importFromText`), CSV/TSV (`importFromSheetText`), SSRF-guarded Google Sheets `/api/sheet?url=...`, and styled binary `.xlsx` workbooks (`parseXlsxBuffer` → `importFromGrid`) all converge through `enrichAndDeduplicateItems` → `applyItemsToList`.
2. `analyzeSheetGrid()` and `IRRELEVANT_ITEM_RULES` strip headers, timestamps, DIY/hardware, furniture, electronics, and errands into `skipped` (with Hebrew reasons), mark bought rows (`✅`, `[x]`, `~~...~~`, Excel `<strike/>`, bought status columns) with `checked: false`, flag bare hypernyms via `checkAmbiguousTerm`, and merge morphological/English/Hebrew equivalents via `resolveGrocerySynonym` without merging competing brands (`brandTag`).

### Flow D: Optional Desktop Chrome Extension (`extension/` v2.3.0 — Frozen Bonus)
1. `capture.js` stores incoming `#smartlist=` payloads with `autoAdd: false`.
2. `panel.js` decodes via `SLCodec`, never auto-submits on load, and never overwrites saved `mappings` or `shufAuth`:
   - **Shufersal:** Previews items and POSTs `/online/he/cart/addGrid` only after an explicit click on `"הוסף לסל"`.
   - **Rami Levy:** Runs strictly in **guided search-and-add** mode (`/he/online/search?q=...` + manual checklist) so existing carts are never overwritten.

---

## 2. Security & Reliability Boundaries
- **Strict CSP (No `'unsafe-inline'`):** Enforced in `vercel.json` and `serve.mjs` (`script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'`).
- **Bounded Streaming Decompression:** `SLCodec` enforces a `32 KB` encoded cap, `256 KB` streaming decompressed cap, `200`-item cap, and image host allowlist; `web/js/xlsx.js` enforces `XLSX_LIMITS` entry/byte caps.
- **SSRF Protection (`api/sheet.js`):** Accepts only `docs.google.com/spreadsheets/d/<id>` URLs and re-validates host/protocol on every HTTP redirect hop.
- **Localhost-Only Family Sync:** `FEATURES.familySync` is enabled only on `localhost`/`127.0.0.1` with 96-bit `crypto.getRandomValues` room IDs and strict item sanitization.
- **PWA Shell Service Worker (`web/sw.js`):** Network-first for static shell files only; never caches `/api/*`, `/data/*`, or `.zip`.
