# SmartCart DV Regression & Maturity Report

- **Commit:** `505608f`
- **Executed At:** `2026-11-18T19:49:45.091Z` (131.83s)
- **Frozen Online-Store Snapshot:** `2026-11-18T15:53:40.130Z` (`Shufersal 413`, `Rami Levy 39`, `Carrefour 471`)
- **Primary KPI — Overall List Pass Rate:** **63.7%** (400 / 628 lists green)
- **Functional Cross-Coverage Closure (Passing Lists Only):** **98.6%** cross-coverage · **100%** 1D + DUT-response bins
- **Scoreboard Assertion Score:** **94.8%** (4192 / 4420 checks)
- **Non-Tautology Lexicon Gate:** **9.6%** overlap (64/667 <= 30% max) ✅

### Held-Out Generalization & Recall Splits
- **S6 Seen Vocabulary:** **100.0% (13781/13781)** · **S6 Held-Out / Mutated (Unseen):** **100.0% (752/752)**
- **S7 Seen Ambiguous:** **100.0% (415/415)** · **S7 Held-Out Inflected/Qualified (Unseen):** **100.0% (76/76)**
- **S9 Catalog Recall:** **99.4% (42054/42312)** · **S9 Semantic Precision:** **99.3% (41703/42002)**

---

## 1. Per-Rule Specification Scoreboard (`S1`–`S10`)

| Rule | Specification Requirement | Passed / Checked | Waived | Pass Rate | Status |
|---|---|---:|---:|---:|---|
| **S1** | Empty / No-Grocery Error | 15 / 15 | 0 | **100.0%** | ✅ PASS |
| **S2** | Mixed Non-Grocery Filtering | 280 / 280 | 0 | **100.0%** | ✅ PASS |
| **S3** | Headers, Chat & Formatting Noise | 613 / 613 | 0 | **100.0%** | ✅ PASS |
| **S4** | Bought Marks -> Unchecked | 178 / 178 | 0 | **100.0%** | ✅ PASS |
| **S5** | Quantities & Units (±0.01) | 613 / 613 | 0 | **100.0%** | ✅ PASS |
| **S6** | Synonyms, Typos & Deduplication | 613 / 613 | 0 | **100.0%** | ✅ PASS |
| **S7** | Ambiguous Terms Flagged & Unpriced | 444 / 444 | 0 | **100.0%** | ✅ PASS |
| **S8** | Rare / Missing -> Partial Basket | 439 / 439 | 0 | **100.0%** | ✅ PASS |
| **S9** | Semantic Precision & Recall | 384 / 612 | 0 | **62.7%** | ❌ FAIL |
| **S10** | Independent XML Price & Winner Oracle | 613 / 613 | 0 | **100.0%** | ✅ PASS |

---

## 2. Stimulus & DUT-Response Coverage Closure (Sampled on Passing Lists Only)

| Dimension | Bins Hit | Closure |
|---|---:|---:|
| `channel` | 4 / 4 | 100.0% |
| `layout` | 11 / 11 | 100.0% |
| `budget` | 6 / 6 | 100.0% |
| `noise` | 6 / 6 | 100.0% |
| `ambiguity` | 4 / 4 | 100.0% |
| `rarity` | 2 / 2 | 100.0% |
| `qtyStyle` | 6 / 6 | 100.0% |
| `dutResponse` | 9 / 9 | 100.0% |

### DUT-Response Coverpoints
| Coverpoint | Passing Hits | Status |
|---|---:|---|
| `promo_price_applied` | 603 | ✅ Hit |
| `promo_bundle_applied` | 1686 | ✅ Hit |
| `ramilevy_promo_applied` | 61 | ✅ Hit |
| `weighted_kg_priced` | 3340 | ✅ Hit |
| `substitute_flagged` | 929 | ✅ Hit |
| `partial_basket_honest` | 670 | ✅ Hit |
| `bought_excluded_from_total` | 113 | ✅ Hit |
| `ambiguous_blocked_winner` | 185 | ✅ Hit |
| `asymmetric_delivery_subtotal_cmp` | 153 | ✅ Hit |

---

## 3. Maturity Trend Across Commits

| Run | Commit | Timestamp (UTC) | Lists Passed | Assertions Passed | Coverage (1D / Cross) |
|---:|---|---|---:|---:|---:|
| 1 | `081f6d1` | 2026-11-18 17:12 | 1/620 (**0.2%**) | **49.3%** | 100% / 100% |
| 2 | `505608f` | 2026-11-18 19:49 | 400/628 (**63.7%**) | **94.8%** | 100% / 98.6% |

---

## Sample Failures (Top Diagnostic Signatures)
- **`DIR_100_spices_and_baking_shelf`**: [S9] PRECISION mismatch on carrefour for "קמח שקדים מולבנים" (קמח שקדים מולבנים): "קמח שקד מולבן 300 גר" missing [קמח שקדים / אבקת שקדים / שקדים מולבנים טחון]
- **`RND_0002`**: [S9] RECALL miss on shufersal for "תרכיז פטל ויטמינצ׳יק" (input "תרכיז פטל ויטמינצ׳יק"): DUT returned null while snapshot has valid item · [S9] RECALL miss on ramilevy for "תרכיז פטל ויטמינצ׳יק" (input "תרכיז פטל ויטמינצ׳יק"): DUT returned null while snapshot has valid item
- **`RND_0003`**: [S9] RECALL miss on carrefour for "מזון יבש לכלבים בונזו" (input "אוכל לכלבים בונזו"): DUT returned null while snapshot has valid item
- **`RND_0008`**: [S9] PRECISION mismatch on shufersal for "צלחות חד פעמיות מתכלות" (צלחות חד פעמיות מתכלות): "צלחות גדולות 1קג חוויה" missing [צלחות חד / צלחות פלסטיק / צלחות מתכל / צלחות מתכלות / צלחות מתכלה / צלחות לבנות / צלחות קשיחות / צלחות נייר] · [S9] PRECISION mismatch on carrefour for "צלחות חד פעמיות מתכלות" (צלחות חד פעמיות מתכלות): "צלחות אמריקאיות קטן" missing [צלחות חד / צלחות פלסטיק / צלחות מתכל / צלחות מתכלות / צלחות מתכלה / צלחות לבנות / צלחות קשיחות / צלחות נייר]
- **`RND_0024`**: [S9] RECALL miss on shufersal for "פופקורן למיקרוגל" (input "פופקורן להכנה במיקרוגל"): DUT returned null while snapshot has valid item · [S9] RECALL miss on carrefour for "פופקורן למיקרוגל" (input "פופקורן להכנה במיקרוגל"): DUT returned null while snapshot has valid item
- **`RND_0027`**: [S9] PRECISION mismatch on shufersal for "פופקורן למיקרוגל" (מארז פופקורן למיקרוגל): "פופקורן 500 גרם שורש" missing [למיקרוגל / במיקרוגל / פופ סטאר / פופסטאר / הוט פופ] · [S9] PRECISION mismatch on carrefour for "פופקורן למיקרוגל" (מארז פופקורן למיקרוגל): "פופקורן 1 ק'ג" missing [למיקרוגל / במיקרוגל / פופ סטאר / פופסטאר / הוט פופ]
- **`RND_0028`**: [S9] RECALL miss on carrefour for "מזון יבש לכלבים בונזו" (input "אוכל לכלבים בונזו"): DUT returned null while snapshot has valid item
- **`RND_0029`**: [S9] RECALL miss on carrefour for "מזון יבש לכלבים בונזו" (input "אוכל לכלבים בונזו"): DUT returned null while snapshot has valid item · [S9] RECALL miss on carrefour for "פרינגלס" (input "גליל פרינגלס"): DUT returned null while snapshot has valid item
- **`RND_0032`**: [S9] RECALL miss on shufersal for "מזון יבש לחתולים פריסקיז" (input "אוכל לחתולים"): DUT returned null while snapshot has valid item · [S9] RECALL miss on carrefour for "מזון יבש לחתולים פריסקיז" (input "אוכל לחתולים"): DUT returned null while snapshot has valid item
- **`RND_0034`**: [S9] RECALL miss on carrefour for "מזון יבש לכלבים בונזו" (input "אוכל לכלבים בונזו"): DUT returned null while snapshot has valid item
- **`RND_0037`**: [S9] RECALL miss on shufersal for "פופקורן למיקרוגל" (input "פופקורן להכנה במיקרוגל"): DUT returned null while snapshot has valid item · [S9] RECALL miss on carrefour for "פופקורן למיקרוגל" (input "פופקורן להכנה במיקרוגל"): DUT returned null while snapshot has valid item
- **`RND_0038`**: [S9] PRECISION mismatch on carrefour for "תרכיז פטל ויטמינצ׳יק" (סירופ פטל): "סירופ דייאט פטל יכין" missing [סירופ פטל / סירופ בטעם פטל / סירופ דיאט פטל / סירופ דיאט בטעם פטל / ויטמינציק פטל / תרכיז פטל]
