# SmartCart DV Regression & Maturity Report

- **Commit:** `081f6d1`
- **Executed At:** `2026-11-18T17:12:27.003Z` (408.7s)
- **Frozen Online-Store Snapshot:** `2026-11-18T15:53:40.130Z` (`Shufersal 413`, `Rami Levy 39`, `Carrefour 471`)
- **Overall List Maturity Score:** **0.2%** (1 / 620 lists green)
- **Scoreboard Assertion Score:** **49.3%** (2192 / 4447 checks)
- **Functional Coverage:** **100%** single-dimension bins · **100%** cross-coverage bins

---

## 1. Per-Rule Specification Scoreboard (`S1`–`S10`)

| Rule | Specification Requirement | Passed / Checked | Pass Rate | Status |
|---|---|---:|---:|---|
| **S1** | Empty / No-Grocery Error | 555 / 620 | **89.5%** | ❌ FAIL |
| **S2** | Mixed Non-Grocery Filtering | 45 / 263 | **17.1%** | ❌ FAIL |
| **S3** | Headers, Chat & Formatting Noise | 268 / 555 | **48.3%** | ❌ FAIL |
| **S4** | Bought Marks -> Unchecked | 0 / 159 | **0.0%** | ❌ FAIL |
| **S5** | Quantities & Units | 263 / 415 | **63.4%** | ❌ FAIL |
| **S6** | Synonyms, Typos & Deduplication | 79 / 555 | **14.2%** | ❌ FAIL |
| **S7** | Ambiguous Terms Flagged & Unpriced | 134 / 404 | **33.2%** | ❌ FAIL |
| **S8** | Rare / Missing -> Partial Basket | 509 / 509 | **100.0%** | ✅ PASS |
| **S9** | Semantic Product Acceptance | 200 / 412 | **48.5%** | ❌ FAIL |
| **S10** | Independent XML Price & Winner Oracle | 139 / 555 | **25.0%** | ❌ FAIL |

---

## 2. Functional Coverage Closure

| Dimension | Bins Hit | Closure |
|---|---:|---:|
| `channel` | 4 / 4 | 100.0% |
| `layout` | 11 / 11 | 100.0% |
| `budget` | 6 / 6 | 100.0% |
| `noise` | 6 / 6 | 100.0% |
| `ambiguity` | 4 / 4 | 100.0% |
| `rarity` | 2 / 2 | 100.0% |
| `qtyStyle` | 6 / 6 | 100.0% |

---

## 3. Maturity Trend Across Commits

| Run | Commit | Timestamp (UTC) | Lists Passed | Assertions Passed | Coverage (1D / Cross) |
|---:|---|---|---:|---:|---:|
| 1 | `081f6d1` | 2026-11-18 17:12 | 1/620 (**0.2%**) | **49.3%** | 100% / 100% |

---

## Sample Failures (Top Diagnostic Signatures)
- **`DIR_001_empty_str`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=0
- **`DIR_002_spaces_only`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=0
- **`DIR_003_punctuation_only`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=2 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_004_headers_only_text`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=4 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_005_hardware_only_text`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=4 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_006_furniture_only_text`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=3 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_007_errands_only_whatsapp`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=6 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_008_gibberish_ascii`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=3 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_009_urls_and_numbers`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=4 · [S2] expected >=1 skipped with reason, got 0
- **`DIR_010_tsv_irrelevant_cols_only`**: [S1] expected NO_GROCERY_ITEMS & 0 added, got error=null added=0
