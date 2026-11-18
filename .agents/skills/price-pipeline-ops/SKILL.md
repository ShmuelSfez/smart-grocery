---
name: price-pipeline-ops
description: >-
  Operates, debugs, and extends SmartCart's Israeli Price Transparency Law (חוק שקיפות
  מחירים) ingestion pipeline (pipeline/), covering Stores/PriceFull/PromoFull XML feeds,
  gzip vs disguised-ZIP decompression, UTF-16LE/Windows-1255 decoding, StoreType=2 online
  fulfilment stores, orphan gh-pages publishing, and onboarding new supermarket chains
  such as Victory or Yochananof. Use this skill whenever working on pipeline/*,
  .github/workflows/prices.yml, data/v1/*, or adding a supermarket chain.
---

# Israeli Price Transparency Pipeline Operations (`pipeline/`)

SmartCart ingests 100% official supermarket feeds mandated by Israel's **Food Price Transparency Law (`חוק קידום התחרות בענף המזון`)**—never scraping private consumer web APIs.

---

## 1. Official Feed Types & Filename Anatomy

Every regulated chain publishes three feed families (`extractFileMeta` in `pipeline/parse.mjs`):
1. **`Stores`** (`Stores<ChainGln>-<SubChain>-<YYYYMMDDHHMM>.xml/.gz`) — Lists physical branches (`StoreType = 1`) and online fulfilment centers (`StoreType = 2`), with `StoreID`, `StoreName`, `Address`, and `City` (often numeric CBS locality codes).
2. **`PriceFull`** (`PriceFull<ChainGln>-[<SubChain>-]<StoreId>-<YYYYMMDD>[-<HHMMSS>].gz`) — Full shelf catalog for one branch (`ItemCode`, `ItemName`, `ManufacturerItemDescription`, `ManufactureName`, `Quantity`, `UnitQty`, `bIsWeighted`, `ItemPrice`, `UnitOfMeasurePrice`).
3. **`PromoFull`** (`PromoFull<ChainGln>-[<SubChain>-]<StoreId>-<YYYYMMDD>[-<HHMMSS>].gz`) — Promotions for one branch.

- **Store ID Normalization (`normalizeStoreId`):** Strips leading zeros (`"007"` → `"7"`, `"0413"` → `"413"`) so `Stores`, `PriceFull`, and `PromoFull` join reliably across portals.
- **Newest-Per-Store Selection:** Each source adapter (`pipeline/sources/*.mjs`) deduplicates multiple daily dumps per `storeId` by picking the highest lexicographic `stamp`.

---

## 2. Compression, Encoding & XML Schema Quirks

### A. `.gz` vs. Disguised ZIP Archives (`decodeFeedBuffer` in `pipeline/parse.mjs`)
- Standard feeds begin with gzip magic bytes `0x1f 0x8b` → `zlib.gunzipSync(buf)`.
- **Portal Trap (Disguised ZIP):** Several portals (including Rami Levy's online store `39`) serve **PKZIP archives (`0x50 0x4b 0x03 0x04`) with a `.gz` filename extension**. `decodeFeedBuffer` detects `isZip(buf)` via `web/js/zip.js`, locates the inner `.xml` entry, and inflates raw deflate (`zlib.inflateRawSync`). Always route raw downloaded buffers through `decodeFeedBuffer`!

### B. Character Encodings (`UTF-8`, `UTF-16LE/BE`, `Windows-1255`)
- `decodeFeedBuffer` inspects BOM and XML prolog before decoding:
  - `0xFF 0xFE` → `utf16le`
  - `0xFE 0xFF` → 16-bit byte swap (`copy.swap16()`) + `utf16le`
  - `encoding="windows-1255"` or `iso-8859-8` in the first 200 bytes → `new TextDecoder('windows-1255').decode(buf)`
  - Otherwise → `utf8` (stripping leading `\uFEFF` BOM).

### C. Promotion XML Variations (`pipeline/promos.mjs`)
- **All-Customer Filter (v1 Policy):** Keeps **only** active promotions where:
  1. `ClubID` is empty or starts with `0` (e.g., `"0"` or `"0 - כלל הלקוחות"`).
  2. `AdditionalIsCoupon` / `IsCoupon` is not `1` / `true`.
  3. Current timestamp is within `PromotionStartDate[Time]`..`PromotionEndDate[Time]`.
  4. Unconditional (`MinPurchaseAmount == 0`, at most 1 `<Group>`, `IsGiftItem != 1`, non-weighted `bIsWeighted != 1`).
- **Dual Item Nesting:** Shufersal & Carrefour emit `<PromotionItem>...</PromotionItem>`, whereas Rami Levy nests `<PromotionItems><Item>...</Item></PromotionItems>` and often places `DiscountedPrice`/`MinQty` at the parent `<Promotion>` level. `parsePromosXml` supports both.

### D. `StoreType=2` Online Stores vs. Physical Branches & CBS Cities
- **`StoreType=2` (`data/v1/online.json`):** Online fulfilment stores (Shufersal `413`, Rami Levy `39`, Carrefour `471/472/473`) are **always** selected by `selectStoresToProcess` (even under `--limit-stores=N`) and sorted standard-delivery-first, quick-commerce (`קוויק`/`quick`) last.
- **`StoreType=1` (`data/v1/cities.json`):** `pipeline/cities.mjs` resolves numeric CBS codes (`סמל ישוב`, e.g., `6400` → `הרצליה`, ignoring `9999`) via `pipeline/data/cbs-cities.json` + live `data.gov.il` API fallback + store-name city inference, normalizing spelling aliases (`תל אביב` → `תל אביב-יפו`, `קריית` → `קרית`).
- **Zero-Item Guard:** Any `PriceFull` yielding `0` parsed items throws an error and is excluded from `cities.json` / `online.json` rather than written as a broken branch.

---

## 3. Running Locally & Publishing to `gh-pages`

Run from the repository root:

```bash
# 1. Fast smoke build (online stores + 3 priority-city physical branches per chain -> data/v1/)
node pipeline/build.mjs --chains=shufersal,ramilevy,carrefour --limit-stores=3

# 2. Full Israel build (~660+ stores across 117 cities -> data/v1/, ~3 min)
node pipeline/build.mjs --out=data/v1

# 3. Publish built data/v1/ to clean single-commit orphan gh-pages branch (includes .nojekyll)
node pipeline/publish-pages.mjs data/v1
```

- **Daily Automation (`.github/workflows/prices.yml`):** Runs daily at `04:00 UTC` (`06:00 IST`, after Shufersal ~03:00 and Carrefour ~05:10). Note that `pipeline/sources/carrefour.mjs` merges today + yesterday date folders (`/?date=YYYYMMDD`) so early runs never miss branches.
- **Git Guardrail:** **Never** commit `data/v1/` to `main`.

---

## 4. Playbook: Onboarding a New Chain (e.g., Victory or Yochananof)

Follow these 7 steps in order to wire in a `"soon"` chain (`victory` or `yochananof`):

1. **Identify the Official Transparency Portal Family:**
   - **Cerberus Web Client (`https://url.publishedprices.co.il`):** Used by **Yochananof** (public username `Yochananof`, empty password), Rami Levy (`RamiLevi`), Osher Ad, Tiv Taam, etc. Clone/extract the cookie+CSRF session & `/file/json/dir` DataTables helper from `pipeline/sources/ramilevy.mjs`.
   - **LaibCatalog / MatrixCatalog (`laibcatalog.co.il` / `matrixcatalog.co.il`):** Used by **Victory** (`7290696200003`) and Mahsanei Hashuk. Parse the HTML/JSON directory table links via `extractFileMeta(href)` and pick newest per `storeId`.
   - **Date-Sharded / Blob Portal:** Similar to `shufersal.mjs` or `carrefour.mjs`.
2. **Create the Source Adapter (`pipeline/sources/<chainId>.mjs`):**
   - Export `async function listFeeds()` returning `{ chainId, storesFile, priceFiles, promoFiles }`, where `storesFile` and each Map value expose `{ storeId, stamp, filename, download: async () => Buffer }`.
   - Use `AbortSignal.timeout(30000)` and bounded retries (`fetchWithRetry`).
3. **Register in `pipeline/build.mjs`:**
   - Import the adapter, add it to `SOURCES`, and append `'<chainId>'` to default `opts.chains`.
4. **Verify Encoding, Tags & Unit Tests (`tests/pipeline.test.mjs`):**
   - Smoke-build just the new chain:
     ```bash
     node pipeline/build.mjs --chains=<chainId> --limit-stores=3 --out=data/v1
     ```
   - Inspect `data/v1/meta.json`, `data/v1/online.json` (confirm whether the chain publishes a `StoreType=2` online store or uses a designated fulfilment branch), `data/v1/cities.json`, and `data/v1/<chainId>/catalog.json`.
   - Add XML sample assertions in `tests/pipeline.test.mjs` if any new tag alias (e.g. `<ItemNm>` or promo wrapper) was needed in `parse.mjs` / `promos.mjs`.
5. **Human-Verify Delivery Fees & Coverage (`web/data/`):**
   - Check the chain's official website terms for delivery fees and served cities. Update `web/data/delivery.json` and `web/data/delivery-coverage.json` with real verified values (or `null` if address-dependent) and bump `lastChecked` (`YYYY-MM-DD`).
6. **Activate Chain in Frontend (`web/js/chains.js`):**
   - Change `status: 'soon'` → `status: 'live'` for `<chainId>` in `web/js/chains.js` and bump `?v=N` in `web/index.html`. (Only add a host to CSP `img-src` in `vercel.json` / `serve.mjs` and `ALLOWED_IMG_HOST` in `codec.js` if rendering images from that host.)
7. **Extend DV Snapshot & Pass Regression (`tests/regression/`):**
   - Add `<chainId>`'s online store target to `tests/regression/snapshot/capture-snapshot.mjs` and `tests/regression/refmodel/price-model.mjs`, capture the `.xml.gz` snapshot, and run `npm test` + `npm run regression` to verify `100%` `S1`–`S10` compliance before publishing `data/v1` to `gh-pages`.
