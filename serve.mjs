// Local development server for web/ + local data/v1/ price feeds + /api/sheet + dev-only /api/room.
// Zero server-side scraping of supermarket websites.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSheetExportUrl, fetchGoogleCsv } from './api/sheet.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const WEB_ROOT = path.join(REPO_ROOT, 'web');
const DATA_V1_ROOT = path.join(REPO_ROOT, 'data', 'v1');
const PORT = Number(process.env.PORT || process.argv[2]) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.zip': 'application/zip',
};

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "default-src 'self'; img-src 'self' https://res.cloudinary.com https://*.shufersal.co.il https://img.rami-levy.co.il data:; connect-src 'self' https://shmuelsfez.github.io https://generativelanguage.googleapis.com; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
};

const RATE_LIMIT = new Map();
const MAX_REQ_PER_MIN = 180;
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

function serveStaticFrom(baseDir, relPath, res, cacheControl) {
  const file = path.resolve(baseDir, '.' + relPath);
  if ((file !== baseDir && !file.startsWith(baseDir + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SEC_HEADERS);
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    ...SEC_HEADERS,
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': cacheControl,
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const ip = (req.socket.remoteAddress || 'local').toString();
  const u = new URL(req.url, 'http://localhost');

  // Google Sheets public CSV export fetcher (/api/sheet?url=...) – shared with api/sheet.js
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

  // Local-dev Family Sync API (/api/room?id=...)
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
    res.writeHead(400, SEC_HEADERS);
    return res.end('Bad request');
  }

  // Serve locally built Price Transparency files (/data/v1/*) during development
  if (p.startsWith('/data/v1/')) {
    const sub = p.slice('/data/v1'.length);
    return serveStaticFrom(DATA_V1_ROOT, sub, res, 'public, max-age=60');
  }

  if (p.endsWith('/')) p += 'index.html';
  return serveStaticFrom(WEB_ROOT, p, res, 'no-store, no-cache, must-revalidate');
}).listen(PORT, () => console.log(`העגלה החכמה running at http://localhost:${PORT}`));
