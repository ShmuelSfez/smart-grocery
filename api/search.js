// Vercel / serverless endpoint for Multi-Supermarket /api/search?q=...
// Note: never invents prices, fallbacks, or sponsored flags. Removed completely in Phase B once static feeds are live.
import https from 'node:https';

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT = new Map();
const MAX_REQ_PER_MIN = 120;

function allowRate(ip) {
  const now = Date.now();
  if (RATE_LIMIT.size > 2000) {
    for (const [k, v] of RATE_LIMIT) if (now > v.resetAt) RATE_LIMIT.delete(k);
  }
  const entry = RATE_LIMIT.get(ip);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_REQ_PER_MIN;
}

function pickShufImage(images) {
  if (!Array.isArray(images) || !images.length) return '';
  for (const f of ['product', 'medium', 'small', 'large', 'thumbnail']) {
    const img = images.find((i) => i.format === f && i.url);
    if (img) return img.url.startsWith('//') ? 'https:' + img.url : img.url;
  }
  return images[0]?.url || '';
}

function parsePriceNum(val) {
  if (typeof val === 'number') return val;
  const m = String(val || '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function fetchShufersal(query, limit = 10) {
  const url = `https://www.shufersal.co.il/online/he/search/results?q=${encodeURIComponent(query)}:relevance&limit=${limit}&page=0`;
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout: 7000,
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://www.shufersal.co.il/online/he/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        const st = res.statusCode;
        res.resume();
        return resolve({ status: st, items: [] });
      }
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const items = (data.results || []).map((p) => {
            const priceNum = (p.price && typeof p.price.value === 'number') ? p.price.value : parsePriceNum(p.price?.formattedValue);
            const brand = (p.brand && p.brand.name) || '';
            const barcode = String(p.code || '').replace(/^P_/, '');
            return {
              chain: 'shufersal',
              code: p.code,
              barcode,
              name: p.name,
              brand,
              img: pickShufImage(p.images),
              priceNum,
              price: priceNum ? `${priceNum.toFixed(2)} ₪` : (p.price?.formattedValue || ''),
              unitDesc: p.unitDescription || '',
              sellingMethod: (p.sellingMethod && p.sellingMethod.code) || 'BY_UNIT',
              inStock: !(p.stock && p.stock.stockLevelStatus) || p.stock.stockLevelStatus.code === 'inStock',
              purchasable: p.purchasable !== false,
              sponsored: false,
            };
          }).filter((p) => p.purchasable);
          resolve({ status: 200, items });
        } catch { resolve({ status: 'parse_err', items: [] }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', items: [] }); });
    req.on('error', (e) => resolve({ status: e.code || 'err', items: [] }));
  });
}

function fetchRamiLevy(query, limit = 10) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ q: query, store: 331 });
    const req = https.request('https://www.rami-levy.co.il/api/catalog', {
      method: 'POST',
      timeout: 7000,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'content-length': Buffer.byteLength(payload),
        accept: 'application/json, text/plain, */*',
        'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
        origin: 'https://www.rami-levy.co.il',
        referer: 'https://www.rami-levy.co.il/he/online/market',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        const st = res.statusCode;
        res.resume();
        return resolve({ status: st, items: [] });
      }
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > 2_000_000) req.destroy(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const items = (data.data || []).slice(0, limit).map((p) => {
            const priceNum = Number(p.price?.price) || 0;
            const brand = (p.gs && p.gs.BrandName ? String(p.gs.BrandName).trim() : '') || '';
            const small = p.images && p.images.small ? `https://img.rami-levy.co.il${p.images.small}` : '';
            const byKg = p.prop && (p.prop.sw_shakil === 1 || p.prop.by_kilo === 1);
            return {
              chain: 'ramilevy',
              code: String(p.id),
              barcode: String(p.barcode || p.id),
              name: p.name || '',
              brand,
              img: small,
              priceNum,
              price: priceNum ? `${priceNum.toFixed(2)} ₪` : '',
              unitDesc: byKg ? 'לפי משקל (ק"ג)' : 'יחידה',
              sellingMethod: byKg ? 'BY_WEIGHT' : 'BY_UNIT',
              inStock: p.prop ? p.prop.status !== 0 : true,
              purchasable: true,
              sponsored: false,
            };
          }).filter((p) => p.priceNum > 0);
          resolve({ status: 200, items });
        } catch { resolve({ status: 'parse_err', items: [] }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', items: [] }); });
    req.on('error', (e) => resolve({ status: e.code || 'err', items: [] }));
    req.write(payload);
    req.end();
  });
}

function buildMultiChainResults(shufItems, ramiItems, limit = 10) {
  // Real prices only: a chain gets a price only for the exact same barcode. Nothing is estimated.
  const ramiByBarcode = new Map(ramiItems.map((r) => [r.barcode, r]));
  const shufByBarcode = new Map(shufItems.map((s) => [s.barcode, s]));
  const seen = new Set();
  const merged = [];
  for (const item of [...shufItems, ...ramiItems]) {
    if (seen.has(item.barcode)) continue;
    seen.add(item.barcode);
    const shufMatch = shufByBarcode.get(item.barcode);
    const ramiMatch = ramiByBarcode.get(item.barcode);
    const chainPrices = {};
    const chainCodes = {};
    if (shufMatch && shufMatch.priceNum > 0) { chainPrices.shufersal = shufMatch.priceNum; chainCodes.shufersal = shufMatch.code; }
    if (ramiMatch && ramiMatch.priceNum > 0) { chainPrices.ramilevy = ramiMatch.priceNum; chainCodes.ramilevy = ramiMatch.code; }
    merged.push({
      ...item,
      sponsored: false,
      img: item.img || shufMatch?.img || ramiMatch?.img || '',
      brand: item.brand || shufMatch?.brand || ramiMatch?.brand || '',
      chainPrices,
      chainCodes,
    });
    if (merged.length >= limit) break;
  }
  merged.sort((a, b) => b.inStock - a.inStock);
  return merged;
}

export default async function handler(req, res) {
  const ip = (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'anon').toString().split(',')[0].trim();
  if (!allowRate(ip)) return res.status(429).json({ error: 'Too many requests' });

  const q = String(req.query?.q || '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 10));
  if (!q) return res.status(200).json([]);
  try {
    const key = `multi::${q}::${limit}`;
    const cached = SEARCH_CACHE.get(key);
    let results;
    let sourceHeader = 'cache';
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      results = cached.data;
    } else {
      const [shuf, rami] = await Promise.all([fetchShufersal(q, limit), fetchRamiLevy(q, limit)]);
      sourceHeader = `shuf:${shuf.status}(${shuf.items.length}),rami:${rami.status}(${rami.items.length})`;
      results = buildMultiChainResults(shuf.items, rami.items, limit);
      if (results.length) {
        if (SEARCH_CACHE.size > 500) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
        SEARCH_CACHE.set(key, { ts: Date.now(), data: results });
      }
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Sources', sourceHeader);
    return res.status(200).json(results);
  } catch {
    return res.status(502).json({ error: 'Search unavailable' });
  }
}
