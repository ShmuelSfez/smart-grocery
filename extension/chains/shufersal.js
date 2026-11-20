// Shufersal Online adapter (SAP Hybris — https://www.shufersal.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  const { absoluteUrl } = reg.helpers;
  const SHUF_BASE = '/online/he';

  function isOnLoginPage() {
    return typeof location !== 'undefined' && location.pathname.includes('/login');
  }

  function isLoggedIn() {
    if (typeof document === 'undefined') return true;
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
      if (img) return absoluteUrl(img.url);
    }
    return absoluteUrl(images[0].url || '');
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

  async function searchCatalog(query, limit = 12) {
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

  async function addReadyItems(readyItems, { saveMapping }) {
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
    const { cartCodes } = await shufAddGrid(readyItems.map(toGridItem));
    const inCart = new Set(cartCodes || []);

    // Fallback resolution if a P_<barcode> differed from Shufersal's internal P_ catalog code
    const unconfirmed = readyItems.filter((i) => !inCart.has(i.product.code));
    if (unconfirmed.length) {
      const retryPayload = [];
      for (const i of unconfirmed) {
        const rawCode = String(i.product.code || '').replace(/^P_/, '');
        const found = await searchCatalog(rawCode || i.name, 4).catch(() => []);
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

    for (const i of readyItems) {
      if (inCart.has(i.product.code)) {
        i.status = 'added';
        await saveMapping(i.key, i.product);
      } else {
        i.status = 'error';
        i.errorMsg = 'לא אושר בסל של שופרסל – בדוק מלאי או בחר חלופה.';
      }
    }
    return { reloadAfterDone: false };
  }

  function tryFillLoginForm(shufAuth, onSaveAuth) {
    if (!isOnLoginPage()) return;
    sessionStorage.setItem('sl_from_login', '1');
    const uInput = document.querySelector('#j_username');
    const pInput = document.querySelector('#j_password');
    if (!uInput) return;

    if (!uInput.dataset.slBound) {
      uInput.dataset.slBound = '1';
      uInput.addEventListener('change', () => {
        onSaveAuth({ user: uInput.value.trim() });
      });
    }

    if (shufAuth && shufAuth.user && !uInput.value) {
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

  function consumePostLoginReload() {
    if (!isOnLoginPage() && typeof sessionStorage !== 'undefined' && sessionStorage.getItem('sl_from_login') === '1') {
      sessionStorage.removeItem('sl_from_login');
      sessionStorage.removeItem('sl_submitted_once');
      return true;
    }
    return false;
  }

  reg.register({
    id: 'shufersal',
    name: 'שופרסל',
    mode: 'auto',
    platform: 'hybris',
    hostnames: ['shufersal.co.il'],
    homeUrl: 'https://www.shufersal.co.il/online/he/',
    matchPattern: 'https://www.shufersal.co.il/*',
    accent: '#e2001a',
    checkoutLabel: '💳 עבור לסל ולתשלום בשופרסל',
    loginUrl: `${SHUF_BASE}/login`,
    showRefreshOnDone: true,
    acceptsLinkProductDirectly: true,
    isLoggedIn,
    isOnLoginPage,
    tryFillLoginForm,
    consumePostLoginReload,
    isSavedProductReady: (prod) =>
      Boolean(prod && prod.code && !/^SEARCH/i.test(prod.code) && String(prod.code).startsWith('P_')),
    searchCatalog,
    addReadyItems,
    formatAddError(err) {
      if (err && (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF')) {
        return { redirectLogin: true, message: 'login' };
      }
      return { message: 'שגיאה בהוספה לסל: ' + (err?.message || err) };
    },
    goToCheckout() {
      location.href = `${SHUF_BASE}/cart`;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
