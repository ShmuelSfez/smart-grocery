# Codebase File Inventory (Auto-Generated)

- **Updated:** 2026-11-18T01:38:31.267Z
- **Latest Commit:** `a5066e1 2026-11-18 Add .vercelignore to exclude local pipeline data from Vercel uploads`
- **Unit Tests (`npm test`):** 18 pass, 0 fail

| File | Lines / Size | Exports |
| :--- | :--- | :--- |
| `.github/workflows/ci.yml` | binary (621 B) | — |
| `.github/workflows/prices.yml` | binary (1242 B) | — |
| `.gitignore` | binary (41 B) | — |
| `.vercelignore` | binary (68 B) | — |
| `README.md` | 102 | — |
| `api/sheet.js` | 92 | `extractSheetExportUrl`, `fetchGoogleCsv`, `default` |
| `extension/capture.js` | 11 | — |
| `extension/codec.js` | 139 | — |
| `extension/icons/128.png` | binary (2070 B) | — |
| `extension/icons/16.png` | binary (438 B) | — |
| `extension/icons/48.png` | binary (984 B) | — |
| `extension/manifest.json` | 37 | — |
| `extension/panel.js` | 666 | — |
| `extension/popup.html` | 42 | — |
| `extension/popup.js` | 65 | — |
| `gemini/agents.md` | 55 | — |
| `gemini/skills/code-infra/SKILL.md` | 48 | — |
| `gemini/skills/code-infra/references/architecture.md` | 40 | — |
| `gemini/skills/code-infra/scripts/update-map.mjs` | 87 | — |
| `package.json` | 2 | — |
| `pipeline/build.mjs` | 236 | — |
| `pipeline/cities.mjs` | 106 | `cleanCityString`, `loadLocalCityMap`, `loadCityMap`, `resolveCityName` |
| `pipeline/data/cbs-cities.json` | 1319 | — |
| `pipeline/parse.mjs` | 157 | `decodeFeedBuffer`, `unescapeXml`, `normalizeStoreId`, `extractFileMeta`, `getTag`, `parseStoresXml`, `parsePricesXml` |
| `pipeline/promos.mjs` | 149 | `parsePromosXml` |
| `pipeline/publish-pages.mjs` | 34 | — |
| `pipeline/sources/carrefour.mjs` | 98 | `listFeeds` |
| `pipeline/sources/ramilevy.mjs` | 134 | `listFeeds` |
| `pipeline/sources/shufersal.mjs` | 97 | `listFeeds` |
| `serve.mjs` | 170 | — |
| `tests/core.test.mjs` | 129 | — |
| `tests/fixtures/prices-sample.xml` | binary (1160 B) | — |
| `tests/fixtures/promos-sample.xml` | binary (4793 B) | — |
| `tests/fixtures/stores-sample.xml` | binary (844 B) | — |
| `tests/pipeline.test.mjs` | 197 | — |
| `tests/pricing.test.mjs` | 72 | — |
| `vercel.json` | 22 | — |
| `web/data/delivery.json` | 10 | — |
| `web/data/sponsored.json` | 6 | — |
| `web/icon.svg` | binary (195 B) | — |
| `web/index.html` | 314 | — |
| `web/js/ai.js` | 57 | `aiToItems` |
| `web/js/app.js` | 1627 | — |
| `web/js/categories.js` | 154 | `CATEGORIES`, `CATEGORY_BY_ID`, `categorize` |
| `web/js/chains.js` | 14 | `CHAINS`, `CHAIN_BY_ID`, `LIVE_CHAIN_IDS` |
| `web/js/codec.js` | 139 | — |
| `web/js/parser.js` | 177 | `UNITS`, `parseItem`, `splitItems`, `parseMany`, `normalizeName`, `formatQty` |
| `web/js/prices.js` | 434 | `PROD_DATA_BASE`, `LOCAL_DATA_BASE`, `normalizeBarcode`, `normalizeSearchText`, `expandHebrewToken`, `buildCatalogBundle`, `scoreEntry`, `searchCatalogProducts`, `matchLineAcrossChains`, `loadMeta`, `loadCities`, `loadChainCatalog`, `loadBranchPrices`, `findMatchingCity`, `branchesInCity` |
| `web/js/pricing.js` | 117 | `chargeQty`, `applyPromo`, `lineCost`, `compareBasket` |
| `web/js/recipes.js` | 85 | `RECIPES`, `scaleRecipe` |
| `web/js/sheets.js` | 181 | `parseGrid`, `analyzeSheetGrid`, `exportListToCsv` |
| `web/js/store.js` | 66 | `store` |
| `web/js/suggest.js` | 66 | `STARTER_ITEMS`, `recordPurchase`, `runningOut`, `frequent` |
| `web/manifest.webmanifest` | 16 | — |
| `web/shufersal-extension.zip` | binary (18637 B) | — |
| `web/styles.css` | 324 | — |
| `web/sw.js` | 50 | — |
