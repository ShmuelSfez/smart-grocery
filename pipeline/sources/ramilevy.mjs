// Official Rami Levy Price Transparency portal adapter (Cerberus web client at url.publishedprices.co.il).
import { extractFileMeta } from '../parse.mjs';

const ORIGIN = 'https://url.publishedprices.co.il';
const UA = 'Mozilla/5.0 (compatible; SmartCartPriceTransparencyBot/1.0)';

function createCookieSession() {
  const jar = new Map();
  return {
    save(res) {
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
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

async function fetchWithRetry(url, opts = {}, session = null, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = { 'user-agent': UA, ...(opts.headers || {}) };
      if (session) {
        const ck = session.header();
        if (ck) headers.cookie = ck;
      }
      const res = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(30000) });
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

async function loginRamiLevy() {
  const session = createCookieSession();
  const r1 = await fetchWithRetry(`${ORIGIN}/login`, {}, session);
  const h1 = await r1.text();
  const csrf1 = (h1.match(/name="csrftoken"\s+content="([^"]+)"/i) || [])[1] || '';

  await fetchWithRetry(`${ORIGIN}/login/user`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'RamiLevi', password: '', csrftoken: csrf1, Submit: 'Sign in' }).toString(),
  }, session);

  const r3 = await fetchWithRetry(`${ORIGIN}/file`, {}, session);
  const h3 = await r3.text();
  const csrf2 = (h3.match(/name="csrftoken"\s+content="([^"]+)"/i) || [])[1] || csrf1;
  return { session, csrf: csrf2 };
}

async function listCerberusKind(session, csrf, searchPrefix) {
  const entries = [];
  const pageSize = 500;
  let start = 0;
  for (let guard = 0; guard < 20; guard++) {
    const res = await fetchWithRetry(`${ORIGIN}/file/json/dir`, {
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

function pickNewestByStore(entries, session) {
  const byStore = new Map();
  for (const e of entries) {
    const prev = byStore.get(e.storeId);
    if (!prev || e.stamp > prev.stamp) {
      byStore.set(e.storeId, {
        storeId: e.storeId,
        stamp: e.stamp,
        filename: e.filename,
        download: async () => {
          const url = `${ORIGIN}/file/d/${encodeURIComponent(e.fname)}`;
          const res = await fetchWithRetry(url, {}, session);
          return Buffer.from(await res.arrayBuffer());
        },
      });
    }
  }
  return byStore;
}

export async function listFeeds() {
  const { session, csrf } = await loginRamiLevy();
  const [storesList, priceList, promoList] = await Promise.all([
    listCerberusKind(session, csrf, 'Stores'),
    listCerberusKind(session, csrf, 'PriceFull'),
    listCerberusKind(session, csrf, 'PromoFull'),
  ]);
  const storesMap = pickNewestByStore(storesList, session);
  const storesFile = [...storesMap.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
  if (!storesFile) throw new Error('Rami Levy Stores feed not found');
  return {
    chainId: 'ramilevy',
    storesFile,
    priceFiles: pickNewestByStore(priceList, session),
    promoFiles: pickNewestByStore(promoList, session),
  };
}
