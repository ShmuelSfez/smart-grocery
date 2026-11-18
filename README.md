# 🛒 העגלה החכמה (SmartCart)

**Live App (Web POC):** https://smart-grocery-kappa.vercel.app  
**Price Data Feed (GitHub Pages):** https://shmuelsfez.github.io/smart-grocery/data/v1/meta.json  
**Repository:** https://github.com/ShmuelSfez/smart-grocery

A Hebrew-first grocery planning web app (PWA) built around three principles:
1. **Extreme ease of use:** Go from messy notes, WhatsApp messages, or Google Sheets to an aisle-sorted shopping list in under 60 seconds.
2. **100% real, transparent prices:** Compare item-level and full-basket costs across **Shufersal, Rami Levy, and Carrefour** using Israel's official **Price Transparency Law (חוק שקיפות מחירים)** branch feeds—never invented or guessed prices. (**Victory** and **Yochananof** are shown as *בקרוב* until wired in.)
3. **Built to grow commercially:** Clean, zero-build frontend + daily automated feed pipeline designed to evolve toward commercial scale.

---

## Features
- **Official Price Transparency Comparison (`pipeline/`, `web/js/prices.js`, `web/js/pricing.js`):**
  - Ingests official `Stores`, `PriceFull`, and `PromoFull` XML/GZ/ZIP feeds for **Shufersal** (~417 stores), **Rami Levy** (~97 stores), and **Carrefour** (~148 stores) across **117 Israeli localities** plus official **`StoreType=2` online fulfilment stores** (`online.json`).
  - **Delivery vs In-Store Mode:** Defaults to **`🚚 משלוח הביתה`** (prices each chain directly from its official online fulfilment store: Shufersal `413`, Rami Levy `39`, Carrefour `471/472/473`), or toggle to **`🏬 קנייה בסניף פיזי`** to pick a city and physical branch (`סניף ▾`).
  - **All-Customer Promotions:** Applies active non-coupon promotions open to all customers (`ClubID = 0`, single-item discounts and `X for ₪Y` bundles across `<PromotionItem>` and `<PromotionItems><Item>`). Club-only deals are excluded for now.
  - **Strict Price & Ambiguity Honesty:** Missing items show `אין נתון`, incomplete baskets are marked `חלקי` (never eligible for `🏆 הכי זול!`), bare ambiguous words (`סודה`, `פלפל`, `שמנת`, `נייר`, etc.) prompt 1-click disambiguation chips instead of guessing, bought items (`✅`, `[x]`, `~~...~~`, Excel strikethrough) import unchecked, and asymmetric delivery fees compare on apples-to-apples product subtotals.
  - **Verified Delivery & Coverage Configs (`web/data/delivery.json`, `web/data/delivery-coverage.json`):** Only human-verified fees/coverage are asserted with a visible `lastChecked` date; unknown cities show a direct check link to the chain's site.
- **Unified Import, Synonym & `.xlsx` Engine (`web/js/importer.js`, `web/js/synonyms.js`, `web/js/xlsx.js`, `web/js/sheets.js`):**
  - Supports free text, WhatsApp chats, Google Sheets links (`api/sheet.js`), CSV/TSV, and zero-dependency styled **Excel `.xlsx`** workbooks (ignoring colors/merged cells while detecting `<strike/>` bought rows with bounded streaming decompression).
  - Deduplicates Hebrew/English synonyms and morphology without merging competing brands or distinct products, and filters out headers, DIY/hardware, furniture, electronics, and errands.
- **DV-Style 628-List Regression Suite (`tests/regression/`):**
  - **108 directed corner-case lists + 520 seeded constrained-random lists** (₪200–₪4,000) checked against a 392-entry golden dictionary, a frozen 2.3 MB online-store XML snapshot, and a standalone zero-import XML price oracle (`S1`–`S10` scoreboard + 1D/cross/DUT-response coverage).
- **Suggestions, Recipes & Optional AI (`suggest.js`, `recipes.js`, `ai.js`):** Purchase-interval predictions (*"כנראה נגמר לך"*), scalable meal templates, and optional BYO Gemini API key.
- **Optional Desktop Chrome Extension (`extension/`, frozen bonus):**
  - Manifest V3 extension (`v2.3.0`) for desktop Chrome: opens prefilled on **Shufersal** and adds items only after an explicit click on `"הוסף לסל"` (never auto-submits on link open, never touches passwords), and provides a safe **guided search-and-add** checklist on **Rami Levy**.

---

## Project Structure
```text
smart-grocery/
├── web/                      # Static frontend PWA (HTML, CSS, ES modules — zero build step)
│   ├── index.html            # App shell, dialogs, cache-busted asset tags (?v=N)
│   ├── styles.css            # RTL-first styling (no inline styles; strict CSP)
│   ├── sw.js                 # Network-first service worker for static app shell only
│   ├── data/                 # Human-verified delivery.json + config-driven sponsored.json
│   ├── js/                   # app, prices, pricing, chains, parser, categories, sheets, codec, suggest, recipes, store, ai
│   └── shufersal-extension.zip
├── pipeline/                 # Node 20 Price Transparency ingestion pipeline
│   ├── build.mjs             # Fetches, parses, normalizes & writes static JSON to data/v1/
│   ├── publish-pages.mjs     # Publishes a clean single-commit snapshot to gh-pages
│   ├── parse.mjs             # Gzip + UTF-8/UTF-16LE/Windows-1255 XML parser (Stores, PriceFull)
│   ├── promos.mjs            # All-customer active promotion extractor (PromoFull)
│   ├── cities.mjs            # CBS locality code -> Hebrew city mapper (+ data/cbs-cities.json)
│   └── sources/              # shufersal.mjs, ramilevy.mjs, carrefour.mjs
├── api/
│   └── sheet.js              # /api/sheet (strict Google Sheets CSV export fetcher, shared with serve.mjs)
├── extension/                # Optional desktop Chrome Extension (Manifest V3, v2.3.0)
├── tests/                    # 25 unit tests + 628-list DV regression suite (tests/regression/)
├── gemini/                   # Project definition (agents.md) & skills (code-infra, dv-regression)
├── serve.mjs                 # Local dev server (web/, local /data/v1/, /api/sheet, dev-only /api/room)
└── vercel.json               # Vercel routing + strict CSP & security headers
```

---

## Getting Started (For Developers)
Requires **Node.js 20+** (zero external npm dependencies).

```bash
git clone https://github.com/ShmuelSfez/smart-grocery.git
cd smart-grocery
npm test                  # Run all 25 fast unit tests
npm run regression:smoke  # Run fast deterministic DV smoke regression
npm run regression        # Run full 628-list DV regression & update tests/regression/reports/latest.md
npm start                 # Start local server at http://localhost:5173
```

### Build Price Data Locally (Optional)
```bash
# Quick smoke build (3 branches per chain -> data/v1/)
node pipeline/build.mjs --chains=shufersal,ramilevy,carrefour --limit-stores=3

# Full Israel build (~658 branches across 117 cities, ~3 min)
node pipeline/build.mjs --out=data/v1
```

### Deploy Frontend to Production (Vercel)
```bash
npx vercel --prod
```

---

## Roadmap
- **POC v1 (Done):** Zero-build web app, Hebrew/English parser, Google Sheets smart import/export, official **Price Transparency v1** pipeline (`Shufersal`, `Rami Levy`, `Carrefour`) hosted as static per-branch JSON, hybrid barcode/substitute basket comparison, security & honesty audit fixes, 18 unit tests.
- **Next Phases:**
  - Add **Victory** and **Yochananof** transparency feeds + address-level nearest-branch matching.
  - Decide policy on club/credit-card promotions with the team.
  - Migrate static price hosting off GitHub Pages to **Cloudflare R2 / Postgres** and move Vercel Hobby → Pro before any commercial monetization.
  - Persistent authenticated Family Sync (currently feature-flagged to `localhost` only) and server-side `/api/ai` proxy.

---

## Contributing & AI Agents
- Read `gemini/agents.md` and `gemini/skills/code-infra/SKILL.md` before making changes.
- Follow **pull → test (`npm test` + `node --check`) → small focused commit → push**.
- Keep `web/js/codec.js` and `extension/codec.js` byte-identical, rebuild `web/shufersal-extension.zip` on extension/codec changes, and bump `?v=N` in `web/index.html` on frontend changes.
- Maintain all non-affiliation disclaimers (independent unofficial comparison tool, not affiliated with any supermarket chain).
