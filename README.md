# 🛒 העגלה החכמה (SmartCart)

**Live App:** https://smart-grocery-kappa.vercel.app  
**Repository:** https://github.com/ShmuelSfez/smart-grocery

An ultra-simple, Hebrew-first grocery planning web app (PWA) and Chrome extension built around three goals:
1. **Extreme ease of use:** Go from messy notes, WhatsApp messages, or Google Sheets to a complete supermarket basket in under 60 seconds.
2. **All prices in one place:** Compare item-level and full-basket costs across major Israeli chains—including delivery fees, free-delivery thresholds, area coverage, and delivery windows.
3. **Built to grow commercially:** Clean, security-hardened architecture designed to scale to 500k+ households (Israeli Price Transparency XML feeds, real-time family sync, Freemium Pro plan, and sponsored brand placement).

---

## Features
- **Smart Hebrew/English Parser (`web/js/parser.js`):** Understands quantities, units, and qualifiers like `2 חלב`, `1.5 ק"ג עגבניות`, `במבה x3`, `סלק לפחות 5`, and `כרובית?`.
- **Auto Aisle Categorization (`web/js/categories.js`):** Head-noun aware sorting (`מיץ תפוזים` → drinks, `שוקולד חלב` → snacks) with remembered manual overrides.
- **Smart Google Sheets Import & Export (`web/js/sheets.js`, `/api/sheet`):**
  - Import from a Google Sheets URL (with a guided permission popup if the sheet is private), `.csv` upload, or direct **Ctrl+C → Ctrl+V** from Google Sheets.
  - Automatically separates buyable supermarket items from table headers, hardware/DIY (`ציוד בניה`), furniture, and durable kitchenware (`קניות כלליות`).
  - Export lists to UTF-8 BOM `.csv` or clipboard TSV for Google Sheets/Excel.
- **Location-Aware Multi-Supermarket Comparison (`web/js/app.js`, `/api/search`):**
  - Compares baskets across **Rami Levy, Shufersal, Carrefour, Victory, and Yochananof** (live Rami Levy & Shufersal search locally, plus staple fallback when cloud WAFs block serverless IPs).
  - Supports city entry or GPS detection, chain availability overrides, delivery fees, free-shipping thresholds, and sorting by **Cheapest (incl. delivery)** or **Fastest delivery**.
- **1-Click Cart Fill Extension (`extension/`):** Manifest V3 Chrome extension supporting **Rami Levy** and **Shufersal**—redirects to the store's official login page when needed (never collects passwords) and adds the user's selected items straight to the cart.
- **Real-Time Family Sync (`?room=...`):** Live shared shopping rooms (`/api/room` in local server; Supabase Realtime planned for cloud scale).
- **Suggestions, Recipes & Optional AI (`suggest.js`, `recipes.js`, `ai.js`):** Purchase-interval predictions (*"כנראה נגמר לך"*), scalable meal templates, and optional BYO Gemini API key for turning recipes/requests into lists.

---

## Project Structure
```text
smart-grocery/
├── web/                  # Static frontend PWA (HTML, CSS, ES modules — zero build step)
│   ├── index.html        # App shell, dialogs, cache-busted asset tags (?v=N)
│   ├── styles.css        # RTL-first styling
│   ├── js/               # Core modules (app, parser, categories, sheets, codec, suggest, recipes, store, ai)
│   └── shufersal-extension.zip  # Packaged Chrome extension download
├── api/                  # Vercel serverless endpoints
│   ├── search.js         # /api/search (multi-chain search + rate limit + fallback catalog)
│   └── sheet.js          # /api/sheet (strict Google Sheets CSV export fetcher)
├── extension/            # Chrome Extension (Manifest V3)
│   ├── manifest.json     # Least-privilege permissions (storage + Rami Levy / Shufersal)
│   ├── capture.js        # Captures #smartlist= payload on document_start
│   ├── panel.js          # Same-origin search, official login redirect & cart fill UI
│   ├── codec.js          # Shared payload codec (synced with web/js/codec.js)
│   └── popup.html|js     # Saved product mappings & manual import popup
├── tests/                # Unit tests (node --test tests/)
├── exports/              # Exported roadmap & supermarket specs (.xlsx / .csv)
├── gemini/               # Project definition (agents.md) & code-infra skill (auto-updated weekly)
├── serve.mjs             # Local dev server (web/, /api/search, /api/sheet, /api/room)
└── vercel.json           # Vercel routing + strict CSP & security headers
```

---

## Getting Started (For Developers)
Requires **Node.js 18+** (zero external npm dependencies needed).

```bash
git clone https://github.com/ShmuelSfez/smart-grocery.git
cd smart-grocery
npm test    # Run unit tests (7 tests covering parser, categories, suggestions, recipes, codec, sheets)
npm start   # Start local server at http://localhost:5173
```

### Load the Chrome Extension Locally
1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** → choose the `extension/` folder.

### Deploy to Production (Vercel)
Configured via `vercel.json` and `api/`:
```bash
npx vercel --prod
```

---

## Roadmap (Towards Commercial Scale)
- **Phase 1 (Done):** Core zero-build PWA, Hebrew/English parser, Google Sheets smart import/export, 5-chain & delivery comparison UI, Chrome Extension (`Rami Levy` & `Shufersal`), security hardening, Vercel & GitHub setup.
- **Phase 2:** Chrome Web Store publishing (\$5 + Privacy Policy) + hourly ingestion of Israel's public **Price Transparency Law (חוק שקיפות מחירים)** XML/GZ feeds into Postgres/Supabase.
- **Phase 3:** Persistent Supabase Realtime family rooms, user accounts, and server-side `/api/ai` proxy.
- **Phase 4:** Freemium Pro billing (₪15–₪25/mo), sponsored brand management, and extension adapters for Carrefour, Victory, and Yochananof.

---

## Contributing & AI Agents
- Read `gemini/agents.md` and `gemini/skills/code-infra/SKILL.md` before making changes.
- Follow **pull → test (`npm test` + `node --check`) → small focused commit → push**.
- Whenever changing `web/js/codec.js` or `extension/`, copy `web/js/codec.js` to `extension/codec.js`, rebuild `web/shufersal-extension.zip`, and bump `?v=N` in `web/index.html`.
- Keep all non-affiliation disclaimers intact (independent unofficial tool, not affiliated with any supermarket chain).
