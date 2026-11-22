# Chrome Extension Rules (`extension/`)

Rules automatically active whenever working inside `extension/`.

## 1. Scope & Architecture
- `extension/` builds the MV3 SmartCart Chrome Extension (`v3.1.2+`) supporting **7 Israeli online supermarket chains** via modular adapters in `extension/chains/<chain>.js`:
  - **4 `'auto'` 1-click cart-fill chains:** `shufersal.js` (SAP Hybris), `ramilevy.js` (`/api/catalog` + `/api/v2/cart`), `carrefour.js` (Self-Point `retailerId: 1540`), `mahsaneihashuk.js` (Self-Point `retailerId: 1107`).
  - **3 `'guided'` search-and-add chains:** `victory.js`, `yochananof.js`, `tivtaam.js` (with single-match DOM highlight assist).
- Shared helpers and registry live in `extension/chains/selfpoint.js` (`window.SmartCartChains`); shared Shadow-DOM UI and queue live in `extension/panel.js`.

## 2. Non-Negotiable Safety & Reliability Invariants
1. **Zero Passwords:** Never read, store, log, or transmit user passwords. Only store optional non-sensitive username/email hints (`shufAuth.user`) when explicitly entered.
2. **Explicit User Action Only:** Never auto-submit cart mutations on page load (`autoAdd: false`). Always wait for the user to click the green add-to-cart button.
3. **Safe Cart Merging:** Never wipe existing items in a user's supermarket cart—always fetch/inspect current cart state and merge quantities safely.
4. **Timeouts & Per-Item Fault Isolation:**
   - Every `fetch` call in `extension/chains/*.js` must use `fetchWithTimeout` (`AbortController`) so stalled WAF/XHR requests never hang the UI spinner forever.
   - Batch cart endpoints (such as Shufersal `POST /online/he/cart/addGrid`) must translate physical EANs (`72900...` ↔ `P_<short>`), submit in bounded chunks, and fall back to per-item isolation on `HTTP 500` (`ADD_500`) so a single out-of-stock item never blocks the rest of the basket.
5. **MV3 CSP & Safari/WebKit Hygiene:**
   - Zero inline `style=` or `on*=` attributes anywhere in `extension/` (use Shadow DOM `adoptedStyleSheets`).
   - Zero regex lookbehinds (`(?<=...)`, `(?<!...)`).
6. **Build & Sync Gate:**
   - Keep `extension/codec.js` byte-identical to `web/js/codec.js` and always run `node extension/build.mjs --all-chains` + `npm test` after any edit in `extension/`.
