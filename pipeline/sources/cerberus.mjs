// Shared Cerberus Price Transparency web portal adapter (https://url.publishedprices.co.il).
// Used by Rami Levy, Yochananof, Tiv Taam, Osher Ad, and Keshet Teamim.
import { extractFileMeta } from '../parse.mjs';

export const CERBERUS_ORIGIN = 'https://url.publishedprices.co.il';
const UA = 'Mozilla/5.0 (compatible; SmartCartPriceTransparencyBot/1.0)';

export function createCookieSession() {
  const jar = new Map();
  return {
    save(res) {
      const cookies = res.headers?.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of cookies) {
        const [kv] = c.split(';');
        const eq = kv.indexOf('=');
        if (eq > 0) jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function fetchWithRetry(fetchImpl, url, opts = {}, session = null, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = { 'user-agent': UA, ...(opts.headers || {}) };
      if (session) {
        const ck = session.header();
        if (ck) headers.cookie = ck;
      }
      const res = await fetchImpl(url, { ...opts, headers, signal: AbortSignal.timeout(30000) });
      if (session) session.save(res);
      if (opts.redirect !== 'manual' && !res.ok) throw new Error(`HTTP_${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

async function loginCerberus(fetchImpl, origin, username, password = '') {
  const session = createCookieSession();
  const r1 = await fetchWithRetry(fetchImpl, `${origin}/login`, {}, session);
  const h1 = await r1.text();
  const csrf1 = (h1.match(/name="csrftoken"\s+content="([^"]+)"/i) || [])[1] || '';

  await fetchWithRetry(fetchImpl, `${origin}/login/user`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, csrftoken: csrf1, Submit: 'Sign in' }).toString(),
  }, session);

  const r3 = await fetchWithRetry(fetchImpl, `${origin}/file`, {}, session);
  const h3 = await r3.text();
  const csrf2 = (h3.match(/name="csrftoken"\s+content="([^"]+)"/i) || [])[1] || csrf1;
  return { session, csrf: csrf2 };
}

async function listCerberusKind(fetchImpl, origin, session, csrf, searchPrefix, chainGln = '') {
  const entries = [];
  const pageSize = 500;
  let start = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await fetchWithRetry(fetchImpl, `${origin}/file/json/dir`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sEcho: String(guard + 1),
        iDisplayStart: String(start),
        iDisplayLength: String(pageSize),
        sSearch: searchPrefix,
        cd: '/',
        csrftoken: csrf,
      }).toString(),
    }, session);
    const json = await res.json();
    const rows = json.aaData || [];
    for (const row of rows) {
      const fname = row.fname || row.name || '';
      if (chainGln && !fname.includes(chainGln)) continue;
      const meta = extractFileMeta(fname);
      if (meta && meta.kind.toLowerCase() === searchPrefix.toLowerCase()) {
        entries.push({ ...meta, fname });
      }
    }
    start += rows.length;
    const total = Number(json.iTotalDisplayRecords) || 0;
    if (!rows.length || start >= total) break;
  }
  return entries;
}

function pickNewestByStore(fetchImpl, origin, entries, session) {
  const byStore = new Map();
  for (const e of entries) {
    const prev = byStore.get(e.storeId);
    if (!prev || e.stamp > prev.stamp) {
      byStore.set(e.storeId, {
        storeId: e.storeId,
        stamp: e.stamp,
        filename: e.filename,
        download: async () => {
          const url = `${origin}/file/d/${encodeURIComponent(e.fname)}`;
          const res = await fetchWithRetry(fetchImpl, url, {}, session);
          return Buffer.from(await res.arrayBuffer());
        },
      });
    }
  }
  return byStore;
}

export function createCerberusSource({
  chainId,
  username,
  password = '',
  chainGln = '',
  origin = CERBERUS_ORIGIN,
  fetchImpl = globalThis.fetch,
}) {
  if (!chainId || !username) throw new Error('createCerberusSource requires chainId and username');
  const baseOrigin = origin.replace(/\/+$/, '');

  async function listFeeds() {
    const { session, csrf } = await loginCerberus(fetchImpl, baseOrigin, username, password);
    const [storesList, priceList, promoList] = await Promise.all([
      listCerberusKind(fetchImpl, baseOrigin, session, csrf, 'Stores', chainGln),
      listCerberusKind(fetchImpl, baseOrigin, session, csrf, 'PriceFull', chainGln),
      listCerberusKind(fetchImpl, baseOrigin, session, csrf, 'PromoFull', chainGln),
    ]);
    const storesMap = pickNewestByStore(fetchImpl, baseOrigin, storesList, session);
    const storesFile = [...storesMap.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
    if (!storesFile) throw new Error(`${chainId} Stores feed not found on Cerberus (${username})`);
    return {
      chainId,
      storesFile,
      priceFiles: pickNewestByStore(fetchImpl, baseOrigin, priceList, session),
      promoFiles: pickNewestByStore(fetchImpl, baseOrigin, promoList, session),
    };
  }

  return { chainId, username, chainGln, listFeeds };
}
