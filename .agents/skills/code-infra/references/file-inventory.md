# Codebase File Inventory (Auto-Generated)

- **Updated:** 2026-11-18T21:45:00.909Z
- **Latest Commit:** `dfe3ab2 2026-11-18 docs(agents,arch): add auto-discovered AI agent infrastructure and web/cloud scaling guide`
- **Unit Tests (`npm test`):** 26 pass, 0 fail

| File | Lines / Size | Exports |
| :--- | :--- | :--- |
| `.agents/README.md` | 31 | — |
| `.agents/rules/verification-signoff.md` | 36 | — |
| `.agents/skills/code-infra/SKILL.md` | 68 | — |
| `.agents/skills/code-infra/references/architecture.md` | 49 | — |
| `.agents/skills/code-infra/scripts/update-map.mjs` | 89 | — |
| `.agents/skills/dv-regression/SKILL.md` | 133 | — |
| `.agents/skills/price-pipeline-ops/SKILL.md` | 104 | — |
| `.agents/skills/release-and-deploy/SKILL.md` | 130 | — |
| `.github/workflows/ci.yml` | 32 | — |
| `.github/workflows/prices.yml` | 49 | — |
| `.github/workflows/regression.yml` | 42 | — |
| `.gitignore` | binary (41 B) | — |
| `.vercelignore` | binary (68 B) | — |
| `AGENTS.md` | 115 | — |
| `README.md` | 106 | — |
| `api/sheet.js` | 98 | `extractSheetExportUrl`, `fetchGoogleCsv`, `default` |
| `docs/web-dev-and-scaling-guide.md` | 362 | — |
| `extension/bridge.js` | 14 | — |
| `extension/capture.js` | 20 | — |
| `extension/codec.js` | 139 | — |
| `extension/icons/128.png` | binary (2070 B) | — |
| `extension/icons/16.png` | binary (438 B) | — |
| `extension/icons/48.png` | binary (984 B) | — |
| `extension/manifest.json` | 50 | — |
| `extension/panel.js` | 1326 | — |
| `extension/popup.html` | 50 | — |
| `extension/popup.js` | 140 | — |
| `gemini/agents.md` | 18 | — |
| `gemini/skills/code-infra/SKILL.md` | 16 | — |
| `gemini/skills/code-infra/references/architecture.md` | 4 | — |
| `gemini/skills/code-infra/references/file-inventory.md` | 6 | — |
| `gemini/skills/code-infra/scripts/update-map.mjs` | 4 | — |
| `gemini/skills/dv-regression/SKILL.md` | 15 | — |
| `package.json` | 2 | — |
| `pipeline/build.mjs` | 279 | `serializeBranchItems` |
| `pipeline/cities.mjs` | 106 | `cleanCityString`, `loadLocalCityMap`, `loadCityMap`, `resolveCityName` |
| `pipeline/data/cbs-cities.json` | 1319 | — |
| `pipeline/parse.mjs` | 166 | `decodeFeedBuffer`, `unescapeXml`, `normalizeStoreId`, `extractFileMeta`, `getTag`, `parseStoresXml`, `parsePricesXml` |
| `pipeline/promos.mjs` | 158 | `parsePromosXml` |
| `pipeline/publish-pages.mjs` | 34 | — |
| `pipeline/sources/carrefour.mjs` | 98 | `listFeeds` |
| `pipeline/sources/ramilevy.mjs` | 134 | `listFeeds` |
| `pipeline/sources/shufersal.mjs` | 97 | `listFeeds` |
| `serve.mjs` | 170 | — |
| `tests/core.test.mjs` | 129 | — |
| `tests/fixtures/prices-sample.xml` | binary (1160 B) | — |
| `tests/fixtures/promos-sample.xml` | binary (4793 B) | — |
| `tests/fixtures/stores-sample.xml` | binary (879 B) | — |
| `tests/importer.test.mjs` | 240 | — |
| `tests/pipeline.test.mjs` | 216 | — |
| `tests/pricing.test.mjs` | 117 | — |
| `tests/regression/AGENTS.md` | 71 | — |
| `tests/regression/dictionary/items.json` | 6976 | — |
| `tests/regression/directed/cases.mjs` | 569 | `buildDirectedCases` |
| `tests/regression/gen/generate.mjs` | 377 | `LAYOUTS`, `BUDGET_BUCKETS`, `NOISE_PROFILES`, `AMBIG_PROFILES`, `RARITY_PROFILES`, `QTY_STYLES`, `mulberry32`, `mutateHebrewPhrase`, `generateRandomCase` |
| `tests/regression/gen/render.mjs` | 405 | `formatLineText`, `renderStimulus`, `buildStyledXlsxBuffer` |
| `tests/regression/lib/zip-writer.mjs` | 72 | `crc32`, `writeZip` |
| `tests/regression/refmodel/price-model.mjs` | 484 | `loadReferenceSnapshot`, `refEvaluateBasket`, `refComputeAvailability`, `buildPriceEstimator` |
| `tests/regression/reports/history.json` | 151 | — |
| `tests/regression/reports/latest.md` | 85 | — |
| `tests/regression/run.mjs` | 800 | — |
| `tests/regression/snapshot/capture-snapshot.mjs` | 51 | — |
| `tests/regression/snapshot/carrefour-471-prices.xml.gz` | binary (532124 B) | — |
| `tests/regression/snapshot/carrefour-471-promos.xml.gz` | binary (239623 B) | — |
| `tests/regression/snapshot/manifest.json` | 24 | — |
| `tests/regression/snapshot/ramilevy-39-prices.xml.gz` | binary (640165 B) | — |
| `tests/regression/snapshot/ramilevy-39-promos.xml.gz` | binary (21409 B) | — |
| `tests/regression/snapshot/shufersal-413-prices.xml.gz` | binary (604217 B) | — |
| `tests/regression/snapshot/shufersal-413-promos.xml.gz` | binary (358559 B) | — |
| `tests/regression/spec.md` | 63 | — |
| `tests/regression/waivers.json` | 6 | — |
| `vercel.json` | 22 | — |
| `web/AGENTS.md` | 76 | — |
| `web/data/delivery-coverage.json` | 10 | — |
| `web/data/delivery.json` | 10 | — |
| `web/data/sponsored.json` | 6 | — |
| `web/icon.svg` | binary (195 B) | — |
| `web/index.html` | 346 | — |
| `web/js/ai.js` | 57 | `aiToItems` |
| `web/js/app.js` | 2135 | — |
| `web/js/categories.js` | 154 | `CATEGORIES`, `CATEGORY_BY_ID`, `categorize` |
| `web/js/chains.js` | 14 | `CHAINS`, `CHAIN_BY_ID`, `LIVE_CHAIN_IDS` |
| `web/js/codec.js` | 139 | — |
| `web/js/importer.js` | 221 | `enrichAndDeduplicateItems`, `applyItemsToList`, `importFromText`, `importFromGrid`, `importFromSheetText` |
| `web/js/parser.js` | 198 | `UNITS`, `parseItem`, `splitLineSegments`, `splitItems`, `parseMany`, `normalizeName`, `formatQty` |
| `web/js/prices.js` | 719 | `PROD_DATA_BASE`, `LOCAL_DATA_BASE`, `normalizeBarcode`, `normalizeSearchText`, `expandHebrewToken`, `buildCatalogBundle`, `scoreEntry`, `searchCatalogProducts`, `matchLineAcrossChains`, `loadMeta`, `loadCities`, `loadOnlineStores`, `deliveryCoverage`, `loadChainCatalog`, `loadBranchPrices`, `findMatchingCity`, `branchesInCity` |
| `web/js/pricing.js` | 125 | `chargeQty`, `applyPromo`, `lineCost`, `compareBasket` |
| `web/js/produce.js` | 145 | `PRODUCE_PIECE_RULES`, `lookupPieceWeightKg`, `lookupBareDefaultKg`, `isKnownWeightedProduceName`, `resolveWeightedChargeKg` |
| `web/js/recipes.js` | 85 | `RECIPES`, `scaleRecipe` |
| `web/js/sheets.js` | 546 | `GROCERY_HEADERS`, `IRRELEVANT_HEADERS`, `IRRELEVANT_ITEM_RULES`, `BOUGHT_VALUE_RE`, `parseDelimitedGrid`, `parseGrid`, `isSectionHeaderText`, `classifyIrrelevantReason`, `stripInlineBoughtMarker`, `canMergeResolvedConcepts`, `mergeUnitsIfCompatible`, `mergeGroceryCandidates`, `analyzeSheetGrid`, `exportListToCsv` |
| `web/js/store.js` | 107 | `store` |
| `web/js/suggest.js` | 66 | `STARTER_ITEMS`, `recordPurchase`, `runningOut`, `frequent` |
| `web/js/synonyms.js` | 667 | `AMBIGUOUS_ITEMS_LIST`, `checkAmbiguousTerm`, `resolveGrocerySynonym`, `getSearchQueriesForItem` |
| `web/js/xlsx.js` | 359 | `XLSX_LIMITS`, `scanXmlElements`, `parseXlsxBuffer` |
| `web/js/zip.js` | 93 | `isZip`, `listZipEntries` |
| `web/manifest.webmanifest` | 16 | — |
| `web/shufersal-extension.zip` | binary (25102 B) | — |
| `web/styles.css` | 393 | — |
| `web/sw.js` | 50 | — |
