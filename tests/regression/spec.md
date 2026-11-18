# SmartCart DV Verification Specification (`spec.md`)

This document is the authoritative **Verification Plan & Reference Model Specification** for SmartCart's automated list regression suite (`tests/regression/`).

---

## 1. Design Under Test (DUT) Boundaries
Because the regression runs in zero-dependency Node (`D6`), every stimulus list is driven through the exact production modules used by the browser UI:
1. **Input / Import Layer:**
   - Free-text / WhatsApp / bulleted / comma-separated paste → `importFromText(rawText)` in `web/js/importer.js` (wrapping `web/js/parser.js` + `web/js/categories.js`).
   - TSV / CSV / spreadsheet grid → `importFromGrid(grid, meta)` in `web/js/importer.js` (wrapping `web/js/sheets.js`).
   - Formatted `.xlsx` binary workbook (colors, bold headers, merged cells, strikethrough rows) → `parseXlsx(buffer)` in `web/js/xlsx.js` → `importFromGrid(...)`.
2. **Product Matching Layer:**
   - `matchLineAcrossChains(line, branchData)` in `web/js/prices.js` against the frozen official online-store catalogs (`StoreType=2`).
3. **Pricing & Basket Ranking Layer:**
   - `compareBasket(lines, LIVE_CHAIN_IDS, deliveryChains, { includeDelivery })` in `web/js/pricing.js`.

---

## 2. Expected-Behavior Specification (`S1`–`S10`)

| Spec ID | Scenario | Expected DUT Behavior (Scoreboard Assertion) |
|---|---|---|
| **S1** | **Empty / No-Grocery Input** | Returns `error: 'NO_GROCERY_ITEMS'` (`"לא זוהו מוצרי סופר ברשימה"`), `added.length === 0`. Never adds gibberish, headers, or hardware items. |
| **S2** | **Mixed Real + Non-Grocery** | Real grocery items appear in `added`; non-grocery items (DIY/hardware, furniture, electronics, clothing, personal reminders, gibberish) appear in `skipped` with a non-empty Hebrew `reason`. |
| **S3** | **Headers, Formatting & Noise** | Section headers (`**חלבי**`, `ירקות:`, `=== שבת ===`), WhatsApp `[date, time] Sender:` prefixes, list numbering, bullets, and decorative emojis are stripped or skipped—never imported as items. |
| **S4** | **Already-Bought Lines (`D4`)** | Items marked bought (`✅`, `☑`, `[x]`, `[v]`, `.xlsx` strikethrough font, or `TRUE`/`כן`/`V`/`✓` in a bought/status column) are imported into `added` with `checked: false` (visible on the list, excluded from basket totals). |
| **S5** | **Quantities & Units** | Quantities across all styles (`2 חלב`, `חלב x3`, `3 יח'`, `חצי קילו`, `1/2 ק"ג`, `שתי חבילות`, `1500 גרם`, separate qty/unit columns) match expected canonical quantity & unit within `±0.01`. |
| **S6** | **Synonyms, Typos & Deduplication** | Equivalent items in the same list (`קוטג'` + `קוטג`, `עגבניות` + `עגבניה`, `קוקה קולה` + `קולה`, `milk` + `חלב`) normalize to one canonical item and sum compatible quantities. |
| **S7** | **Ambiguous Terms (`D3`)** | Bare ambiguous words (e.g. `סודה`, `פלפל`, `שמנת`, `נייר`, `גבינה`, `קמח`, `שמן`, `סבון`, `טונה`, `קפה`) are imported with `ambiguous: { label, choices: [...] }`, are **not** silently priced, and prevent any chain from claiming `complete: true` / `cheapestId` until resolved. |
| **S8** | **Rare / Missing Items** | When a chain's online store lacks an item, `matches[chain]` is `null` (`"אין נתון"`), `perChain[chain].complete` is `false` (`"חלקי"`), and that chain is never `cheapestId`. |
| **S9** | **Semantic Product Acceptance** | Every product matched by `matchLineAcrossChains` for an unambiguous item satisfies the golden dictionary's independent `mustIncludeAny` and `mustExcludeAny` rules (e.g. `"חלב 3%"` never matches `"שוקולד חלב"`). |
| **S10** | **Independent Price & Winner Oracle** | For the matched barcodes, `perChain[chain].subtotal`, `promoSavings`, `total`, `complete`, and `cheapestId` match the standalone XML reference calculator (`refmodel/price-model.mjs`) within `±₪0.01`. |

---

## 3. Functional Coverage Model
Every executed test case hits bins across 7 dimensions (plus pairwise cross-coverage):
1. **Channel (`channel`):** `text`, `tsv`, `csv`, `xlsx`
2. **Layout (`layout`):** `lines`, `commas`, `bullets`, `numbered`, `checkboxes`, `whatsapp`, `tsv_vertical`, `tsv_horizontal`, `tsv_cols_qty`, `csv_quoted`, `xlsx_styled`
3. **Budget Bucket (`budget`):** `none` (error/ambiguous-only), `b200_400`, `b400_800`, `b800_1500`, `b1500_2500`, `b2500_4000`
4. **Noise Profile (`noise`):** `clean`, `headers`, `non_grocery`, `whatsapp_chat`, `bought_marks`, `heavy_mixed`
5. **Ambiguity (`ambiguity`):** `none`, `single_ambig`, `multi_ambig`, `disambiguated`
6. **Rarity (`rarity`):** `common_only`, `with_rare`
7. **Quantity Style (`qtyStyle`):** `plain_num`, `mult_x`, `hebrew_words`, `fractions_weights`, `mixed_styles`, `synonym_merge`
