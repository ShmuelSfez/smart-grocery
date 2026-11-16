---
name: code-infra
description: >-
  Explains the SmartCart (smart-grocery) code infrastructure, module boundaries,
  end-to-end data flows, and optimal code-reading order. Use whenever onboarding
  to the codebase, planning a feature, debugging, or performing the weekly
  architecture doc refresh.
---

# SmartCart Code Infrastructure & Reading Guide

Use this skill to quickly understand how **SmartCart (העגלה החכמה)** is structured and where to look before making edits.

## Optimal Code Reading Order (Read in ~3 Minutes)
Follow this order instead of scanning files randomly:

1. **System Entry & Routing (`serve.mjs` + `vercel.json`)**
   - Read `serve.mjs` (local dev server) and `vercel.json` (production rewrites + CSP headers) to see every HTTP route (`/`, `/api/search`, `/api/sheet`, `/api/room`) and security boundary.
2. **Core Domain Logic (`web/js/`) — Pure, Testable Modules First**
   - `web/js/parser.js` — Parses free text (`2 חלב`, `1.5 ק"ג עגבניות`, `סלק לפחות 5`, `כרובית?`) into `{ name, qty, unit, note }`.
   - `web/js/categories.js` — Head-noun aware Hebrew/English aisle classifier.
   - `web/js/sheets.js` — Parses CSV/TSV grids, filters non-supermarket columns/items (`ציוד בניה`, furniture, headers), and exports UTF-8 BOM CSV.
   - `web/js/codec.js` — Bounded deflate-raw URL codec (`SLCodec`) shared byte-for-byte with `extension/codec.js`.
   - `web/js/suggest.js`, `web/js/recipes.js`, `web/js/store.js`, `web/js/ai.js` — Purchase-interval predictions, scalable meals, `localStorage` persistence, and optional Gemini helper.
3. **Frontend Orchestration (`web/index.html`, `web/styles.css`, `web/js/app.js`)**
   - Start from `web/index.html` dialog/section IDs, then read `web/js/app.js` top-to-bottom by section comments (`render`, `Location & Delivery`, `Real-Time Family Sync`, `Smart Google Sheets`, `Send to Selected Supermarket`).
4. **Serverless Cloud Endpoints (`api/search.js`, `api/sheet.js`)**
   - Production Vercel equivalents of `/api/search` (multi-chain search + cloud WAF fallback catalog) and `/api/sheet` (strict Google Sheets CSV export fetcher).
5. **Chrome Extension (`extension/`)**
   - `extension/manifest.json` → `extension/capture.js` (grabs `#smartlist=` at `document_start`) → `extension/panel.js` (same-origin search, official login redirect, `/cart/addGrid` or `/api/v2/cart` submission) → `extension/popup.html` & `extension/popup.js`.
6. **Tests (`tests/core.test.mjs`)**
   - Run `npm test` (`node --test tests/`) to verify parser, categories, suggestions, recipes, codec, and sheet relevance filtering.

## Deep Reference & Live File Inventory
- Architecture, data flows, and invariants: [architecture.md](./references/architecture.md)
- Auto-generated file & export map: [file-inventory.md](./references/file-inventory.md)

## Weekly Maintenance Workflow
Every week, keep this skill synchronized with the actual repository:
1. Run `node gemini/skills/code-infra/scripts/update-map.mjs` from the repo root to regenerate [file-inventory.md](./references/file-inventory.md) and run `npm test`.
2. Review `git log --since="7 days ago" --stat` for any new endpoints, modules, extension changes, or architectural shifts.
3. Update [architecture.md](./references/architecture.md) and this `SKILL.md` if any reading-order file, API route, or invariant changed.
4. Commit any updates (or report changes clearly if uncommitted).
