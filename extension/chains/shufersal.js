// Shufersal Online adapter (SAP Hybris — https://www.shufersal.co.il/*).
(function (root) {
  const reg = root.SmartCartChains;
  const { absoluteUrl, fetchWithTimeout, round2 } = reg.helpers;
  const SHUF_BASE = '/online/he';

  // Shufersal Online strips '729' + leading zeros on legacy Israeli EAN-13 barcodes
  // (e.g. 7290003107223 -> P_3107223, 7290000000183 -> P_183, while 7296073151548 -> P_7296073151548).
  function hasValidEan13CheckDigit(ean) {
    if (!/^\d{13}$/.test(ean)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += Number(ean[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return ((10 - (sum % 10)) % 10) === Number(ean[12]);
  }

  function barcodeFromShufersalCode(code) {
    const m = /^P_(\d+)$/.exec(String(code || '').trim());
    if (!m) return '';
    const digits = m[1];
    if (digits.length === 8 || digits.length >= 11) return digits;
    if (digits.length <= 10) {
      const israeli = '729' + digits.padStart(10, '0');
      if (hasValidEan13CheckDigit(israeli)) return israeli;
    }
    return digits;
  }

  function shufersalSearchQueries(rawBarcode) {
    const clean = String(rawBarcode || '').replace(/^P_/, '').trim();
    if (!/^\d{4,14}$/.test(clean)) return clean ? [clean] : [];
    const shortened = clean.startsWith('729')
      ? clean.slice(3).replace(/^0+/, '')
      : clean.replace(/^0+/, '');
    if (!shortened || shortened === clean) return [clean];
    return clean.startsWith('72900') ? [shortened, clean] : [clean, shortened];
  }

  reg.helpers.barcodeFromShufersalCode = barcodeFromShufersalCode;
  reg.helpers.shufersalSearchQueries = shufersalSearchQueries;

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
    if (typeof document === 'undefined') return 'TEST_CSRF';
    const input = document.querySelector('input[name="CSRFToken"], input[name="_csrf"]');
    if (input && input.value) return input.value;
    for (const s of document.scripts) {
      const m = (s.textContent || '').match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/i);
      if (m) return m[1];
    }
    const htmlMatch = (document.documentElement.innerHTML || '').match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/i);
    if (htmlMatch) return htmlMatch[1];
    try {
      const res = await fetchWithTimeout(`${SHUF_BASE}/cart/load?restoreCart=true`, { credentials: 'include' }, 5000);
      const txt = await res.text();
      const m = txt.match(/CSRFToken\s*[:=]\s*["']([^"']+)["']/i);
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
      const outer = el.outerHTML || '';
      const byWeight = outer.includes('BY_WEIGHT') || outer.includes('BY_PACKAGE') || outer.includes('לק"ג');
      const notInStock = el.classList.contains('outOfStock') || outer.includes('notInStock');
      out.push({
        code,
        barcode: barcodeFromShufersalCode(code) || code.replace(/^P_/, ''),
        name,
        brand: '',
        img: imgEl ? absoluteUrl(imgEl.getAttribute('src')) : '',
        price: priceTxt ? (priceTxt.includes('₪') ? priceTxt : `₪${priceTxt}`) : '',
        unitDesc: byWeight ? 'לפי משקל' : '',
        sellingMethod: byWeight ? 'BY_WEIGHT' : 'BY_UNIT',
        inStock: !notInStock,
        purchasable: true,
        verifiedOnline: true,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  async function fetchShufSearchOnce(q, limit = 12) {
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
            barcode: barcodeFromShufersalCode(p.code) || String(p.code || '').replace(/^P_/, ''),
            name: p.name || '',
            brand: (p.brand && p.brand.name) || '',
            img: pickShufImage(p.images),
            price: (p.price && p.price.formattedValue) || '',
            unitDesc: p.unitDescription || '',
            sellingMethod: (p.sellingMethod && p.sellingMethod.code) || 'BY_UNIT',
            inStock: !(p.stock && p.stock.stockLevelStatus) || p.stock.stockLevelStatus.code === 'inStock',
            purchasable: p.purchasable !== false,
            verifiedOnline: true,
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

  async function searchCatalog(query, limit = 12) {
    const q = String(query || '').trim();
    if (!q) return [];
    const cleanDigits = q.replace(/^P_/, '').trim();

    // Barcode / PLU query: try shortened Shufersal code (e.g. 3107223 / 183) + full EAN,
    // and strictly verify code/barcode match so an unstocked barcode falls back cleanly to Hebrew product name.
    if (/^\d{4,14}$/.test(cleanDigits)) {
      const variants = shufersalSearchQueries(cleanDigits);
      for (const subQ of variants) {
        const found = await fetchShufSearchOnce(subQ, limit);
        const exact = found.filter(
          (r) => r.barcode === cleanDigits || r.code === `P_${subQ}` || r.code === `P_${cleanDigits}`,
        );
        if (exact.length) return exact;
      }
      return [];
    }

    return fetchShufSearchOnce(q, limit);
  }

  async function shufAddGrid(items) {
    const token = await findCsrfToken();
    if (!token) throw new Error('NO_CSRF');
    const res = await fetchWithTimeout(`${SHUF_BASE}/cart/addGrid`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', csrftoken: token },
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
    for (const m of html.matchAll(/P_\d{1,14}/g)) {
      foundCodes.add(m[0]);
    }
    if (foundCodes.size === 0 && html.trim().length > 0) {
      for (const it of items) {
        if (it.productCode) foundCodes.add(it.productCode);
      }
    }
    return { cartCodes: Array.from(foundCodes) };
  }

  function computeQtyForProduct(item, prod) {
    const byUnit = !prod || prod.sellingMethod === 'BY_UNIT';
    if (byUnit) {
      return item.unit === 'unit' || item.unit === 'pack'
        ? Math.max(1, Math.round(Number(item.qty) || 1))
        : Math.max(1, Math.round(Number(item.addQty) || 1));
    }
    if (item.unit === 'kg') return Math.max(0.5, round2(Number(item.qty) || 1));
    if (item.unit === 'g') return Math.max(0.5, round2((Number(item.qty) || 500) / 1000));
    return Math.max(0.5, round2(Number(item.addQty) || 1));
  }

  function toGridItem(item, methodOverride, qtyOverride) {
    const rawQty = qtyOverride != null ? qtyOverride : (Number(item.addQty) || 1);
    const method = methodOverride || (item.product.sellingMethod === 'BY_UNIT' ? 'BY_UNIT' : 'BY_PACKAGE');
    const q = method === 'BY_UNIT' ? Math.max(1, Math.round(rawQty)) : Math.max(0.1, round2(rawQty));
    return {
      productCode: item.product.code,
      quantity: q,
      frontQuantity: q,
      sellingMethod: method,
      longTail: false,
    };
  }

  async function runPool(list, concurrency, fn) {
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
      while (idx < list.length) {
        const cur = list[idx++];
        await fn(cur);
      }
    });
    await Promise.all(workers);
  }

  async function ensureOnlineVerifiedItem(item) {
    const prod = item.product;
    if (
      prod
      && prod.verifiedOnline === true
      && prod.code
      && String(prod.code).startsWith('P_')
      && prod.inStock !== false
      && prod.purchasable !== false
    ) {
      return true;
    }

    const rawBarcode = String(item.wantBarcode || prod?.code || '').replace(/^P_/, '').trim();
    const queries = [];
    if (/^\d{4,14}$/.test(rawBarcode)) queries.push(rawBarcode);
    if (prod?.name) queries.push(prod.name);
    if (item.name && item.name !== prod?.name) queries.push(item.name);
    if (item.name && item.name.includes(' ')) {
      queries.push(item.name.split(/\s+/).slice(0, 2).join(' '));
    }

    for (const q of queries) {
      const results = await searchCatalog(q, 10);
      const inStockMatch = results.find((r) => r.inStock && r.purchasable !== false);
      if (inStockMatch) {
        const prevMethod = item.product?.sellingMethod;
        item.product = inStockMatch;
        if (!item.addQty || prevMethod !== inStockMatch.sellingMethod) {
          item.addQty = computeQtyForProduct(item, inStockMatch);
        }
        return true;
      }
    }
    return false;
  }

  async function tryAddSingleWithFallback(item, saveMapping) {
    const attempts = [toGridItem(item)];
    if (item.product.sellingMethod && item.product.sellingMethod !== 'BY_UNIT') {
      const stepKg = Math.max(0.5, Math.round((Number(item.addQty) || 1) * 2) / 2);
      attempts.push(toGridItem(item, 'BY_PACKAGE', stepKg));
      attempts.push(toGridItem(item, 'BY_WEIGHT', stepKg));
      attempts.push(toGridItem(item, 'BY_UNIT', Math.max(1, Math.round(Number(item.addQty) || 1))));
    }

    for (const payload of attempts) {
      try {
        const { cartCodes } = await shufAddGrid([payload]);
        if (cartCodes.includes(payload.productCode)) {
          item.status = 'added';
          await saveMapping(item.key, item.product);
          return true;
        }
      } catch (err) {
        if (err && (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF')) throw err;
      }
    }

    // Last resort: search by Hebrew item name for a fresh in-stock alternative in Shufersal Online
    const altQueries = [item.name, item.name?.split(/\s+/).slice(0, 2).join(' ')].filter(Boolean);
    for (const q of altQueries) {
      const results = await searchCatalog(q, 8);
      const alt = results.find((r) => r.inStock && r.purchasable !== false && r.code !== item.product?.code);
      if (alt) {
        item.product = alt;
        item.addQty = computeQtyForProduct(item, alt);
        try {
          const { cartCodes } = await shufAddGrid([toGridItem(item)]);
          if (cartCodes.includes(alt.code)) {
            item.status = 'added';
            await saveMapping(item.key, item.product);
            return true;
          }
        } catch (err) {
          if (err && (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF')) throw err;
        }
      }
    }

    item.status = 'error';
    item.errorMsg = 'המוצר אזל או אינו זמין במשלוח שופרסל אונליין.';
    return false;
  }

  async function addReadyItems(readyItems, { saveMapping }) {
    // 1. Upgrade any unverified physical-feed P_72900... codes to live Shufersal Online P_ codes
    const unverified = readyItems.filter(
      (i) => !i.product?.verifiedOnline || i.product.inStock === false || i.product.purchasable === false,
    );
    if (unverified.length) {
      await runPool(unverified, 4, ensureOnlineVerifiedItem);
    }

    const candidates = [];
    for (const i of readyItems) {
      if (
        i.product?.code
        && String(i.product.code).startsWith('P_')
        && i.product.inStock !== false
        && i.product.purchasable !== false
      ) {
        candidates.push(i);
      } else {
        i.status = 'error';
        i.errorMsg = 'לא נמצא במלאי שופרסל אונליין – ניתן לבחור חלופה ידנית.';
      }
    }

    // 2. Submit in chunks of 10; if any chunk hits ADD_500 (e.g. 1 warehouse-unavailable item),
    // isolate per item so 1 unavailable item never blocks the rest of the basket!
    const CHUNK_SIZE = 10;
    for (let offset = 0; offset < candidates.length; offset += CHUNK_SIZE) {
      const chunk = candidates.slice(offset, offset + CHUNK_SIZE);
      try {
        const { cartCodes } = await shufAddGrid(chunk.map((i) => toGridItem(i)));
        const inCart = new Set(cartCodes || []);
        const missed = [];
        for (const i of chunk) {
          if (inCart.has(i.product.code)) {
            i.status = 'added';
            await saveMapping(i.key, i.product);
          } else {
            missed.push(i);
          }
        }
        if (missed.length) {
          await runPool(missed, 3, (i) => tryAddSingleWithFallback(i, saveMapping));
        }
      } catch (err) {
        if (err && (err.message === 'LOGIN_REQUIRED' || err.message === 'NO_CSRF')) {
          throw err;
        }
        await runPool(chunk, 3, (i) => tryAddSingleWithFallback(i, saveMapping));
      }
    }

    const addedTotal = readyItems.filter((i) => i.status === 'added').length;
    if (readyItems.length > 0 && addedTotal === 0) {
      throw new Error('לא הצלחנו להוסיף את המוצרים לסל שופרסל אונליין – בדוק שבחרת כתובת משלוח פעילה באתר.');
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
    acceptsLinkProductDirectly: false,
    isLoggedIn,
    isOnLoginPage,
    tryFillLoginForm,
    consumePostLoginReload,
    isSavedProductReady: (prod) =>
      Boolean(
        prod
        && prod.verifiedOnline === true
        && prod.code
        && !/^SEARCH/i.test(prod.code)
        && String(prod.code).startsWith('P_')
        && prod.inStock !== false
        && prod.purchasable !== false,
      ),
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
