---
name: code-infra
description: >-
  Explains the SmartCart (smart-grocery) codebase architecture, module boundaries,
  end-to-end data flows, and 3-minute code-reading order, and regenerates the live
  file/export inventory while keeping README.md aligned with the code. Use this skill
  when onboarding to the repo, planning a feature, tracing data flow, or performing
  documentation and inventory maintenance.
---

# SmartCart Code Infrastructure & Reading Guide

Use this skill to navigate **SmartCart (העגלה החכמה)** quickly without scanning files at random, and to keep the live file inventory and `README.md` synchronized with the codebase.

---

## 1. Optimal Code-Reading Order (~3 Minutes)

Read in this exact sequence to build a complete mental model:

1. **Master Guardrails & Scoped Rules (`AGENTS.md`)**
   - Read [`/AGENTS.md`](../../../AGENTS.md) first for non-negotiable pricing honesty, security, and zero-dependency rules, plus [`/web/AGENTS.md`](../../../web/AGENTS.md) or [`/tests/regression/AGENTS.md`](../../../tests/regression/AGENTS.md) when working in those subtrees.
2. **HTTP Entrypoints & Security Headers (`serve.mjs`, `vercel.json`, `api/sheet.js`)**
   - `serve.mjs` — Local Node 20 dev server serving `web/`, local `/data/v1/` (when built), `/api/sheet`, and `localhost`-only `/api/room`.
   - `vercel.json` — Production URL rewrites and strict CSP (`script-src 'self'; style-src 'self'`, `connect-src` allowing `https://shmuelsfez.github.io` and `https://generativelanguage.googleapis.com`).
   - `api/sheet.js` — SSRF-guarded Google Sheets CSV export fetcher validating every redirect hop.
3. **Pure Domain, Import & Pricing Modules (`web/js/`) — Read Pure Logic Before UI**
   - `chains.js` — Live (`shufersal`, `ramilevy`, `carrefour`) vs. `soon` (`victory`, `yochananof`) chain definitions.
   - `pricing.js` — Pure basket comparison (`chargeQty`, `applyPromo`, `lineCost`, `compareBasket`), incomplete-basket disqualifier, and `comparedOnSubtotalOnly` asymmetric delivery fairness.
   - `prices.js` — Loads `meta.json`, `cities.json`, `online.json`, `<chain>/catalog.json`, and `<chain>/stores/<storeId>.json`; implements stem-aware Hebrew search and Q15 hybrid matching (`exact` barcode vs. `substitute` name fallback).
   - `parser.js`, `synonyms.js`, `sheets.js`, `xlsx.js`, `zip.js`, `importer.js`, `categories.js`, `codec.js` — Quantity/unit parser, morphological synonym & ambiguity engine, CSV/TSV/Sheets grid analyzer, zero-dependency streaming `.xlsx` parser (`<strike/>` bought detection), unified list importer (`applyItemsToList`), head-noun aisle classifier, and bounded `SLCodec`.
4. **Price Transparency Pipeline (`pipeline/`)**
   - `sources/{shufersal,ramilevy,carrefour}.mjs` — Official transparency portal adapters.
   - `parse.mjs`, `promos.mjs`, `cities.mjs` — Gzip + disguised-ZIP + UTF-8/UTF-16/Windows-1255 XML decoders, active `ClubID=0` promotion parser, and CBS locality code (`סמל ישוב`) mapper.
   - `build.mjs` & `publish-pages.mjs` — Writes `data/v1/` (`serializeBranchItems`) and force-pushes a clean single-commit orphan snapshot to `gh-pages`.
5. **Frontend UI Shell & Optional Desktop Bonus (`web/`, `extension/`)**
   - `web/index.html`, `web/styles.css`, `web/js/app.js`, `web/sw.js`, `web/data/{delivery,delivery-coverage,sponsored}.json` — Delivery (`🚚`) vs. In-Store (`🏬`) mode toggle, honest basket cards, disambiguation chips, and network-first shell SW.
   - `extension/` (`v2.3.0`, frozen for POC) — `capture.js` (`autoAdd: false`) and `panel.js` (confirmed 1-click `/cart/addGrid` on Shufersal; guided search-and-add on Rami Levy).
6. **Unit Tests & 628-List DV Suite (`tests/`)**
   - Fast unit tests (`tests/*.test.mjs`) and hardware-style DV regression (`tests/regression/`, covered by [`../dv-regression/SKILL.md`](../dv-regression/SKILL.md)).

---

## 2. Deep Architecture & Auto-Generated File Inventory

- End-to-end data flows & security invariants: [architecture.md](./references/architecture.md)
- Live file line counts & exported symbols: [file-inventory.md](./references/file-inventory.md)
- Inventory generator script: [update-map.mjs](./scripts/update-map.mjs)

---

## 3. Maintenance & Drift-Check Workflow

Run this workflow after adding/removing files or exports, or during weekly repository maintenance:

1. **Regenerate the live file inventory and run unit tests:**
   ```bash
   node .agents/skills/code-infra/scripts/update-map.mjs
   ```
   *(Legacy alias `node gemini/skills/code-infra/scripts/update-map.mjs` delegates to the same script.)*
2. **Audit recent changes:**
   ```bash
   git log --since="7 days ago" --stat
   ```
3. **Verify `README.md` and `architecture.md` against reality:**
   - Confirm that feature descriptions, store/city counts, CLI commands, directory trees, and test counts in `README.md` and [architecture.md](./references/architecture.md) match [file-inventory.md](./references/file-inventory.md) and `package.json`.
4. **Validate before finishing:** Confirm `npm test` reports `0 fail` and `update-map.mjs` reports `No changes` on a repeat run.
