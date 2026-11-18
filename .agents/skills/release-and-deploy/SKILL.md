---
name: release-and-deploy
description: >-
  Executes SmartCart's pre-release verification, cache-busting (?v=N), shared codec
  and shufersal-extension.zip packaging, git commit workflow, Vercel production
  deployment, and commercial SaaS migration readiness checklist. Use this skill
  before cutting a commit/release, deploying web/ or api/ to Vercel, updating
  extension/ or codec.js, or preparing SmartCart for commercial launch.
---

# SmartCart Release, Deployment & SaaS Readiness Runbook

Follow this sequential checklist whenever preparing changes for commit, production Vercel release, or commercial transition.

---

## 1. Pre-Flight Git Sync & Workspace Cleanliness

```bash
git status --short
git pull --rebase origin main
```
- Confirm generated `data/` price files and local `.env` / `.vercel` files remain untracked/ignored (`.gitignore`, `.vercelignore`).

---

## 2. Full Verification Gate (Syntax + Unit + DV Regression)

1. **Syntax-check all runtime and pipeline files (`node --check`):**
   - *Bash / GitHub Actions:*
     ```bash
     for f in web/*.js web/js/*.js api/*.js pipeline/*.mjs pipeline/sources/*.mjs serve.mjs extension/*.js; do node --check "$f"; done
     ```
   - *PowerShell (Windows):*
     ```powershell
     Get-ChildItem web/*.js,web/js/*.js,api/*.js,pipeline/*.mjs,pipeline/sources/*.mjs,serve.mjs,extension/*.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Syntax error in $_" } }
     ```
2. **Run all 25+ Node built-in unit tests:**
   ```bash
   npm test
   ```
3. **Run the DV Regression Gate:**
   - For UI-only / CSS / docs edits:
     ```bash
     npm run regression:smoke
     ```
   - For any edit touching `web/js/*` domain/import/matching/pricing logic, `pipeline/*`, or `tests/regression/*`:
     ```bash
     npm run regression
     ```
     Verify `S1`–`S8` and `S10` are **100.0% PASS**, lexicon overlap is **`<= 30%`**, **zero regression** in list pass rate / `S9` recall & precision against `tests/regression/reports/latest.md` (`--strict` enforces `100%` once `S9` is closed), and review the updated `latest.md`.

---

## 3. Frontend Cache Busting (`?v=N`) & Service Worker Check

Whenever **any** file in `web/styles.css` or `web/js/*.js` changed:
1. Open `web/index.html` and increment `?v=N` to the same integer `N+1` on all three tags:
   - `<link rel="stylesheet" href="styles.css?v=N" />`
   - `<script src="js/codec.js?v=N"></script>`
   - `<script type="module" src="js/app.js?v=N"></script>`
2. If `web/sw.js` shell caching behavior or `SHELL_URLS` changed, bump `CACHE_NAME = 'smartcart-shell-v...'` in `web/sw.js` and verify `/api/*`, `/data/*`, and `.zip` remain excluded from caching.

---

## 4. Shared `codec.js` & `web/shufersal-extension.zip` Sync

Note: `extension/` (`v2.3.0`) is **frozen** for new POC features, so rebuild only on bug/security fixes or `web/js/codec.js` updates.

1. **Sync `codec.js` byte-for-byte:**
   - *PowerShell:* `Copy-Item web/js/codec.js extension/codec.js -Force`
   - *Bash:* `cp web/js/codec.js extension/codec.js`
2. **Rebuild `web/shufersal-extension.zip` cleanly from `extension/*`:**
   - *PowerShell:*
     ```powershell
     Compress-Archive -Path extension/* -DestinationPath web/shufersal-extension.zip -Force
     ```
   - *Bash:*
     ```bash
     (cd extension && zip -rq ../web/shufersal-extension.zip .)
     ```
3. Re-run `npm test` (which asserts byte equality between `web/js/codec.js` and `extension/codec.js`).

---

## 5. Inventory Map Refresh & Commit Conventions

1. **Refresh the auto-generated file/export inventory:**
   ```bash
   node .agents/skills/code-infra/scripts/update-map.mjs
   ```
2. **Commit with focused, imperative messages:**
   - Stage explicit paths (`git add <paths>`)—never blind `git add .` if untracked scratch artifacts exist.
   - Use clear scoped messages:
     - `feat(web): ...`
     - `fix(pipeline): ...`
     - `test(regression): ...`
     - `docs(agents): ...`

---

## 6. Production Deployment (Vercel + GitHub Pages)

1. **Deploy Frontend & `/api/sheet` to Vercel:**
   ```bash
   npx vercel --prod
   ```
2. **Post-Deploy Live Smoke Check (`https://smart-grocery-kappa.vercel.app`):**
   - Confirm main page loads with the new `?v=N` assets and zero console/CSP errors.
   - Confirm live price metadata loads from `https://shmuelsfez.github.io/smart-grocery/data/v1/meta.json`.
   - Confirm non-affiliation disclaimers render in the page footer/dialogs.
3. **If `pipeline/` Output Schema Changed:**
   - Trigger `.github/workflows/prices.yml` (`workflow_dispatch`) or run locally:
     ```bash
     node pipeline/build.mjs --out=data/v1
     node pipeline/publish-pages.mjs data/v1
     ```

---

## 7. Commercial / SaaS Pre-Monetization Checklist

Before charging users, running paid placements (`sponsored.json`), or removing POC disclaimers, complete **all** items below:

- [ ] **Move Price Feed Hosting Off GitHub Pages:** Host `data/v1/*` on **Cloudflare R2** (with CDN caching) or a managed database; update `PROD_DATA_BASE` in `web/js/prices.js` and `connect-src` in `vercel.json` + `serve.mjs`.
- [ ] **Upgrade Vercel Plan:** Upgrade from Vercel **Hobby** (non-commercial) to **Pro**.
- [ ] **Server-Side AI Proxy (`/api/ai`):** Move Gemini API calls (`web/js/ai.js`) behind an authenticated, rate-limited server endpoint so users do not supply browser API keys.
- [ ] **Authenticated Family Sync:** Replace `localhost`-only in-memory `/api/room` (`serve.mjs`) with authenticated persistent storage + room ACLs before enabling `FEATURES.familySync` in production.
- [ ] **Commercial & Legal Review:** Review Israeli Price Transparency usage terms, trademark/non-affiliation disclosures, Privacy Policy, Terms of Service, and explicit `"ממומן"` labeling rules if `web/data/sponsored.json` is enabled.
