# SmartCart (העגלה החכמה) — Project & Agent Guide

## 1. What This Project Is
**SmartCart (העגלה החכמה)** is a Hebrew-first, mobile-friendly grocery planning web app (PWA) paired with a Manifest V3 Chrome Extension that compares supermarket baskets across major Israeli chains and automatically fills the user's online shopping cart so they only have to pick a delivery slot and pay.

- **GitHub:** https://github.com/ShmuelSfez/smart-grocery
- **Live Production (Vercel):** https://smart-grocery-kappa.vercel.app
- **Local Dev URL:** http://localhost:5173

---

## 2. Project Goal & Commercial Vision
### Core User Problem
Building a weekly supermarket order in Israel is tedious and fragmented: people maintain lists in WhatsApp or Google Sheets, manually copy-paste items into a supermarket site one by one, don't know which chain is actually cheapest for *their* specific basket (after delivery fees), and waste time checking which stores even deliver to their city.

### Product Goal
1. **Smart List Capture:** Parse natural Hebrew/English input (`2 חלב`, `1.5 ק"ג עגבניות`, `סלק לפחות 5`, `כרובית?`), auto-sort items into supermarket aisles, learn purchase intervals (*"כנראה נגמר לך"*), scale recipes, and support optional AI meal-to-list generation.
2. **Smart Google Sheets Import / Export:** Let users import from a Google Sheet link, CSV, or direct copy-paste while automatically filtering out table headers, hardware/DIY (`ציוד בניה`), furniture, and non-supermarket items.
3. **Location-Aware Multi-Supermarket Comparison:** Compare the full basket total (items + delivery fee + free-delivery threshold + earliest delivery slot + city coverage) across **Rami Levy, Shufersal, Carrefour, Victory, and Yochananof**.
4. **1-Click Cart Auto-Fill (No Double Work):** Pass the user's exact selected products into the Chrome Extension, which redirects to the store's official login page if needed and fills the cart automatically inside the user's own authenticated browser session.

### Commercial Roadmap (Target: Scalable SaaS / 500k+ Users)
- **Phase 1 (Current):** Core web app + Chrome extension (`Shufersal` & `Rami Levy`), security-hardened client/proxy, Google Sheets smart import/export, live Vercel deployment.
- **Phase 2 (Data & Scale):** Replace live cloud search proxies (which hit WAF blocks on cloud IPs) with scheduled ingestion of Israel's public **Price Transparency Law (חוק שקיפות מחירים)** XML/GZ feeds into Postgres/Supabase for `<20ms` exact 5-chain pricing + Chrome Web Store release.
- **Phase 3 (Real-Time Sync & Accounts):** Persistent family rooms via Supabase Realtime / Postgres instead of in-memory rooms, plus server-side `/api/ai` proxy.
- **Phase 4 (Monetization):**
  - **Freemium Pro (₪15–₪25/mo):** Free single-chain list & cart fill; paid tier for 5-chain price comparison, real-time family sync, and hosted AI meal planning.
  - **Sponsored Brand Placement:** Promoted default brand suggestions (marked `⭐ ממומן`) when users add generic items.
  - **Multi-Chain Extension Adapters:** Expand auto-cart support to Carrefour, Victory, and Yochananof using `optional_host_permissions`.

---

## 3. Codebase Architecture
```
smart-grocery/
├── web/                  # Static frontend (vanilla HTML, CSS, ES modules — zero build step)
│   ├── index.html        # App shell, dialogs, cache-busted asset version (?v=N)
│   ├── styles.css        # RTL-first styling
│   ├── js/
│   │   ├── app.js        # UI state, multi-chain pricing, location/delivery logic, rooms
│   │   ├── parser.js     # Hebrew/English quantity, unit & qualifier parser
│   │   ├── categories.js # Store aisle keyword/phrase classifier
│   │   ├── sheets.js     # CSV/TSV parser, non-grocery filter, UTF-8 BOM exporter
│   │   ├── codec.js      # Bounded deflate-raw URL list codec (shared with extension)
│   │   ├── suggest.js    # Purchase frequency & "running out" engine
│   │   ├── recipes.js    # Built-in scalable Hebrew meal templates
│   │   ├── store.js      # localStorage persistence & backup import/export
│   │   └── ai.js         # Optional client-side Gemini API helper
│   └── shufersal-extension.zip  # Packaged extension for direct download
├── api/                  # Vercel serverless functions
│   ├── search.js         # /api/search with TTL cache, rate limit & staple fallback
│   └── sheet.js          # /api/sheet strict Google Sheets CSV fetcher
├── extension/            # Chrome Extension (Manifest V3)
│   ├── manifest.json     # Least-privilege permissions (storage + supermarket hosts)
│   ├── capture.js        # document_start #smartlist= hash capture
│   ├── panel.js          # Same-origin search, login redirect & cart fill panel
│   ├── codec.js          # Must stay byte-identical to web/js/codec.js
│   └── popup.html|js     # Toolbar popup for saved item mappings & manual import
├── tests/core.test.mjs   # Node built-in test runner (`npm test`)
├── exports/              # Exported roadmap & supermarket specs (.xlsx / .csv)
├── serve.mjs             # Local dev server (serves web/, /api/search, /api/sheet, /api/room)
├── vercel.json           # Vercel routing + strict CSP & security headers
└── gemini/               # Project AI context (`agents.md`) & custom skills (`skills/`)
```

---

## 4. Engineering & Security Rules for Agents
1. **Zero Passwords Policy:** Never collect, store, or transmit third-party supermarket passwords in `web/`, URL hashes, or `chrome.storage`. Only optional email hints may be passed to pre-fill the official store login page.
2. **Untrusted Input & XSS:** Never inject product names, sheet cells, or URL payload fields via `innerHTML`. Keep `SLCodec` bounded (256 KB decompressed cap, strict item/length limits, and allowlisted image hosts only).
3. **Sync Shared Assets:** Whenever editing `web/js/codec.js` or any file in `extension/`, copy `web/js/codec.js` to `extension/codec.js` and rebuild `web/shufersal-extension.zip`.
4. **Cache Busting:** Bump `?v=N` query params on `styles.css`, `codec.js`, and `app.js` in `web/index.html` whenever frontend files change.
5. **No Unnecessary Build Tooling:** Keep `web/` runnable as plain static ES modules and verify every change with `npm test` (`node --test tests/`) and `node --check`.
6. **Legal & Trademark Separation:** Keep clear non-affiliation disclaimers in both `web/index.html` and `extension/manifest.json`.
