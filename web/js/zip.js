// Minimal zero-dependency ZIP reader (used by the pipeline for ZIP-in-.gz feeds and by the .xlsx importer).
// Pure and synchronous: it only locates entries. The caller inflates DEFLATE data with its own
// inflater (zlib.inflateRawSync in Node, DecompressionStream('deflate-raw') in the browser).

export function isZip(bytes) {
  return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

/**
 * List entries of a ZIP archive.
 * @returns {Array<{name: string, method: number, size: number, data: Uint8Array}>}
 *          `data` is the raw (possibly DEFLATE-compressed) payload; method 0 = stored, 8 = deflate.
 */
export function listZipEntries(bytes) {
  if (!isZip(bytes)) throw new Error('Not a ZIP archive');
  // End Of Central Directory record: scan backwards (comment can be up to 65535 bytes)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP central directory not found');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const dec = new TextDecoder('utf-8');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('Bad ZIP central directory entry');
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (u32(bytes, localOff) !== 0x04034b50) throw new Error('Bad ZIP local header');
    const start = localOff + 30 + u16(bytes, localOff + 26) + u16(bytes, localOff + 28);
    if (name.endsWith('/')) continue;
    out.push({ name, method, size, data: bytes.subarray(start, start + compSize) });
  }
  return out;
}
