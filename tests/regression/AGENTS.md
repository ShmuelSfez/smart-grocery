# DV Testbench & Reference Model Rules (`tests/regression/`)

These rules apply whenever reading, running, or modifying SmartCart's Design-Verification (DV) regression suite under `tests/regression/`. Read `tests/regression/spec.md` and activate the `dv-regression` skill (`.agents/skills/dv-regression/SKILL.md`) before changing testbench logic.

---

## 1. Strict DUT vs. Testbench Separation

1. **Production Seam Fidelity:**
   - The Design Under Test (**DUT**) consists strictly of production modules (`web/js/*` and `pipeline/{parse,promos,build}.mjs`).
   - `tests/regression/run.mjs` must drive the exact production call graph used in `web/js/app.js` and `pipeline/build.mjs`:
     - `importFromText` / `importFromSheetText` / (`parseXlsxBuffer` → `importFromGrid`) → `applyItemsToList` (`web/js/importer.js`)
     - `parsePricesXml` + `parsePromosXml` + `serializeBranchItems` (`pipeline/build.mjs`)
     - `buildCatalogBundle` + `matchLineAcrossChains` (`web/js/prices.js`)
     - `compareBasket` (`web/js/pricing.js`)
   - Never bypass production entrypoints or duplicate DUT business logic inside `run.mjs`.
2. **Zero Reverse Imports:**
   - Production files (`web/**`, `pipeline/**`, `api/**`, `serve.mjs`) must **never** import from `tests/**`.

---

## 2. Oracle Independence (`refmodel/price-model.mjs`)

1. **Zero Production Imports in Reference Model & Dictionary:**
   - `tests/regression/refmodel/price-model.mjs` and `tests/regression/dictionary/items.json` must **never** import anything from `web/js/*` or `pipeline/*` (specifically never `pipeline/parse.mjs`, `pipeline/promos.mjs`, `web/js/prices.js`, `web/js/pricing.js`, or `web/js/produce.js`).
2. **Independent Implementation & Startup Self-Checks:**
   - `price-model.mjs` maintains its own standalone linear XML block scanner (`extractBlocksLinear`), promotion eligibility filter, catalog availability oracle (`refComputeAvailability`), weighted-produce piece-weight vs. bare-default specification calculator (`refWeightedKg`, using `line.name` and `line.qtyExplicit`), and basket calculator (`refEvaluateBasket`).
   - Preserve startup self-checks (`TB_SELF_CHECK_ERROR` if any chain in the snapshot parses `< 1,000` priced items or `0` active promotions when `<Promotion>` blocks exist) so silent oracle blindness is impossible.

---

## 3. Non-Tautology Gate (`<= 30%` Lexicon Overlap & Held-Out Splits)

1. **Hard `<= 30%` Lexicon Overlap Ceiling:**
   - `verifyLexiconIndependence()` in `run.mjs` checks what percentage of multi-word phrases in `dictionary/items.json` (`canonical`, `aliases`, `unseenAliases`) appear as string literals in `web/js/synonyms.js`, aborting with `TB_NON_TAUTOLOGY_VIOLATION` above **`30.0%`**.
   - Solve synonym normalization in `web/js/synonyms.js` through general Hebrew morphology, orthographic normalization, and compact lexical root bridges—**never** by copying dictionary entries.
2. **Protect Held-Out Generalization Splits (`unseenAliases`):**
   - **Never** copy phrases from `unseenAliases` in `dictionary/items.json` (or mutated outputs from `mutateHebrewPhrase` in `gen/generate.mjs`) into `web/js/synonyms.js` or `web/js/prices.js`.
   - Monitor `S6-seen` vs `S6-unseen` and `S7-seen` vs `S7-unseen` in regression output; a healthy engine keeps `unseen` close to `seen` without memorizing held-out test strings.

---

## 4. Functional Coverage Sampled ONLY on Passing Lists

1. **No Coverage Credit from Failing Lists:**
   - All 8 stimulus coverage dimensions (`channel`, `layout`, `budget`, `noise`, `ambiguity`, `rarity`, `qtyStyle`), all 4 pairwise cross-coverage tables, and all 9 DUT-response coverpoints (`RESPONSE_BINS`) must be sampled **exclusively when a stimulus list passes 100% of its `S1`–`S10` scoreboard checks**.
   - Never move coverage sampling ahead of scoreboard pass/fail evaluation.

---

## 5. Mandatory `waivers.json` Governance Process

1. **Fix Bugs First — Never Weaken Assertions:**
   - Never loosen `S1`–`S10` tolerances, delete failing `directed/cases.mjs` tests, or strip `mustExcludeAny` guards simply to turn a red run green.
2. **Audited Waiver Schema (`tests/regression/waivers.json`):**
   - Use `waivers.json` only for verified upstream feed anomalies (`feed-quirk`) or tracked, time-boxed issues while a fix is scheduled.
   - Every waiver entry in `waivers` **must** specify all required fields, including a bug ticket and an explicit expiration date:
     ```json
     {
       "rule": "S9",
       "itemId": "real_042",
       "chain": "carrefour",
       "verdict": "feed-quirk",
       "owner": "team-handle",
       "ticket": "SC-104",
       "expires": "2027-02-01",
       "reason": "Upstream Store 471 XML truncates ManufacturerItemDescription at 20 chars; verified barcode 729000... is exact product."
     }
     ```
   - Expired waivers must be resolved or re-audited immediately, and all active waivers must remain visibly listed in `tests/regression/reports/latest.md` (never hidden).
