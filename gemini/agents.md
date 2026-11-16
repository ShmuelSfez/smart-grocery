# SmartCart (העגלה החכמה) — Vision, Goals & Agent Guide

## 1. Project Definition & What We Aim For
**SmartCart (העגלה החכמה)** is a Hebrew-first grocery shopping platform built around **three non-negotiable pillars**:

1. **Extreme Ease of Use (UX First):**
   - Anyone—even non-technical shoppers—should be able to go from a messy WhatsApp note, Google Sheet, or a few taps to a complete supermarket basket in under 60 seconds.
   - Zero clutter, zero friction, mobile-first RTL layout, automatic aisle sorting, and smart filtering that understands what belongs in a supermarket cart vs. what doesn't (e.g., skipping DIY/hardware or furniture in imported sheets).
2. **A Clear List of All Prices in One Place:**
   - Give the user a single, transparent view of **all prices**: per-item prices across brands, full-basket totals across Israeli supermarket chains (**Rami Levy, Shufersal, Carrefour, Victory, Yochananof**), delivery fees, free-delivery thresholds, area/city coverage, and earliest delivery windows.
   - Send the finalized basket directly into the chosen supermarket's cart via the Chrome extension so the user never copy-pastes products manually.
3. **Commercial Readiness (Built to Scale & Monetize):**
   - Designed from day one to evolve into a commercial SaaS product serving 500k+ Israeli households.
   - **Monetization paths:**
     - **Freemium Pro (₪15–₪25/mo):** Free single-store list & cart fill; paid tier for live 5-chain price comparison, real-time family sync, and hosted AI meal planning.
     - **Sponsored Brand Placement:** Highlighted brand suggestions (`⭐ ממומן`) when users add generic items like `"חלב"` or `"פסטה"`.
     - **Legal Data Foundation:** Transition from live search scraping to scheduled ingestion of Israel's official **Price Transparency Law (חוק שקיפות מחירים)** daily XML/GZ catalogs.

- **GitHub:** https://github.com/ShmuelSfez/smart-grocery
- **Live Production (Vercel):** https://smart-grocery-kappa.vercel.app
- **Local Dev URL:** http://localhost:5173

---

## 2. Commercial & Technical Roadmap
- **Phase 1 (Done):** Core zero-build PWA, Hebrew/English parser, Google Sheets smart import/export, 5-chain & delivery comparison UI, Chrome Extension MV3 (`Shufersal` & `Rami Levy`), security hardening, Vercel deployment, GitHub repo.
- **Phase 2 (Next — Data & Distribution):** Publish Chrome Extension to the Chrome Web Store (\$5 one-time + Privacy Policy); replace cloud search fallback with hourly XML/GZ Price Transparency ingestion into Postgres/Supabase.
- **Phase 3 (Sync & Accounts):** Persistent real-time family sync rooms via Supabase Realtime + user auth + server-side `/api/ai` proxy.
- **Phase 4 (Revenue & Expansion):** Freemium billing (Meshulam / PayPlus / Stripe), sponsored brand admin console, and cart-fill extension adapters for Carrefour, Victory, and Yochananof (`optional_host_permissions`).

---

## 3. Codebase Map & Skills
- **`gemini/skills/code-infra/`**: Living guide to the entire codebase architecture and how to read it efficiently (scheduled to refresh weekly).
- **`web/`**: Static frontend (no bundler; ES modules + `SLCodec` classic script).
- **`api/`**: Vercel serverless endpoints (`/api/search`, `/api/sheet`).
- **`extension/`**: Chrome Extension MV3 (`manifest.json`, `capture.js`, `panel.js`, `codec.js`, `popup.*`).
- **`serve.mjs`**: Local Node server (static `web/` + `/api/search` + `/api/sheet` + `/api/room`).
- **`tests/`**: Node built-in test runner (`npm test`).

---

## 4. Non-Negotiable Engineering & Security Guardrails
1. **Zero Passwords Policy:** Never ask for, store, or encode third-party supermarket passwords in `web/`, URL hashes, or `chrome.storage`. Only optional email hints may pre-fill official login pages.
2. **Untrusted Input & XSS:** Never pass product strings, sheet cells, or URL payload fields to `innerHTML`. Keep `SLCodec` bounded (256 KB decompressed limit, item/string caps, allowlisted image hosts only).
3. **Keep Shared Code & Zip Synced:** After any change to `web/js/codec.js` or `extension/`, copy `web/js/codec.js` → `extension/codec.js` and rebuild `web/shufersal-extension.zip`.
4. **Cache Busting:** Bump `?v=N` on CSS/JS tags in `web/index.html` whenever frontend assets change.
5. **Keep UX Frictionless & Build-Free:** Preserve vanilla ES modules with zero required build step. Verify every edit with `npm test` and `node --check`.
6. **Legal & Trademark Separation:** Maintain non-affiliation disclaimers in `web/index.html` and `extension/manifest.json`.
