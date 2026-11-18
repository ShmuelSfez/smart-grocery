# SmartCart (העגלה החכמה) — Master AI Agent & Engineering Contract

**SmartCart** is a Hebrew-first grocery planning and basket price-comparison PWA (**web-only POC**). Any AI coding or verification agent working in this repository must follow this root contract, scoped subdirectory `AGENTS.md` files, `.agents/rules/`, and `.agents/skills/`.

---

## 1. Product Pillars (Non-Negotiable)

1. **Extreme Ease of Use (<60s UX):** Turn messy WhatsApp chats, free text, CSV/TSV, Google Sheets, or styled `.xlsx` files into a deduplicated, aisle-sorted RTL shopping list in under 60 seconds—with zero build step and zero silent auto-saving of unchosen products.
2. **100% Real, Honest Prices Only:**
   - Single source of truth: Israel's official **Price Transparency Law (`חוק שקיפות מחירים`)** feeds (`Stores`, `PriceFull`, `PromoFull`) for **Shufersal**, **Rami Levy**, and **Carrefour**. (**Victory** and **Yochananof** show `"בקרוב"` until wired in.)
   - **Never invent, extrapolate, or copy prices across chains.**
3. **Commercial Readiness:** Static price feeds (`data/v1/`) publish daily to orphan `gh-pages` (`https://shmuelsfez.github.io/smart-grocery/data/v1`) and the frontend runs on Vercel (`https://smart-grocery-kappa.vercel.app`), with a clean path to Cloudflare R2 + Vercel Pro + server-side `/api/ai` before monetization.

---

## 2. Repository Map

```text
smart-grocery/
├── AGENTS.md                 # Master repo contract (this file — always active)
├── .agents/                  # Auto-discovered workspace rules & progressive-disclosure skills
│   ├── README.md             # AI agent infrastructure overview & discovery guide
│   ├── rules/                # Always-on pre-commit verification gates
│   └── skills/               # code-infra, dv-regression, price-pipeline-ops, release-and-deploy
├── web/                      # Zero-build ES module PWA (scoped rules in web/AGENTS.md)
│   ├── index.html            # RTL app shell, dialogs, cache-busted asset tags (?v=N)
│   ├── styles.css            # Mobile-first RTL styles (strict CSP — no inline styles)
│   ├── sw.js                 # Network-first service worker for static app shell only
│   ├── data/                 # Human-verified delivery.json, delivery-coverage.json, sponsored.json
│   ├── js/                   # Pure domain/pricing modules + app.js + shared codec.js
│   └── shufersal-extension.zip
├── pipeline/                 # Node 20+ Price Transparency ingestion & orphan gh-pages publisher
│   ├── build.mjs             # Fetches, decodes, normalizes & writes data/v1/
│   ├── publish-pages.mjs     # Force-pushes single-commit orphan snapshot to gh-pages
│   ├── parse.mjs             # Gzip/disguised-ZIP + UTF-8/UTF-16/Windows-1255 XML parser
│   ├── promos.mjs            # Active all-customer (ClubID=0) promotion extractor
│   ├── cities.mjs            # CBS locality code (סמל ישוב) -> Hebrew city resolver
│   └── sources/              # shufersal.mjs, ramilevy.mjs, carrefour.mjs
├── api/sheet.js              # SSRF-guarded Google Sheets CSV export proxy (shared with serve.mjs)
├── extension/                # Optional desktop Chrome Extension MV3 (v2.3.0 — FROZEN for POC)
├── tests/                    # 25 Node built-in unit tests + 628-list DV regression
│   └── regression/           # DV testbench, XML oracle & scoreboard (tests/regression/AGENTS.md)
├── docs/                     # Architecture & scaling reference (docs/web-dev-and-scaling-guide.md)
├── gemini/                   # Legacy compatibility pointers to AGENTS.md and .agents/
├── serve.mjs                 # Local dev server (web/, local /data/v1/, /api/sheet, localhost /api/room)
└── vercel.json               # Production rewrites + strict CSP & security headers
```

---

## 3. Essential Commands (Node.js 20+, Zero NPM Dependencies)

Run all commands from the repository root:

```bash
npm test                  # Run all 25 fast unit tests (node --test tests/)
npm run regression:smoke  # Fast deterministic DV smoke regression (~72 lists, offline)
npm run regression        # Full 628-list DV regression & update tests/regression/reports/latest.md
npm start                 # Local dev server at http://localhost:5173
```

Additional targeted commands:
- **Strict CI / pre-commit DV gate:** `node tests/regression/run.mjs --smoke --no-record --strict`
- **Syntax check edited files:** `node --check <path/to/file.js>`
- **Local smoke feed build:** `node pipeline/build.mjs --chains=shufersal,ramilevy,carrefour --limit-stores=3`
- **Refresh codebase file map:** `node .agents/skills/code-infra/scripts/update-map.mjs`

---

## 4. Non-Negotiable Engineering, Pricing & Security Guardrails

1. **Zero NPM Dependencies & Zero Build Step:**
   - Do **not** add `dependencies` or `devDependencies` to `package.json`, and do **not** introduce a bundler or transpiler. Use Node 20+ built-ins (`node:test`, `node:zlib`, `fetch`, Web Streams) and standard browser APIs.
2. **Honest Pricing & Ambiguity Invariants:**
   - Missing prices render `"אין נתון"`. Incomplete baskets (`missing.length > 0`) render `"חלקי"` and can **never** win `cheapestId` (`"🏆 הכי זול!"`).
   - Pinned products missing an exact barcode at another chain use the closest normalized Hebrew name match badged `"חלופה"` (`kind: 'substitute'`).
   - Bare ambiguous hypernyms (`סודה`, `פלפל`, `שמנת`, `נייר`, etc.) stay unpriced behind 1-click disambiguation chips and block `cheapestId` (`null`) until resolved.
   - Bought lines (`✅`, `[x]`, `~~...~~`, Excel `<strike/>`) import with `checked: false` (visible on list, excluded from basket totals).
   - **All-Customer Promotions Only (v1):** Keep only active, unconditional, non-coupon deals open to all customers (`ClubID` empty or starting with `0`).
   - **Verified Delivery & Asymmetric Fee Fairness:** `web/data/delivery.json` and `web/data/delivery-coverage.json` contain only human-verified values with `lastChecked` (`null` = `"לא ידוע"`). When complete chains mix known numeric fees with `null` fees, rank complete chains on product `subtotal` (`comparedOnSubtotalOnly: true`). Keep `web/data/sponsored.json` `enabled: false`.
3. **Security, Privacy & Scope Guardrails:**
   - **Zero Passwords:** Never request, store, or encode supermarket passwords anywhere.
   - **XSS & Strict CSP:** Never pass untrusted strings to `innerHTML`. Keep CSP free of `'unsafe-inline'` in `vercel.json` and `serve.mjs`. Keep `SLCodec` (32 KB encoded / 256 KB streaming decompressed / 200 items / allowlisted image hosts) and `XLSX_LIMITS` bounded.
   - **No Private Store Scraping:** Never scrape private supermarket APIs from `serve.mjs` or `api/`. All price data comes from official Price Transparency portals via `pipeline/`.
   - **Frozen Desktop Extension (`extension/` v2.3.0):** Do not add new features during POC. Never auto-submit carts on `#smartlist=` load (`autoAdd: false`), never overwrite saved `mappings` or `shufAuth` from untrusted links, and keep Rami Levy in guided search-and-add mode only.
   - **Family Sync (`FEATURES.familySync`):** Keep restricted to `localhost` / `127.0.0.1` until backed by authenticated storage.
   - **Legal Separation:** Preserve non-affiliation disclaimers in `web/index.html` and `extension/manifest.json`.

---

## 5. Git, Sync & Deployment Rules

1. **Sync First:** Run `git pull --rebase origin main` before starting edits.
2. **Keep Shared Artifacts Synced:**
   - Copy `web/js/codec.js` → `extension/codec.js` (byte-identical) and rebuild `web/shufersal-extension.zip` whenever `codec.js` or `extension/` changes.
   - Bump `?v=N` on asset tags in `web/index.html` whenever `web/` CSS/JS changes.
3. **Verify Before Commit:** Pass `.agents/rules/verification-signoff.md` (`node --check`, `npm test`, `regression:smoke`, and `update-map.mjs` when files/exports change). Make small, focused imperative commits.
4. **Data vs Code Separation:** Never commit generated `/data/v1/` price files to `main` (`pipeline/publish-pages.mjs` publishes an orphan commit to `gh-pages`). Deploy `web/` or `api/` updates via `npx vercel --prod`.

---

## 6. Scoped Rules & On-Demand Workspace Skills

| Customization | Path | When Used |
| :--- | :--- | :--- |
| **Frontend Rules** | [web/AGENTS.md](./web/AGENTS.md) | Auto-loaded when editing `web/**` (ES modules, Safari compat, CSP/XSS, `?v=N`, UI honesty). |
| **DV Testbench Rules** | [tests/regression/AGENTS.md](./tests/regression/AGENTS.md) | Auto-loaded when editing `tests/regression/**` (oracle independence, `<= 30%` non-tautology gate, waivers). |
| **Signoff Gate Rule** | [.agents/rules/verification-signoff.md](./.agents/rules/verification-signoff.md) | Always-on pre-commit verification checklist (`node --check`, unit tests, DV smoke, map sync). |
| **Skill: `code-infra`** | [.agents/skills/code-infra/SKILL.md](./.agents/skills/code-infra/SKILL.md) | Onboarding, 3-minute code-reading order, architecture flows, and refreshing `file-inventory.md` / `README.md`. |
| **Skill: `dv-regression`** | [.agents/skills/dv-regression/SKILL.md](./.agents/skills/dv-regression/SKILL.md) | Running, triaging (`S1`–`S10`), extending, and closing coverage on the 628-list DV regression suite. |
| **Skill: `price-pipeline-ops`** | [.agents/skills/price-pipeline-ops/SKILL.md](./.agents/skills/price-pipeline-ops/SKILL.md) | Operating `pipeline/`, XML/ZIP/encoding quirks, `StoreType=2`, `gh-pages`, and onboarding new chains (Victory/Yochananof). |
| **Skill: `release-and-deploy`** | [.agents/skills/release-and-deploy/SKILL.md](./.agents/skills/release-and-deploy/SKILL.md) | Pre-release checklist, `?v=N` bump, `shufersal-extension.zip` rebuild, Vercel deploy, and SaaS migration checklist. |
