// Official Shufersal Price Transparency portal adapter (prices.shufersal.co.il -> Azure Blob Storage).
import { extractFileMeta } from '../parse.mjs';

const PORTAL = 'https://prices.shufersal.co.il/FileObject/UpdateCategory';
const UA = 'Mozilla/5.0 (compatible; SmartCartPriceTransparencyBot/1.0)';

async function fetchWithRetry(url, opts = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'user-agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(30000),
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

async function listCategoryLinks(catId, maxPages = 45) {
  const entries = [];
  const seenUrls = new Set();
  const batchSize = catId === 5 ? 1 : 6;
  for (let start = 1; start <= maxPages; start += batchSize) {
    const pages = [];
    for (let p = start; p < start + batchSize && p <= maxPages; p++) pages.push(p);
    const htmlList = await Promise.all(
      pages.map((page) =>
        fetchWithRetry(`${PORTAL}?catID=${catId}&storeId=0&page=${page}`)
          .then((r) => r.text())
          .catch(() => ''),
      ),
    );
    let addedInBatch = 0;
    let emptyPageHit = false;
    for (const html of htmlList) {
      const links = [...html.matchAll(/href="(https:\/\/pricesprodpublic\.blob\.core\.windows\.net\/[^"]+)"/gi)]
        .map((m) => m[1].replace(/&amp;/g, '&'));
      if (!links.length) {
        emptyPageHit = true;
        continue;
      }
      for (const href of links) {
        const cleanKey = href.split('?')[0];
        if (seenUrls.has(cleanKey)) continue;
        seenUrls.add(cleanKey);
        const meta = extractFileMeta(href);
        if (meta) {
          entries.push({ ...meta, url: href });
          addedInBatch++;
        }
      }
    }
    if (emptyPageHit || addedInBatch === 0) break;
  }
  return entries;
}

function pickNewestByStore(entries) {
  const byStore = new Map();
  for (const e of entries) {
    const prev = byStore.get(e.storeId);
    if (!prev || e.stamp > prev.stamp) {
      byStore.set(e.storeId, {
        storeId: e.storeId,
        stamp: e.stamp,
        filename: e.filename,
        download: async () => Buffer.from(await (await fetchWithRetry(e.url)).arrayBuffer()),
      });
    }
  }
  return byStore;
}

export async function listFeeds() {
  const [storesList, priceList, promoList] = await Promise.all([
    listCategoryLinks(5, 3),
    listCategoryLinks(2, 45),
    listCategoryLinks(4, 45),
  ]);
  const storesMap = pickNewestByStore(storesList);
  const storesFile = [...storesMap.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
  if (!storesFile) throw new Error('Shufersal Stores feed not found');
  return {
    chainId: 'shufersal',
    storesFile,
    priceFiles: pickNewestByStore(priceList),
    promoFiles: pickNewestByStore(promoList),
  };
}
