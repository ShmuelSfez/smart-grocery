// Content script on shufersal.co.il, rami-levy.co.il, and carrefour.co.il (SmartCart Extension v3.0.0).
// Security & safety invariants:
// 1. Never auto-submit items to a cart on page load (autoAdd: false) – always wait for an explicit user click.
// 2. Never overwrite saved product mappings or email hints from untrusted incoming #smartlist= links.
// 3. Always merge with existing cart items (never wipe an existing cart on Rami Levy or Carrefour).
(function () {
  if (window.__smartlistPanel) return;
  window.__smartlistPanel = true;

  const HOST = location.hostname;
  const CHAIN = HOST.includes('rami-levy.co.il')
    ? 'ramilevy'
    : HOST.includes('carrefour.co.il')
      ? 'carrefour'
      : 'shufersal';
  const IS_SHUF = CHAIN === 'shufersal';
  const IS_RAMI = CHAIN === 'ramilevy';
  const IS_CARR = CHAIN === 'carrefour';
  const SHUF_BASE = '/online/he';

  const CHAIN_META = {
    shufersal: {
      name: 'שופרסל',
      accent: '#e2001a',
      checkoutLabel: '💳 עבור לסל ולתשלום בשופרסל',
    },
    ramilevy: {
      name: 'רמי לוי',
      accent: '#0f766e',
      checkoutLabel: '💳 עבור לתשלום ברמי לוי',
    },
    carrefour: {
      name: 'קרפור',
      accent: '#004e9e',
      checkoutLabel: '💳 עבור לתשלום בקרפור',
    },
  };
  const META = CHAIN_META[CHAIN];

  // ---------------- storage ----------------
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
  const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
  const del = (k) => new Promise((r) => chrome.storage.local.remove(k, r));

  const normalize = (name) =>
    String(name || '')
      .toLowerCase()
      .replace(/["״'׳`]/g, '')
      .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function absolute(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    return location.origin + (url.startsWith('/') ? '' : '/') + url;
  }

  // ---------------- Shufersal helpers ----------------
  function isOnLoginPage() {
    return IS_SHUF && location.pathname.includes('/login');
  }

  function isLoggedIn() {
    if (!IS_SHUF) return true;
    if (isOnLoginPage()) return false;
    if (document.querySelector('.title-notAnonymous')) return true;
    if (document.querySelector('a[href*="/login"] .accountLink')) return false;
    return false;
  }

  function pickShufImage(images) {
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
      const res = await fetch(`${SHUF_BASE}/cart/load?restoreCart=true`, { credentials: 'include' });
      const txt = await res.text();
      const m = txt.match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return null;
  }

  async function shufSearch(query, limit = 12) {
    const url = `${SHUF_BASE}/search/results?q=${encodeURIComponent(query)}:relevance&limit=${limit}&page=0`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error('SEARCH_' + res.status);
    const data = await res.json();
    return (data.results || []).map((p) => ({
      code: p.code,
      barcode: String(p.code || '').replace(/^P_/, ''),
      name: p.name || '',
      brand: (p.brand && p.brand.name) || '',
      img: pickShufImage(p.images),
      price: (p.price && p.price.formattedValue) || '',
      unitDesc: p.unitDescription || '',
      sellingMethod: (p.sellingMethod && p.sellingMethod.code) || 'BY_UNIT',
      inStock: !(p.stock && p.stock.stockLevelStatus) || p.stock.stockLevelStatus.code === 'inStock',
      purchasable: p.purchasable !== false,
    }));
  }

  async function shufAddGrid(items) {
    const token = await findCsrfToken();
    if (!token) throw new Error('NO_CSRF');
    const res = await fetch(`${SHUF_BASE}/cart/addGrid`, {
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

  // ---------------- Rami Levy helpers ----------------
  function getRamiStoreId() {
    try {
      const rl = JSON.parse(localStorage.getItem('ramilevy') || '{}');
      const st = rl?.authuser?.user?.store
        || rl?.cart?.store
        || rl?.store?.id
        || rl?.selectedStore;
      if (st && Number(st) > 0) return Number(st);
    } catch (e) { /* ignore */ }
    return 331;
  }

  async function ramiSearch(query, limit = 12) {
    const storeId = getRamiStoreId();
    const res = await fetch('/api/catalog', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        accept: 'application/json',
        locale: 'he',
      },
      body: JSON.stringify({ q: String(query || '').trim(), store: storeId }),
    });
    if (!res.ok) throw new Error('SEARCH_' + res.status);
    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows.slice(0, limit).map((p) => {
      const byWeight = Boolean(p?.prop?.by_kilo || p?.prop?.sw_shakil);
      const rawPrice = p?.price?.price;
      const small = p?.images?.small || '';
      const img = small
        ? (/^https?:\/\//i.test(small) ? small : `https://img.rami-levy.co.il${small.startsWith('/') ? '' : '/'}${small}`)
        : '';
      return {
        ramiId: String(p.id),
        code: String(p.barcode || p.id),
        barcode: String(p.barcode || ''),
        name: String(p.name || ''),
        brand: String(p?.brand?.name || p?.gs?.BrandName || ''),
        img,
        price: typeof rawPrice === 'number' ? `₪${rawPrice.toFixed(2)}` : (rawPrice ? `₪${rawPrice}` : ''),
        unitDesc: byWeight ? 'לפי משקל (ק"ג)' : '',
        sellingMethod: byWeight ? 'BY_WEIGHT' : 'BY_UNIT',
        inStock: p?.prop?.status !== 0 && p?.in_stock !== false,
        purchasable: true,
      };
    });
  }

  function readExistingRamiCart() {
    const itemsMap = {};
    let supplyAt = '';
    try {
      const rl = JSON.parse(localStorage.getItem('ramilevy') || '{}');
      if (typeof rl?.cart?.supplyAt === 'string' && rl.cart.supplyAt) {
        const dt = Date.parse(rl.cart.supplyAt);
        if (!Number.isNaN(dt) && dt > Date.now()) supplyAt = rl.cart.supplyAt;
      }
      const rawItems = rl?.cart?.items;
      if (Array.isArray(rawItems)) {
        for (const ci of rawItems) {
          const id = ci && (ci.id ?? ci.product_id ?? ci.item_id);
          const q = Number(ci?.quantity ?? ci?.qty ?? ci?.amount ?? 0);
          if (id != null && q > 0) {
            const k = String(id);
            itemsMap[k] = round2((itemsMap[k] || 0) + q);
          }
        }
      } else if (rawItems && typeof rawItems === 'object') {
        for (const [k, v] of Object.entries(rawItems)) {
          const q = typeof v === 'object' ? Number(v?.quantity ?? v?.qty ?? 0) : Number(v);
          if (k && q > 0) {
            itemsMap[String(k)] = round2((itemsMap[String(k)] || 0) + q);
          }
        }
      }
    } catch (e) { /* ignore */ }
    return { itemsMap, supplyAt };
  }

  async function ramiAddCart(readyItems) {
    const storeId = getRamiStoreId();
    const { itemsMap, supplyAt } = readExistingRamiCart();
    const mergedItemsMap = {};
    for (const [id, q] of Object.entries(itemsMap)) {
      mergedItemsMap[id] = String(q);
    }
    for (const i of readyItems) {
      const ramiId = String(i.product?.ramiId || '');
      if (!ramiId) continue;
      const addQ = Number(i.addQty) || 1;
      const prevQ = Number(mergedItemsMap[ramiId] || 0);
      mergedItemsMap[ramiId] = String(round2(prevQ + addQ));
    }

    const res = await fetch('/api/v2/cart', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        accept: 'application/json',
        locale: 'he',
      },
      body: JSON.stringify({
        store: String(storeId),
        isClub: 0,
        supplyAt: supplyAt || new Date(Date.now() + 86400000).toISOString(),
        items: mergedItemsMap,
        meta: null,
      }),
    });
    if (!res.ok) throw new Error('RAMI_CART_' + res.status);
    const respJson = await res.json();
    const respItems = Array.isArray(respJson?.items) ? respJson.items : [];
    const inCart = new Set(respItems.map((x) => String(x.id)));

    // Sync updated items back into localStorage.ramilevy if ramilevy key exists so Vuex hydrates cleanly
    try {
      const rawRl = localStorage.getItem('ramilevy');
      if (rawRl) {
        const rl = JSON.parse(rawRl);
        if (rl && typeof rl === 'object') {
          rl.cart = { ...(rl.cart || {}), ...respJson, items: respItems };
          localStorage.setItem('ramilevy', JSON.stringify(rl));
        }
      }
    } catch (e) { /* ignore */ }

    return { inCart };
  }

  function clickRamiCheckoutButton() {
    const findPayBtn = () =>
      Array.from(document.querySelectorAll('button, a')).find((b) => b.textContent.trim() === 'לתשלום');
    const btn = findPayBtn();
    if (btn) {
      btn.click();
      return true;
    }
    // If cart drawer is closed on narrow viewports, try opening cart toggle first
    const cartToggle = document.querySelector('[aria-label*="סל"], [aria-label*="עגלה"], .cart-btn, #cart-btn');
    if (cartToggle) {
      cartToggle.click();
      setTimeout(() => { findPayBtn()?.click(); }, 250);
      return true;
    }
    return false;
  }

  // ---------------- Carrefour Israel (Self-Point / stor.ai) helpers ----------------
  function discoverCarrefourContext() {
    let branchId = '';
    let cartId = '';
    const existingLines = new Map();

    const inspectObj = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 4) return;
      if (!branchId) {
        const b = obj.branchId ?? obj.selectedBranchId ?? obj.branch?.id ?? obj.branch?.branchId;
        if (b && /^\d{2,6}$/.test(String(b)) && String(b) !== '1540') {
          branchId = String(b);
        }
      }
      if (!cartId) {
        const c = obj.cartId ?? obj.activeCartId ?? (Array.isArray(obj.lines) && obj.id ? obj.id : null) ?? obj.cart?.id ?? obj.cart?.cartId;
        if (c && /^[A-Za-z0-9_-]{4,64}$/.test(String(c))) {
          cartId = String(c);
        }
      }
      const linesArr = Array.isArray(obj.lines) ? obj.lines : (Array.isArray(obj.cart?.lines) ? obj.cart.lines : null);
      if (linesArr) {
        for (const ln of linesArr) {
          const rpid = Number(ln?.retailerProductId ?? ln?.product?.retailerProductId ?? ln?.productId);
          const q = Number(ln?.quantity ?? ln?.qty ?? 0);
          if (rpid > 0 && q > 0 && !existingLines.has(rpid)) {
            existingLines.set(rpid, {
              retailerProductId: rpid,
              quantity: q,
              type: ln?.type || 1,
              soldBy: ln?.soldBy ?? null,
            });
          }
        }
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          inspectObj(v, depth + 1);
        }
      }
    };

    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i) || '';
          const raw = (storage.getItem(k) || '').trim();
          if (!raw) continue;
          const cleanScalar = raw.replace(/^"|"$/g, '');
          if (!branchId && /branch/i.test(k) && /^\d{2,6}$/.test(cleanScalar) && cleanScalar !== '1540') {
            branchId = cleanScalar;
          }
          if (!cartId && /cart.?id/i.test(k) && /^[A-Za-z0-9_-]{4,64}$/.test(cleanScalar)) {
            cartId = cleanScalar;
          }
          if (raw.startsWith('{') || raw.startsWith('[')) {
            try { inspectObj(JSON.parse(raw), 0); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* ignore */ }
    }
    return { branchId: branchId || '3003', cartId, existingLines };
  }

  function mapCarrefourProduct(p, fallbackItem) {
    const rpid = p?.retailerProductId || p?.branchProductId || p?.id;
    const barcode = String(p?.barcode || p?.barcodes?.[0] || '');
    const name = p?.names?.[1]?.short
      || p?.names?.['1']?.long
      || p?.names?.[1]?.long
      || p?.localName
      || p?.name
      || fallbackItem?.product?.name
      || fallbackItem?.name
      || '';
    const isWeighted = Boolean(p?.isWeighted || p?.weightable || fallbackItem?.product?.sellingMethod === 'BY_WEIGHT');
    const rawPrice = p?.price ?? p?.branch?.regularPrice ?? p?.regularPrice ?? p?.prices?.regularPrice;
    const rawImg = p?.images?.[0]?.url || p?.images?.[0]?.small || p?.imageUrl || p?.image || '';
    const brandRaw = p?.brand?.names?.[1] || p?.brand?.name || (typeof p?.brand === 'string' ? p.brand : '') || '';
    return {
      retailerProductId: rpid ? Number(rpid) : null,
      code: String(barcode || rpid || ''),
      barcode,
      name: String(name),
      brand: String(brandRaw),
      img: rawImg ? absolute(rawImg) : '',
      price: typeof rawPrice === 'number' ? `₪${rawPrice.toFixed(2)}` : (rawPrice ? `₪${rawPrice}` : ''),
      unitDesc: isWeighted ? 'לפי משקל (ק"ג)' : '',
      isWeighted,
      sellingMethod: isWeighted ? 'BY_WEIGHT' : 'BY_UNIT',
      inStock: p?.isOutOfStock !== true && p?.inStock !== false && p?.branch?.isActive !== false,
      purchasable: Boolean(rpid),
    };
  }

  async function carrefourFetchList(url) {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error('CARR_SEARCH_' + res.status);
    const data = await res.json();
    return data?.suggestions?.suggestProducts?.products
      || data?.products
      || (Array.isArray(data) ? data : []);
  }

  async function carrefourSearch(query, limit = 10, fallbackItem = null) {
    const q = String(query || '').trim();
    if (!q) return [];
    const { branchId } = discoverCarrefourContext();
    const isBarcode = /^\d{7,14}$/.test(q);
    let rawProducts = [];

    if (isBarcode) {
      const acUrl = `/v2/retailers/1540/branches/${encodeURIComponent(branchId)}/products/autocomplete?appId=4&barcode=${encodeURIComponent(q)}&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encodeURIComponent(q)}&size=${limit}`;
      try {
        rawProducts = await carrefourFetchList(acUrl);
      } catch (e) { /* fall back to /products */ }
    }

    if (!rawProducts.length) {
      const prodUrl = `/v2/retailers/1540/branches/${encodeURIComponent(branchId)}/products?appId=4&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encodeURIComponent(q)}&size=${limit}`;
      try {
        rawProducts = await carrefourFetchList(prodUrl);
      } catch (e) {
        if (!isBarcode) {
          const acFallback = `/v2/retailers/1540/branches/${encodeURIComponent(branchId)}/products/autocomplete?appId=4&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encodeURIComponent(q)}&size=${limit}`;
          rawProducts = await carrefourFetchList(acFallback);
        } else {
          throw e;
        }
      }
    }

    return rawProducts
      .map((p) => mapCarrefourProduct(p, fallbackItem))
      .filter((p) => p.purchasable);
  }

  async function carrefourAddCart(readyItems) {
    const { branchId, cartId, existingLines } = discoverCarrefourContext();
    const lineMap = new Map(existingLines);

    for (const i of readyItems) {
      const rpid = Number(i.product?.retailerProductId || i.product?.code);
      if (!(rpid > 0)) continue;
      const q = Number(i.addQty) || 1;
      const isWeighted = Boolean(i.product?.isWeighted || i.product?.sellingMethod === 'BY_WEIGHT');
      if (lineMap.has(rpid)) {
        const prev = lineMap.get(rpid);
        lineMap.set(rpid, { ...prev, quantity: round2(prev.quantity + q) });
      } else {
        lineMap.set(rpid, {
          retailerProductId: rpid,
          quantity: q,
          type: 1,
          soldBy: isWeighted ? 'weight' : null,
        });
      }
    }

    const mergedLines = Array.from(lineMap.values());
    let res = null;

    if (cartId) {
      res = await fetch(`/v2/retailers/1540/branches/${encodeURIComponent(branchId)}/carts/${encodeURIComponent(cartId)}?appId=4`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-http-method-override': 'PATCH',
        },
        body: JSON.stringify({ lines: mergedLines }),
      });
      if (res.status === 404) res = null;
    }

    if (!res) {
      res = await fetch(`/v2/retailers/1540/branches/${encodeURIComponent(branchId)}/carts?appId=4`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ lines: mergedLines }),
      });
    }

    if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 422) {
      throw new Error('CARR_ADDRESS_OR_LOGIN');
    }
    if (!res.ok) throw new Error('CARR_CART_' + res.status);

    const data = await res.json().catch(() => ({}));
    const newCartId = data?.cart?.id || data?.id || cartId;
    if (newCartId) {
      try { localStorage.setItem('sp_smartcart_cartId', String(newCartId)); } catch (e) { /* ignore */ }
    }
    const respLines = data?.cart?.lines || data?.lines || [];
    const inCart = respLines.length
      ? new Set(respLines.map((ln) => Number(ln?.retailerProductId ?? ln?.product?.retailerProductId ?? ln?.productId)))
      : new Set(mergedLines.map((ln) => Number(ln.retailerProductId)));
    return { inCart };
  }

  function clickCarrefourCheckoutButton() {
    const btn = Array.from(document.querySelectorAll('button, a')).find((b) =>
      b.textContent.trim().includes('לתשלום'),
    );
    if (btn) {
      btn.click();
      return;
    }
    location.href = '/?loginOrRegister=1';
  }

  // ---------------- Unified catalog search ----------------
  async function searchStoreCatalog(query, limit = 12, fallbackItem = null) {
    if (IS_RAMI) return ramiSearch(query, limit);
    if (IS_CARR) return carrefourSearch(query, limit, fallbackItem);
    return shufSearch(query, limit);
  }

  // ---------------- Panel state ----------------
  let state = null;
  let shufMappings = {};
  let chainMappings = { shufersal: {}, ramilevy: {}, carrefour: {} };
  let shufAuth = { user: '' };
  let settings = { remember: true, autoPick: true };
  let root = null;
  let shadow = null;
  let styleSheet = null;
  let collapsed = false;
  let currentTs = 0;

  function activeChainMap() {
    if (IS_SHUF) return shufMappings;
    if (!chainMappings[CHAIN] || typeof chainMappings[CHAIN] !== 'object') {
      chainMappings[CHAIN] = {};
    }
    return chainMappings[CHAIN];
  }

  async function saveChainMapping(itemKey, prod) {
    if (!settings.remember || !itemKey || !prod) return;
    if (IS_SHUF) {
      shufMappings[itemKey] = prod;
      await set({ mappings: shufMappings });
    } else {
      activeChainMap()[itemKey] = prod;
      await set({ chainMappings });
    }
  }

  function isSavedProductReadyForChain(prod) {
    if (!prod || typeof prod !== 'object') return false;
    if (IS_SHUF) return Boolean(prod.code && !/^SEARCH/i.test(prod.code) && String(prod.code).startsWith('P_'));
    if (IS_RAMI) return Boolean(prod.ramiId && /^\d+$/.test(String(prod.ramiId)));
    if (IS_CARR) return Boolean(prod.retailerProductId && Number(prod.retailerProductId) > 0);
    return false;
  }

  async function persist() {
    const pending = await get('pending');
    if (!pending || !state) return;
    pending.items = state.items.map(({ results, ...rest }) => rest);
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

  // ---------------- Login email helper on /online/he/login (Shufersal) ----------------
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

    if (!uInput.value) {
      uInput.focus();
    } else if (pInput && !pInput.value) {
      pInput.focus();
    }
  }

  // ---------------- Background product resolution queue (never auto-adds to cart) ----------------
  let queueRunning = false;
  async function runQueue() {
    if (queueRunning || !state) return;
    queueRunning = true;
    render();
    try {
      const worker = async () => {
        for (;;) {
          const item = state && state.items.find((i) => i.status === 'todo');
          if (!item) return;
          item.status = 'searching';
          render();
          const initialQ = item.query || item.wantBarcode || item.product?.name || item.name;
          await searchFor(item, initialQ, true);
          await new Promise((r) => setTimeout(r, 80));
        }
      };
      await Promise.all([worker(), worker()]);
    } finally {
      queueRunning = false;
      await persist();
      render();
    }
  }

  async function searchFor(item, query, allowAutoPick = true) {
    try {
      const cleanBarcode = String(item.wantBarcode || '').replace(/^P_/, '').trim();
      let results = await searchStoreCatalog(query, 12, item);

      // If initial barcode lookup returned empty, fall back to product name or generic item name
      if (!results.length && allowAutoPick) {
        const nameFallbacks = [item.product?.name, item.name]
          .map((s) => String(s || '').trim())
          .filter((s) => s && s !== query);
        for (const fb of nameFallbacks) {
          results = await searchStoreCatalog(fb, 12, item);
          if (results.length) break;
          if (fb.includes(' ')) {
            results = await searchStoreCatalog(fb.split(' ').slice(0, -1).join(' '), 12, item);
            if (results.length) break;
          }
        }
      } else if (!results.length && query.includes(' ')) {
        results = await searchStoreCatalog(query.split(' ').slice(0, -1).join(' '), 12, item);
      }

      results = results.filter((r) => r.purchasable !== false);
      results.sort((a, b) => Number(Boolean(b.inStock)) - Number(Boolean(a.inStock)));

      if (!results.length) {
        item.status = 'notfound';
      } else if (allowAutoPick) {
        // Match exact EAN barcode first when available, else first in-stock result
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
      item.status = 'error';
      item.errorMsg = 'שגיאת חיפוש: ' + err.message;
    }
    render();
  }

  // ---------------- Add to cart (explicit user click ONLY) ----------------
  async function addAll() {
    if (!state) return;
    if (IS_SHUF && !isLoggedIn()) {
      state.error = 'login';
      await persist();
      render();
      if (!isOnLoginPage()) location.href = `${SHUF_BASE}/login`;
      return;
    }

    const ready = state.items.filter((i) => i.status === 'ready');
    if (!ready.length) return;
    state.phase = 'adding';
    state.error = null;
    render();

    try {
      if (IS_SHUF) {
        const toGridItem = (i) => {
          const q = Number(i.addQty) || 1;
          return {
            productCode: i.product.code,
            quantity: q,
            frontQuantity: q,
            sellingMethod: i.product.sellingMethod === 'BY_UNIT' ? 'BY_UNIT' : 'BY_PACKAGE',
            longTail: false,
          };
        };
        const { cartCodes } = await shufAddGrid(ready.map(toGridItem));
        const inCart = new Set(cartCodes || []);

        // Fallback resolution if a P_<barcode> differed from Shufersal's internal P_ catalog code
        const unconfirmed = ready.filter((i) => !inCart.has(i.product.code));
        if (unconfirmed.length) {
          const retryPayload = [];
          for (const i of unconfirmed) {
            const rawCode = String(i.product.code || '').replace(/^P_/, '');
            const found = await shufSearch(rawCode || i.name, 4).catch(() => []);
            const cand = found.find((r) => r.inStock && r.purchasable) || found[0];
            if (cand && cand.code && cand.code !== i.product.code) {
              i.product = cand;
              retryPayload.push(toGridItem(i));
            }
          }
          if (retryPayload.length) {
            const retryRes = await shufAddGrid(retryPayload).catch(() => ({ cartCodes: [] }));
            for (const c of retryRes.cartCodes || []) inCart.add(c);
          }
        }

        for (const i of ready) {
          if (inCart.has(i.product.code)) {
            i.status = 'added';
            await saveChainMapping(i.key, i.product);
          } else {
            i.status = 'error';
            i.errorMsg = 'לא אושר בסל של שופרסל – בדוק מלאי או בחר חלופה.';
          }
        }
      } else if (IS_RAMI) {
        const { inCart } = await ramiAddCart(ready);
        for (const i of ready) {
          const rid = String(i.product?.ramiId || '');
          if (rid && inCart.has(rid)) {
            i.status = 'added';
            await saveChainMapping(i.key, i.product);
          } else {
            i.status = 'error';
            i.errorMsg = 'לא אושר בסל רמי לוי – לחץ החלף לבחירת מוצר חלופי.';
          }
        }
      } else if (IS_CARR) {
        const { inCart } = await carrefourAddCart(ready);
        for (const i of ready) {
          const rpid = Number(i.product?.retailerProductId || i.product?.code);
          if (rpid && inCart.has(rpid)) {
            i.status = 'added';
            await saveChainMapping(i.key, i.product);
          } else {
            i.status = 'error';
            i.errorMsg = 'לא אושר בסל קרפור – לחץ "🔍 פתח מוצר" או בחר חלופה.';
          }
        }
      }

      const left = state.items.filter((i) =>
        ['choose', 'notfound', 'error', 'todo', 'searching', 'ready'].includes(i.status),
      );
      state.phase = left.length ? 'work' : 'done';
      if (state.phase === 'done') {
        const addedCount = state.items.filter((i) => i.status === 'added').length;
        await del('pending');
        render();
        if (IS_RAMI) {
          // Reload once so Rami Levy's inline sidebar hydrates from localStorage.ramilevy, then show checkout button
          sessionStorage.setItem('sl_done_banner', JSON.stringify({ chain: 'ramilevy', added: addedCount }));
          setTimeout(() => location.reload(), 350);
        }
        return;
      }
      await persist();
    } catch (err) {
      state.phase = 'work';
      if (IS_SHUF && (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF')) {
        state.error = 'login';
        await persist();
        if (!isOnLoginPage()) location.href = `${SHUF_BASE}/login`;
        return;
      }
      if (IS_CARR && err.message === 'CARR_ADDRESS_OR_LOGIN') {
        state.error = 'בקרפור יש לבחור כתובת משלוח או להתחבר לחשבון באתר לפני הוספה אוטומטית לסל (או להשתמש בכפתור "🔍 פתח מוצר" ליד כל פריט).';
        await persist();
        render();
        return;
      }
      state.error = 'שגיאה בהוספה לסל: ' + err.message;
      await persist();
    }
    render();
  }

  function goToCheckout() {
    if (IS_SHUF) {
      location.href = `${SHUF_BASE}/cart`;
      return;
    }
    if (IS_RAMI) {
      if (!clickRamiCheckoutButton()) {
        location.reload();
      }
      return;
    }
    if (IS_CARR) {
      clickCarrefourCheckoutButton();
    }
  }

  // ---------------- Shadow DOM UI ----------------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ACCENT = META.accent;
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
    .panel { position: fixed; bottom: 16px; left: 16px; width: 400px; max-width: calc(100vw - 24px); max-height: calc(100vh - 100px); z-index: 2147483646;
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
    .row { display: flex; align-items: center; gap: 8px; }
    .row-tight { display: flex; align-items: center; gap: 4px; }
    .col-actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .thumb { width: 44px; height: 44px; object-fit: contain; border-radius: 8px; background: #f6f6f8; flex-shrink: 0; }
    .card-ph { height: 64px; }
    .grow { flex: 1; min-width: 0; }
    .want { font-size: 12px; color: #6e6e73; }
    .pname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 12px; color: #6e6e73; }
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
  }

  function unmount() {
    if (root) root.remove();
    root = null;
    shadow = null;
    state = null;
  }

  function fmtQty(i) {
    if (i.unit === 'unit') return i.qty === 1 ? '' : `×${i.qty}`;
    return `${i.qty} ${{ kg: 'ק"ג', g: 'גרם', pack: "חב'" }[i.unit] || i.unit}`;
  }

  function carrefourOpenProductBtn(item) {
    if (!IS_CARR) return null;
    const q = item.product?.name || item.name;
    return h('button', {
      class: 'lnk',
      title: 'פתח חיפוש מוצר ישיר באתר קרפור',
      onclick: async () => {
        await persist();
        location.href = `/search/${encodeURIComponent(q)}`;
      },
    }, '🔍 פתח מוצר');
  }

  function productCard(item, p) {
    return h('button', {
      class: 'card' + (p.inStock ? '' : ' oos'),
      title: `${p.name} ${p.brand}`,
      onclick: () => { choose(item, p, true); render(); persist(); },
    },
      p.img ? h('img', { src: p.img, alt: '', loading: 'lazy' }) : h('div', { class: 'card-ph' }),
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
      carrefourOpenProductBtn(item),
      h('button', { onclick: () => { item.status = 'skipped'; render(); persist(); } }, 'דלג'),
    );
  }

  function renderItem(item) {
    const label = h('span', {}, h('b', {}, item.name), ' ', h('span', { class: 'want' }, fmtQty(item)));
    switch (item.status) {
      case 'ready':
      case 'added': {
        const p = item.product;
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
            p?.img ? h('img', { class: 'thumb', src: p.img, alt: '' }) : h('div', { class: 'thumb' }),
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
                    carrefourOpenProductBtn(item),
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
            h('span', { class: 'status' }, h('span', { class: 'spin' }), ' מתאים מוצר…'),
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
    const resolved = items.filter((i) => ['ready', 'added', 'skipped'].includes(i.status)).length;
    const ready = items.filter((i) => i.status === 'ready').length;
    const added = state.doneAdded || items.filter((i) => i.status === 'added').length;
    const loggedIn = isLoggedIn();

    const panel = h('div', { class: 'panel' + (collapsed ? ' collapsed' : '') });
    panel.append(h('div', { class: 'head' },
      h('span', {}, '🛒'),
      h('b', {}, collapsed ? `${resolved}/${total}` : `העגלה החכמה ← ${META.name}`),
      h('button', { title: collapsed ? 'הרחב' : 'מזער', onclick: () => { collapsed = !collapsed; render(); } }, collapsed ? '▢' : '–'),
      h('button', {
        title: 'סגור חלונית',
        onclick: async () => {
          if (state.phase === 'done' || confirm('לסגור ולנקות את הרשימה מהתוסף?')) {
            await del('pending');
            unmount();
          }
        },
      }, '✕'),
    ));

    if (state.phase === 'done') {
      panel.append(h('div', { class: 'body' },
        h('div', { class: 'done' },
          h('div', { class: 'big' }, '🎉'),
          h('h3', {}, `${added} מוצרים נוספו לסל ב${META.name}!`),
          h('p', {}, IS_RAMI
            ? 'הסל של רמי לוי עודכן (פריטים קודמים נשמרו). לחץ למעבר לתשלום:'
            : `כל המוצרים נוספו לסל ב${META.name}. מוכן למעבר לתשלום!`),
        ),
      ));
      const foot = h('div', { class: 'foot' },
        h('button', { class: 'primary', onclick: goToCheckout }, META.checkoutLabel),
      );
      if (!IS_RAMI) {
        foot.append(h('button', { class: 'secondary', onclick: () => location.reload() }, '🔄 רענן דף והצג סל מעודכן'));
      }
      panel.append(foot);
      shadow.append(panel);
      return;
    }

    const subText = !loggedIn
      ? '🔐 יש להתחבר לחשבון שופרסל לפני ההוספה לסל'
      : state.phase === 'adding'
        ? `מוסיף מוצרים לסל ב${META.name}…`
        : queueRunning && !ready
          ? `מתאים מוצרים מול קטלוג ${META.name}… (${resolved}/${total})`
          : `${ready} מוצרים מוכנים להוספה (${resolved}/${total})`;

    panel.append(h('div', { class: 'sub' }, h('span', {}, subText)));
    panel.append(h('progress', { class: 'prog', max: String(total || 1), value: String(resolved) }));

    const body = h('div', { class: 'body' });
    if (IS_CARR) {
      body.append(h('div', { class: 'tip-box' },
        '💡 טיפ לקרפור: בחר כתובת משלוח או התחבר באתר קרפור לפני הלחיצה על הוספה לסל',
      ));
    }
    if (IS_SHUF && !loggedIn) {
      body.append(h('div', { class: 'login-box' },
        h('b', {}, '👤 התחבר לחשבון שופרסל:'),
        h('span', { class: 'meta' }, 'שום מוצר לא מתווסף אוטומטית. לאחר ההתחברות תוכל לבדוק את המוצרים וללחוץ הוספה לסל.'),
      ));
    }

    const order = { choose: 0, notfound: 0, error: 0, searching: 1, todo: 1, ready: 2, skipped: 3, added: 4 };
    [...items]
      .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0))
      .forEach((i) => body.append(renderItem(i)));
    panel.append(body);

    const foot = h('div', { class: 'foot' });
    if (state.error && state.error !== 'login') {
      const errBox = h('div', { class: 'login-box' }, h('span', {}, state.error));
      if (IS_CARR) {
        errBox.append(h('button', {
          class: 'secondary',
          onclick: async () => {
            await persist();
            location.href = '/?loginOrRegister=1';
          },
        }, '👤 התחבר / בחר כתובת בקרפור'));
      }
      foot.append(errBox);
    }

    if (IS_SHUF && !loggedIn) {
      if (!isOnLoginPage()) {
        foot.append(h('button', {
          class: 'primary',
          onclick: () => { location.href = `${SHUF_BASE}/login`; },
        }, 'התחבר לשופרסל כדי להוסיף לסל'));
      }
    } else {
      const label = state.phase === 'adding'
        ? 'מוסיף לסל…'
        : queueRunning && !ready
          ? 'מתאים מוצרים…'
          : `🛒 הוסף ${ready} מוצרים לסל ועבור לתשלום`;
      foot.append(h('button', {
        class: 'primary',
        disabled: !ready || state.phase === 'adding',
        onclick: addAll,
      }, label));
    }
    panel.append(foot);
    shadow.append(panel);
  }

  // ---------------- Boot ----------------
  async function start() {
    // Post-reload Rami Levy done banner so the hydrated cart sidebar and checkout button appear together
    const doneBannerRaw = sessionStorage.getItem('sl_done_banner');
    if (doneBannerRaw && !location.hash.includes('smartlist=')) {
      sessionStorage.removeItem('sl_done_banner');
      try {
        const parsed = JSON.parse(doneBannerRaw);
        if (parsed && parsed.chain === CHAIN) {
          state = { items: [], phase: 'done', doneAdded: Number(parsed.added) || 0, error: null };
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

    // If returning right after logging in on Shufersal /login, reload once so CSRF/session is fresh
    if (IS_SHUF && !isOnLoginPage() && sessionStorage.getItem('sl_from_login') === '1') {
      sessionStorage.removeItem('sl_from_login');
      sessionStorage.removeItem('sl_submitted_once');
      location.reload();
      return;
    }

    currentTs = pending.ts || 0;
    shufMappings = (await get('mappings')) || {};
    chainMappings = { shufersal: {}, ramilevy: {}, carrefour: {}, ...((await get('chainMappings')) || {}) };
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
          const itemKey = normalize(it.name);
          const savedProd = savedMap[itemKey];
          const linkProd = it.product;
          const wantBarcode = String(linkProd?.code || '').replace(/^P_/, '').trim();
          const base = {
            ...it,
            key: itemKey,
            wantBarcode,
            product: linkProd || null,
            status: 'todo',
          };

          if (isSavedProductReadyForChain(savedProd)) {
            base.product = savedProd;
            base.addQty = qtyFor(it, savedProd);
            base.status = 'ready';
          } else if (IS_SHUF && isSavedProductReadyForChain(linkProd)) {
            // Session preview only – never persisted to saved mappings until user clicks addAll/choose
            base.product = linkProd;
            base.addQty = qtyFor(it, linkProd);
            base.status = 'ready';
          } else {
            // Rami Levy & Carrefour require resolving EAN barcode to internal product ID via runQueue()
            base.query = wantBarcode || linkProd?.name || it.name;
          }
          return base;
        });

        pending.v = 3;
        pending.chain = CHAIN;
        pending.autoAdd = false;
        await set({ pending });
      } catch (err) {
        await del('pending');
        return;
      }
    } else {
      items = items.map((i) =>
        (['searching', 'choose'].includes(i.status) ? { ...i, status: 'todo' } : i),
      );
    }

    state = { items, phase: 'work', error: null };
    collapsed = false;
    await persist();
    render();

    if (isOnLoginPage()) {
      tryFillLoginForm();
    }

    runQueue();
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
