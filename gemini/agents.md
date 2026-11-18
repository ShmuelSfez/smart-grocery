# SmartCart (העגלה החכמה) — Vision, Goals & Agent Guide

## 1. Project Definition & Product Decisions
**SmartCart (העגלה החכמה)** is a Hebrew-first grocery planning & price-comparison web app (**web-only POC**) built around **three non-negotiable pillars**:

1. **Extreme Ease of Use (UX First):**
   - Go from a messy WhatsApp note, Google Sheet, or quick typing to an aisle-sorted shopping list in under 60 seconds.
   - Mobile-first RTL layout, zero build step, smart Google Sheets filtering (skipping DIY/hardware, furniture, and non-grocery rows), and zero auto-saving of unchosen products.
2. **100% Real, Honest Prices Only:**
   - Single source of truth: Israel's official **Price Transparency Law (חוק שקיפות מחירים)** feeds (`Stores`, `PriceFull`, `PromoFull`) for **Shufersal, Rami Levy, and Carrefour**. (**Victory** and **Yochananof** display `"בקרוב"` until wired in.)
   - **Never invent, extrapolate, or copy prices across chains.** Missing prices show `"אין נתון"`, incomplete baskets are marked `"חלקי"` (never `"🏆 הכי זול"`), barcode mismatches on pinned items use closest name match badged `"חלופה"`, and quantity-to-weight estimates are explicitly labeled.
   - **All-Customer Promotions Only (v1):** Include active non-coupon deals open to everyone (`ClubID` starting with `0`). Leave club/credit-card deals for a future team decision.
   - **Verified Configs Only:** Delivery fees live in `web/data/delivery.json` with a visible `lastChecked` date (`null` = `"לא ידוע"`, excluded from totals). Sponsored badges live in `web/data/sponsored.json` (`enabled: false` until real signed placements exist).
3. **Commercial Readiness (Path from POC to SaaS):**
   - For the non-commercial POC, static price files (`data/v1/`) are published to GitHub Pages (`https://shmuelsfez.github.io/smart-grocery/data/v1`) and the frontend runs on Vercel (`https://smart-grocery-kappa.vercel.app`).
   - **Before charging money:** Move static feed hosting from GitHub Pages to Cloudflare R2 / DB, upgrade Vercel from Hobby to Pro, and move Gemini AI calls behind a server proxy.

---

## 2. Scope & Feature Guardrails
- **Chrome Extension (`extension/`):** Frozen as an **optional desktop bonus** (`v2.3.0`). Do **not** add new features to it during the POC. Security rules:
  - Never auto-submit items to a cart on `#smartlist=` load—always require an explicit user click on `"הוסף לסל"`.
  - Never overwrite saved `mappings` or `shufAuth` from incoming untrusted `#smartlist=` links.
  - Rami Levy uses **guided search-and-add** mode only (never call `/api/v2/cart` which overwrites the user's existing cart).
- **Family Sync (`FEATURES.familySync`):** Disabled in production (`localhost` only) until built properly with a database and access control in a future phase. Room IDs use `crypto.getRandomValues` (≥16 chars) and incoming room items are strictly sanitized.
- **No Private Store Scraping:** Never scrape supermarket private website APIs from `serve.mjs` or `api/`. All price data comes from the official Price Transparency portals via `pipeline/`.

---

## 3. Codebase Map & Skills
- **`gemini/skills/code-infra/`**: Living architecture & code-reading guide (scheduled to refresh weekly and verify `README.md` stays aligned with the code).
- **`web/`**: Zero-build static PWA (`index.html`, `styles.css`, `sw.js`, `data/*.json`, `js/*.js`).
- **`pipeline/`**: Node 20 ingestion pipeline (`build.mjs`, `publish-pages.mjs`, `parse.mjs`, `promos.mjs`, `cities.mjs`, `sources/*.mjs`).
- **`api/sheet.js`**: Strict Google Sheets CSV export fetcher (shared with `serve.mjs`).
- **`extension/`**: Optional desktop Chrome Extension MV3 (`manifest.json`, `capture.js`, `panel.js`, `codec.js`, `popup.*`).
- **`tests/`**: Node built-in test runner (`core.test.mjs`, `pricing.test.mjs`, `pipeline.test.mjs` + `fixtures/`).

---

## 4. Non-Negotiable Engineering & Security Guardrails
1. **Zero Passwords Policy:** Never ask for, store, or encode supermarket passwords anywhere.
2. **Untrusted Input & XSS:** Never pass untrusted strings to `innerHTML`. Keep CSP free of `'unsafe-inline'`. Keep `SLCodec` bounded (256 KB decompressed limit, item/string caps, allowlisted image hosts).
3. **Keep Shared Code & Zip Synced:** After any change to `web/js/codec.js` or `extension/`, copy `web/js/codec.js` → `extension/codec.js` and rebuild `web/shufersal-extension.zip`.
4. **Cache Busting:** Bump `?v=N` on CSS/JS tags in `web/index.html` whenever frontend assets change. Keep `web/sw.js` network-first for static shell files only (never cache `/api/*` or `/data/*`).
5. **Zero Frontend Build Step:** Keep `web/` pure ES modules; verify every edit with `npm test` and `node --check`.
6. **Legal & Trademark Separation:** Maintain non-affiliation disclaimers in `web/index.html` and `extension/manifest.json`.

---

## 5. Team & Git Workflow
1. **Sync Before Editing:** Always `git pull --rebase origin main` before starting work.
2. **Small, Focused Commits:** Commit each logical change separately with a clear imperative message.
3. **Green Before Push:** Always run `npm test` and `node --check` on modified JS/MJS files before committing and pushing.
4. **Deploy Sync:** Deploy `web/` or `api/` changes to Vercel (`npx vercel --prod`). Never commit generated `/data/` price files to `main` (`publish-pages.mjs` publishes them as a single orphan commit to `gh-pages`).
