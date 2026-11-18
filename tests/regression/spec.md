# SmartCart DV Verification Specification (`spec.md`)

This document is the authoritative **Verification Plan & Reference Model Specification** for SmartCart's automated Design-Verification (DV) regression suite (`tests/regression/`).

---

## 1. Design Under Test (DUT) Boundaries
Every stimulus list runs in zero-dependency Node (`D6`) through the **exact production code paths** wired into the browser UI and pipeline:
1. **Input, Deduplication & List-Addition Layer:**
   - Free-text / WhatsApp / bulleted / comma-separated paste → `importFromText(rawText)` in `web/js/importer.js` (`parser.js` + `sheets.js` + `synonyms.js` + `categories.js`).
   - TSV / CSV / spreadsheet grid → `importFromSheetText(rawText)` / `importFromGrid(grid, opts)` in `web/js/importer.js`.
   - Formatted `.xlsx` binary workbook (colors, bold headers, merged cells, `<xf>` + `<rPr>` strikethrough rows) → `parseXlsxBuffer(buffer)` in `web/js/xlsx.js` → `importFromGrid(...)`.
   - Production UI list state transition → `applyItemsToList([], imp.added)` in `web/js/importer.js` (the exact function called by `addItems` in `web/js/app.js`).
2. **Pipeline Tuple Serialization & Product Matching Layer:**
   - `parsePricesXml` + `parsePromosXml` + `serializeBranchItems` (`pipeline/build.mjs`) build the DUT's `branchData` from the frozen online-store XML snapshot (`StoreType=2`).
   - `matchLineAcrossChains(line, branchData)` in `web/js/prices.js` matches each checked, non-ambiguous line across Shufersal (`413`), Rami Levy (`39`), and Carrefour (`471`).
3. **Pricing & Basket Ranking Layer:**
   - `compareBasket(lines, LIVE_CHAIN_IDS, deliveryChains, { includeDelivery: true })` in `web/js/pricing.js`.
   - When delivery is enabled and one complete chain publishes a numeric delivery fee while another complete chain's fee is `null` (unknown / address-dependent), `cheapestId` and `savings` compare complete chains on **apples-to-apples product `subtotal`** (`comparedOnSubtotalOnly: true`), while still displaying known delivery fees on each card.

---

## 2. Non-Tautology & Oracle Independence Rules
1. **Zero Shared Imports:** `tests/regression/refmodel/price-model.mjs` and `tests/regression/dictionary/items.json` import **nothing** from `pipeline/*` or `web/js/*`, and `web/js/*` imports **nothing** from `tests/*`.
2. **Lexicon Overlap Gate:** `run.mjs` enforces that string literals in `web/js/synonyms.js` overlap `<= 30%` of multi-word phrases in `dictionary/items.json`. The DUT must generalize via morphology/orthography rather than memorizing the test dictionary.
3. **Held-Out Vocabulary & Mutator Splits:** `dictionary/items.json` maintains held-out `unseenAliases` (never inspected when authoring `synonyms.js`), and `generate.mjs` applies a deterministic Hebrew orthographic/inflection mutator (`mutateHebrewPhrase`), reporting `S6-seen` vs `S6-unseen` and `S7-seen` vs `S7-unseen` separately.
4. **Oracle Self-Checks:** On startup, `loadReferenceSnapshot()` verifies that every chain parses `>= 1,000` priced items and `>= 1` active promotion when `<Promotion>` blocks exist—failing with `TB_SELF_CHECK_ERROR` if an XML schema tag is missed.

---

## 3. Expected-Behavior Scoreboard (`S1`–`S10`)

| Spec ID | Scenario | Expected DUT Behavior (Scoreboard Assertion) |
|---|---|---|
| **S1** | **Empty / No-Grocery Input** | Returns `error: 'NO_GROCERY_ITEMS'` (`"לא זוהו מוצרי סופר ברשימה"`), `added.length === 0`. Never adds gibberish, headers, or hardware items. |
| **S2** | **Mixed Real + Non-Grocery** | Real grocery items appear in `added`; non-grocery items (DIY/hardware, furniture, electronics, clothing, personal errands, gibberish) appear in `skipped` with a non-empty Hebrew `reason`. |
| **S3** | **Headers, Formatting & Noise** | Section headers (`**חלבי**`, `ירקות:`, `=== שבת ===`), WhatsApp `[date, time] Sender:` prefixes, strikethrough `~~...~~`, list numbering, bullets, checkboxes, and decorative emojis are completely stripped—never leaking into `dut.name`. |
| **S4** | **Already-Bought Lines (`D4`)** | Items marked bought (`✅`, `☑`, `[x]`, `[v]`, `~~...~~`, `.xlsx` `<strike/>` font or `<rPr><strike/>`, or `TRUE`/`כן`/`V`/`✓` in a bought/status column) are imported with `checked: false` (visible on list, excluded from basket totals). |
| **S5** | **Quantities & Units** | Quantities across all styles (`2 חלב`, `חלב x3`, `3 יח'`, `חצי קילו`, `1/2 ק"ג`, `שתי חבילות`, `1500 גרם`, separate qty/unit columns) match expected canonical quantity & unit within **`±0.01`** (in kg / units). |
| **S6** | **Synonyms, Typos & Deduplication** | True equivalents in the same list (`קוטג'` + `קוטג`, `עגבניות` + `עגבניה`, `milk 3%` + `חלב 3%`, held-out unseen aliases, and mutated spellings) merge and sum compatible quantities, while competing brands (`אחלה` vs `צבר`, `פרסיל` vs `אריאל`) and distinct products (`נרות שבת` vs `גפרורים`, `קולה זירו` vs `פפסי מקס`) **never** merge. |
| **S7** | **Ambiguous Terms (`D3`)** | Bare ambiguous hypernyms and their plural/size-qualified forms (`סודה`, `פלפלים`, `גבינות`, `סודה גדולה`, `בקבוק שמן`, etc.) are imported with `ambiguous: { term, choices: [...] }`, are **not** silently priced, and block `cheapestId` until resolved. |
| **S8** | **Rare / Missing Items** | Unobtainable items return `null` (precision), `perChain[chain].complete` is `false` whenever any checked item is missing, and incomplete chains never win `cheapestId`. |
| **S9** | **Semantic Precision & Recall** | **Recall:** When the independent oracle confirms a chain stocks a `real` item, the DUT must find a match (`!= null`). **Precision:** Every matched product satisfies `mustIncludeAny` and `mustExcludeAny`. |
| **S10** | **Independent Price & Winner Oracle** | For the matched barcodes, `perChain[chain].subtotal`, `promoSavings`, `total`, `complete`, and `cheapestId` match the standalone XML oracle (`refmodel/price-model.mjs`) within `±₪0.01`. |

---

## 4. Functional & DUT-Response Coverage Model
Coverage is sampled **only on passing lists** across 8 dimensions + 4 pairwise crosses:
1. **Channel (`channel`):** `text`, `tsv`, `csv`, `xlsx`
2. **Layout (`layout`):** `lines`, `commas`, `bullets`, `numbered`, `checkboxes`, `whatsapp`, `tsv_vertical`, `tsv_horizontal`, `tsv_cols_qty`, `csv_quoted`, `xlsx_styled`
3. **Budget Bucket (`budget`):** `none`, `b200_400`, `b400_800`, `b800_1500`, `b1500_2500`, `b2500_4000`
4. **Noise Profile (`noise`):** `clean`, `headers`, `non_grocery`, `whatsapp_chat`, `bought_marks`, `heavy_mixed`
5. **Ambiguity (`ambiguity`):** `none`, `single_ambig`, `multi_ambig`, `disambiguated`
6. **Rarity (`rarity`):** `common_only`, `with_rare`
7. **Quantity Style (`qtyStyle`):** `plain_num`, `mult_x`, `hebrew_words`, `fractions_weights`, `mixed_styles`, `synonym_merge`
8. **DUT-Response Coverpoints (`dutResponse`):** `promo_price_applied`, `promo_bundle_applied`, `ramilevy_promo_applied`, `weighted_kg_priced`, `substitute_flagged`, `partial_basket_honest`, `bought_excluded_from_total`, `ambiguous_blocked_winner`, `asymmetric_delivery_subtotal_cmp`
