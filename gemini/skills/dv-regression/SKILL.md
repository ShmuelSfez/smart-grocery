---
name: dv-regression
description: >-
  Guides running, triaging, extending, and maintaining SmartCart's Design-Verification
  (DV) regression suite, golden reference dictionary, frozen online-store XML snapshot,
  independent XML price oracle, S1-S10 scoreboard, and functional coverage reports.
  Use whenever modifying web/js/{importer,synonyms,parser,sheets,xlsx,prices,pricing}.js,
  pipeline/{parse,promos,build}.mjs, or tests/regression/.
---

# SmartCart DV Regression & Reference Model Skill

SmartCart verifies website maturity using a hardware **Design-Verification (DV)** methodology: **628 shopping lists** (`108` directed corner-case lists + `520` Mulberry32 constrained-random lists spanning **₪200–₪4,000**) driven through the production Node/browser ES modules and checked against an **independent reference model & scoreboard**.

---

## 1. DV Testbench Architecture (`tests/regression/`)

| Hardware DV Component | SmartCart File(s) | Responsibility |
|---|---|---|
| **Verification Plan & Spec** | `tests/regression/spec.md` | Authoritative contract for `S1`–`S10`, DUT boundaries, non-tautology rules, and coverage bins. |
| **Golden Reference Dictionary** | `tests/regression/dictionary/items.json` | Independent ground truth: `250` real items, `30` specialty/rare items, `36` bare ambiguous terms, `56` non-grocery items, `20` section headers, plus held-out `unseenAliases` and semantic `mustIncludeAny` / `mustExcludeAny` acceptance rules. |
| **Frozen Stimulus Snapshot** | `tests/regression/snapshot/` | Real compressed `StoreType=2` online fulfilment `PriceFull` + `PromoFull` XML feeds (`Shufersal 413`, `Rami Levy 39`, `Carrefour 471`, ~2.3 MB) + `manifest.json` + `capture-snapshot.mjs`. |
| **Independent Reference Oracle** | `tests/regression/refmodel/price-model.mjs` | Zero-import standalone XML scanner (`extractBlocksLinear`), startup self-checks (`TB_SELF_CHECK_ERROR`), catalog availability oracle (`refComputeAvailability`), and independent basket/promo/winner calculator (`refEvaluateBasket`). |
| **Constrained-Random Generator** | `tests/regression/gen/generate.mjs`, `render.mjs` | Seeded Mulberry32 PRNG targeting 5 budget buckets (₪200–₪4,000), 11 layouts (`lines`, `commas`, `bullets`, `numbered`, `checkboxes`, `whatsapp`, `tsv_vertical`, `tsv_horizontal`, `tsv_cols_qty`, `csv_quoted`, `xlsx_styled`), and Hebrew orthographic/inflection mutations (`mutateHebrewPhrase`). |
| **Directed Corner-Case Suite** | `tests/regression/directed/cases.mjs` | `108` hand-written corner cases covering empty/noise errors, all 36 ambiguous terms, disambiguated pairs, bought/strikethrough `.xlsx` workbooks, mid-field CSV quotes, word-boundary traps (`בורגול`/`המבורגר`/`מלח שולחן`/`מסיר אבנית`), and must-NOT-merge brand/product pairs. |
| **Scoreboard, Coverage & Reports** | `tests/regression/run.mjs`, `waivers.json`, `reports/` | Executes suite, enforces the `<= 30%` lexicon non-tautology gate, checks `S1`–`S10` (with seen/unseen & recall/precision splits), samples 1D + cross + DUT-response coverage **only on passing lists**, and writes `reports/latest.md` + `reports/history.json`. |

---

## 2. Strict Non-Tautology Guardrails (NEVER Violate)

1. **Zero Cross-Imports:**
   - `tests/regression/refmodel/*` and `tests/regression/dictionary/*` must **never** import from `web/js/*` or `pipeline/*`.
   - `web/js/*` and `pipeline/*` must **never** import from `tests/*`.
2. **Lexicon Independence Gate (`<= 30%`):**
   - `web/js/synonyms.js` must solve normalization via general Hebrew morphology, orthography, and compact cross-root lexical bridges—**never** by copying item groups from `dictionary/items.json`.
   - `run.mjs` automatically computes multi-word phrase overlap and aborts with `TB_NON_TAUTOLOGY_VIOLATION` if overlap exceeds `30%`.
   - Never copy `unseenAliases` from `dictionary/items.json` into `web/js/synonyms.js`; the gap between `S6-seen` and `S6-unseen` (and `S7-seen` vs `S7-unseen`) measures true generalization!
3. **Production Seam Fidelity:**
   - `run.mjs` must always drive `importer.js` -> `applyItemsToList` (`web/js/importer.js`) -> `serializeBranchItems` (`pipeline/build.mjs`) -> `matchLineAcrossChains` (`web/js/prices.js`) -> `compareBasket` (`web/js/pricing.js`), never bypassing the code path wired into `web/js/app.js`.

---

## 3. Running the Suite

Run from the repository root (`smart-grocery`):

```bash
# 1. Fast unit tests (25 tests: parser, sheets, importer, xlsx/zip limits, promos, pricing, codec)
npm test

# 2. Fast deterministic smoke regression (~72 lists, does NOT overwrite reports)
npm run regression:smoke
# or strictly failing with exit code 1 on any red list:
node tests/regression/run.mjs --smoke --no-record --strict

# 3. Full 628-list regression (updates tests/regression/reports/latest.md & history.json)
npm run regression

# 4. Extended soak run (e.g., 1,000 random seeds without recording to history.json)
node tests/regression/run.mjs --seeds=1000 --no-record --strict
```

---

## 4. Triage Workflow When a Rule Fails

When `run.mjs` reports a failure, classify it **before** editing code:

1. **Check Oracle Self-Checks First:** If `TB_SELF_CHECK_ERROR` fires, an official chain XML schema changed (e.g. `<ItemNm>` vs `<ItemName>` or `<PromotionItems><Item>`). Fix both the pipeline parser and the independent oracle scanner.
2. **Inspect the Rule Signature (`S1`–`S10`):**
   - `S1` / `S2` / `S3`: Check `web/js/importer.js` and `web/js/sheets.js` (`isSectionHeaderText`, `IRRELEVANT_ITEM_RULES` token boundaries, CSV/TSV quote handling).
   - `S4`: Check `stripInlineBoughtMarker` (`sheets.js`), `parseXlsxBuffer` (`xlsx.js` `<xf>` / `<rPr><strike/>`), and `applyItemsToList` (`checked` preservation).
   - `S5`: Check `parseItem` (`web/js/parser.js`) and structured table `כמות`/`יחידה` columns (`sheets.js`).
   - `S6`: Check `resolveGrocerySynonym` (`synonyms.js`) and `canMergeResolvedConcepts` (`sheets.js`). Watch out for **over-merging** competing brands (`brandTag`) as well as under-merging!
   - `S7`: Check `checkAmbiguousTerm` (`synonyms.js`) and verify `app.js` / `run.mjs` leave `it.ambiguous` unpriced so `cheapestId === null`.
   - `S9-recall` vs `S9-precision`:
     - **Recall miss (`DUT returned null`):** Check `expandHebrewToken` (`prices.js`) and `getSearchQueriesForItem` (`synonyms.js`) for catalog spelling differences (`קולרבי`/`קולורבי`, `שמנת מתוקה`/`שמנת להקצפה`) or overly strict shopper usage words (`לשבת`, `למטבח`).
     - **Precision mismatch (`matched forbidden ...`):** Check `tokenMatchesEntry` (truncated-word guard), `HARD_DISQUALIFIERS`, `DERIVATIVE_WORDS`, and tie-breaking in `web/js/prices.js`. If the DUT genuinely picked a valid product whose 20-char truncated catalog name wasn't listed in `items.json` `mustIncludeAny`, either update `items.json` or record an audited entry in `tests/regression/waivers.json`.
   - `S10`: Compare `web/js/pricing.js` (`chargeQty`, `applyPromo`, `compareBasket`) against `refEvaluateBasket` (`price-model.mjs`).

---

## 5. Refreshing the Frozen Online-Store Snapshot

The regression runs deterministically offline against `tests/regression/snapshot/`. To refresh the snapshot from live government transparency portals (e.g. quarterly):

```bash
node tests/regression/snapshot/capture-snapshot.mjs
npm run regression
```

Review `tests/regression/snapshot/manifest.json` and `tests/regression/reports/latest.md`, then commit the updated `.xml.gz` files and report together.
