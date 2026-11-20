# SmartCart DV Regression & Maturity Report

- **Commit:** `32788c1`
- **Executed At:** `2026-11-20T01:00:34.464Z` (382.09s)
- **Frozen Online-Store Snapshot:** `2026-11-19T21:56:44.647Z` (`shufersal 413`, `ramilevy 39`, `carrefour 471`, `mahsaneihashuk 97`, `victory 97`, `tivtaam 514`, `keshet 116`)
- **Primary KPI — Overall List Pass Rate:** **34.1%** (215 / 631 lists green)
- **Functional Cross-Coverage Closure (Passing Lists Only):** **83.9%** cross-coverage · **97.9%** 1D + DUT-response bins
- **Scoreboard Assertion Score:** **90.7%** (4073 / 4489 checks)
- **Non-Tautology Lexicon Gate:** **9.6%** overlap (64/667 <= 30% max) ✅

### Held-Out Generalization & Recall Splits
- **S6 Seen Vocabulary:** **100.0% (13852/13852)** · **S6 Held-Out / Mutated (Unseen):** **100.0% (757/757)**
- **S7 Seen Ambiguous:** **100.0% (417/417)** · **S7 Held-Out Inflected/Qualified (Unseen):** **100.0% (74/74)**
- **S9 Catalog Recall:** **99.0% (98346/99371)** · **S9 Semantic Precision:** **99.2% (97489/98245)**

---

## 1. Per-Rule Specification Scoreboard (`S1`–`S10`)

| Rule | Specification Requirement | Passed / Checked | Waived | Pass Rate | Status |
|---|---|---:|---:|---:|---|
| **S1** | Empty / No-Grocery Error | 15 / 15 | 0 | **100.0%** | ✅ PASS |
| **S2** | Mixed Non-Grocery Filtering | 280 / 280 | 0 | **100.0%** | ✅ PASS |
| **S3** | Headers, Chat & Formatting Noise | 616 / 616 | 0 | **100.0%** | ✅ PASS |
| **S4** | Bought Marks -> Unchecked | 178 / 178 | 0 | **100.0%** | ✅ PASS |
| **S5** | Quantities & Units (±0.01) | 616 / 616 | 0 | **100.0%** | ✅ PASS |
| **S6** | Synonyms, Typos & Deduplication | 616 / 616 | 0 | **100.0%** | ✅ PASS |
| **S7** | Ambiguous Terms Flagged & Unpriced | 444 / 444 | 0 | **100.0%** | ✅ PASS |
| **S8** | Rare / Missing -> Partial Basket | 493 / 493 | 0 | **100.0%** | ✅ PASS |
| **S9** | Semantic Precision & Recall | 199 / 615 | 0 | **32.4%** | ❌ FAIL |
| **S10** | Independent XML Price & Winner Oracle | 616 / 616 | 0 | **100.0%** | ✅ PASS |

---

## 2. Stimulus & DUT-Response Coverage Closure (Sampled on Passing Lists Only)

| Dimension | Bins Hit | Closure |
|---|---:|---:|
| `channel` | 4 / 4 | 100.0% |
| `layout` | 11 / 11 | 100.0% |
| `budget` | 5 / 6 | 83.3% |
| `noise` | 6 / 6 | 100.0% |
| `ambiguity` | 4 / 4 | 100.0% |
| `rarity` | 2 / 2 | 100.0% |
| `qtyStyle` | 6 / 6 | 100.0% |
| `dutResponse` | 9 / 9 | 100.0% |

### DUT-Response Coverpoints
| Coverpoint | Passing Hits | Status |
|---|---:|---|
| `promo_price_applied` | 805 | ✅ Hit |
| `promo_bundle_applied` | 1835 | ✅ Hit |
| `ramilevy_promo_applied` | 16 | ✅ Hit |
| `weighted_kg_priced` | 2853 | ✅ Hit |
| `substitute_flagged` | 1145 | ✅ Hit |
| `partial_basket_honest` | 627 | ✅ Hit |
| `bought_excluded_from_total` | 60 | ✅ Hit |
| `ambiguous_blocked_winner` | 72 | ✅ Hit |
| `asymmetric_delivery_subtotal_cmp` | 106 | ✅ Hit |

---

## 3. Maturity Trend Across Commits

| Run | Commit | Timestamp (UTC) | Lists Passed | Assertions Passed | Coverage (1D / Cross) |
|---:|---|---|---:|---:|---:|
| 1 | `081f6d1` | 2026-11-18 17:12 | 1/620 (**0.2%**) | **49.3%** | 100% / 100% |
| 2 | `505608f` | 2026-11-18 19:49 | 400/628 (**63.7%**) | **94.8%** | 100% / 98.6% |
| 3 | `dfe3ab2` | 2026-11-18 21:48 | 403/631 (**63.9%**) | **94.9%** | 100% / 98.6% |
| 4 | `32788c1` | 2026-11-20 01:00 | 215/631 (**34.1%**) | **90.7%** | 97.9% / 83.9% |

---

## Sample Failures (Top Diagnostic Signatures)
- **`DIR_016_amb_soda`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_017_amb_pepper`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_018_amb_cream`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_019_amb_paper`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_020_amb_cheese`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_021_amb_flour`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_022_amb_choco`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_023_amb_oil`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_024_amb_soap`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_025_amb_tuna`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_026_amb_soup`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
- **`DIR_027_amb_vinegar`**: [S9] RECALL miss on tivtaam for "לחם פרוס אחיד" (input "לחם פרוס אחיד"): DUT returned null while snapshot has valid item
