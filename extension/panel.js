// Content script on shufersal.co.il and rami-levy.co.il.
// Security rules:
// 1. Never auto-submit items to a cart on page load – always wait for an explicit user click in the panel.
// 2. Never overwrite saved product mappings or email hints from untrusted incoming #smartlist= links.
// 3. On Rami Levy, use guided search-and-add mode (never overwrite the cart via /api/v2/cart or fake success).
(function () {
  if (window.__smartlistPanel) return;
  window.__smartlistPanel = true;

  const IS_RAMI = location.hostname.includes('rami-levy.co.il');
  const BASE = '/online/he';

  // ---------------- storage ----------------
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
  const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
  const del = (k) => new Promise((r) => chrome.storage.local.remove(k, r));

  const normalize = (name) =>
    String(name || '').toLowerCase().replace(/["״'׳`]/g, '').replace(/[^\p{L}\p{N}%.\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  function isOnLoginPage() {
    return !IS_RAMI && location.pathname.includes('/login');
  }

  function isLoggedIn() {
    if (IS_RAMI) return false;
    if (isOnLoginPage()) return false;
    if (document.querySelector('.title-notAnonymous')) return true;
    if (document.querySelector('a[href*="/login"] .accountLink')) return false;
    return false;
  }

  // ---------------- Direct Shufersal API calls (same-origin fetch) ----------------
  function absolute(url) {
    if (!url) return '';
    if (/^https?:/.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return location.origin + url;
  }

  function pickImage(images) {
    if (!Array.isArray(images) || !images.length) return '';
    const pref = ['product', 'medium', 'small', 'large', 'thumbnail'];
    for (const f of pref) {
      const img = images.find((i) => i.format === f && i.url);
      if (img) return absolute(img.url);
    }
    return absolute(images[0].url || '');
  }

  async function findCsrfToken() {
    const input = document.querySelector('input[name="CSRFToken"]');
    if (input && input.value) return input.value;
    for (const s of document.scripts) {
      const m = (s.textContent || '').match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
    const htmlMatch = (document.documentElement.innerHTML || '').match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/);
    if (htmlMatch) return htmlMatch[1];
    try {
      const res = await fetch(`${BASE}/cart/load?restoreCart=true`, { credentials: 'include' });
      const txt = await res.text();
      const m = txt.match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return null;
  }

  async function apiSearch(query, limit = 12) {
    if (IS_RAMI) return [];
    const url = `${BASE}/search/results?q=${encodeURIComponent(query)}:relevance&limit=${limit}&page=0`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error('SEARCH_' + res.status);
    const data = await res.json();
    return (data.results || []).map((p) => ({
      code: p.code,
      name: p.name,
      brand: (p.brand && p.brand.name) || '',
      img: pickImage(p.images),
      price: (p.price && p.price.formattedValue) || '',
      unitDesc: p.unitDescription || '',
      sellingMethod: (p.sellingMethod && p.sellingMethod.code) || 'BY_UNIT',
      inStock: !(p.stock && p.stock.stockLevelStatus) || p.stock.stockLevelStatus.code === 'inStock',
      purchasable: p.purchasable !== false,
    }));
  }

  async function apiAddGrid(items) {
    if (IS_RAMI) throw new Error('GUIDED_ONLY');
    const token = await findCsrfToken();
    if (!token) throw new Error('NO_CSRF');
    const res = await fetch(`${BASE}/cart/addGrid`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', csrftoken: token, 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify(items),
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new Error('LOGIN_REQUIRED');
    if (res.status === 401 || res.status === 403) throw new Error('LOGIN_REQUIRED');
    if (!res.ok) throw new Error('ADD_' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cartCodes = Array.from(doc.querySelectorAll('article[data-product-code]')).map((a) =>
      a.getAttribute('data-product-code'),
    );
    return { cartCodes };
  }

  // ---------------- state ----------------
  let state = null;
  let mappings = {};
  let shufAuth = { user: '' };
  let settings = { remember: true, autoPick: true };
  let root = null;
  let shadow = null;
  let collapsed = false;
  let currentTs = 0;

  async function persist() {
    const pending = await get('pending');
    if (!pending || !state) return;
    pending.items = state.items.map(({ results, ...rest }) => rest);
    pending.autoAdd = false;
    await set({ pending });
  }

  function qtyFor(item, p) {
    const byUnit = !p || p.sellingMethod === 'BY_UNIT';
    if (byUnit) return item.unit === 'unit' || item.unit === 'pack' ? Math.max(1, Math.round(item.qty)) : 1;
    if (item.unit === 'kg') return item.qty;
    if (item.unit === 'g') return Math.max(0.1, Math.round(item.qty / 100) / 10);
    return item.qty || 1;
  }

  // Only persist to `mappings` when the user explicitly chooses a product card (`saveMapping === true`).
  function choose(item, p, saveMapping = false) {
    item.product = p;
    item.addQty = qtyFor(item, p);
    item.status = 'ready';
    item.results = null;
    if (saveMapping && settings.remember) {
      mappings[item.key] = p;
      set({ mappings });
    }
  }

  // ---------------- Login email helper on /online/he/login ----------------
  function tryFillLoginForm() {
    if (!isOnLoginPage()) return;
    sessionStorage.setItem('sl_from_login', '1');
    const uInput = document.querySelector('#j_username');
    const pInput = document.querySelector('#j_password');
    if (!uInput) return;

    if (!uInput.dataset.slBound) {
      uInput.dataset.slBound = '1';
      uInput.addEventListener('change', () => {
        shufAuth = { user: uInput.value.trim() };
        set({ shufAuth });
      });
    }

    if (shufAuth.user && !uInput.value) {
      uInput.value = shufAuth.user;
      uInput.dispatchEvent(new Event('input', { bubbles: true }));
      uInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (uInput && !uInput.value) {
      uInput.focus();
    } else if (pInput && !pInput.value) {
      pInput.focus();
    }
  }

  // ---------------- search queue (Shufersal only; never auto-submits to cart) ----------------
  let queueRunning = false;
  async function runQueue() {
    if (IS_RAMI || queueRunning) return;
    queueRunning = true;
    try {
      const worker = async () => {
        for (;;) {
          const item = state && state.items.find((i) => i.status === 'todo');
          if (!item) return;
          item.status = 'searching';
          render();
          await searchFor(item, item.query || item.name, true);
          await new Promise((r) => setTimeout(r, 80));
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      queueRunning = false;
      await persist();
    }
  }

  async function searchFor(item, query, allowAutoPick = true) {
    try {
      let results = await apiSearch(query, 12);
      if (!results.length && query.includes(' ')) {
        results = await apiSearch(query.split(' ').slice(0, -1).join(' '), 12);
      }
      results = results.filter((r) => r.purchasable);
      results.sort((a, b) => (b.inStock - a.inStock));
      if (!results.length) {
        item.status = 'notfound';
      } else if (allowAutoPick) {
        // Preview candidate in panel without overwriting user's saved mappings
        choose(item, results.find((r) => r.inStock) || results[0], false);
      } else {
        item.results = results.slice(0, 9);
        item.status = 'choose';
      }
    } catch (err) {
      item.status = 'error';
      item.errorMsg = 'שגיאת חיפוש: ' + err.message;
    }
    render();
  }

  // ---------------- add to cart (Shufersal – explicit user click only) ----------------
  async function addAll() {
    if (IS_RAMI) return;
    if (!isLoggedIn()) {
      state.error = 'login';
      await persist();
      render();
      if (!isOnLoginPage()) {
        location.href = `${BASE}/login`;
      }
      return;
    }
    const ready = state.items.filter((i) => i.status === 'ready');
    if (!ready.length) return;
    state.phase = 'adding';
    state.error = null;
    render();
    const payload = ready.map((i) => {
      const q = Number(i.addQty) || 1;
      return {
        productCode: i.product.code,
        quantity: q,
        frontQuantity: q,
        sellingMethod: i.product.sellingMethod === 'BY_UNIT' ? 'BY_UNIT' : 'BY_PACKAGE',
        longTail: false,
      };
    });
    try {
      const { cartCodes } = await apiAddGrid(payload);
      const inCart = new Set(cartCodes || []);
      for (const i of ready) {
        if (inCart.has(i.product.code)) {
          i.status = 'added';
          // Save mapping only after user explicitly clicked addAll and Shufersal confirmed the product in cart
          if (settings.remember && i.product) {
            mappings[i.key] = i.product;
          }
        } else {
          i.status = 'error';
          i.errorMsg = 'לא אושר בסל של שופרסל – בדוק מלאי או בחר חלופה.';
        }
      }
      await set({ mappings });
      const left = state.items.filter((i) => ['choose', 'notfound', 'error', 'todo', 'searching', 'ready'].includes(i.status));
      state.phase = left.length ? 'work' : 'done';
      if (state.phase === 'done') {
        await del('pending');
        render();
        setTimeout(() => location.reload(), 800);
        return;
      }
      await persist();
    } catch (err) {
      state.phase = 'work';
      if (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF') {
        state.error = 'login';
        await persist();
        if (!isOnLoginPage()) location.href = `${BASE}/login`;
        return;
      }
      state.error = 'שגיאה בהוספה לסל: ' + err.message;
      await persist();
    }
    render();
  }

  // ---------------- UI ----------------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  const ACCENT = IS_RAMI ? '#0f766e' : '#e2001a';
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, "Segoe UI", Arial, sans-serif; }
    .panel { position: fixed; bottom: 16px; left: 16px; width: 390px; max-height: calc(100vh - 120px); z-index: 2147483646;
      background: #fff; color: #1d1d1f; border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.28);
      display: flex; flex-direction: column; direction: rtl; overflow: hidden; font-size: 14px; }
    .panel.collapsed { width: auto; }
    .panel.collapsed .body, .panel.collapsed .foot, .panel.collapsed .sub { display: none; }
    .head { background: ${ACCENT}; color: #fff; padding: 10px 14px; display: flex; align-items: center; gap: 8px; cursor: default; }
    .head b { flex: 1; font-size: 15px; }
    .head button { background: rgba(255,255,255,.18); border: 0; color: #fff; border-radius: 8px; width: 28px; height: 28px; cursor: pointer; font-size: 14px; }
    .sub { padding: 8px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .bar { height: 4px; background: #e2e8f0; } .bar i { display: block; height: 100%; background: #1a9e55; transition: width .3s; }
    .body { overflow: auto; padding: 6px 10px; flex: 1; }
    .item { border-bottom: 1px solid #eee; padding: 8px 4px; }
    .item:last-child { border-bottom: 0; }
    .row { display: flex; align-items: center; gap: 8px; }
    .thumb { width: 44px; height: 44px; object-fit: contain; border-radius: 8px; background: #f6f6f8; flex-shrink: 0; }
    .grow { flex: 1; min-width: 0; }
    .want { font-size: 12px; color: #6e6e73; }
    .pname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 12px; color: #6e6e73; }
    .qty { width: 58px; padding: 4px; border: 1px solid #ddd; border-radius: 8px; text-align: center; font-size: 13px; }
    .lnk { background: none; border: 0; color: ${ACCENT}; cursor: pointer; font-size: 12px; padding: 2px 4px; }
    .lnk.grey { color: #8e8e93; }
    .status { font-size: 12px; color: #6e6e73; }
    .ok { color: #1a9e55; font-weight: 600; font-size: 12px; } .err { color: #c00; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
    .card { border: 1px solid #e5e5ea; border-radius: 10px; padding: 6px; background: #fff; cursor: pointer; text-align: center; font-size: 11px; line-height: 1.25; display: flex; flex-direction: column; gap: 3px; }
    .card:hover { border-color: ${ACCENT}; box-shadow: 0 0 0 2px rgba(15,118,110,.2); }
    .card img { width: 100%; height: 64px; object-fit: contain; }
    .card .n { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
    .card .p { font-weight: 700; color: ${ACCENT}; }
    .card.oos { opacity: .45; }
    .refine { display: flex; gap: 4px; margin-top: 6px; }
    .refine input, .login-box input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; width: 100%; }
    .refine button, .btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 5px 9px; cursor: pointer; font-size: 12px; }
    .btn.act { border-color: ${ACCENT}; color: ${ACCENT}; font-weight: 600; }
    .login-box { background: #fff8e6; border: 1px solid #ffe08a; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
    .skipped { opacity: .5; }
    .foot { padding: 10px; border-top: 1px solid #eee; display: flex; flex-direction: column; gap: 6px; }
    .primary { background: ${ACCENT}; color: #fff; border: 0; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
    .primary:disabled { opacity: .45; cursor: default; }
    .done { text-align: center; padding: 20px 10px; }
    .done .big { font-size: 40px; }
    .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid ${ACCENT}; border-top-color: transparent; border-radius: 50%; animation: s .8s linear infinite; vertical-align: middle; }
    @keyframes s { to { transform: rotate(360deg); } }
  `;

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'smartlist-root';
    shadow = root.attachShadow({ mode: 'open' });
    document.documentElement.append(root);
  }

  function unmount() {
    if (root) root.remove();
    root = null;
    shadow = null;
    state = null;
  }

  function fmtQty(i) {
    if (i.unit === 'unit') return i.qty === 1 ? '' : `×${i.qty}`;
    return `${i.qty} ${{ kg: 'ק"ג', g: 'גרם', pack: 'חב\'' }[i.unit] || i.unit}`;
  }

  function productCard(item, p) {
    return h('button', { class: 'card' + (p.inStock ? '' : ' oos'), title: `${p.name} ${p.brand}`, onclick: () => { choose(item, p, true); render(); persist(); } },
      p.img ? h('img', { src: p.img, alt: '', loading: 'lazy' }) : h('div', { style: 'height:64px' }),
      h('span', { class: 'n' }, p.name),
      h('span', { class: 'meta' }, [p.brand, p.unitDesc].filter(Boolean).join(' · ')),
      h('span', { class: 'p' }, p.price, p.inStock ? '' : ' (אזל)'),
    );
  }

  function refineBox(item) {
    const input = h('input', { type: 'text', value: item.query || item.name, placeholder: 'חפש אחרת…' });
    const go = () => { item.query = input.value.trim() || item.name; item.status = 'searching'; render(); searchFor(item, item.query, false); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'refine' }, input, h('button', { onclick: go }, '🔍'),
      h('button', { onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'));
  }

  function renderGuidedItem(item) {
    const qText = item.product?.name || item.name;
    const done = item.status === 'added';
    const skipped = item.status === 'skipped';
    return h('div', { class: 'item' + (skipped ? ' skipped' : '') },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'pname' }, item.name, ' ', h('span', { class: 'want' }, fmtQty(item))),
          item.product?.name ? h('div', { class: 'meta', title: item.product.name }, item.product.name) : null,
        ),
        done
          ? h('div', { class: 'row', style: 'gap:4px' },
              h('span', { class: 'ok' }, '✓ סומן'),
              h('button', { class: 'lnk grey', onclick: () => { item.status = 'ready'; render(); persist(); } }, 'בטל'),
            )
          : skipped
            ? h('button', { class: 'lnk', onclick: () => { item.status = 'ready'; render(); persist(); } }, 'החזר')
            : h('div', { class: 'row', style: 'gap:4px' },
                h('button', {
                  class: 'btn act',
                  onclick: async () => {
                    await persist();
                    location.href = `/he/online/search?q=${encodeURIComponent(qText)}`;
                  },
                }, '🔍 חפש'),
                h('button', {
                  class: 'btn',
                  title: 'סמן לאחר שהוספת את המוצר לסל באתר רמי לוי',
                  onclick: () => { item.status = 'added'; render(); persist(); },
                }, '✓ הוספתי'),
                h('button', { class: 'lnk grey', onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'),
              ),
      ),
    );
  }

  function renderItem(item) {
    if (IS_RAMI) return renderGuidedItem(item);
    const label = h('span', {}, h('b', {}, item.name), ' ', h('span', { class: 'want' }, fmtQty(item)));
    switch (item.status) {
      case 'ready':
      case 'added': {
        const p = item.product;
        const qty = h('input', { class: 'qty', type: 'number', min: '0.1', step: p.sellingMethod === 'BY_UNIT' ? '1' : '0.1', value: item.addQty, title: p.sellingMethod === 'BY_UNIT' ? 'יחידות' : 'ק"ג' });
        qty.addEventListener('change', () => { item.addQty = Math.max(0.1, Number(qty.value) || 1); persist(); });
        return h('div', { class: 'item' },
          h('div', { class: 'row' },
            p.img ? h('img', { class: 'thumb', src: p.img, alt: '' }) : h('div', { class: 'thumb' }),
            h('div', { class: 'grow' },
              h('div', { class: 'want' }, item.name, ' ', fmtQty(item)),
              h('div', { class: 'pname', title: p.name }, p.name),
              h('div', { class: 'meta' }, [p.brand, p.price].filter(Boolean).join(' · ')),
            ),
            item.status === 'added'
              ? h('span', { class: 'ok' }, '✅ בסל')
              : h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:2px' },
                  h('div', { class: 'row', style: 'gap:3px' }, qty, h('span', { class: 'meta' }, p.sellingMethod === 'BY_UNIT' ? "יח'" : 'ק"ג')),
                  h('div', {},
                    h('button', { class: 'lnk', onclick: () => { item.status = 'choose'; item.query = item.name; render(); searchFor(item, item.query, false); } }, 'החלף'),
                    h('button', { class: 'lnk grey', onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'),
                  ),
                ),
          ),
        );
      }
      case 'todo':
      case 'searching':
        return h('div', { class: 'item' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, label), h('span', { class: 'status' }, h('span', { class: 'spin' }), ' מתאים מוצר…')));
      case 'choose':
        return h('div', { class: 'item' }, label, h('div', { class: 'status' }, 'בחר את המוצר המתאים:'),
          h('div', { class: 'grid' }, (item.results || []).map((p) => productCard(item, p))), refineBox(item));
      case 'notfound':
        return h('div', { class: 'item' }, label, h('div', { class: 'status err' }, 'לא נמצא. נסה ניסוח אחר:'), refineBox(item));
      case 'error':
        return h('div', { class: 'item' }, label, h('div', { class: 'status err' }, item.errorMsg || 'שגיאה'), refineBox(item));
      case 'skipped':
        return h('div', { class: 'item skipped' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, label),
          h('button', { class: 'lnk', onclick: () => { item.status = item.product ? 'ready' : 'todo'; render(); runQueue(); } }, 'החזר')));
      default:
        return h('div', { class: 'item' }, label);
    }
  }

  function render() {
    if (!state) return;
    mount();
    shadow.innerHTML = '';
    shadow.append(h('style', {}, CSS));

    const items = state.items;
    const total = items.length;
    const resolved = IS_RAMI
      ? items.filter((i) => ['added', 'skipped'].includes(i.status)).length
      : items.filter((i) => ['ready', 'added', 'skipped'].includes(i.status)).length;
    const ready = items.filter((i) => i.status === 'ready').length;
    const added = items.filter((i) => i.status === 'added').length;
    const loggedIn = isLoggedIn();

    const panel = h('div', { class: 'panel' + (collapsed ? ' collapsed' : '') });
    panel.append(h('div', { class: 'head' },
      h('span', {}, '🛒'),
      h('b', {}, collapsed ? `${resolved}/${total}` : (IS_RAMI ? 'העגלה החכמה ← רמי לוי (מודרך)' : 'העגלה החכמה ← שופרסל')),
      h('button', { title: collapsed ? 'הרחב' : 'מזער', onclick: () => { collapsed = !collapsed; render(); } }, collapsed ? '▢' : '–'),
      h('button', { title: 'סגור ובטל את הרשימה', onclick: async () => { if (state.phase === 'done' || confirm('לסגור ולנקות את הרשימה מהתוסף?')) { await del('pending'); unmount(); } } }, '✕'),
    ));

    if (state.phase === 'done') {
      panel.append(h('div', { class: 'body' }, h('div', { class: 'done' },
        h('div', { class: 'big' }, '🎉'),
        h('h3', {}, `${added} מוצרים נוספו לסל שופרסל!`),
        h('p', {}, 'מרענן את הדף כדי להציג את הסל המעודכן…'),
      )));
      panel.append(h('div', { class: 'foot' },
        h('button', { class: 'primary', onclick: () => location.reload() }, 'רענן את הדף והצג את הסל'),
      ));
      shadow.append(panel);
      return;
    }

    const subText = IS_RAMI
      ? `🧭 מצב מודרך: חפש והוסף באתר רמי לוי (${resolved}/${total} טופלו)`
      : (!loggedIn
        ? '🔐 יש להתחבר לחשבון שופרסל לפני ההוספה לסל'
        : state.phase === 'adding'
          ? 'מוסיף לסל שופרסל…'
          : `${ready} מוצרים מוכנים לאישור הוספה (${resolved}/${total})`);

    panel.append(h('div', { class: 'sub' }, h('span', {}, subText)));
    panel.append(h('div', { class: 'bar' }, h('i', { style: `width:${total ? (resolved / total) * 100 : 0}%` })));

    const body = h('div', { class: 'body' });
    if (IS_RAMI) {
      body.append(h('div', { class: 'login-box' },
        h('b', {}, '🧭 הוספה מודרכת ברמי לוי (ללא דריסת עגלה):'),
        h('span', { class: 'meta' }, 'לחץ "🔍 חפש" ליד כל פריט, הוסף אותו לסל באתר של רמי לוי, וסמן "✓ הוספתי". סל קיים לא יידרס.'),
      ));
    } else if (!loggedIn) {
      body.append(h('div', { class: 'login-box' },
        h('b', {}, '👤 התחבר לחשבון שופרסל:'),
        h('span', { class: 'meta' }, 'שום מוצר לא מתווסף אוטומטית. לאחר ההתחברות תוכל לבדוק את המוצרים וללחוץ "הוסף לסל".'),
      ));
    }

    const order = IS_RAMI
      ? { ready: 0, todo: 0, skipped: 1, added: 2 }
      : { choose: 0, notfound: 0, error: 0, searching: 1, todo: 1, ready: 2, skipped: 3, added: 4 };
    [...items].sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0)).forEach((i) => body.append(renderItem(i)));
    panel.append(body);

    const foot = h('div', { class: 'foot' });
    if (state.error && state.error !== 'login') {
      foot.append(h('div', { class: 'login-box' }, state.error));
    }
    if (IS_RAMI) {
      foot.append(h('button', {
        class: 'primary',
        onclick: async () => { await del('pending'); unmount(); },
      }, resolved === total ? '🎉 סיימתי – סגור חלונית' : 'סגור חלונית'));
    } else if (!loggedIn) {
      if (!isOnLoginPage()) {
        foot.append(h('button', {
          class: 'primary',
          onclick: () => { location.href = `${BASE}/login`; },
        }, 'התחבר לשופרסל כדי להוסיף לסל'));
      }
    } else {
      const btn = h('button', { class: 'primary', disabled: !ready || state.phase === 'adding', onclick: addAll },
        state.phase === 'adding' ? 'מוסיף לסל…' : `הוסף ${ready} מוצרים לסל`);
      foot.append(btn);
    }
    panel.append(foot);
    shadow.append(panel);
  }

  // ---------------- boot ----------------
  async function start() {
    const m = location.hash.match(/smartlist=([^&]+)/);
    if (m) {
      await set({ pending: { code: m[1], ts: Date.now(), items: null, autoAdd: false, v: 2 } });
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }

    const pending = await get('pending');
    if (!pending) return;

    // If returning right after logging in on /login, reload once so Shufersal's session/CSRF accepts POST
    if (!IS_RAMI && !isOnLoginPage() && sessionStorage.getItem('sl_from_login') === '1') {
      sessionStorage.removeItem('sl_from_login');
      sessionStorage.removeItem('sl_submitted_once');
      location.reload();
      return;
    }

    currentTs = pending.ts || 0;
    mappings = (await get('mappings')) || {};
    const storedAuth = (await get('shufAuth')) || {};
    shufAuth = { user: storedAuth.user || '' };
    if (storedAuth.pass) await set({ shufAuth });
    settings = { ...settings, ...((await get('settings')) || {}) };

    let items = pending.items;

    if (!items || !pending.v) {
      try {
        const decoded = SLCodec.decodePayload ? await SLCodec.decodePayload(pending.code) : { items: await SLCodec.decodeList(pending.code), auth: null };
        // Never overwrite an already-saved email hint with an untrusted link parameter
        if (decoded.auth && decoded.auth.user && !shufAuth.user) {
          shufAuth = { user: decoded.auth.user };
          await set({ shufAuth });
        }
        items = decoded.items.map((it) => {
          const key = normalize(it.name);
          // Prefer user's own saved mapping; allow link's product as session preview ONLY (never overwrite mappings!)
          const chosen = mappings[key] || it.product;
          const base = { ...it, key, status: IS_RAMI ? 'ready' : 'todo' };
          if (IS_RAMI) {
            if (chosen) base.product = chosen;
            return base;
          }
          if (chosen && chosen.code && !/^SEARCH/i.test(chosen.code) && String(chosen.code).startsWith('P_')) {
            base.product = chosen;
            base.addQty = qtyFor(it, chosen);
            base.status = 'ready';
          }
          return base;
        });
        pending.v = 2;
        pending.autoAdd = false;
        await set({ pending });
      } catch (err) {
        await del('pending');
        return;
      }
    } else {
      items = items.map((i) => {
        if (IS_RAMI && ['todo', 'searching', 'choose'].includes(i.status)) return { ...i, status: 'ready' };
        return ['searching', 'choose'].includes(i.status) ? { ...i, status: 'todo' } : i;
      });
    }

    state = { items, phase: 'work', error: null };
    collapsed = false;
    await persist();
    render();

    if (isOnLoginPage()) {
      tryFillLoginForm();
    }

    if (!IS_RAMI) {
      runQueue();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pending) return;
    const nv = changes.pending.newValue;
    if (nv && (!nv.items || nv.ts !== currentTs)) start();
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
