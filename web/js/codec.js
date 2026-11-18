/* Shared list codec (classic script – used by the web app, the extension and node tests).
 * Encodes a grocery list (and optional email-only hint, NEVER passwords) into a compact URL-safe string.
 * Format: "d" + base64url(deflate(json)), "z" + base64url(deflate-raw(json)), or "p" + base64url(json).
 */
(function (root) {
  if (root.SLCodec) return;

  const MAX_DECOMPRESSED_BYTES = 262144; // 256 KB cap against decompression bombs
  const ALLOWED_IMG_HOST = /^https:\/\/(res\.cloudinary\.com|img\.rami-levy\.co\.il|([a-z0-9-]+\.)?shufersal\.co\.il)\//i;

  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function streamBytesBounded(bytes, stream, maxBytes) {
    const readable = new Blob([bytes]).stream().pipeThrough(stream);
    const reader = readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Decompressed payload exceeds limit');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

  function isSafeImgUrl(url) {
    return typeof url === 'string' && url.length < 500 && ALLOWED_IMG_HOST.test(url);
  }

  function sanitizeProduct(p) {
    if (!p || typeof p !== 'object') return null;
    const code = String(p.code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    if (!code) return null;
    const out = {
      code,
      name: String(p.name || '').slice(0, 160),
      brand: String(p.brand || '').slice(0, 80),
      img: isSafeImgUrl(p.img) ? p.img : '',
      price: String(p.price || '').slice(0, 30),
      unitDesc: String(p.unitDesc || '').slice(0, 40),
      sellingMethod: p.sellingMethod === 'BY_PACKAGE' || p.sellingMethod === 'BY_WEIGHT' ? p.sellingMethod : 'BY_UNIT',
      inStock: p.inStock !== false,
    };
    if (p.chainCodes && typeof p.chainCodes === 'object') {
      out.chainCodes = {
        shufersal: String(p.chainCodes.shufersal || code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
        ramilevy: String(p.chainCodes.ramilevy || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
      };
    }
    return out;
  }

  async function encodeList(items, auth) {
    const payload = {
      v: 1,
      i: (Array.isArray(items) ? items : []).slice(0, 200).map((it) => {
        const sp = sanitizeProduct(it && it.product);
        return sp
          ? [String(it.name || '').slice(0, 120), Number(it.qty) || 1, it.unit || 'unit', it.category || '', sp]
          : [String((it && it.name) || '').slice(0, 120), Number(it && it.qty) || 1, (it && it.unit) || 'unit', (it && it.category) || ''];
      }),
    };
    if (auth && auth.user) payload.u = String(auth.user).slice(0, 120);
    if (auth && auth.chain) payload.c = String(auth.chain).slice(0, 20);
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (canCompress) {
      try {
        return 'd' + bytesToB64url(await streamBytesBounded(bytes, new CompressionStream('deflate'), MAX_DECOMPRESSED_BYTES));
      } catch (e) { /* fall through */ }
    }
    return 'p' + bytesToB64url(bytes);
  }

  async function decodePayload(code) {
    code = decodeURIComponent(String(code || '').trim());
    if (!code || code.length > 32768) throw new Error('Invalid list payload size');
    const kind = code[0];
    let bytes = b64urlToBytes(code.slice(1));
    if (kind === 'd') bytes = await streamBytesBounded(bytes, new DecompressionStream('deflate'), MAX_DECOMPRESSED_BYTES);
    else if (kind === 'z') bytes = await streamBytesBounded(bytes, new DecompressionStream('deflate-raw'), MAX_DECOMPRESSED_BYTES);
    else if (kind !== 'p') throw new Error('Unknown list format');
    if (bytes.byteLength > MAX_DECOMPRESSED_BYTES) throw new Error('Payload too large');
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || payload.v !== 1 || !Array.isArray(payload.i)) throw new Error('Bad list payload');
    const items = [];
    for (const entry of payload.i.slice(0, 200)) {
      if (!Array.isArray(entry)) continue;
      const [name, qty, unit, category, product] = entry;
      const cleanName = String(name || '').trim().slice(0, 120);
      if (!cleanName) continue;
      const out = {
        name: cleanName,
        qty: Math.max(0.01, Math.min(1000, Number(qty) || 1)),
        unit: ['unit', 'kg', 'g', 'pack'].includes(unit) ? unit : 'unit',
        category: String(category || '').slice(0, 30),
      };
      const sp = sanitizeProduct(product);
      if (sp) out.product = sp;
      items.push(out);
    }
    const user = typeof payload.u === 'string' ? payload.u.slice(0, 120) : '';
    const chain = typeof payload.c === 'string' ? payload.c.slice(0, 20) : '';
    return { items, auth: user || chain ? { user, chain } : null };
  }

  async function decodeList(code) {
    const { items } = await decodePayload(code);
    return items;
  }

  root.SLCodec = { encodeList, decodeList, decodePayload, sanitizeProduct, isSafeImgUrl };
})(typeof globalThis !== 'undefined' ? globalThis : window);
