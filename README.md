# 🛒 העגלה החכמה (SmartCart)

A smart, Hebrew-first grocery list & multi-supermarket price comparison web app (PWA) + a Chrome extension that fills your **Rami Levy** or **Shufersal** cart in one click.

```
smart-grocery/
├── web/          ← Frontend PWA (static HTML/CSS/ES modules – no build step)
├── api/          ← Vercel serverless endpoints (/api/search, /api/sheet)
├── extension/    ← Chrome Extension MV3 (auto-fills Rami Levy & Shufersal carts)
├── tests/        ← Node unit tests (`npm test`)
├── exports/      ← Roadmap & supermarket fee sheets (.xlsx / .csv)
├── serve.mjs     ← Local dev server (serves web/, /api/search, /api/sheet, /api/room)
└── vercel.json   ← Vercel rewrites & Content-Security-Policy headers
```

## Features
- **Smart Hebrew/English parser**: handles `2 חלב`, `1.5 ק"ג עגבניות`, `במבה x3`, `סלק לפחות 5`, `כרובית?`, or full WhatsApp lists.
- **Google Sheets Smart Import & Export**: paste a Google Sheets link, upload CSV, or copy-paste cells directly; automatically skips table headers, hardware/DIY (`ציוד בניה`), furniture, and durable kitchenware.
- **Multi-Supermarket Comparison + Location & Delivery**: compares totals across Rami Levy, Yochananof, Victory, Carrefour, and Shufersal (with delivery fees, free-delivery thresholds, area availability, and delivery windows).
- **Real-Time Family Sync** (`?room=...` via `/api/room` locally; ready for Supabase/Redis in production).
- **1-Click Cart Fill Extension**: runs inside the user's logged-in browser tab on `rami-levy.co.il` or `shufersal.co.il`.
- **Optional AI**: bring-your-own Gemini API key in ⚙️ to turn meal plans or recipes into grocery items.

## Local Development

```bash
npm test      # Run unit tests (node --test tests/)
npm start     # Start local server on http://localhost:5173
```

### Load the Chrome Extension locally
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder

## Production Deployment (Vercel)
Already configured via `vercel.json` + `api/`:
```bash
npx vercel --prod
```
*(Note: On cloud IPs, supermarket search WAFs may block live requests, so `api/search.js` includes a staple catalog fallback while the Chrome extension searches live in the user's browser. Phase 2 roadmap: ingest Israel's official Price Transparency XML/GZ feeds into Postgres.)*
