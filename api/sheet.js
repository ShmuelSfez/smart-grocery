// Vercel / serverless endpoint for /api/sheet?url=... (strictly allows Google Sheets CSV export URLs only)
import https from 'node:https';

const RATE_LIMIT = new Map();
const MAX_REQ_PER_MIN = 40;

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

export function extractSheetExportUrl(input) {
  const raw = String(input || '').trim();
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,80})/) || raw.match(/^([a-zA-Z0-9_-]{25,80})$/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const gidMatch = raw.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
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
    const req = https.get(targetUrl, {
      timeout: 8000,
      headers: { 'user-agent': 'Mozilla/5.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        return resolve(fetchGoogleCsv(nextUrl, hops + 1));
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        return reject(new Error('PRIVATE_SHEET'));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP_' + res.statusCode));
      }
      const ct = res.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        res.resume();
        return reject(new Error('PRIVATE_SHEET'));
      }
      let raw = '';
      res.on('data', (c) => {
        raw += c;
        if (raw.length > 1_500_000) req.destroy(new Error('Sheet too large'));
      });
      res.on('end', () => resolve(raw));
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const ip = (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'anon').toString().split(',')[0].trim();
  if (!allowRate(ip)) return res.status(429).json({ error: 'Too many requests' });

  const exportUrl = extractSheetExportUrl(req.query?.url || '');
  if (!exportUrl) return res.status(400).json({ error: 'INVALID_URL' });

  try {
    const csv = await fetchGoogleCsv(exportUrl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).json({ csv });
  } catch (e) {
    if (e.message === 'PRIVATE_SHEET') return res.status(403).json({ error: 'PRIVATE_SHEET' });
    return res.status(502).json({ error: 'FETCH_FAILED' });
  }
}
