# Codebase File Inventory (Auto-Generated)

- **Updated:** 2026-11-21T19:38:35.745Z
- **Latest Commit:** `96f45f5 2026-11-21 fix(extension): complete v3.1.1 zip build and auto-navigate to cart after adding ready items`
- **Unit Tests (`npm test`):** 43 pass, 0 fail

| File | Lines / Size | Exports |
| :--- | :--- | :--- |
| `.agents/README.md` | 31 | — |
| `.agents/rules/verification-signoff.md` | 36 | — |
| `.agents/skills/code-infra/SKILL.md` | 68 | — |
| `.agents/skills/code-infra/references/architecture.md` | 49 | — |
| `.agents/skills/code-infra/scripts/update-map.mjs` | 89 | — |
| `.agents/skills/dv-regression/SKILL.md` | 133 | — |
| `.agents/skills/price-pipeline-ops/SKILL.md` | 80 | — |
| `.agents/skills/release-and-deploy/SKILL.md` | 130 | — |
| `.github/workflows/ci.yml` | 32 | — |
| `.github/workflows/prices.yml` | 49 | — |
| `.github/workflows/regression.yml` | 42 | — |
| `.gitignore` | binary (47 B) | — |
| `.vercelignore` | binary (68 B) | — |
| `AGENTS.md` | 115 | — |
| `README.md` | 107 | — |
| `api/sheet.js` | 98 | `extractSheetExportUrl`, `fetchGoogleCsv`, `default` |
| `dist/extensions/smartcart-carrefour.zip` | binary (28887 B) | — |
| `dist/extensions/smartcart-mahsaneihashuk.zip` | binary (28937 B) | — |
| `dist/extensions/smartcart-ramilevy.zip` | binary (31338 B) | — |
| `dist/extensions/smartcart-shufersal.zip` | binary (34259 B) | — |
| `dist/extensions/smartcart-tivtaam.zip` | binary (29214 B) | — |
| `dist/extensions/smartcart-victory.zip` | binary (29179 B) | — |
| `dist/extensions/smartcart-yochananof.zip` | binary (29192 B) | — |
| `dist/smartcart-mahsaneihashuk.zip` | binary (28300 B) | — |
| `docs/web-dev-and-scaling-guide.md` | 362 | — |
| `extension/bridge.js` | 14 | — |
| `extension/build.mjs` | 196 | `CHAIN_BUILD_SPECS`, `syncCodec`, `verifyExtensionZipBuffer`, `buildUnifiedZipBuffer`, `buildSingleChainZipBuffer`, `runBuild` |
| `extension/capture.js` | 23 | — |
| `extension/chains/carrefour.js` | 16 | — |
| `extension/chains/mahsaneihashuk.js` | 16 | — |
| `extension/chains/ramilevy.js` | 209 | — |
| `extension/chains/selfpoint.js` | 571 | — |
| `extension/chains/shufersal.js` | 481 | — |
| `extension/chains/tivtaam.js` | 32 | — |
| `extension/chains/victory.js` | 27 | — |
| `extension/chains/yochananof.js` | 28 | — |
| `extension/codec.js` | 139 | — |
| `extension/icons/128.png` | binary (2070 B) | — |
| `extension/icons/16.png` | binary (438 B) | — |
| `extension/icons/48.png` | binary (984 B) | — |
| `extension/manifest.json` | 73 | — |
| `extension/panel.js` | 1026 | — |
| `extension/popup.html` | 63 | — |
| `extension/popup.js` | 170 | — |
| `gemini/agents.md` | 18 | — |
| `gemini/skills/code-infra/SKILL.md` | 16 | — |
| `gemini/skills/code-infra/references/architecture.md` | 4 | — |
| `gemini/skills/code-infra/references/file-inventory.md` | 6 | — |
| `gemini/skills/code-infra/scripts/update-map.mjs` | 4 | — |
| `gemini/skills/dv-regression/SKILL.md` | 15 | — |
| `package.json` | 2 | — |
| `pipeline/build.mjs` | 402 | `serializeBranchItems`, `tryCarryForwardChain` |
| `pipeline/cities.mjs` | 141 | `cleanCityString`, `loadLocalCityMap`, `loadCityMap`, `resolveCityName` |
| `pipeline/data/cbs-cities.json` | 1319 | — |
| `pipeline/parse.mjs` | 184 | `decodeFeedBuffer`, `unescapeXml`, `normalizeStoreId`, `extractFileMeta`, `getTag`, `parseStoresXml`, `parsePricesXml` |
| `pipeline/promos.mjs` | 158 | `parsePromosXml` |
| `pipeline/publish-pages.mjs` | 34 | — |
| `pipeline/sources/carrefour.mjs` | 98 | `listFeeds` |
| `pipeline/sources/cerberus.mjs` | 150 | `CERBERUS_ORIGIN`, `createCookieSession`, `createCerberusSource` |
| `pipeline/sources/keshet.mjs` | 11 | `listFeeds` |
| `pipeline/sources/laibcatalog.mjs` | 117 | `LAIB_ORIGIN`, `parseLaibFilesPayload`, `parseLaibHtmlLinks`, `createLaibCatalogSource` |
| `pipeline/sources/mahsaneihashuk.mjs` | 10 | `listFeeds` |
| `pipeline/sources/osherad.mjs` | 11 | `listFeeds` |
| `pipeline/sources/ramilevy.mjs` | 11 | `listFeeds` |
| `pipeline/sources/shufersal.mjs` | 97 | `listFeeds` |
| `pipeline/sources/tivtaam.mjs` | 11 | `listFeeds` |
| `pipeline/sources/victory.mjs` | 10 | `listFeeds` |
| `pipeline/sources/yochananof.mjs` | 11 | `listFeeds` |
| `serve.mjs` | 170 | — |
| `tests/core.test.mjs` | 129 | — |
| `tests/extension.test.mjs` | 370 | — |
| `tests/fixtures/prices-sample.xml` | binary (1160 B) | — |
| `tests/fixtures/promos-sample.xml` | binary (4793 B) | — |
| `tests/fixtures/stores-sample.xml` | binary (879 B) | — |
| `tests/importer.test.mjs` | 240 | — |
| `tests/pipeline.test.mjs` | 376 | — |
| `tests/pricing.test.mjs` | 117 | — |
| `tests/ranking.test.mjs` | 244 | — |
| `tests/regression/AGENTS.md` | 71 | — |
| `tests/regression/dictionary/items.json` | 6976 | — |
| `tests/regression/directed/cases.mjs` | 569 | `buildDirectedCases` |
| `tests/regression/gen/generate.mjs` | 377 | `LAYOUTS`, `BUDGET_BUCKETS`, `NOISE_PROFILES`, `AMBIG_PROFILES`, `RARITY_PROFILES`, `QTY_STYLES`, `mulberry32`, `mutateHebrewPhrase`, `generateRandomCase` |
| `tests/regression/gen/render.mjs` | 405 | `formatLineText`, `renderStimulus`, `buildStyledXlsxBuffer` |
| `tests/regression/lib/zip-writer.mjs` | 72 | `crc32`, `writeZip` |
| `tests/regression/refmodel/price-model.mjs` | 487 | `loadReferenceSnapshot`, `refEvaluateBasket`, `refComputeAvailability`, `buildPriceEstimator` |
| `tests/regression/reports/history.json` | 317 | — |
| `tests/regression/reports/latest.md` | 87 | — |
| `tests/regression/run.mjs` | 802 | — |
| `tests/regression/snapshot/capture-snapshot.mjs` | 59 | — |
| `tests/regression/snapshot/carrefour-471-prices.xml.gz` | binary (532871 B) | — |
| `tests/regression/snapshot/carrefour-471-promos.xml.gz` | binary (240212 B) | — |
| `tests/regression/snapshot/keshet-116-prices.xml.gz` | binary (573763 B) | — |
| `tests/regression/snapshot/keshet-116-promos.xml.gz` | binary (157311 B) | — |
| `tests/regression/snapshot/mahsaneihashuk-97-prices.xml.gz` | binary (600080 B) | — |
| `tests/regression/snapshot/mahsaneihashuk-97-promos.xml.gz` | binary (191158 B) | — |
| `tests/regression/snapshot/manifest.json` | 48 | — |
| `tests/regression/snapshot/ramilevy-39-prices.xml.gz` | binary (639264 B) | — |
| `tests/regression/snapshot/ramilevy-39-promos.xml.gz` | binary (21534 B) | — |
| `tests/regression/snapshot/shufersal-413-prices.xml.gz` | binary (604538 B) | — |
| `tests/regression/snapshot/shufersal-413-promos.xml.gz` | binary (358586 B) | — |
| `tests/regression/snapshot/tivtaam-514-prices.xml.gz` | binary (794881 B) | — |
| `tests/regression/snapshot/tivtaam-514-promos.xml.gz` | binary (326234 B) | — |
| `tests/regression/snapshot/victory-97-prices.xml.gz` | binary (417918 B) | — |
| `tests/regression/snapshot/victory-97-promos.xml.gz` | binary (133734 B) | — |
| `tests/regression/spec.md` | 63 | — |
| `tests/regression/waivers.json` | 6 | — |
| `vercel.json` | 22 | — |
| `web/AGENTS.md` | 76 | — |
| `web/data/delivery-coverage.json` | 16 | — |
| `web/data/delivery.json` | 16 | — |
| `web/data/sponsored.json` | 6 | — |
| `web/icon.svg` | binary (195 B) | — |
| `web/index.html` | 346 | — |
| `web/js/ai.js` | 57 | `aiToItems` |
| `web/js/app.js` | 2401 | — |
| `web/js/categories.js` | 154 | `CATEGORIES`, `CATEGORY_BY_ID`, `categorize` |
| `web/js/chains.js` | 101 | `CHAINS`, `CHAIN_BY_ID`, `LIVE_CHAIN_IDS`, `ONLINE_LIVE_CHAIN_IDS` |
| `web/js/codec.js` | 139 | — |
| `web/js/importer.js` | 221 | `enrichAndDeduplicateItems`, `applyItemsToList`, `importFromText`, `importFromGrid`, `importFromSheetText` |
| `web/js/parser.js` | 198 | `UNITS`, `parseItem`, `splitLineSegments`, `splitItems`, `parseMany`, `normalizeName`, `formatQty` |
| `web/js/prices.js` | 719 | `PROD_DATA_BASE`, `LOCAL_DATA_BASE`, `normalizeBarcode`, `normalizeSearchText`, `expandHebrewToken`, `buildCatalogBundle`, `scoreEntry`, `searchCatalogProducts`, `matchLineAcrossChains`, `loadMeta`, `loadCities`, `loadOnlineStores`, `deliveryCoverage`, `loadChainCatalog`, `loadBranchPrices`, `findMatchingCity`, `branchesInCity` |
| `web/js/pricing.js` | 125 | `chargeQty`, `applyPromo`, `lineCost`, `compareBasket` |
| `web/js/produce.js` | 145 | `PRODUCE_PIECE_RULES`, `lookupPieceWeightKg`, `lookupBareDefaultKg`, `isKnownWeightedProduceName`, `resolveWeightedChargeKg` |
| `web/js/ranking.js` | 187 | `buildRankedChainRows` |
| `web/js/recipes.js` | 85 | `RECIPES`, `scaleRecipe` |
| `web/js/sheets.js` | 546 | `GROCERY_HEADERS`, `IRRELEVANT_HEADERS`, `IRRELEVANT_ITEM_RULES`, `BOUGHT_VALUE_RE`, `parseDelimitedGrid`, `parseGrid`, `isSectionHeaderText`, `classifyIrrelevantReason`, `stripInlineBoughtMarker`, `canMergeResolvedConcepts`, `mergeUnitsIfCompatible`, `mergeGroceryCandidates`, `analyzeSheetGrid`, `exportListToCsv` |
| `web/js/store.js` | 107 | `store` |
| `web/js/suggest.js` | 66 | `STARTER_ITEMS`, `recordPurchase`, `runningOut`, `frequent` |
| `web/js/synonyms.js` | 667 | `AMBIGUOUS_ITEMS_LIST`, `checkAmbiguousTerm`, `resolveGrocerySynonym`, `getSearchQueriesForItem` |
| `web/js/xlsx.js` | 359 | `XLSX_LIMITS`, `scanXmlElements`, `parseXlsxBuffer` |
| `web/js/zip.js` | 93 | `isZip`, `listZipEntries` |
| `web/manifest.webmanifest` | 16 | — |
| `web/shufersal-extension.zip` | binary (40680 B) | — |
| `web/smartcart-extension.zip` | binary (40680 B) | — |
| `web/styles.css` | 472 | — |
| `web/sw.js` | 50 | — |
