---
name: dv-regression
description: >-
  Runs, triages, extends, and closes coverage on SmartCart's 628-list Design-Verification
  (DV) regression suite, golden dictionary, frozen StoreType=2 XML snapshot, standalone
  XML price oracle, S1-S10 scoreboard, held-out generalization splits, and waivers.json.
  Use this skill whenever modifying web/js/{importer,synonyms,parser,sheets,xlsx,prices,pricing}.js,
  pipeline/{parse,promos,build}.mjs, or tests/regression/.
---

# SmartCart DV Regression & Reference Model Runbook

SmartCart verifies end-to-end website maturity using a hardware **Design-Verification (DV)** methodology: **628 shopping lists** (`108` directed corner cases + `520` Mulberry32 constrained-random lists spanning **₪200–₪4,000**) driven through production ES modules and checked against an **independent zero-import XML price oracle**.

> Always observe the scoped testbench invariants in [`/tests/regression/AGENTS.md`](../../../tests/regression/AGENTS.md) and [`/tests/regression/spec.md`](../../../tests/regression/spec.md).

---

## 1. Testbench Architecture (`tests/regression/`)

| DV Component | File(s) | Role |
| :--- | :--- | :--- |
| **Verification Spec** | `tests/regression/spec.md` | Authoritative specification for `S1`–`S10`, DUT seams, non-tautology rules, and coverage model. |
| **Golden Dictionary** | `tests/regression/dictionary/items.json` | Independent ground truth (`392` entries): `250` real items, `30` rare/specialty items, `36` ambiguous hypernyms, `56` non-grocery items, `20` section headers, held-out `unseenAliases`, and `mustIncludeAny` / `mustExcludeAny` semantic bounds. |
| **Frozen XML Snapshot** | `tests/regression/snapshot/` | Real compressed `StoreType=2` online fulfilment `PriceFull` + `PromoFull` feeds (`shufersal-413`, `ramilevy-39`, `carrefour-471`, ~2.3 MB) + `manifest.json` + `capture-snapshot.mjs`. |
| **Independent Oracle** | `tests/regression/refmodel/price-model.mjs` | Zero-import standalone linear XML scanner (`extractBlocksLinear`), startup self-checks (`TB_SELF_CHECK_ERROR`), catalog availability oracle (`refComputeAvailability`), and basket/promo/winner calculator (`refEvaluateBasket`). |
| **Random Generator** | `tests/regression/gen/generate.mjs`, `render.mjs` | Seeded Mulberry32 PRNG across 5 budget buckets (₪200–₪4,000), 11 layouts (`lines`, `commas`, `bullets`, `numbered`, `checkboxes`, `whatsapp`, `tsv_vertical`, `tsv_horizontal`, `tsv_cols_qty`, `csv_quoted`, `xlsx_styled`), and deterministic Hebrew spelling/inflection mutations (`mutateHebrewPhrase`). |
| **Directed Suite** | `tests/regression/directed/cases.mjs` | `108` hand-crafted corner cases: empty/noise errors, all 36 ambiguous terms, disambiguated pairs, bought/strikethrough `.xlsx`, mid-field CSV quotes, word-boundary traps (`בורגול`/`המבורגר`/`מלח שולחן`/`מסיר אבנית`), and competing-brand non-merge pairs. |
| **Runner & Reports** | `tests/regression/run.mjs`, `waivers.json`, `reports/` | Enforces `<= 30%` lexicon overlap gate, evaluates `S1`–`S10` + seen/unseen splits, samples coverage **only on passing lists**, and writes `reports/latest.md` + `reports/history.json`. |

---

## 2. Running the Regression Suite

Run from the repository root:

```bash
# 1. Fast unit tests first (25 tests)
npm test

# 2. Fast deterministic smoke run (108 directed + 36 random seeds, does NOT overwrite reports)
npm run regression:smoke

# 3. Strict CI / pre-commit smoke gate (exits 1 on any failure, leaves reports untouched)
node tests/regression/run.mjs --smoke --no-record --strict

# 4. Full 628-list regression (updates tests/regression/reports/latest.md & history.json)
npm run regression

# 5. Extended soak run (e.g., 1,000 random seeds without recording to history.json)
node tests/regression/run.mjs --seeds=1000 --no-record --strict
```

---

## 3. Scoreboard (`S1`–`S10`) & Generalization Splits

| Rule | Checked Invariant | Primary DUT Module(s) |
| :--- | :--- | :--- |
| **S1** | Empty / noise-only input returns `error: 'NO_GROCERY_ITEMS'`, `added.length === 0`. | `importer.js`, `sheets.js` |
| **S2** | Non-grocery items (DIY, furniture, electronics, clothing, errands) routed to `skipped` with Hebrew `reason`. | `sheets.js` (`IRRELEVANT_ITEM_RULES`) |
| **S3** | Headers, WhatsApp `[date] Sender:`, bullets, checkboxes, `~~`, and decorative emojis stripped cleanly (`S3_LEAK_RE`). | `parser.js`, `sheets.js`, `importer.js` |
| **S4** | Bought items (`✅`, `[x]`, `~~...~~`, `.xlsx` `<strike/>`, bought column) imported with `checked: false`. | `sheets.js`, `xlsx.js`, `importer.js` |
| **S5** | Quantities & units (`2 חלב`, `x3`, `חצי קילו`, `1/2 ק"ג`, `1500 גרם`, table columns) accurate within `±0.01`. | `parser.js`, `sheets.js` |
| **S6** | Equivalent concepts/typos merge & sum compatible units; competing brands (`brandTag`) and distinct items **never** merge. | `synonyms.js`, `sheets.js` |
| **S7** | Bare ambiguous hypernyms (`סודה`, `פלפלים`, `סודה גדולה`, `בקבוק שמן`) flagged `ambiguous`, left unpriced, block `cheapestId`. | `synonyms.js`, `prices.js`, `app.js` |
| **S8** | Unobtainable items return `null`; incomplete chains set `complete: false` and never win `cheapestId`. | `prices.js`, `pricing.js` |
| **S9** | **Recall:** Match found whenever oracle confirms stock. **Precision:** Match satisfies `mustIncludeAny` & `mustExcludeAny`. | `prices.js`, `synonyms.js` |
| **S10** | `subtotal`, `promoSavings`, `total`, `complete`, and `cheapestId` match standalone XML oracle within `±₪0.01`. | `pricing.js`, `promos.mjs`, `build.mjs` |

### Held-Out Generalization Splits (Anti-Overfitting Telemetry)
`run.mjs` reports separate pass rates for:
- **`S6-seen` vs. `S6-unseen`:** `unseen` exercises `dictionary/items.json` `unseenAliases` and `mutateHebrewPhrase()` orthographic/plural inflections. Never copy `unseenAliases` into `synonyms.js` (`TB_NON_TAUTOLOGY_VIOLATION` triggers above `30.0%` multi-word overlap).
- **`S7-seen` vs. `S7-unseen`:** Verifies plural/container/size-qualified ambiguous inputs (`פלפלים`, `בקבוק שמן`) still trigger disambiguation without memorizing literal phrases.
- **`S9-recall` vs. `S9-precision`:** Tracks whether catalog matching changes trade precision for recall or vice versa.

---

## 4. Coverage Closure Rules

Coverage is sampled **only on 100%-passing lists**:
- **8 Dimensions:** `channel` (4), `layout` (11), `budget` (6), `noise` (6), `ambiguity` (4), `rarity` (2), `qtyStyle` (6), plus **9 DUT-Response Coverpoints**: `promo_price_applied`, `promo_bundle_applied`, `ramilevy_promo_applied`, `weighted_kg_priced`, `substitute_flagged`, `partial_basket_honest`, `bought_excluded_from_total`, `ambiguous_blocked_winner`, `asymmetric_delivery_subtotal_cmp`.
- **4 Pairwise Crosses:** `channel × noise`, `layout × qtyStyle`, `budget × ambiguity`, `budget × rarity`.
- **Closing a `0`-Hit Bin:** Inspect `reports/latest.md` Section 2. If a stimulus bin is `0` because lists hitting it failed, fix the DUT bug first. If no stimulus generated that combination, add a targeted directed case in `tests/regression/directed/cases.mjs` or adjust weights in `tests/regression/gen/generate.mjs`.

---

## 5. Failure Triage Decision Tree

1. **`TB_SELF_CHECK_ERROR` on startup:**
   - Upstream chain XML tag names changed (e.g. `<ItemName>` vs. `<ItemNm>` or `<PromotionItems><Item>`). Update both `pipeline/{parse,promos}.mjs` and `tests/regression/refmodel/price-model.mjs` independently.
2. **`TB_NON_TAUTOLOGY_VIOLATION` (`> 30%` overlap):**
   - Replace literal multi-word item lists in `web/js/synonyms.js` with morphological stem/suffix rules or compact single-token canonical bridges.
3. **`S9-recall` miss (`DUT returned null` when oracle found stock):**
   - Check `expandHebrewToken` (`web/js/prices.js`) and `getSearchQueriesForItem` (`web/js/synonyms.js`) for missing orthographic variants (`קולרבי`/`קולורבי`) or non-essential modifier words (`לשבת`, `טרי`).
4. **`S9-precision` mismatch (`matched forbidden ...` or `missing [...]`):**
   - Check `tokenMatchesEntry`, `HARD_DISQUALIFIERS`, `DERIVATIVE_WORDS`, and score tie-breaking in `web/js/prices.js` (e.g. preventing `"חמאה"` from matching `"חמאת בוטנים"` or `"חלב"` from matching `"שוקולד חלב"`).
   - Only if the DUT matched a genuinely valid product whose 20-char truncated XML catalog description lacked an expected keyword, update `mustIncludeAny` in `dictionary/items.json` or file a time-boxed waiver in `waivers.json`.
5. **`S10` price/winner delta (`> ₪0.01`):**
   - Compare `chargeQty`, `applyPromo`, and `comparedOnSubtotalOnly` in `web/js/pricing.js` (and `parsePromosXml` in `pipeline/promos.mjs`) against `refEvaluateBasket` in `price-model.mjs`.

---

## 6. Managing `tests/regression/waivers.json`

Every waiver must remain visible in `reports/latest.md` and include all governance fields:

```json
{
  "rule": "S9",
  "itemId": "real_042",
  "chain": "carrefour",
  "verdict": "feed-quirk",
  "owner": "team-handle",
  "ticket": "SC-104",
  "expires": "2027-02-01",
  "reason": "Store 471 XML truncates ManufacturerItemDescription at 20 chars; barcode verified."
}
```
Allowed `verdict` values: `'feed-quirk'`, `'DUT-bug'`, `'TB-bug'`. Remove waivers as soon as the underlying bug or snapshot quirk is resolved.

---

## 7. Refreshing the Frozen Online-Store Snapshot

To re-capture live `StoreType=2` feeds from Shufersal (`413`), Rami Levy (`39`), and Carrefour (`471`):

```bash
node tests/regression/snapshot/capture-snapshot.mjs
npm run regression
```
Inspect `tests/regression/snapshot/manifest.json` and `tests/regression/reports/latest.md` before committing the refreshed `.xml.gz` files and report together.
