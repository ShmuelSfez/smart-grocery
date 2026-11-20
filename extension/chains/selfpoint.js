// Shared chain registry, Self-Point (stor.ai) adapter factory (Carrefour & Mahsanei HaShuk),
// and Guided Search-and-Add helpers for the SmartCart Chrome Extension (v3.1.0).
(function (root) {
  function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  function absoluteUrl(url, origin) {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    const base = origin || (typeof location !== 'undefined' ? location.origin : '');
    if (!base) return url;
    return base + (url.startsWith('/') ? '' : '/') + url;
  }

  function normalizeText(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/["״'׳`]/g, '')
      .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractEanBarcode(item) {
    const raw = String(item?.wantBarcode || item?.product?.barcode || item?.product?.code || '')
      .replace(/^P_/, '')
      .trim();
    return /^\d{8,14}$/.test(raw) ? raw : '';
  }

  function resolveGuidedQuery(item, preferName = false) {
    const ean = extractEanBarcode(item);
    if (!preferName && ean) return ean;
    const custom = String(item?.guidedQuery || '').trim();
    if (!preferName && custom) return custom;
    return String(item?.name || item?.product?.name || ean || '').trim();
  }

  function readStorageEntries(storage) {
    const pairs = [];
    if (!storage || typeof storage !== 'object') return pairs;
    if (typeof storage.length === 'number' && typeof storage.key === 'function' && typeof storage.getItem === 'function') {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i) || '';
        const v = storage.getItem(k);
        if (k && typeof v === 'string') pairs.push([k, v]);
      }
      return pairs;
    }
    for (const [k, v] of Object.entries(storage)) {
      if (v != null) pairs.push([k, typeof v === 'string' ? v : JSON.stringify(v)]);
    }
    return pairs;
  }

  function discoverSelfPointContext(config, customStorages) {
    const retailerStr = String(config?.retailerId || '');
    const defaultBranchId = String(config?.defaultBranchId || '');
    let branchId = '';
    let cartId = '';
    const existingLines = new Map();

    const inspectObj = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 4) return;
      if (!branchId) {
        const b = obj.branchId ?? obj.selectedBranchId ?? obj.branch?.id ?? obj.branch?.branchId;
        if (b && /^\d{2,6}$/.test(String(b)) && String(b) !== retailerStr) {
          branchId = String(b);
        }
      }
      if (!cartId) {
        const c = obj.cartId
          ?? obj.activeCartId
          ?? (Array.isArray(obj.lines) && obj.id ? obj.id : null)
          ?? obj.cart?.id
          ?? obj.cart?.cartId;
        if (c && /^[A-Za-z0-9_-]{4,64}$/.test(String(c))) {
          cartId = String(c);
        }
      }
      const linesArr = Array.isArray(obj.lines)
        ? obj.lines
        : (Array.isArray(obj.cart?.lines) ? obj.cart.lines : null);
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

    const storages = Array.isArray(customStorages)
      ? customStorages
      : [root.localStorage, root.sessionStorage].filter(Boolean);

    for (const storage of storages) {
      try {
        for (const [k, rawVal] of readStorageEntries(storage)) {
          const raw = String(rawVal || '').trim();
          if (!raw) continue;
          const cleanScalar = raw.replace(/^"|"$/g, '');
          if (!branchId && /branch/i.test(k) && /^\d{2,6}$/.test(cleanScalar) && cleanScalar !== retailerStr) {
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

    return { branchId: branchId || defaultBranchId, cartId, existingLines };
  }

  function mapSelfPointProduct(p, fallbackItem, origin) {
    const rpid = p?.retailerProductId || p?.branch?.branchProductId || p?.branchProductId || p?.id;
    const barcode = String(p?.barcode || p?.barcodes?.[0] || '');
    const name = p?.names?.['1']?.long
      || p?.names?.['1']?.short
      || p?.localName
      || p?.name
      || fallbackItem?.product?.name
      || fallbackItem?.name
      || '';
    const isWeighted = Boolean(
      p?.isWeighted
      || p?.weightable
      || p?.branch?.isWeighted
      || fallbackItem?.product?.sellingMethod === 'BY_WEIGHT',
    );
    const rawPrice = p?.branch?.regularPrice || p?.price || p?.regularPrice || p?.prices?.regularPrice;
    const rawImg = p?.images?.[0]?.url || p?.images?.[0]?.small || p?.imageUrl || p?.image || '';
    const brandRaw = p?.brand?.names?.['1'] || p?.brand?.name || (typeof p?.brand === 'string' ? p.brand : '') || '';
    return {
      retailerProductId: rpid ? Number(rpid) : null,
      code: String(barcode || rpid || ''),
      barcode,
      name: String(name),
      brand: String(brandRaw),
      img: rawImg ? absoluteUrl(rawImg, origin) : '',
      price: typeof rawPrice === 'number' ? `₪${rawPrice.toFixed(2)}` : (rawPrice ? `₪${rawPrice}` : ''),
      unitDesc: isWeighted ? 'לפי משקל (ק"ג)' : '',
      isWeighted,
      sellingMethod: isWeighted ? 'BY_WEIGHT' : 'BY_UNIT',
      inStock: p?.isOutOfStock !== true && p?.inStock !== false && p?.branch?.isActive !== false,
      purchasable: Boolean(rpid),
    };
  }

  function mergeSelfPointCartLines(existingLines, readyItems) {
    const lineMap = new Map();
    if (existingLines instanceof Map) {
      for (const [k, ln] of existingLines.entries()) {
        const rpid = Number(ln?.retailerProductId ?? k);
        const q = Number(ln?.quantity ?? 0);
        if (rpid > 0 && q > 0) {
          lineMap.set(rpid, {
            retailerProductId: rpid,
            quantity: q,
            type: ln?.type || 1,
            soldBy: ln?.soldBy ?? null,
          });
        }
      }
    } else if (Array.isArray(existingLines)) {
      for (const ln of existingLines) {
        const rpid = Number(ln?.retailerProductId ?? ln?.productId);
        const q = Number(ln?.quantity ?? ln?.qty ?? 0);
        if (rpid > 0 && q > 0) {
          lineMap.set(rpid, {
            retailerProductId: rpid,
            quantity: q,
            type: ln?.type || 1,
            soldBy: ln?.soldBy ?? null,
          });
        }
      }
    }

    for (const i of readyItems || []) {
      const rpid = Number(i?.product?.retailerProductId || i?.product?.code);
      if (!(rpid > 0)) continue;
      const q = Number(i?.addQty) || 1;
      const isWeighted = Boolean(i?.product?.isWeighted || i?.product?.sellingMethod === 'BY_WEIGHT');
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

    return Array.from(lineMap.values());
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('TIMEOUT')), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function selfPointFetchProducts(url) {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    }, 6000);
    if (!res.ok) throw new Error('SELFPOINT_SEARCH_' + res.status);
    const data = await res.json();
    return data?.suggestions?.suggestProducts?.products
      || data?.products
      || (Array.isArray(data) ? data : []);
  }

  function clickCheckoutOrDrawer(fallbackUrl) {
    if (typeof document === 'undefined') return false;
    const findPayBtn = () =>
      Array.from(document.querySelectorAll('button, a')).find((b) => {
        const t = (b.textContent || '').trim();
        return t === 'לתשלום' || t.includes('לתשלום') || t.includes('מעבר לתשלום');
      });
    const btn = findPayBtn();
    if (btn) {
      btn.click();
      return true;
    }
    const cartToggle = document.querySelector(
      '[aria-label*="סל"], [aria-label*="עגלה"], .cart-btn, #cart-btn, [data-testid*="cart"], a[href*="/cart"]',
    );
    if (cartToggle) {
      cartToggle.click();
      setTimeout(() => {
        const delayed = findPayBtn();
        if (delayed) delayed.click();
        else if (fallbackUrl) location.href = fallbackUrl;
      }, 280);
      return true;
    }
    if (fallbackUrl) {
      location.href = fallbackUrl;
      return true;
    }
    return false;
  }

  function isElementVisible(el) {
    if (!el || el.disabled) return false;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
    return true;
  }

  function findGuidedDomAssist(searchQuery) {
    if (typeof document === 'undefined') return null;
    const q = String(searchQuery || '').trim();
    if (!q) return null;

    const scope = document.querySelector('main') || document.body;
    if (!scope) return null;

    const allButtons = Array.from(scope.querySelectorAll('button, [role="button"]')).filter((btn) => {
      if (!isElementVisible(btn)) return false;
      if (btn.closest('header, nav, footer, aside, [role="dialog"]')) return false;
      const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (btn.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const label = txt || aria;
      if (!label || label.includes('לתשלום')) return false;
      return (
        label === 'הוספה לסל'
        || label === 'הוסף לסל'
        || label === 'הוספה לעגלה'
        || label === 'הוסף לעגלה'
        || label.includes('הוספה לסל')
        || label.includes('הוסף לסל')
      );
    });

    if (!allButtons.length) return null;

    const cardFor = (btn) =>
      btn.closest('article, li, [data-testid*="product"], [class*="product-card"], [class*="ProductCard"], [class*="product"], [class*="card"]')
      || btn.parentElement;

    const titleFor = (card, btn) => {
      if (!card) return '';
      const heading = card.querySelector('h1, h2, h3, h4, [class*="name"], [class*="title"], a[title]');
      if (heading) {
        const t = (heading.getAttribute('title') || heading.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t !== (btn.textContent || '').trim()) return t.slice(0, 90);
      }
      return '';
    };

    if (allButtons.length === 1) {
      const btn = allButtons[0];
      const cardEl = cardFor(btn);
      return { addButton: btn, cardEl, title: titleFor(cardEl, btn) };
    }

    if (/^\d{8,14}$/.test(q)) {
      const exactCards = allButtons
        .map((btn) => ({ btn, cardEl: cardFor(btn) }))
        .filter(({ cardEl }) => cardEl && (cardEl.outerHTML || '').includes(q));
      if (exactCards.length === 1) {
        const { btn, cardEl } = exactCards[0];
        return { addButton: btn, cardEl, title: titleFor(cardEl, btn) };
      }
    }

    return null;
  }

  function createSelfPointChain(cfg) {
    const {
      id,
      name,
      retailerId,
      defaultBranchId,
      hostnames,
      homeUrl,
      matchPattern,
      accent,
      checkoutLabel,
    } = cfg;

    async function searchCatalog(query, limit = 12, fallbackItem = null) {
      const q = String(query || '').trim();
      if (!q) return [];
      const { branchId } = discoverSelfPointContext({ retailerId, defaultBranchId });
      const encBranch = encodeURIComponent(branchId);
      const encQ = encodeURIComponent(q);
      const isBarcode = /^\d{7,14}$/.test(q);
      const basePath = `/v2/retailers/${retailerId}/branches/${encBranch}/products`;
      let rawProducts = [];

      if (isBarcode) {
        const prodBarcodeUrl = `${basePath}?appId=4&barcode=${encQ}&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encQ}&size=${limit}`;
        try {
          rawProducts = await selfPointFetchProducts(prodBarcodeUrl);
        } catch (e) { /* try autocomplete next */ }

        if (!rawProducts.length) {
          const acBarcodeUrl = `${basePath}/autocomplete?appId=4&barcode=${encQ}&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encQ}&size=${limit}`;
          try {
            rawProducts = await selfPointFetchProducts(acBarcodeUrl);
          } catch (e) { /* fall back to plain query */ }
        }
      }

      if (!rawProducts.length) {
        const prodUrl = `${basePath}?appId=4&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encQ}&size=${limit}`;
        try {
          rawProducts = await selfPointFetchProducts(prodUrl);
        } catch (e) {
          if (!isBarcode) {
            const acFallback = `${basePath}/autocomplete?appId=4&filters=%7B%7D&from=0&isSearch=true&languageId=1&minScore=0&query=${encQ}&size=${limit}`;
            rawProducts = await selfPointFetchProducts(acFallback);
          } else {
            throw e;
          }
        }
      }

      const origin = typeof location !== 'undefined' ? location.origin : new URL(homeUrl).origin;
      return rawProducts
        .map((p) => mapSelfPointProduct(p, fallbackItem, origin))
        .filter((p) => p.purchasable);
    }

    async function addReadyItems(readyItems, { saveMapping }) {
      const { branchId, cartId, existingLines } = discoverSelfPointContext({ retailerId, defaultBranchId });
      const mergedLines = mergeSelfPointCartLines(existingLines, readyItems);
      const encBranch = encodeURIComponent(branchId);
      let res = null;

      if (cartId) {
        res = await fetchWithTimeout(`/v2/retailers/${retailerId}/branches/${encBranch}/carts/${encodeURIComponent(cartId)}?appId=4`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-http-method-override': 'PATCH',
          },
          body: JSON.stringify({ lines: mergedLines }),
        }, 12000);
        if (res.status === 404) res = null;
      }

      if (!res) {
        res = await fetchWithTimeout(`/v2/retailers/${retailerId}/branches/${encBranch}/carts?appId=4`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ lines: mergedLines }),
        }, 12000);
      }

      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 422) {
        throw new Error('SELFPOINT_ADDRESS_OR_LOGIN');
      }
      if (!res.ok) throw new Error('SELFPOINT_CART_' + res.status);

      const data = await res.json().catch(() => ({}));
      const newCartId = data?.cart?.id || data?.id || cartId;
      if (newCartId) {
        try { localStorage.setItem(`sp_smartcart_cartId_${retailerId}`, String(newCartId)); } catch (e) { /* ignore */ }
      }
      const respLines = data?.cart?.lines || data?.lines || [];
      const inCart = respLines.length
        ? new Set(respLines.map((ln) => Number(ln?.retailerProductId ?? ln?.product?.retailerProductId ?? ln?.productId)))
        : new Set(mergedLines.map((ln) => Number(ln.retailerProductId)));

      for (const i of readyItems) {
        const rpid = Number(i.product?.retailerProductId || i.product?.code);
        if (rpid && inCart.has(rpid)) {
          i.status = 'added';
          await saveMapping(i.key, i.product);
        } else {
          i.status = 'error';
          i.errorMsg = `לא אושר בסל ${name} – לחץ "🔍 פתח מוצר" או בחר חלופה.`;
        }
      }

      return { reloadAfterDone: false };
    }

    return {
      id,
      name,
      mode: 'auto',
      platform: 'selfpoint',
      retailerId,
      defaultBranchId,
      hostnames,
      homeUrl,
      matchPattern,
      accent,
      checkoutLabel,
      tipText: `💡 טיפ ל${name}: בחר כתובת משלוח או התחבר באתר לפני הלחיצה על הוספה לסל`,
      showRefreshOnDone: true,
      acceptsLinkProductDirectly: false,
      isLoggedIn: () => true,
      isOnLoginPage: () => false,
      isSavedProductReady: (prod) => Boolean(prod && prod.retailerProductId && Number(prod.retailerProductId) > 0),
      buildProductSearchUrl: (q) => `/search/${encodeURIComponent(q)}`,
      searchCatalog,
      addReadyItems,
      formatAddError(err) {
        if (err && err.message === 'SELFPOINT_ADDRESS_OR_LOGIN') {
          return {
            message: `ב${name} יש לבחור כתובת משלוח או להתחבר לחשבון באתר לפני הוספה אוטומטית לסל (או להשתמש בכפתור "🔍 פתח מוצר" ליד כל פריט).`,
            actionLabel: `👤 התחבר / בחר כתובת ב${name}`,
            actionUrl: '/?loginOrRegister=1',
          };
        }
        return { message: 'שגיאה בהוספה לסל: ' + (err?.message || err) };
      },
      goToCheckout() {
        clickCheckoutOrDrawer('/?loginOrRegister=1');
      },
    };
  }

  function createGuidedChain(cfg) {
    return {
      mode: 'guided',
      platform: 'guided',
      domAssist: cfg.domAssist !== false,
      isLoggedIn: () => true,
      isOnLoginPage: () => false,
      isSavedProductReady: () => true,
      findSinglePageMatchAssist(query) {
        if (cfg.domAssist === false) return null;
        return findGuidedDomAssist(query);
      },
      ...cfg,
    };
  }

  const registry = root.SmartCartChains || {
    adapters: {},
    order: [],
    helpers: {},
    register(adapter) {
      if (!adapter || !adapter.id) return adapter;
      this.adapters[adapter.id] = adapter;
      if (!this.order.includes(adapter.id)) this.order.push(adapter.id);
      return adapter;
    },
    get(id) {
      return this.adapters[id] || null;
    },
    list() {
      return this.order.map((id) => this.adapters[id]).filter(Boolean);
    },
    getByHost(hostname) {
      const h = String(hostname || '').toLowerCase();
      if (!h) return null;
      for (const id of this.order) {
        const a = this.adapters[id];
        if (a && Array.isArray(a.hostnames) && a.hostnames.some((pat) => h === pat || h.endsWith('.' + pat) || h.includes(pat))) {
          return a;
        }
      }
      return null;
    },
    detectChainId(rawText) {
      const s = String(rawText || '').toLowerCase();
      if (!s) return '';
      for (const id of this.order) {
        const a = this.adapters[id];
        if (a && Array.isArray(a.hostnames) && a.hostnames.some((pat) => s.includes(pat))) {
          return a.id;
        }
      }
      return '';
    },
  };

  Object.assign(registry.helpers, {
    round2,
    absoluteUrl,
    normalizeText,
    extractEanBarcode,
    resolveGuidedQuery,
    fetchWithTimeout,
    discoverSelfPointContext,
    mapSelfPointProduct,
    mergeSelfPointCartLines,
    clickCheckoutOrDrawer,
    findGuidedDomAssist,
    createSelfPointChain,
    createGuidedChain,
  });

  root.SmartCartChains = registry;
})(typeof globalThis !== 'undefined' ? globalThis : window);
