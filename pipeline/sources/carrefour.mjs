// Official Carrefour Israel Price Transparency portal adapter (prices.carrefour.co.il).
// Checks both today's and yesterday's date folders so runs before ~05:15 AM still get all branches.
import { extractFileMeta } from '../parse.mjs';

const ORIGIN = 'https://prices.carrefour.co.il';
const UA = 'Mozilla/5.0 (compatible; SmartCartPriceTransparencyBot/1.0)';

async function fetchWithRetry(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
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

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function listDayEntries(queryDate) {
  const url = queryDate ? `${ORIGIN}/?date=${queryDate}` : `${ORIGIN}/`;
  const html = await (await fetchWithRetry(url)).text();
  const pathMatch = html.match(/const\s+path\s*=\s*['"]([^'"]+)['"]/);
  const filesMatch = html.match(/const\s+files\s*=\s*(\[[\s\S]*?\]);/);
  const dir = pathMatch ? pathMatch[1] : queryDate;
  if (!dir || !filesMatch) return [];
  let files = [];
  try { files = JSON.parse(filesMatch[1]); } catch { return []; }
  const out = [];
  for (const f of files) {
    const name = f?.name || '';
    const meta = extractFileMeta(name);
    if (meta) {
      out.push({ ...meta, url: `${ORIGIN}/${dir}/${encodeURIComponent(name)}` });
    }
  }
  return out;
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
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 3600 * 1000);

  const [todayEntries, yestEntries] = await Promise.all([
    listDayEntries(null),
    listDayEntries(formatYmd(yesterday)),
  ]);
  let all = [...yestEntries, ...todayEntries];
  if (!all.some((e) => /^pricefull$/i.test(e.kind))) {
    const older = await listDayEntries(formatYmd(twoDaysAgo));
    all = [...older, ...all];
  }

  const storesList = all.filter((e) => /^stores$/i.test(e.kind));
  const priceList = all.filter((e) => /^pricefull$/i.test(e.kind));
  const promoList = all.filter((e) => /^promofull$/i.test(e.kind));

  const storesMap = pickNewestByStore(storesList);
  const storesFile = [...storesMap.values()].sort((a, b) => b.stamp.localeCompare(a.stamp))[0] || null;
  if (!storesFile) throw new Error('Carrefour Stores feed not found');
  return {
    chainId: 'carrefour',
    storesFile,
    priceFiles: pickNewestByStore(priceList),
    promoFiles: pickNewestByStore(promoList),
  };
}
