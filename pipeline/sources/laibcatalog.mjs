// Shared official LaibCatalog (Nibit) Price Transparency portal adapter (https://laibcatalog.co.il).
// Hosts Victory (7290696200003) and Machsanei HaShuk (7290661400001) via /webapi/api/getfiles?edi=<GLN>
// (with HTML table link fallback for NBCompetitionRegulations.aspx).
import { extractFileMeta } from '../parse.mjs';

export const LAIB_ORIGIN = 'https://laibcatalog.co.il';
const UA = 'Mozilla/5.0 (compatible; SmartCartPriceTransparencyBot/1.0)';

async function fetchWithRetry(fetchImpl, url, opts = {}, retries = 2, timeoutMs = 45000) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchImpl(url, {
        ...opts,
        headers: { 'user-agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

export function parseLaibFilesPayload(entries, chainGln, origin = LAIB_ORIGIN) {
  const baseOrigin = origin.replace(/\/+$/, '');
  const out = [];
  for (const row of Array.isArray(entries) ? entries : []) {
    const fileName = String(row?.fileName || row?.name || '').trim();
    if (!fileName) continue;
    if (chainGln && !fileName.includes(chainGln)) continue;
    const meta = extractFileMeta(fileName);
    if (!meta) continue;
    out.push({
      ...meta,
      url: `${baseOrigin}/webapi/${encodeURIComponent(chainGln)}/${encodeURIComponent(fileName)}`,
    });
  }
  return out;
}

export function parseLaibHtmlLinks(html, chainGln, origin = LAIB_ORIGIN) {
  const baseOrigin = origin.replace(/\/+$/, '');
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/href=['"]([^'"]*(?:CompetitionRegulationsFiles|webapi)[^'"]+)['"]/gi)) {
    const rawHref = m[1].replace(/&amp;/g, '&').replace(/\\/g, '/').replace(/^\/+/, '');
    if (chainGln && !rawHref.includes(chainGln)) continue;
    const meta = extractFileMeta(rawHref);
    if (!meta) continue;
    const url = /^https?:\/\//i.test(rawHref) ? rawHref : `${baseOrigin}/${rawHref}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ ...meta, url });
  }
  return out;
}

function pickNewestByStore(entries, fetchImpl) {
  const byStore = new Map();
  for (const e of entries) {
    const prev = byStore.get(e.storeId);
    if (!prev || e.stamp > prev.stamp) {
      byStore.set(e.storeId, {
        storeId: e.storeId,
        stamp: e.stamp,
        filename: e.filename,
        download: async () => Buffer.from(await (await fetchWithRetry(fetchImpl, e.url, {}, 2, 30000)).arrayBuffer()),
      });
    }
  }
  return byStore;
}

export function createLaibCatalogSource({
  chainId,
  chainGln,
  origin = LAIB_ORIGIN,
  fetchImpl = globalThis.fetch,
}) {
  if (!chainId || !chainGln) throw new Error('createLaibCatalogSource requires chainId and chainGln');
  const baseOrigin = origin.replace(/\/+$/, '');

  async function listFeeds() {
    let entries = [];
    const apiUrl = `${baseOrigin}/webapi/api/getfiles?edi=${encodeURIComponent(chainGln)}`;
    const res = await fetchWithRetry(fetchImpl, apiUrl, {}, 2, 45000);
    const contentType = res.headers?.get?.('content-type') || '';
    const text = await res.text();
    if (/json/i.test(contentType) || text.trim().startsWith('[')) {
      entries = parseLaibFilesPayload(JSON.parse(text), chainGln, baseOrigin);
    } else {
      entries = parseLaibHtmlLinks(text, chainGln, baseOrigin);
    }

    const storesList = entries.filter((e) => /^stores$/i.test(e.kind));
    const priceList = entries.filter((e) => /^pricefull$/i.test(e.kind));
    const promoList = entries.filter((e) => /^promofull$/i.test(e.kind));

    const storesMap = pickNewestByStore(storesList, fetchImpl);
    const storesFile = [...storesMap.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
    if (!storesFile) throw new Error(`${chainId} Stores feed not found on LaibCatalog (${chainGln})`);

    return {
      chainId,
      storesFile,
      priceFiles: pickNewestByStore(priceList, fetchImpl),
      promoFiles: pickNewestByStore(promoList, fetchImpl),
    };
  }

  return { chainId, chainGln, listFeeds };
}
