---
trigger: always_on
---

# Pre-Commit Verification & Signoff Gate

Before concluding any code-modifying task, reporting completion, or creating a git commit in `smart-grocery`, you **must** execute and pass all applicable checks below from the repository root:

## 1. Syntax Verification (`node --check`)
Run `node --check` on every modified `.js` or `.mjs` file across `web/`, `api/`, `pipeline/`, `extension/`, `tests/`, and `serve.mjs`:
```bash
node --check <modified-file>
```

## 2. Fast Unit Test Suite (`npm test`)
Run the full Node 20 built-in unit test suite and confirm **0 failures**:
```bash
npm test
```

## 3. DV Regression Smoke Gate (`npm run regression:smoke`)
Whenever any file under `web/js/*`, `web/data/*`, `pipeline/*`, or `tests/regression/*` was modified, run the deterministic offline DV smoke suite:
```bash
npm run regression:smoke
```
- **Required invariants:** Rules `S1`–`S8` and `S10` must stay **100.0% PASS** (`0` failures), lexicon overlap must stay **`<= 30%`**, and `Lists Green` / `S9-recall` / `S9-precision` must **never regress** relative to baseline (`tests/regression/reports/latest.md`; use `--strict` once `S9` is at 100% closure).
- If you modified matching (`prices.js`), morphology/ambiguity (`synonyms.js`), import/sheets/xlsx (`importer.js`, `sheets.js`, `xlsx.js`, `parser.js`), basket math (`pricing.js`), promotions (`promos.mjs`), or testbench specs (`tests/regression/*`), also run the full 628-list suite (`npm run regression`).

## 4. Sync & Inventory Hygiene (`update-map.mjs`)
1. **Shared Codec & Extension Zip:** If `web/js/codec.js` or `extension/*` changed, verify `web/js/codec.js` and `extension/codec.js` are byte-identical and `web/shufersal-extension.zip` is rebuilt.
2. **Frontend Cache Busting:** If `web/styles.css` or `web/js/*.js` changed, verify `?v=N` was incremented uniformly on all three tags in `web/index.html`.
3. **File & Export Map:** If any repository files or JS/MJS `export` symbols were added, removed, or renamed, regenerate the codebase map:
   ```bash
   node .agents/skills/code-infra/scripts/update-map.mjs
   ```
