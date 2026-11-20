// Shufersal Online adapter (SAP Hybris — https://www.shufersal.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  const { absoluteUrl, fetchWithTimeout } = reg.helpers;
  const SHUF_BASE = '/online/he';

  function isOnLoginPage() {
    return typeof location !== 'undefined' && location.pathname.includes('/login');
  }

  function isLoggedIn() {
    if (typeof document === 'undefined') return true;
    if (isOnLoginPage()) return false;
    if (document.querySelector('.title-notAnonymous')) return true;
    const loginLink = document.querySelector('a[href*="/login"]');
    if (loginLink && loginLink.offsetParent !== null) return false;
    return true;
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
      const res = await fetchWithTimeout(`${SHUF_BASE}/cart/load?restoreCart=true`, { credentials: 'include' }, 5000);
      const txt = await res.text();
      const m = txt.match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return null;
  }

  function parseHtmlSearchCards(html, limit = 12) {
    if (!html || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = Array.from(doc.querySelectorAll('[data-product-code^="P_"]'));
    const seen = new Set();
    const out = [];
    for (const el of nodes) {
      const code = el.getAttribute('data-product-code') || '';
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const name = (
        el.getAttribute('data-product-name')
        || el.querySelector('.text, .name, h2, h3, [itemprop="name"]')?.textContent
        || ''
      ).replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const priceTxt = (el.querySelector('.price .number, .price')?.textContent || '').replace(/\s+/g, ' ').trim();
      const imgEl = el.querySelector('img[src]');
      const byWeight = (el.outerHTML || '').includes('BY_WEIGHT') || (el.outerHTML || '').includes('לק"ג');
      out.push({
        code,
        barcode: code.replace(/^P_/, ''),
        name,
        brand: '',
        img: imgEl ? absoluteUrl(imgEl.getAttribute('src')) : '',
        price: priceTxt ? (priceTxt.includes('₪') ? priceTxt : `₪${priceTxt}`) : '',
        unitDesc: byWeight ? 'לפי משקל' : '',
        sellingMethod: byWeight ? 'BY_WEIGHT' : 'BY_UNIT',
        inStock: !el.classList.contains('outOfStock'),
        purchasable: true,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async function searchCatalog(query, limit = 12) {
    const q = String(query || '').trim();
    if (!q) return [];
    try {
      const url = `${SHUF_BASE}/search/results?q=${encodeURIComponent(q)}:relevance&limit=${limit}&page=0`;
      const res = await fetchWithTimeout(url, {
        credentials: 'include',
        headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      }, 4500);
      if (res.ok) {
        const raw = await res.text();
        if (raw.trim().startsWith('{')) {
          const data = JSON.parse(raw);
          const mapped = (data.results || []).map((p) => ({
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
          if (mapped.length) return mapped;
        } else {
          const fromHtml = parseHtmlSearchCards(raw, limit);
          if (fromHtml.length) return fromHtml;
        }
      }
    } catch (e) { /* fall through to HTML search */ }

    try {
      const htmlRes = await fetchWithTimeout(`${SHUF_BASE}/search?text=${encodeURIComponent(q)}`, {
        credentials: 'include',
      }, 4500);
      if (htmlRes.ok) {
        return parseHtmlSearchCards(await htmlRes.text(), limit);
      }
    } catch (e) { /* timeout or offline */ }
    return [];
  }

  async function shufAddGrid(items) {
    const token = await findCsrfToken();
    if (!token) throw new Error('NO_CSRF');
    const res = await fetchWithTimeout(`${SHUF_BASE}/cart/addGrid`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', csrftoken: token, 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify(items),
    }, 15000);
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new Error('LOGIN_REQUIRED');
    if (res.status === 401 || res.status === 403) throw new Error('LOGIN_REQUIRED');
    if (!res.ok) throw new Error('ADD_' + res.status);
    const html = await res.text();
    if (html.includes('j_username') || html.includes('loginForm')) throw new Error('LOGIN_REQUIRED');

    const foundCodes = new Set();
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const el of doc.querySelectorAll('[data-product-code], [data-code]')) {
        const c = el.getAttribute('data-product-code') || el.getAttribute('data-code');
        if (c) foundCodes.add(c);
      }
    }
    for (const m of html.matchAll(/P_\d{4,14}/g)) {
      foundCodes.add(m[0]);
    }
    // If Shufersal returned HTTP 200 OK without per-item DOM attributes (e.g. JSON summary fragment), confirm submitted codes
    if (foundCodes.size === 0 && html.trim().length > 0) {
      for (const it of items) {
        if (it.productCode) foundCodes.add(it.productCode);
      }
    }
    return { cartCodes: Array.from(foundCodes) };
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

    // Cap fallback catalog resolution to at most 4 unconfirmed items in parallel so it never stalls
    const unconfirmed = readyItems.filter((i) => !inCart.has(i.product.code)).slice(0, 4);
    if (unconfirmed.length) {
      const retryPayload = [];
      await Promise.all(unconfirmed.map(async (i) => {
        const rawCode = String(i.product.code || '').replace(/^P_/, '');
        const found = await searchCatalog(rawCode || i.name, 4).catch(() => []);
        const cand = found.find((r) => r.inStock && r.purchasable) || found[0];
        if (cand && cand.code && cand.code !== i.product.code) {
          i.product = cand;
          retryPayload.push(toGridItem(i));
        }
      }));
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
    return { reloadAfterDone: false, navigateToCartUrl: `${SHUF_BASE}/cart` };
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
