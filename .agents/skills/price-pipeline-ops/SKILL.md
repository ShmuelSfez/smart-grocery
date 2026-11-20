---
name: price-pipeline-ops
description: >-
  Operates, debugs, and extends SmartCart's Israeli Price Transparency Law (חוק שקיפות
  מחירים) ingestion pipeline (pipeline/), covering Stores/StoresFull/PriceFull/PromoFull
  XML feeds across 9 live chains (Shufersal, Rami Levy, Carrefour, Machsanei HaShuk,
  Victory, Yochananof, Tiv Taam, Keshet Teamim, Osher Ad), LaibCatalog & Cerberus shared
  adapters, StoreType=2 online fulfilment stores, and orphan gh-pages publishing. Use this
  skill whenever working on pipeline/*, .github/workflows/prices.yml, data/v1/*, or adding
  a supermarket chain.
---

# Israeli Price Transparency Pipeline Operations (`pipeline/`)

SmartCart ingests 100% official supermarket feeds mandated by Israel's **Food Price Transparency Law (`חוק קידום התחרות בענף המזון`)**—never scraping private consumer web APIs.

---

## 1. Live Chain Roster & Portal Families (9 Live Chains)

| Chain ID | Hebrew Name | Chain GLN | Portal Adapter | Online Fulfilment (`online.json`) |
| :--- | :--- | :--- | :--- | :--- |
| `shufersal` | שופרסל | `7290027600007` | `shufersal.mjs` (Azure Blob) | `413` (`hasOnlineStore: true`) |
| `ramilevy` | רמי לוי | `7290058140886` | `ramilevy.mjs` → `cerberus.mjs` (`RamiLevi`) | `39` (`hasOnlineStore: true`) |
| `carrefour` | קרפור | `7290055700007` | `carrefour.mjs` (Date-sharded JSON) | `471`, `473`, `472` (`hasOnlineStore: true`) |
| `mahsaneihashuk` | מחסני השוק | `7290661400001` | `mahsaneihashuk.mjs` → `laibcatalog.mjs` | `97` (`97 אינטרנט`), `96` (`96 אינטרנט אילת`) |
| `victory` | ויקטורי | `7290696200003` | `victory.mjs` → `laibcatalog.mjs` | `97` (`אינטרנט`, `victoryonline.co.`) |
| `yochananof` | יוחננוף | `7290803800003` | `yochananof.mjs` → `cerberus.mjs` (`Yohananof`) | `null` (`hasOnlineStore: false`, branch pickup) |
| `tivtaam` | טיב טעם | `7290873255550` | `tivtaam.mjs` → `cerberus.mjs` (`TivTaam`) | `514`, `519`, `502`, `503`, `512`, `515` |
| `keshet` | קשת טעמים | `7290785400000` | `keshet.mjs` → `cerberus.mjs` (`Keshet`) | `116` (`ממ"ר קרית חיים`), `120` (`ממ"ר פתח תקווה`) |
| `osherad` | אושר עד | `7290103152017` | `osherad.mjs` → `cerberus.mjs` (`osherad`) | `null` (`hasOnlineStore: false`, in-store only) |

### Official Feed Types & Filename Anatomy (`extractFileMeta` in `pipeline/parse.mjs`)
1. **`Stores` / `StoresFull`** (`Stores[Full]<ChainGln>-<SubChain>-<YYYYMMDDHHMM>.xml/.gz`) — Physical branches (`StoreType = 1`) and online fulfilment centers (`StoreType = 2`).
2. **`PriceFull`** (`PriceFull<ChainGln>-[<SubChain>-]<StoreId>-<YYYYMMDD>[-<HHMMSS>].gz`) — Full shelf catalog per branch.
3. **`PromoFull`** (`PromoFull<ChainGln>-[<SubChain>-]<StoreId>-<YYYYMMDD>[-<HHMMSS>].gz`) — Promotions per branch.

- **Foreign-GLN Guard:** Both `cerberus.mjs` and `laibcatalog.mjs` filter directory listings by `chainGln` so stray foreign files (e.g., `7290055700007` inside Keshet's Cerberus root) are ignored.

---

## 2. Compression, Encoding & XML Schema Quirks

1. **`.gz` vs. Disguised ZIP (`decodeFeedBuffer`):** Detects gzip (`0x1f 0x8b`) vs. PKZIP (`0x50 0x4b 0x03 0x04`, e.g., Rami Levy `39`), plus `UTF-16LE/BE` BOMs and `windows-1255` XML prologs.
2. **Self-Closing XML Tags:** Nibit/LaibCatalog `PromoFull` feeds emit self-closing tags such as `<MinPurchaseAmount />` and `<PromotionStartHour />`. Both `getTag` (`pipeline/parse.mjs`) and `xmlVal` (`tests/regression/refmodel/price-model.mjs`) guard open-tag matching with `(?:\\s[^>/]*)?>`.
3. **All-Customer Promotions (`pipeline/promos.mjs`):** Keeps only active deals where `ClubID` is empty or starts with `0`, `AdditionalIsCoupon != 1`, `MinPurchaseAmount == 0`, single `<Group>`, `IsGiftItem != 1`, and non-weighted.
4. **Nibit `StoreType=2` Disambiguation & `online[chainId] = null`:**
   - When a chain publishes explicit online-named `StoreType=2` stores (e.g., Machsanei HaShuk `97 אינטרנט` & `96 אינטרנט אילת`), street-addressed `StoreType=2` franchise branches lacking online hints (`20 להבים`, `11 עין יהב`) are reclassified as physical `branch`es.
   - Online stores with `< 200` items (e.g., Tiv Taam stub `523`) are excluded from `online.json`, and nationwide fulfilment stores sort ahead of `quick` and Eilat (`אילת`) stores.
   - Chains with no published online fulfilment catalog (`yochananof`, `osherad`) emit `online[chainId] = null` in `data/v1/online.json` and set `hasOnlineStore: false` in `web/js/chains.js`.

---

## 3. Running Locally & Publishing to `gh-pages`

```bash
# 1. Fast smoke build (online stores + 3 priority-city physical branches per chain -> data/v1/)
node pipeline/build.mjs --limit-stores=3 --out=data/v1

# 2. Full 9-chain Israel build (-> data/v1/)
node pipeline/build.mjs --out=data/v1

# 3. Publish built data/v1/ to clean single-commit orphan gh-pages branch (includes .nojekyll)
node pipeline/publish-pages.mjs data/v1
```

- **Git Guardrail:** **Never** commit `data/v1/` to `main`.

---

## 4. Playbook: Onboarding an Additional Chain

1. **Choose or Add Source Adapter (`pipeline/sources/`):**
   - **Cerberus (`url.publishedprices.co.il`):** Call `createCerberusSource({ chainId, username, chainGln })` from `./cerberus.mjs`.
   - **LaibCatalog (`laibcatalog.co.il`):** Call `createLaibCatalogSource({ chainId, chainGln })` from `./laibcatalog.mjs`.
   - **Custom Blob / Date-Sharded:** Follow `shufersal.mjs` or `carrefour.mjs` with `AbortSignal.timeout(30000)` and bounded retries.
2. **Register in `pipeline/build.mjs`**, smoke-test with `--chains=<chainId> --limit-stores=3`, and add offline unit tests in `tests/pipeline.test.mjs`.
3. **Update `web/js/chains.js` & `web/data/{delivery,delivery-coverage}.json`** with verified `url`, `searchUrl`, `hasOnlineStore`, and `cartFill`.
4. **Extend DV Snapshot (`tests/regression/snapshot/capture-snapshot.mjs`)** if `hasOnlineStore: true`, run `npm test` and `node tests/regression/run.mjs --smoke --no-record`, then build and publish `data/v1` via `node pipeline/publish-pages.mjs data/v1`.
