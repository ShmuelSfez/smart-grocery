// Static server for web/ + Multi-Supermarket catalog proxy (/api/search) + Real-time Family Sync (/api/room)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'web');
const PORT = Number(process.env.PORT || process.argv[2]) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip',
};

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' https://res.cloudinary.com https://*.shufersal.co.il https://img.rami-levy.co.il data:; connect-src 'self' https://generativelanguage.googleapis.com; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
};

const SEARCH_CACHE = new Map();
const IN_FLIGHT = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT = new Map();
const MAX_REQ_PER_MIN = 120;

// Real-time family sync rooms: roomId -> { updatedAt, list, chain }
const FAMILY_ROOMS = new Map();

function allowRate(ip) {
  const now = Date.now();
  if (RATE_LIMIT.size > 2000) {
    for (const [k, v] of RATE_LIMIT) if (now > v.resetAt) RATE_LIMIT.delete(k);
    if (RATE_LIMIT.size > 2000) RATE_LIMIT.delete(RATE_LIMIT.keys().next().value);
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
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve([]); }
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
          resolve(items);
        } catch { resolve([]); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
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
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve([]); }
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
          resolve(items);
        } catch { resolve([]); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
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

async function fetchMultiSearch(query, limit = 10) {
  const key = `multi::${query}::${limit}`;
  const cached = SEARCH_CACHE.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
  if (IN_FLIGHT.has(key)) return IN_FLIGHT.get(key);

  const p = Promise.all([fetchShufersal(query, limit), fetchRamiLevy(query, limit)])
    .then(([shuf, rami]) => {
      const data = buildMultiChainResults(shuf, rami, limit);
      if (SEARCH_CACHE.size > 500) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
      SEARCH_CACHE.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => IN_FLIGHT.delete(key));

  IN_FLIGHT.set(key, p);
  return p;
}

function extractSheetExportUrl(input) {
  const raw = String(input || '').trim();
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,80})/) || raw.match(/^([a-zA-Z0-9_-]{25,80})$/);
  if (!idMatch) return null;
  const gidMatch = raw.match(/[#&?]gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gidMatch ? gidMatch[1] : '0'}`;
}

function fetchGoogleCsv(targetUrl, hops = 0) {
  if (hops > 4) return Promise.reject(new Error('Too many redirects'));
  const parsed = new URL(targetUrl);
  if (!/(^|\.)(google\.com|googleusercontent\.com)$/i.test(parsed.hostname)) {
    return Promise.reject(new Error('Blocked redirect host'));
  }
  if (parsed.hostname === 'accounts.google.com') {
    return Promise.reject(new Error('PRIVATE_SHEET'));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, { timeout: 8000, headers: { 'user-agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchGoogleCsv(new URL(res.headers.location, targetUrl).toString(), hops + 1));
      }
      if (res.statusCode === 401 || res.statusCode === 403) { res.resume(); return reject(new Error('PRIVATE_SHEET')); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP_' + res.statusCode)); }
      if ((res.headers['content-type'] || '').includes('text/html')) { res.resume(); return reject(new Error('PRIVATE_SHEET')); }
      let raw = '';
      res.on('data', (c) => { raw += c; if (raw.length > 1_500_000) req.destroy(new Error('Sheet too large')); });
      res.on('end', () => resolve(raw));
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 512_000) req.destroy(new Error('Payload too large')); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const ip = (req.socket.remoteAddress || 'local').toString();
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/api/search') {
    if (!allowRate(ip)) {
      res.writeHead(429, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Too many requests' }));
    }
    const q = (u.searchParams.get('q') || '').trim().slice(0, 80);
    const limit = Math.max(1, Math.min(20, Number(u.searchParams.get('limit')) || 10));
    if (!q) {
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end('[]');
    }
    try {
      const results = await fetchMultiSearch(q, limit);
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(JSON.stringify(results));
    } catch {
      res.writeHead(502, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Search unavailable' }));
    }
  }

  // Google Sheets public CSV export fetcher (/api/sheet?url=...)
  if (u.pathname === '/api/sheet') {
    if (!allowRate(ip)) {
      res.writeHead(429, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Too many requests' }));
    }
    const exportUrl = extractSheetExportUrl(u.searchParams.get('url') || '');
    if (!exportUrl) {
      res.writeHead(400, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'INVALID_URL' }));
    }
    try {
      const csv = await fetchGoogleCsv(exportUrl);
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ csv }));
    } catch (e) {
      const code = e.message === 'PRIVATE_SHEET' ? 403 : 502;
      res.writeHead(code, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message === 'PRIVATE_SHEET' ? 'PRIVATE_SHEET' : 'FETCH_FAILED' }));
    }
  }

  // Real-Time Family Sync API (/api/room?id=...)
  if (u.pathname === '/api/room') {
    if (!allowRate(ip)) {
      res.writeHead(429, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Too many requests' }));
    }
    const roomId = (u.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    if (!roomId || roomId.length < 16) {
      res.writeHead(400, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'Invalid room ID' }));
    }
    if (req.method === 'GET') {
      const room = FAMILY_ROOMS.get(roomId) || { updatedAt: 0, list: [], selectedChain: 'auto' };
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(room));
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        if (FAMILY_ROOMS.size > 1000 && !FAMILY_ROOMS.has(roomId)) {
          FAMILY_ROOMS.delete(FAMILY_ROOMS.keys().next().value);
        }
        const cleanItems = (Array.isArray(body.list) ? body.list : []).slice(0, 200)
          .filter((it) => it && typeof it === 'object' && String(it.name || '').trim())
          .map((it) => ({
            id: String(it.id || '').slice(0, 64),
            name: String(it.name || '').trim().slice(0, 120),
            qty: Math.max(0.01, Math.min(1000, Number(it.qty) || 1)),
            unit: ['unit', 'kg', 'g', 'pack'].includes(it.unit) ? it.unit : 'unit',
            category: String(it.category || '').slice(0, 30),
            note: String(it.note || '').trim().slice(0, 120),
            checked: it.checked !== false,
            product: it.product && typeof it.product === 'object' ? it.product : null,
            addedAt: Number(it.addedAt) || Date.now(),
          }));
        const state = {
          updatedAt: Date.now(),
          list: cleanItems,
          selectedChain: String(body.selectedChain || 'auto').slice(0, 20),
        };
        FAMILY_ROOMS.set(roomId, state);
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, updatedAt: state.updatedAt }));
      } catch {
        res.writeHead(400, { ...SEC_HEADERS, 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }
  }

  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    res.writeHead(400, SEC_HEADERS); return res.end('Bad request');
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + p);
  if ((file !== ROOT && !file.startsWith(ROOT + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SEC_HEADERS); return res.end('Not found');
  }
  res.writeHead(200, { ...SEC_HEADERS, 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store, no-cache, must-revalidate' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`העגלה החכמה running at http://localhost:${PORT}`));
