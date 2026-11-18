# Frontend & Browser Runtime Rules (`web/`)

These rules apply whenever reading or modifying files under `web/` (`index.html`, `styles.css`, `sw.js`, `data/*.json`, and `js/*.js`).

---

## 1. Pure ES Modules, Zero Bundler & Node Testability

1. **Zero Build Step & Zero NPM Packages:**
   - All modules under `web/js/` (except `web/js/codec.js`) are native browser ES modules loaded directly via `<script type="module" src="js/app.js?v=N">`.
   - Always include explicit `.js` extensions in relative `import` statements (e.g., `import { compareBasket } from './pricing.js';`).
2. **Keep Domain Modules Pure & Node-Compatible:**
   - `chains.js`, `parser.js`, `synonyms.js`, `categories.js`, `sheets.js`, `xlsx.js`, `zip.js`, `importer.js`, `prices.js`, `pricing.js`, `suggest.js`, and `recipes.js` are imported directly in Node 20 unit tests (`tests/*.test.mjs`) and the DV regression runner (`tests/regression/run.mjs`).
   - Do **not** touch `document`, `window`, or `navigator` at module top-level inside these pure modules. Keep all DOM rendering and event wiring inside `web/js/app.js`.
3. **Strict Dependency Direction (Zero Test/Pipeline Imports):**
   - Files in `web/**` must **never** import anything from `tests/**` or `pipeline/**`.
4. **Classic Script Exception (`web/js/codec.js`):**
   - `web/js/codec.js` is an IIFE attaching `SLCodec` onto `globalThis` so it works identically as a `<script>` in `web/index.html`, a content script in `extension/`, and in Node tests.

---

## 2. Safari / Mobile WebKit Compatibility & RTL UX

1. **No Regex Lookbehind:**
   - Never use regex lookbehind assertions (`(?<=...)` or `(?<!...)`) in `web/js/*.js`—older iOS Safari / WebKit versions throw a parse-time `SyntaxError` that breaks the entire app before boot. Use token boundaries, capture groups, or explicit index scanning instead.
2. **Web API Fallbacks:**
   - Guard modern APIs gracefully (`crypto.randomUUID` fallback in `app.js`; `CompressionStream` / `DecompressionStream` availability check in `codec.js` and `xlsx.js`).
3. **Mobile-First RTL Ergonomics:**
   - Maintain `<html lang="he" dir="rtl">`, touch-friendly hit targets, native `<dialog>` elements, `viewport-fit=cover`, and fast list interaction without layout thrash.

---

## 3. XSS, Strict CSP & Untrusted Input Bounds

1. **Never Pass Untrusted Data to `innerHTML`:**
   - Grocery item names, pasted WhatsApp/CSV/XLSX text, Google Sheets cells, supermarket XML catalog names/manufacturers, Gemini AI output, `#smartlist=` payloads, and `/api/room` items are **untrusted input**.
   - Build DOM nodes via `document.createElement` + `textContent` (or sanitize/escape strictly before any static template assembly). Never interpolate raw strings into `innerHTML` or `insertAdjacentHTML`.
2. **Strict Content-Security-Policy (No `'unsafe-inline'`):**
   - `vercel.json` and `serve.mjs` enforce `script-src 'self'; style-src 'self'`.
   - Never add inline `<script>` blocks, inline event handlers (`onclick="..."`), or inline `style="..."` attributes in `web/index.html` or JS-rendered elements—put styles in `web/styles.css` and toggle classes or `hidden`.
   - Only load product images from hosts allowlisted in both CSP `img-src` and `ALLOWED_IMG_HOST` (`codec.js`).
3. **Bounded Decompression & Parsing:**
   - Preserve `MAX_DECOMPRESSED_BYTES` (`256 KB`), item count (`200`), and field length caps in `web/js/codec.js`, and preserve `XLSX_LIMITS` streaming caps in `web/js/xlsx.js` + `web/js/zip.js`.

---

## 4. Cache Busting (`?v=N`), Service Worker & Extension Sync

1. **Asset Cache Busting (`web/index.html`):**
   - Whenever **any** file in `web/styles.css` or `web/js/*.js` changes, increment `?v=N` uniformly on all three tags in `web/index.html`:
     - `<link rel="stylesheet" href="styles.css?v=N" />`
     - `<script src="js/codec.js?v=N"></script>`
     - `<script type="module" src="js/app.js?v=N"></script>`
2. **Service Worker Scope (`web/sw.js`):**
   - Keep `web/sw.js` **network-first** and restricted strictly to static app-shell assets. It must **never** cache `/api/*`, `/data/*` price feeds, or `.zip` downloads so stale prices are never served from SW cache.
3. **`codec.js` → `extension/codec.js` & `shufersal-extension.zip` Sync:**
   - After editing `web/js/codec.js` (or anything in `extension/`), copy `web/js/codec.js` to `extension/codec.js` (enforced byte-for-byte by `tests/core.test.mjs`) and rebuild `web/shufersal-extension.zip`.

---

## 5. Honest Pricing & UI State Rules

1. **Missing Items (`"אין נתון"`) & Incomplete Baskets (`"חלקי"`):**
   - Never fabricate or carry over another chain's price when a branch lacks a match.
   - Any chain with `missing.length > 0` has `complete: false`, displays `"חלקי"`, and is ineligible for `cheapestId` (`"🏆 הכי זול!"`).
2. **Q15 Hybrid Matching & Substitutes (`"חלופה"`):**
   - Pinned product (`it.product.code`): match exact normalized barcode (`kind: 'exact'`); if unavailable at a chain, pick that chain's closest Hebrew name match flagged `kind: 'substitute'` (`"חלופה"`) without mutating `it.product` or `mappings`.
   - Unpinned generic item: pick each chain's best stem-aware catalog match (`matchLineAcrossChains`) without silently pinning or saving to `mappings`. Only explicit user confirmation in the product picker saves a mapping.
3. **Ambiguous Items & Bought Lines:**
   - Bare ambiguous hypernyms (`checkAmbiguousTerm` → `it.ambiguous`) must show disambiguation chips, remain unpriced across all chains, and force `cheapestId = null` until the user picks a specific product concept.
   - Bought lines (`it.checked === false`) remain visible on the list so shoppers see what was already purchased, but are excluded from basket price comparison.
4. **Asymmetric Delivery Fee Comparison (`comparedOnSubtotalOnly`):**
   - In `compareBasket()` (`web/js/pricing.js`), when `includeDelivery` is on and complete chains mix numeric `fee` values with `null` (`"לא ידוע"`), rank complete chains and compute `savings` on product `subtotal` (`comparedOnSubtotalOnly: true`) so chains that transparently publish delivery fees are never penalized against chains with unknown fees.
   - When fetch of `<chain>/catalog.json` or `<chain>/stores/<storeId>.json` fails in `web/js/prices.js`, evict the rejected promise from cache rather than caching an empty result.
