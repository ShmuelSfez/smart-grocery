---
name: code-infra
description: >-
  Explains the SmartCart (smart-grocery) code infrastructure, module boundaries,
  end-to-end data flows, and optimal code-reading order, and keeps README.md
  aligned with the codebase. Use whenever onboarding, planning a feature,
  debugging, or performing the weekly docs & README refresh.
---

# SmartCart Code Infrastructure & Reading Guide

Use this skill to quickly understand how **SmartCart (העגלה החכמה)** is structured and keep both the architecture docs and `README.md` accurate.

## Optimal Code Reading Order (Read in ~3 Minutes)
Follow this order instead of scanning files randomly:

0. **Project Overview & Guardrails (`README.md` + `gemini/agents.md`)**
   - Skim `README.md` for user-facing features, setup commands, and data architecture, and `gemini/agents.md` for non-negotiable honesty/security rules (real Price Transparency data only, frozen desktop extension, zero passwords).
1. **System Entry & Routing (`serve.mjs` + `vercel.json` + `api/sheet.js`)**
   - Read `serve.mjs` (local dev server serving `web/`, local `/data/v1/`, `/api/sheet`, and localhost-only `/api/room`) and `vercel.json` (production rewrites + strict CSP allowing `https://shmuelsfez.github.io` for price feeds).
2. **Pure Domain & Pricing Logic (`web/js/`) — Read Pure Modules First**
   - `web/js/chains.js` — Live (`shufersal`, `ramilevy`, `carrefour`) vs `soon` (`victory`, `yochananof`) chain definitions.
   - `web/js/pricing.js` — Pure basket comparison (`chargeQty`, `applyPromo`, `lineCost`, `compareBasket`). Never invents prices; only complete baskets can win `cheapestId`.
   - `web/js/prices.js` — Loads `meta.json`, `cities.json`, `<chain>/catalog.json`, and `<chain>/stores/<storeId>.json`; implements Hebrew stem-aware product search and Q15 hybrid matching (exact barcode when pinned, closest name match flagged `substitute`, or per-chain best match for generic items).
   - `web/js/parser.js`, `web/js/synonyms.js`, `web/js/sheets.js`, `web/js/xlsx.js`, `web/js/zip.js`, `web/js/importer.js`, `web/js/categories.js`, `web/js/codec.js` — Free-text quantity/unit parser, morphological synonym & ambiguity analyzer, Sheets/CSV/XLSX relevance & strikethrough analyzer, unified list importer (`applyItemsToList`), head-noun aisle classifier, and bounded deflate URL codec (`SLCodec`).
3. **Price Transparency Pipeline (`pipeline/`)**
   - `pipeline/sources/{shufersal,ramilevy,carrefour}.mjs` — Official Price Transparency portal adapters.
   - `pipeline/parse.mjs`, `pipeline/promos.mjs`, `pipeline/cities.mjs` — Gzip + UTF-8/UTF-16LE/Windows-1255 XML decoders, active all-customer promotion extractor, and CBS locality code mapper.
   - `pipeline/build.mjs` & `pipeline/publish-pages.mjs` — Builds `data/v1/` and publishes a single-commit orphan snapshot to `gh-pages`.
4. **Frontend UI & PWA Shell (`web/index.html`, `web/styles.css`, `web/js/app.js`, `web/sw.js`)**
   - City autocomplete + per-chain branch pickers (`#branchPickers`), honest basket comparison cards, product picker without silent auto-saving, and network-first app-shell service worker.
5. **Optional Desktop Chrome Extension (`extension/`, frozen for POC)**
   - `extension/manifest.json` (`v2.3.0`) → `extension/capture.js` (`autoAdd: false`) → `extension/panel.js` (1-click confirmed `/cart/addGrid` on Shufersal; guided search-and-add checklist on Rami Levy).
6. **Tests & DV Regression (`tests/` & `gemini/skills/dv-regression/SKILL.md`)**
   - Run `npm test` (`core.test.mjs`, `importer.test.mjs`, `pricing.test.mjs`, `pipeline.test.mjs` + `tests/fixtures/*.xml`) and `npm run regression:smoke` / `npm run regression` (628-list DV suite).

## Deep Reference & Live File Inventory
- Architecture, data flows, and invariants: [architecture.md](./references/architecture.md)
- Auto-generated file & export map: [file-inventory.md](./references/file-inventory.md)

## Weekly Maintenance Workflow
Every week, keep both this skill and `README.md` synchronized with the actual codebase:
1. Run `node gemini/skills/code-infra/scripts/update-map.mjs` from the repo root to regenerate [file-inventory.md](./references/file-inventory.md) and run `npm test`.
2. Review `git log --since="7 days ago" --stat` for any new endpoints, pipeline adapters, modules, or architectural shifts.
3. **Verify `README.md` against the code:** Check that `README.md`'s listed features, directory structure, endpoints, test counts, setup commands, and roadmap status match the actual files and `file-inventory.md`. Update `README.md` if anything drifted.
4. Update [architecture.md](./references/architecture.md) and this `SKILL.md` if any reading-order file, route, or invariant changed.
5. Commit and push any updates (`git add README.md gemini/skills/code-infra`).
