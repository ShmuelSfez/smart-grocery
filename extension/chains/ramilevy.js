// Rami Levy Online adapter (https://www.rami-levy.co.il/*).
// Includes pure Node-testable cart extraction & safe-merge helpers so existing carts are never wiped.
(function (root) {
  const reg = root.SmartCartChains;
  const { round2 } = reg.helpers;

  function extractExistingRamiCart(rawRamilevy, nowMs = Date.now()) {
    const itemsMap = {};
    let supplyAt = '';
    try {
      const rl = typeof rawRamilevy === 'string'
        ? JSON.parse(rawRamilevy || '{}')
        : (rawRamilevy && typeof rawRamilevy === 'object' ? rawRamilevy : {});
      if (typeof rl?.cart?.supplyAt === 'string' && rl.cart.supplyAt) {
        const dt = Date.parse(rl.cart.supplyAt);
        if (!Number.isNaN(dt) && dt > nowMs) supplyAt = rl.cart.supplyAt;
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

  function mergeRamiCartItems(existingItemsMap, readyItems) {
    const merged = {};
    for (const [id, q] of Object.entries(existingItemsMap || {})) {
      const num = Number(q);
      if (id && num > 0) merged[String(id)] = String(round2(num));
    }
    for (const i of readyItems || []) {
      const ramiId = String(i?.product?.ramiId || '');
      if (!ramiId) continue;
      const addQ = Number(i?.addQty) || 1;
      const prevQ = Number(merged[ramiId] || 0);
      merged[ramiId] = String(round2(prevQ + addQ));
    }
    return merged;
  }

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

  async function searchCatalog(query, limit = 12) {
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

  async function addReadyItems(readyItems, { saveMapping }) {
    const storeId = getRamiStoreId();
    let rawLocal = '{}';
    try { rawLocal = localStorage.getItem('ramilevy') || '{}'; } catch (e) { /* ignore */ }
    const { itemsMap, supplyAt } = extractExistingRamiCart(rawLocal);
    const mergedItemsMap = mergeRamiCartItems(itemsMap, readyItems);

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

    // Sync updated items back into localStorage.ramilevy so Vuex hydrates cleanly on reload
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

    for (const i of readyItems) {
      const rid = String(i.product?.ramiId || '');
      if (rid && inCart.has(rid)) {
        i.status = 'added';
        await saveMapping(i.key, i.product);
      } else {
        i.status = 'error';
        i.errorMsg = 'לא אושר בסל רמי לוי – לחץ החלף לבחירת מוצר חלופי.';
      }
    }
    return { reloadAfterDone: true };
  }

  function clickRamiCheckoutButton() {
    const findPayBtn = () =>
      Array.from(document.querySelectorAll('button, a')).find((b) => b.textContent.trim() === 'לתשלום');
    const btn = findPayBtn();
    if (btn) {
      btn.click();
      return true;
    }
    const cartToggle = document.querySelector('[aria-label*="סל"], [aria-label*="עגלה"], .cart-btn, #cart-btn');
    if (cartToggle) {
      cartToggle.click();
      setTimeout(() => { findPayBtn()?.click(); }, 250);
      return true;
    }
    return false;
  }

  Object.assign(reg.helpers, {
    extractExistingRamiCart,
    mergeRamiCartItems,
  });

  reg.register({
    id: 'ramilevy',
    name: 'רמי לוי',
    mode: 'auto',
    platform: 'ramilevy',
    hostnames: ['rami-levy.co.il'],
    homeUrl: 'https://www.rami-levy.co.il/he/online/market',
    matchPattern: 'https://www.rami-levy.co.il/*',
    accent: '#0f766e',
    checkoutLabel: '💳 עבור לתשלום ברמי לוי',
    doneSubtitle: 'הסל של רמי לוי עודכן (פריטים קודמים נשמרו). לחץ למעבר לתשלום:',
    showRefreshOnDone: false,
    acceptsLinkProductDirectly: false,
    isLoggedIn: () => true,
    isOnLoginPage: () => false,
    isSavedProductReady: (prod) => Boolean(prod && prod.ramiId && /^\d+$/.test(String(prod.ramiId))),
    searchCatalog,
    addReadyItems,
    formatAddError(err) {
      return { message: 'שגיאה בהוספה לסל: ' + (err?.message || err) };
    },
    goToCheckout() {
      if (!clickRamiCheckoutButton()) {
        location.reload();
      }
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
