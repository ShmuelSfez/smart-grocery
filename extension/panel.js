// Shared Shadow-DOM UI, queue & state machine for all 7 Israeli supermarket storefronts (SmartCart Extension v3.1.0).
// Security & safety invariants:
// 1. Never auto-submit items to a cart on page load (autoAdd: false) – always wait for an explicit user click.
// 2. Never overwrite saved product mappings or email hints from untrusted incoming #smartlist= links.
// 3. Always merge with existing cart items (never wipe an existing cart).
// 4. Zero inline style= attributes – styling uses adoptedStyleSheets exclusively.
(function () {
  if (window.__smartlistPanel) return;
  window.__smartlistPanel = true;

  const reg = window.SmartCartChains;
  const ADAPTER = reg && reg.getByHost(location.hostname);
  if (!ADAPTER) return;

  const CHAIN = ADAPTER.id;
  const IS_GUIDED = ADAPTER.mode === 'guided';
  const { round2, normalizeText, extractEanBarcode, resolveGuidedQuery } = reg.helpers;

  // ---------------- storage ----------------
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
  const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
  const del = (k) => new Promise((r) => chrome.storage.local.remove(k, r));

  function safeImg(url) {
    return typeof url === 'string' && url.length < 500 && /^https:\/\//i.test(url) ? url : '';
  }

  // ---------------- Panel state ----------------
  let state = null;
  let shufMappings = {};
  let chainMappings = {};
  let shufAuth = { user: '' };
  let settings = { remember: true, autoPick: true };
  let root = null;
  let shadow = null;
  let styleSheet = null;
  let collapsed = false;
  let currentTs = 0;
  let lastHighlightedCard = null;
  let domObserver = null;
  let lastAssistSig = '';

  function activeChainMap() {
    if (CHAIN === 'shufersal') return shufMappings;
    if (!chainMappings[CHAIN] || typeof chainMappings[CHAIN] !== 'object') {
      chainMappings[CHAIN] = {};
    }
    return chainMappings[CHAIN];
  }

  async function saveChainMapping(itemKey, prod) {
    if (!settings.remember || !itemKey || !prod) return;
    if (CHAIN === 'shufersal') {
      shufMappings[itemKey] = prod;
      await set({ mappings: shufMappings });
    } else {
      activeChainMap()[itemKey] = prod;
      await set({ chainMappings });
    }
  }

  function isSavedProductReadyForChain(prod) {
    return Boolean(ADAPTER.isSavedProductReady && ADAPTER.isSavedProductReady(prod));
  }

  async function persist() {
    const pending = await get('pending');
    if (!pending || !state) return;
    pending.items = state.items.map(({ results, ...rest }) => rest);
    pending.activeItemKey = state.activeItemKey || '';
    pending.autoAdd = false;
    pending.chain = CHAIN;
    await set({ pending });
  }

  function qtyFor(item, p) {
    const byUnit = !p || p.sellingMethod === 'BY_UNIT';
    if (byUnit) return item.unit === 'unit' || item.unit === 'pack' ? Math.max(1, Math.round(item.qty)) : 1;
    if (item.unit === 'kg') return Math.max(0.1, round2(Number(item.qty) || 1));
    if (item.unit === 'g') return Math.max(0.1, Math.round((Number(item.qty) || 100) / 100) / 10);
    return Math.max(0.1, round2(Number(item.qty) || 1));
  }

  // Only persist to saved mappings when the user explicitly chooses a product card (`saveMapping === true`).
  function choose(item, p, saveMapping = false) {
    item.product = p;
    item.addQty = qtyFor(item, p);
    item.status = 'ready';
    item.results = null;
    if (saveMapping) {
      saveChainMapping(item.key, p);
    }
  }

  // ---------------- Host-page highlight helper (Guided DOM Assist, zero inline style=) ----------------
  function setHighlightedCard(cardEl) {
    if (lastHighlightedCard && lastHighlightedCard !== cardEl) {
      lastHighlightedCard.classList.remove('smartcart-assist-card');
      lastHighlightedCard = null;
    }
    if (!cardEl || !document.head) return;
    if (!document.getElementById('smartcart-page-assist-style')) {
      const st = document.createElement('style');
      st.id = 'smartcart-page-assist-style';
      st.textContent = '.smartcart-assist-card { outline: 2.5px solid #16a34a !important; outline-offset: 3px !important; border-radius: 12px !important; }';
      document.head.append(st);
    }
    cardEl.classList.add('smartcart-assist-card');
    lastHighlightedCard = cardEl;
  }

  function computeGuidedAssist() {
    if (!IS_GUIDED || !state || !ADAPTER.getCurrentSearchQuery) {
      setHighlightedCard(null);
      return null;
    }
    const q = ADAPTER.getCurrentSearchQuery();
    if (!q) {
      setHighlightedCard(null);
      return null;
    }
    const normQ = normalizeText(q);
    const targetItem = state.items.find((i) => i.status === 'ready' && i.key === state.activeItemKey)
      || state.items.find((i) => {
        if (i.status !== 'ready') return false;
        const ean = extractEanBarcode(i);
        if (ean && ean === q) return true;
        return normalizeText(i.name) === normQ || normalizeText(i.product?.name || '') === normQ;
      });
    if (!targetItem) {
      setHighlightedCard(null);
      return null;
    }
    const found = ADAPTER.findSinglePageMatchAssist ? ADAPTER.findSinglePageMatchAssist(q) : null;
    if (!found || !found.addButton) {
      setHighlightedCard(null);
      return null;
    }
    setHighlightedCard(found.cardEl || null);
    return { item: targetItem, addButton: found.addButton, title: found.title || '' };
  }

  function ensureGuidedObserver() {
    if (!IS_GUIDED || domObserver || !document.body) return;
    let timer = null;
    const check = () => {
      timer = null;
      if (!state || !root) return;
      const q = ADAPTER.getCurrentSearchQuery ? ADAPTER.getCurrentSearchQuery() : '';
      const found = q && ADAPTER.findSinglePageMatchAssist ? ADAPTER.findSinglePageMatchAssist(q) : null;
      const sig = `${q}|${Boolean(found && found.addButton)}|${found?.title || ''}`;
      if (sig !== lastAssistSig) {
        lastAssistSig = sig;
        render();
      }
    };
    domObserver = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(check, 220);
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', () => setTimeout(check, 120));
  }

  // ---------------- Background product resolution queue (auto chains only; never auto-adds to cart) ----------------
  let queueRunning = false;
  let queueAborted = false;
  let pointerDownInFoot = false;

  function safeQueueRender() {
    if (!pointerDownInFoot && state && state.phase !== 'adding' && state.phase !== 'done') {
      render();
    }
  }

  async function runQueue() {
    if (IS_GUIDED || queueRunning || !state || !ADAPTER.searchCatalog) return;
    queueRunning = true;
    queueAborted = false;
    safeQueueRender();
    try {
      const worker = async () => {
        for (;;) {
          if (queueAborted || !state || state.phase === 'adding' || state.phase === 'done') return;
          const item = state.items.find((i) => i.status === 'todo');
          if (!item) return;
          item.status = 'searching';
          safeQueueRender();
          const initialQ = item.query || item.wantBarcode || item.product?.name || item.name;
          await searchFor(item, initialQ, true);
          if (queueAborted) return;
          await new Promise((r) => setTimeout(r, 80));
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      queueRunning = false;
      if (!queueAborted && state && state.phase !== 'done') {
        await persist();
        render();
      }
    }
  }

  async function searchFor(item, query, allowAutoPick = true) {
    try {
      const cleanBarcode = String(item.wantBarcode || '').replace(/^P_/, '').trim();
      let results = await ADAPTER.searchCatalog(query, 12, item);

      if (!results.length && allowAutoPick) {
        const nameFallbacks = [item.product?.name, item.name]
          .map((s) => String(s || '').trim())
          .filter((s) => s && s !== query);
        for (const fb of nameFallbacks) {
          results = await ADAPTER.searchCatalog(fb, 12, item);
          if (results.length) break;
          if (fb.includes(' ')) {
            results = await ADAPTER.searchCatalog(fb.split(' ').slice(0, -1).join(' '), 12, item);
            if (results.length) break;
          }
        }
      } else if (!results.length && query.includes(' ')) {
        results = await ADAPTER.searchCatalog(query.split(' ').slice(0, -1).join(' '), 12, item);
      }

      results = results.filter((r) => r.purchasable !== false);
      results.sort((a, b) => Number(Boolean(b.inStock)) - Number(Boolean(a.inStock)));

      if (!results.length) {
        item.status = 'notfound';
      } else if (allowAutoPick) {
        const exactInStock = cleanBarcode
          ? results.find((r) => r.inStock && r.barcode && String(r.barcode) === cleanBarcode)
          : null;
        const exactAny = cleanBarcode
          ? results.find((r) => r.barcode && String(r.barcode) === cleanBarcode)
          : null;
        const picked = exactInStock || results.find((r) => r.inStock) || exactAny || results[0];
        choose(item, picked, false);
      } else {
        item.results = results.slice(0, 9);
        item.status = 'choose';
      }
    } catch (err) {
      if (item.status !== 'skipped') {
        item.status = 'error';
        item.errorMsg = 'שגיאת חיפוש: ' + (err?.message || err);
      }
    }
    safeQueueRender();
  }

  // ---------------- Add to cart (explicit user click ONLY) ----------------
  async function addAll() {
    if (!state || IS_GUIDED) return;
    queueAborted = true;
    if (!ADAPTER.isLoggedIn()) {
      state.error = 'login';
      await persist();
      render();
      if (ADAPTER.loginUrl && !ADAPTER.isOnLoginPage()) location.href = ADAPTER.loginUrl;
      return;
    }

    const ready = state.items.filter((i) => i.status === 'ready');
    if (!ready.length) return;
    state.phase = 'adding';
    state.error = null;
    state.errorAction = null;
    render();

    try {
      const outcome = await ADAPTER.addReadyItems(ready, { saveMapping: saveChainMapping });

      const addedCount = state.items.filter((i) => i.status === 'added').length;
      const unaddedNames = state.items
        .filter((i) => i.status !== 'added' && i.status !== 'skipped')
        .map((i) => i.name);
      if (addedCount > 0) {
        state.phase = 'done';
        state.doneAdded = addedCount;
        state.unaddedNames = unaddedNames;
        await del('pending');
        render();
        if (outcome && outcome.navigateToCartUrl && !location.pathname.endsWith('/cart')) {
          sessionStorage.setItem('sl_done_banner', JSON.stringify({
            chain: CHAIN,
            added: addedCount,
            missing: unaddedNames,
          }));
          setTimeout(() => { location.href = outcome.navigateToCartUrl; }, 350);
          return;
        }
        if (outcome && outcome.reloadAfterDone) {
          sessionStorage.setItem('sl_done_banner', JSON.stringify({
            chain: CHAIN,
            added: addedCount,
            missing: unaddedNames,
          }));
          setTimeout(() => location.reload(), 350);
          return;
        }
        return;
      }
      state.phase = 'work';
      await persist();
    } catch (err) {
      state.phase = 'work';
      const formatted = ADAPTER.formatAddError
        ? ADAPTER.formatAddError(err)
        : { message: 'שגיאה בהוספה לסל: ' + (err?.message || err) };
      if (formatted.redirectLogin) {
        state.error = 'login';
        await persist();
        if (ADAPTER.loginUrl && !ADAPTER.isOnLoginPage()) location.href = ADAPTER.loginUrl;
        return;
      }
      state.error = formatted.message;
      state.errorAction = formatted.actionUrl
        ? { label: formatted.actionLabel || 'פתח דף התחברות', url: formatted.actionUrl }
        : null;
      await persist();
    }
    render();
  }

  async function goToCheckout() {
    if (IS_GUIDED) {
      await persist();
    }
    ADAPTER.goToCheckout();
  }

  // ---------------- Shadow DOM UI ----------------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false || k === 'style') continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ACCENT = ADAPTER.accent || '#0f766e';
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
    .panel { position: fixed; bottom: 16px; left: 16px; width: 406px; max-width: calc(100vw - 24px); max-height: calc(100vh - 96px); z-index: 2147483646;
      background: #fff; color: #1d1d1f; border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.28);
      display: flex; flex-direction: column; direction: rtl; overflow: hidden; font-size: 14px; border: 1px solid rgba(0,0,0,.08); }
    .panel.collapsed { width: auto; }
    .panel.collapsed .body, .panel.collapsed .foot, .panel.collapsed .sub, .panel.collapsed .prog { display: none; }
    .head { background: ${ACCENT}; color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 8px; cursor: default; }
    .head b { flex: 1; font-size: 15px; }
    .head button { background: rgba(255,255,255,.18); border: 0; color: #fff; border-radius: 8px; width: 28px; height: 28px; cursor: pointer; font-size: 14px; }
    .head button:hover { background: rgba(255,255,255,.3); }
    .sub { padding: 8px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .prog { width: 100%; height: 4px; appearance: none; -webkit-appearance: none; border: 0; background: #e2e8f0; display: block; }
    .prog::-webkit-progress-bar { background: #e2e8f0; }
    .prog::-webkit-progress-value { background: #16a34a; transition: width .3s; }
    .body { overflow: auto; padding: 6px 10px; flex: 1; }
    .item { border-bottom: 1px solid #eee; padding: 8px 4px; }
    .item:last-child { border-bottom: 0; }
    .item.active-guided { background: #f0fdf4; border-radius: 10px; padding: 8px 8px; margin: 2px 0; border: 1px solid #bbf7d0; }
    .item.added-guided { opacity: .68; }
    .row { display: flex; align-items: center; gap: 8px; }
    .row-tight { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
    .col-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
    .thumb { width: 42px; height: 42px; object-fit: contain; border-radius: 8px; background: #f6f6f8; flex-shrink: 0; }
    .card-ph { height: 64px; }
    .grow { flex: 1; min-width: 0; }
    .want { font-size: 12px; color: #6e6e73; }
    .qty-pill { display: inline-block; background: #f1f5f9; color: #0f172a; border-radius: 6px; padding: 1px 6px; font-size: 11.5px; font-weight: 700; margin-right: 4px; }
    .pname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 12px; color: #6e6e73; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qty { width: 58px; padding: 4px; border: 1px solid #ddd; border-radius: 8px; text-align: center; font-size: 13px; }
    .lnk { background: none; border: 0; color: ${ACCENT}; cursor: pointer; font-size: 12px; padding: 2px 4px; text-decoration: none; }
    .lnk:hover { text-decoration: underline; }
    .lnk.grey { color: #8e8e93; }
    .status { font-size: 12px; color: #6e6e73; }
    .ok { color: #16a34a; font-weight: 700; font-size: 12px; }
    .err { color: #dc2626; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
    .card { border: 1px solid #e5e5ea; border-radius: 10px; padding: 6px; background: #fff; cursor: pointer; text-align: center; font-size: 11px; line-height: 1.25; display: flex; flex-direction: column; gap: 3px; }
    .card:hover { border-color: ${ACCENT}; box-shadow: 0 0 0 2px rgba(15,118,110,.18); }
    .card img { width: 100%; height: 64px; object-fit: contain; }
    .card .n { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
    .card .p { font-weight: 700; color: ${ACCENT}; }
    .card.oos { opacity: .45; }
    .refine { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
    .refine input { flex: 1; min-width: 120px; padding: 7px 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; }
    .refine button, .btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 5px 9px; cursor: pointer; font-size: 12px; color: #1d1d1f; }
    .btn.act { border-color: ${ACCENT}; color: ${ACCENT}; font-weight: 600; }
    .btn.search-go { background: ${ACCENT}; color: #fff; border-color: ${ACCENT}; font-weight: 600; }
    .btn.search-go:hover { filter: brightness(0.92); }
    .btn.mark-done { border-color: #16a34a; color: #15803d; background: #f0fdf4; font-weight: 600; }
    .btn.mark-done.is-added { background: #dcfce7; border-color: #16a34a; color: #166534; }
    .assist-box { background: #ecfdf5; border: 1.5px solid #10b981; color: #065f46; border-radius: 12px; padding: 9px 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
    .assist-btn { background: #16a34a; color: #fff; border: 0; border-radius: 9px; padding: 8px 10px; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; }
    .assist-btn:hover { background: #15803d; }
    .tip-box { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; border-radius: 10px; padding: 8px 10px; font-size: 12px; line-height: 1.4; margin-bottom: 6px; }
    .login-box { background: #fff8e6; border: 1px solid #ffe08a; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; font-size: 12.5px; }
    .skipped { opacity: .5; }
    .foot { padding: 10px; border-top: 1px solid #eee; display: flex; flex-direction: column; gap: 6px; background: #fff; }
    .primary { background: #16a34a; color: #fff; border: 0; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; text-align: center; }
    .primary:hover { background: #15803d; }
    .primary:disabled { opacity: .45; cursor: default; background: #94a3b8; }
    .secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; text-align: center; }
    .done { text-align: center; padding: 18px 10px; }
    .done .big { font-size: 40px; }
    .done h3 { margin: 8px 0 4px; font-size: 16px; }
    .done p { margin: 0; color: #6e6e73; font-size: 13px; }
    .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid ${ACCENT}; border-top-color: transparent; border-radius: 50%; animation: s .8s linear infinite; vertical-align: middle; }
    @keyframes s { to { transform: rotate(360deg); } }
  `;

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'smartlist-root';
    shadow = root.attachShadow({ mode: 'open' });
    try {
      styleSheet = new CSSStyleSheet();
      styleSheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [styleSheet];
    } catch (e) {
      styleSheet = null;
    }
    document.documentElement.append(root);
    ensureGuidedObserver();
  }

  function unmount() {
    setHighlightedCard(null);
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    if (root) root.remove();
    root = null;
    shadow = null;
    state = null;
  }

  function fmtQty(i) {
    if (i.unit === 'unit') return i.qty === 1 ? '' : `×${i.qty}`;
    return `${i.qty} ${{ kg: 'ק"ג', g: 'גרם', pack: "חב'" }[i.unit] || i.unit}`;
  }

  function openStoreSearchBtn(item) {
    if (!ADAPTER.buildProductSearchUrl) return null;
    const q = item.product?.name || item.name;
    return h('button', {
      class: 'lnk',
      title: `פתח חיפוש מוצר ישיר באתר ${ADAPTER.name}`,
      onclick: async () => {
        await persist();
        location.href = ADAPTER.buildProductSearchUrl(q);
      },
    }, '🔍 פתח מוצר');
  }

  function productCard(item, p) {
    const imgSrc = safeImg(p.img);
    return h('button', {
      class: 'card' + (p.inStock ? '' : ' oos'),
      title: `${p.name} ${p.brand}`,
      onclick: () => { choose(item, p, true); render(); persist(); },
    },
      imgSrc ? h('img', { src: imgSrc, alt: '', loading: 'lazy' }) : h('div', { class: 'card-ph' }),
      h('span', { class: 'n' }, p.name),
      h('span', { class: 'meta' }, [p.brand, p.unitDesc].filter(Boolean).join(' · ')),
      h('span', { class: 'p' }, p.price, p.inStock ? '' : ' (אזל)'),
    );
  }

  function refineBox(item) {
    const input = h('input', { type: 'text', value: item.query || item.name, placeholder: 'חפש אחרת…' });
    const go = () => {
      item.query = input.value.trim() || item.name;
      item.status = 'searching';
      render();
      searchFor(item, item.query, false);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'refine' },
      input,
      h('button', { onclick: go }, '🔍'),
      openStoreSearchBtn(item),
      h('button', { onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'),
    );
  }

  function renderGuidedItem(item) {
    if (item.status === 'skipped') {
      return h('div', { class: 'item skipped' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('b', {}, item.name), ' ', h('span', { class: 'want' }, fmtQty(item))),
          h('button', {
            class: 'lnk',
            onclick: () => {
              item.status = 'ready';
              render();
              persist();
            },
          }, 'החזר'),
        ),
      );
    }

    const p = item.product;
    const imgSrc = safeImg(p?.img);
    const ean = extractEanBarcode(item);
    const qtyLabel = fmtQty(item) || '×1';
    const isAdded = item.status === 'added';
    const isActive = !isAdded && state.activeItemKey && state.activeItemKey === item.key;

    const navigateSearch = async (preferName) => {
      const q = resolveGuidedQuery(item, preferName);
      if (!q) return;
      state.activeItemKey = item.key;
      await persist();
      location.href = ADAPTER.buildSearchUrl(q);
    };

    const toggleAdded = async () => {
      item.status = isAdded ? 'ready' : 'added';
      if (item.status === 'added' && state.activeItemKey === item.key) {
        state.activeItemKey = '';
      }
      await persist();
      render();
    };

    const metaParts = [p?.brand, ean ? `ברקוד ${ean}` : '', p?.price].filter(Boolean);

    return h('div', { class: 'item' + (isActive ? ' active-guided' : '') + (isAdded ? ' added-guided' : '') },
      h('div', { class: 'row' },
        imgSrc ? h('img', { class: 'thumb', src: imgSrc, alt: '' }) : null,
        h('div', { class: 'grow' },
          h('div', { class: 'pname', title: p?.name || item.name },
            item.name,
            h('span', { class: 'qty-pill' }, qtyLabel),
          ),
          p?.name && p.name !== item.name ? h('div', { class: 'want', title: p.name }, p.name) : null,
          metaParts.length ? h('div', { class: 'meta' }, metaParts.join(' · ')) : null,
        ),
        h('div', { class: 'col-actions' },
          h('div', { class: 'row-tight' },
            !isAdded
              ? h('button', {
                  class: 'btn search-go',
                  onclick: () => navigateSearch(false),
                }, ADAPTER.searchButtonLabel || '🔍 חפש והוסף')
              : null,
            h('button', {
              class: 'btn mark-done' + (isAdded ? ' is-added' : ''),
              onclick: toggleAdded,
            }, isAdded ? '✓ נוסף (בטל)' : '✓ הוספתי'),
          ),
          !isAdded
            ? h('div', { class: 'row-tight' },
                ean
                  ? h('button', {
                      class: 'lnk',
                      title: 'חפש לפי שם המוצר במקום ברקוד',
                      onclick: () => navigateSearch(true),
                    }, 'חפש לפי שם')
                  : null,
                h('button', {
                  class: 'lnk grey',
                  onclick: () => {
                    item.status = 'skipped';
                    if (state.activeItemKey === item.key) state.activeItemKey = '';
                    render();
                    persist();
                  },
                }, 'דלג'),
              )
            : null,
        ),
      ),
    );
  }

  function renderAutoItem(item) {
    const label = h('span', {}, h('b', {}, item.name), ' ', h('span', { class: 'want' }, fmtQty(item)));
    switch (item.status) {
      case 'ready':
      case 'added': {
        const p = item.product;
        const imgSrc = safeImg(p?.img);
        const isUnit = !p || p.sellingMethod === 'BY_UNIT';
        const qty = h('input', {
          class: 'qty',
          type: 'number',
          min: isUnit ? '1' : '0.1',
          step: isUnit ? '1' : '0.1',
          value: item.addQty,
          title: isUnit ? 'יחידות' : 'ק"ג',
        });
        qty.addEventListener('change', () => {
          item.addQty = Math.max(0.1, Number(qty.value) || 1);
          persist();
        });
        return h('div', { class: 'item' },
          h('div', { class: 'row' },
            imgSrc ? h('img', { class: 'thumb', src: imgSrc, alt: '' }) : h('div', { class: 'thumb' }),
            h('div', { class: 'grow' },
              h('div', { class: 'want' }, item.name, ' ', fmtQty(item)),
              h('div', { class: 'pname', title: p?.name || item.name }, p?.name || item.name),
              h('div', { class: 'meta' }, [p?.brand, p?.price].filter(Boolean).join(' · ')),
            ),
            item.status === 'added'
              ? h('span', { class: 'ok' }, '✅ בסל')
              : h('div', { class: 'col-actions' },
                  h('div', { class: 'row-tight' }, qty, h('span', { class: 'meta' }, isUnit ? "יח'" : 'ק"ג')),
                  h('div', { class: 'row-tight' },
                    h('button', {
                      class: 'lnk',
                      onclick: () => {
                        item.status = 'choose';
                        item.query = item.name;
                        render();
                        searchFor(item, item.query, false);
                      },
                    }, 'החלף'),
                    openStoreSearchBtn(item),
                    h('button', { class: 'lnk grey', onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'),
                  ),
                ),
          ),
        );
      }
      case 'todo':
      case 'searching':
        return h('div', { class: 'item' },
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, label),
            h('div', { class: 'row-tight' },
              h('span', { class: 'status' }, h('span', { class: 'spin' }), ' מתאים מוצר…'),
              openStoreSearchBtn(item),
              h('button', {
                class: 'lnk grey',
                onclick: () => { item.status = 'skipped'; render(); persist(); },
              }, 'דלג'),
            ),
          ),
        );
      case 'choose':
        return h('div', { class: 'item' },
          label,
          h('div', { class: 'status' }, 'בחר את המוצר המתאים:'),
          h('div', { class: 'grid' }, (item.results || []).map((p) => productCard(item, p))),
          refineBox(item),
        );
      case 'notfound':
        return h('div', { class: 'item' }, label, h('div', { class: 'status err' }, 'לא נמצא בקטלוג. נסה ניסוח אחר:'), refineBox(item));
      case 'error':
        return h('div', { class: 'item' }, label, h('div', { class: 'status err' }, item.errorMsg || 'שגיאה'), refineBox(item));
      case 'skipped':
        return h('div', { class: 'item skipped' },
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, label),
            h('button', {
              class: 'lnk',
              onclick: () => {
                item.status = isSavedProductReadyForChain(item.product) ? 'ready' : 'todo';
                render();
                runQueue();
              },
            }, 'החזר'),
          ),
        );
      default:
        return h('div', { class: 'item' }, label);
    }
  }

  function render() {
    if (!state) return;
    mount();
    shadow.innerHTML = '';
    if (!styleSheet) shadow.append(h('style', {}, CSS));

    const items = state.items || [];
    const total = items.length;
    const addedCount = state.doneAdded || items.filter((i) => i.status === 'added').length;
    const skippedCount = items.filter((i) => i.status === 'skipped').length;
    const readyCount = items.filter((i) => i.status === 'ready').length;
    const resolved = IS_GUIDED ? (addedCount + skippedCount) : (readyCount + addedCount + skippedCount);
    const loggedIn = ADAPTER.isLoggedIn();

    const panel = h('div', { class: 'panel' + (collapsed ? ' collapsed' : '') });
    panel.append(h('div', { class: 'head' },
      h('span', {}, '🛒'),
      h('b', {}, collapsed ? `${resolved}/${total}` : `העגלה החכמה ← ${ADAPTER.name}`),
      h('button', { title: collapsed ? 'הרחב' : 'מזער', onclick: () => { collapsed = !collapsed; render(); } }, collapsed ? '▢' : '–'),
      h('button', {
        title: 'סגור חלונית',
        onclick: async () => {
          const allHandled = IS_GUIDED && (addedCount + skippedCount >= total);
          if (state.phase === 'done' || allHandled || confirm('לסגור ולנקות את הרשימה מהתוסף?')) {
            await del('pending');
            unmount();
          }
        },
      }, '✕'),
    ));

    if (!IS_GUIDED && state.phase === 'done') {
      const missingList = Array.isArray(state.unaddedNames) ? state.unaddedNames : [];
      panel.append(h('div', { class: 'body' },
        h('div', { class: 'done' },
          h('div', { class: 'big' }, '🎉'),
          h('h3', {}, `${addedCount} מוצרים נוספו לסל ב${ADAPTER.name}!`),
          h('p', {}, ADAPTER.doneSubtitle || `כל המוצרים המותאמים נוספו לסל ב${ADAPTER.name}. מוכן למעבר לתשלום!`),
        ),
        missingList.length
          ? h('div', { class: 'login-box' },
              h('b', {}, `⚠️ ${missingList.length} פריטים לא הותאמו אוטומטית (ניתן להוסיף בחיפוש באתר):`),
              h('span', { class: 'meta' }, missingList.join(' · ')),
            )
          : null,
      ));
      const foot = h('div', { class: 'foot' },
        h('button', { class: 'primary', onclick: goToCheckout }, ADAPTER.checkoutLabel),
      );
      if (ADAPTER.showRefreshOnDone !== false) {
        foot.append(h('button', { class: 'secondary', onclick: () => location.reload() }, '🔄 רענן דף והצג סל מעודכן'));
      }
      panel.append(foot);
      shadow.append(panel);
      return;
    }

    const subText = IS_GUIDED
      ? (addedCount + skippedCount >= total && total > 0
          ? `🎉 כל הפריטים סומנו (${addedCount}/${total} נוספו לסל) – מוכן לתשלום!`
          : `סומנו ${addedCount} מתוך ${total} מוצרים בסל ${ADAPTER.name}`)
      : !loggedIn
        ? `🔐 יש להתחבר לחשבון ${ADAPTER.name} לפני ההוספה לסל`
        : state.phase === 'adding'
          ? `מוסיף מוצרים לסל ב${ADAPTER.name}…`
          : queueRunning && !readyCount
            ? `מתאים מוצרים מול קטלוג ${ADAPTER.name}… (${resolved}/${total})`
            : `${readyCount} מוצרים מוכנים להוספה (${resolved}/${total})`;

    panel.append(h('div', { class: 'sub' }, h('span', {}, subText)));
    panel.append(h('progress', { class: 'prog', max: String(total || 1), value: String(resolved) }));

    const body = h('div', { class: 'body' });
    const guidedAssist = computeGuidedAssist();

    if (guidedAssist) {
      const wantQty = fmtQty(guidedAssist.item);
      body.append(h('div', { class: 'assist-box' },
        h('b', {}, `⚡ נמצאה התאמה יחידה בדף עבור "${guidedAssist.item.name}"${wantQty ? ` (${wantQty})` : ''}`),
        guidedAssist.title ? h('span', {}, guidedAssist.title) : null,
        h('button', {
          class: 'assist-btn',
          onclick: async () => {
            guidedAssist.addButton.click();
            guidedAssist.item.status = 'added';
            if (state.activeItemKey === guidedAssist.item.key) state.activeItemKey = '';
            await persist();
            render();
          },
        }, `➕ הוסף לסל בדף וסמן ✓${wantQty && guidedAssist.item.qty > 1 ? ` (בדוק כמות ${wantQty} בסל)` : ''}`),
      ));
    } else if (ADAPTER.tipText) {
      body.append(h('div', { class: 'tip-box' }, ADAPTER.tipText));
    }

    if (!IS_GUIDED && !loggedIn) {
      body.append(h('div', { class: 'login-box' },
        h('b', {}, `👤 התחבר לחשבון ${ADAPTER.name}:`),
        h('span', { class: 'meta' }, 'שום מוצר לא מתווסף אוטומטית. לאחר ההתחברות תוכל לבדוק את המוצרים וללחוץ הוספה לסל.'),
      ));
    }

    if (IS_GUIDED) {
      const rankGuided = (i) => {
        if (i.status === 'ready' && state.activeItemKey && i.key === state.activeItemKey) return -1;
        if (i.status === 'ready') return 0;
        if (i.status === 'skipped') return 1;
        return 2;
      };
      [...items]
        .sort((a, b) => rankGuided(a) - rankGuided(b))
        .forEach((i) => body.append(renderGuidedItem(i)));
    } else {
      const order = { choose: 0, notfound: 0, error: 0, searching: 1, todo: 1, ready: 2, skipped: 3, added: 4 };
      [...items]
        .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0))
        .forEach((i) => body.append(renderAutoItem(i)));
    }
    panel.append(body);

    const foot = h('div', {
      class: 'foot',
      onpointerdown: () => {
        pointerDownInFoot = true;
        setTimeout(() => { pointerDownInFoot = false; }, 600);
      },
      onpointerup: () => { pointerDownInFoot = false; },
    });
    if (state.error && state.error !== 'login') {
      const errBox = h('div', { class: 'login-box' }, h('span', {}, state.error));
      if (state.errorAction) {
        errBox.append(h('button', {
          class: 'secondary',
          onclick: async () => {
            await persist();
            location.href = state.errorAction.url;
          },
        }, state.errorAction.label));
      }
      foot.append(errBox);
    }

    if (IS_GUIDED) {
      foot.append(h('button', {
        class: 'primary',
        onclick: goToCheckout,
      }, ADAPTER.checkoutLabel));
    } else if (!loggedIn) {
      if (ADAPTER.loginUrl && !ADAPTER.isOnLoginPage()) {
        foot.append(h('button', {
          class: 'primary',
          onclick: () => { location.href = ADAPTER.loginUrl; },
        }, `התחבר ל${ADAPTER.name} כדי להוסיף לסל`));
      }
    } else {
      const label = state.phase === 'adding'
        ? 'מוסיף לסל…'
        : queueRunning && !readyCount
          ? 'מתאים מוצרים…'
          : `🛒 הוסף ${readyCount} מוצרים לסל ועבור לתשלום`;
      foot.append(h('button', {
        class: 'primary',
        disabled: !readyCount || state.phase === 'adding',
        onclick: addAll,
      }, label));
    }
    panel.append(foot);
    shadow.append(panel);
  }

  // ---------------- Boot ----------------
  async function start() {
    const doneBannerRaw = sessionStorage.getItem('sl_done_banner');
    if (doneBannerRaw && !location.hash.includes('smartlist=')) {
      sessionStorage.removeItem('sl_done_banner');
      try {
        const parsed = JSON.parse(doneBannerRaw);
        if (parsed && parsed.chain === CHAIN) {
          state = {
            items: [],
            phase: 'done',
            doneAdded: Number(parsed.added) || 0,
            unaddedNames: Array.isArray(parsed.missing) ? parsed.missing : [],
            error: null,
            errorAction: null,
          };
          collapsed = false;
          render();
          return;
        }
      } catch (e) { /* ignore */ }
    }

    const m = location.hash.match(/smartlist=([^&]+)/);
    if (m) {
      await set({ pending: { code: m[1], chain: CHAIN, ts: Date.now(), items: null, autoAdd: false, v: 3 } });
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    }

    const pending = await get('pending');
    if (!pending) return;
    if (pending.chain && pending.chain !== CHAIN) return;

    if (ADAPTER.consumePostLoginReload && ADAPTER.consumePostLoginReload()) {
      location.reload();
      return;
    }

    currentTs = pending.ts || 0;
    shufMappings = (await get('mappings')) || {};
    chainMappings = (await get('chainMappings')) || {};
    const storedAuth = (await get('shufAuth')) || {};
    shufAuth = { user: storedAuth.user || '' };
    if (storedAuth.pass) await set({ shufAuth });
    settings = { ...settings, ...((await get('settings')) || {}) };

    let items = pending.items;

    if (!items || pending.v !== 3) {
      try {
        const decoded = SLCodec.decodePayload
          ? await SLCodec.decodePayload(pending.code)
          : { items: await SLCodec.decodeList(pending.code), auth: null };

        if (decoded.auth?.chain && !pending.chain && decoded.auth.chain !== CHAIN) {
          pending.chain = decoded.auth.chain;
          await set({ pending });
          return;
        }

        // Never overwrite an already-saved email hint with an untrusted link parameter
        if (decoded.auth && decoded.auth.user && !shufAuth.user) {
          shufAuth = { user: decoded.auth.user };
          await set({ shufAuth });
        }

        const savedMap = activeChainMap();
        items = decoded.items.map((it) => {
          const itemKey = normalizeText(it.name);
          const savedProd = savedMap[itemKey];
          const linkProd = it.product;
          const wantBarcode = String(linkProd?.code || '').replace(/^P_/, '').trim();
          const base = {
            ...it,
            key: itemKey,
            wantBarcode,
            product: linkProd || null,
            status: IS_GUIDED ? 'ready' : 'todo',
            addQty: qtyFor(it, linkProd),
          };

          if (IS_GUIDED) {
            return base;
          }

          if (isSavedProductReadyForChain(savedProd)) {
            base.product = savedProd;
            base.addQty = qtyFor(it, savedProd);
            base.status = 'ready';
          } else if (ADAPTER.acceptsLinkProductDirectly && isSavedProductReadyForChain(linkProd)) {
            // Session preview only – never persisted to saved mappings until user clicks addAll/choose
            base.product = linkProd;
            base.addQty = qtyFor(it, linkProd);
            base.status = 'ready';
          } else {
            base.query = wantBarcode || linkProd?.name || it.name;
          }
          return base;
        });

        pending.v = 3;
        pending.chain = CHAIN;
        pending.autoAdd = false;
        pending.activeItemKey = '';
        await set({ pending });
      } catch (err) {
        await del('pending');
        return;
      }
    } else if (!IS_GUIDED) {
      items = items.map((i) =>
        (['searching', 'choose'].includes(i.status) ? { ...i, status: 'todo' } : i),
      );
    }

    state = {
      items,
      phase: 'work',
      error: null,
      errorAction: null,
      activeItemKey: pending.activeItemKey || '',
    };
    collapsed = false;
    await persist();
    render();

    if (ADAPTER.tryFillLoginForm && ADAPTER.isOnLoginPage()) {
      ADAPTER.tryFillLoginForm(shufAuth, (nextAuth) => {
        shufAuth = nextAuth;
        set({ shufAuth });
      });
    }

    if (!IS_GUIDED) {
      runQueue();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pending) return;
    const nv = changes.pending.newValue;
    if (nv && (!nv.chain || nv.chain === CHAIN) && (!nv.items || nv.ts !== currentTs)) {
      start();
    }
  });

  window.addEventListener('hashchange', () => {
    if (location.hash.includes('smartlist=')) start();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'smartlist-open') {
      if (state) { collapsed = false; render(); } else start();
      sendResponse({ ok: true });
    }
  });

  start();
})();
