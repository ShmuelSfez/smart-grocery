// Minimal zero-dependency ZIP reader with archive/entry/encryption/ZIP64 safety bounds.
// Used by `pipeline/parse.mjs` (for ZIP-in-.gz feeds) and `web/js/xlsx.js` (with tighter browser caps).

export function isZip(bytes) {
  return Boolean(
    bytes
    && bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && bytes[2] === 0x03
    && bytes[3] === 0x04,
  );
}

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

/**
 * List entries of a ZIP archive with strict bounds checking.
 * @param {Uint8Array} bytes
 * @param {object} [opts]
 * @param {number} [opts.maxArchiveBytes=67108864]
 * @param {number} [opts.maxEntries=128]
 * @param {number} [opts.maxEntryBytes=67108864]
 */
export function listZipEntries(bytes, opts = {}) {
  const maxArchiveBytes = opts.maxArchiveBytes ?? 64 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 128;
  const maxEntryBytes = opts.maxEntryBytes ?? 64 * 1024 * 1024;

  if (!isZip(bytes)) throw new Error('Not a ZIP archive');
  if (bytes.length > maxArchiveBytes) {
    throw new Error(`ZIP archive exceeds maximum allowed size (${maxArchiveBytes} bytes)`);
  }

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP central directory not found');

  const count = u16(bytes, eocd + 10);
  if (count === 0xffff) throw new Error('ZIP64 archives are not supported');
  if (count > maxEntries) throw new Error(`ZIP archive has too many entries (${count} > ${maxEntries})`);

  let p = u32(bytes, eocd + 16);
  if (p === 0xffffffff || p >= bytes.length) throw new Error('Invalid ZIP central directory offset');

  const dec = new TextDecoder('utf-8');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) {
      throw new Error('Bad ZIP central directory entry');
    }
    const gpFlags = u16(bytes, p + 8);
    if ((gpFlags & 1) !== 0) throw new Error('Encrypted ZIP archives are not supported');

    const method = u16(bytes, p + 10);
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    if (compSize === 0xffffffff || size === 0xffffffff) {
      throw new Error('ZIP64 entries are not supported');
    }
    if (size > maxEntryBytes) {
      throw new Error(`ZIP entry uncompressed size (${size}) exceeds limit (${maxEntryBytes})`);
    }

    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    if (p + 46 + nameLen > bytes.length) throw new Error('Truncated ZIP entry header');

    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (localOff + 30 > bytes.length || u32(bytes, localOff) !== 0x04034b50) {
      throw new Error('Bad ZIP local header');
    }
    const start = localOff + 30 + u16(bytes, localOff + 26) + u16(bytes, localOff + 28);
    if (start + compSize > bytes.length) {
      throw new Error('Truncated ZIP entry payload');
    }
    if (name.endsWith('/')) continue;
    out.push({ name, method, size, data: bytes.subarray(start, start + compSize) });
  }
  return out;
}
