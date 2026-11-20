// Common XML / gzip decoder and parsers for Israeli Price Transparency feeds
// (Stores, PriceFull) across Shufersal, Rami Levy, and Carrefour.
import zlib from 'node:zlib';
import { resolveCityName } from './cities.mjs';
import { isZip, listZipEntries } from '../web/js/zip.js';

export function decodeFeedBuffer(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  } else if (isZip(buf)) {
    // Some portals (e.g. Rami Levy's online store) publish ZIP archives with a .gz extension
    const entry = listZipEntries(buf).find((e) => /\.xml$/i.test(e.name)) || listZipEntries(buf)[0];
    if (!entry) throw new Error('Empty ZIP feed');
    buf = entry.method === 8 ? zlib.inflateRawSync(entry.data) : Buffer.from(entry.data);
  }
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.toString('utf16le');
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const copy = Buffer.from(buf);
    copy.swap16();
    text = copy.toString('utf16le');
  } else {
    const head = buf.subarray(0, 200).toString('latin1');
    if (/encoding=["']?(windows-1255|iso-8859-8)/i.test(head)) {
      text = new TextDecoder('windows-1255').decode(buf);
    } else {
      text = buf.toString('utf8');
    }
  }
  return text.replace(/^\uFEFF/, '');
}

const ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ' };
export function unescapeXml(str) {
  if (!str || !str.includes('&')) return str || '';
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return ENTITIES[ent] ?? full;
  });
}

export function normalizeStoreId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || '0';
  return s;
}

/**
 * Extract feed type, storeId, and timestamp from standard Israeli transparency filenames:
 * e.g. PriceFull7290055700007-001-416-20261118-000011.gz
 *      PriceFull7290027600007-001-202611170300.gz
 *      Stores7290058140886-000-20261116-050500.xml
 */
export function extractFileMeta(filename) {
  const base = String(filename || '').replace(/\\/g, '/').split('/').pop().split('?')[0];
  let m = base.match(/^(PriceFull|PromoFull|StoresFull|Stores)\d+-(\d+)-(\d+)-(\d{8})-?(\d*)/i);
  if (m) {
    const rawKind = m[1];
    const isStores = /^stores/i.test(rawKind);
    return {
      kind: isStores ? 'Stores' : rawKind,
      subChainId: m[2],
      storeId: isStores ? '0' : normalizeStoreId(m[3]),
      stamp: isStores ? `${m[3]}${m[4]}` : `${m[4]}${m[5] || ''}`,
      filename: base,
    };
  }
  m = base.match(/^(PriceFull|PromoFull|StoresFull|Stores)\d+-(\d+)-(\d{8,14})-?(\d*)/i);
  if (m) {
    const rawKind = m[1];
    const isStores = /^stores/i.test(rawKind);
    return {
      kind: isStores ? 'Stores' : rawKind,
      subChainId: '0',
      storeId: isStores ? '0' : normalizeStoreId(m[2]),
      stamp: `${m[3]}${m[4] || ''}`,
      filename: base,
    };
  }
  return null;
}

export function getTag(block, tagNames) {
  const names = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>/]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
    const m = block.match(re);
    if (m) return unescapeXml(m[1].trim());
  }
  return '';
}

const ONLINE_STORE_HINT_RE = /אינטרנט|אונליין|online|משלוח|ליקוט|ממ["״']?ר|קוויק|quick|וולט|wolt|פיק\s*-?\s*אפ|pickup|\.co\.il|\.co\.|\.com/i;
const DEDICATED_INTERNET_NAME_RE = /(?:^|\s|-)(אינטרנט|אונליין|online)(?:\s|-|$)/i;

export function parseStoresXml(xml, chainId, cityMap) {
  const byId = new Map();
  const storeRe = /<Store(?:\s[^>/]*)?>([\s\S]*?)<\/Store>/gi;
  let m;
  while ((m = storeRe.exec(xml)) !== null) {
    const block = m[1];
    const storeId = normalizeStoreId(getTag(block, ['StoreID', 'StoreId', 'STOREID']));
    if (!storeId) continue;
    const name = getTag(block, ['StoreName', 'STORENAME']).replace(/\s+/g, ' ').trim();
    let address = getTag(block, ['Address', 'ADDRESS']).replace(/\s+/g, ' ').trim();
    if (/^(לא ידוע|unknown|null|none|-)$/i.test(address)) address = '';
    const rawCity = getTag(block, ['City', 'CITY']);
    const city = resolveCityName(rawCity, cityMap, name);
    if (!name && !city && !address) continue;
    // StoreType 2 = online / fulfilment store (per the Price Transparency regulations), 1 = physical branch.
    // Also detect dedicated internet fulfilment stores even if tagged StoreType=1 with name "אינטרנט"/"אונליין".
    const storeType = getTag(block, ['StoreType', 'STORETYPE']).trim();
    const hasOnlineHint = ONLINE_STORE_HINT_RE.test(`${name} ${address}`);
    const isOnline = storeType === '2' || DEDICATED_INTERNET_NAME_RE.test(name);
    byId.set(storeId, {
      chain: chainId,
      storeId,
      name: name || `סניף ${storeId}`,
      address,
      city: city || 'כללי',
      type: isOnline ? 'online' : 'branch',
      _storeType: storeType,
      _hasOnlineHint: hasOnlineHint,
    });
  }

  // Nibit ERP quirk (e.g. Machsanei HaShuk): some physical franchise branches ("20 להבים", "11 עין יהב") carry
  // StoreType=2 alongside real internet stores ("97 אינטרנט", "96 אינטרנט אילת"). When a chain publishes explicit
  // online-named StoreType=2 stores, reclassify street-addressed StoreType=2 branches that lack any online hint.
  const all = [...byId.values()];
  const hasExplicitOnline = all.some((s) => s.type === 'online' && s._hasOnlineHint);
  return all.map(({ _storeType, _hasOnlineHint, ...s }) => ({
    ...s,
    type: s.type === 'online' && hasExplicitOnline && !_hasOnlineHint && Boolean(s.address) ? 'branch' : s.type,
  }));
}

export function parsePricesXml(xml) {
  const topHead = xml.slice(0, 600);
  const xmlStoreId = normalizeStoreId(getTag(topHead, ['StoreID', 'StoreId', 'STOREID']));
  const items = [];
  const itemRe = /<Item(?:\s[^>/]*)?>([\s\S]*?)<\/Item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    const code = getTag(b, ['ItemCode', 'ITEMCODE']).replace(/\s+/g, '');
    if (!code) continue;
    const price = round2(Number(getTag(b, ['ItemPrice', 'ITEMPRICE'])));
    if (!(price > 0)) continue;
    const name = (getTag(b, ['ItemName', 'ItemNm', 'ITEMNAME']) || getTag(b, ['ManufacturerItemDescription', 'ManufactureItemDescription'])).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    let manufacturer = getTag(b, ['ManufactureName', 'ManufacturerName', 'MANUFACTURENAME']).replace(/\s+/g, ' ').trim();
    if (/^(לא ידוע|unknown|null|-)$/i.test(manufacturer)) manufacturer = '';
    const qty = round2(Number(getTag(b, ['Quantity', 'QUANTITY'])) || 0);
    let unit = getTag(b, ['UnitQty', 'UnitOfMeasure', 'UNITQTY']).replace(/\s+/g, ' ').trim();
    if (/^(לא ידוע|unknown)$/i.test(unit)) unit = '';
    const weightedRaw = getTag(b, ['bIsWeighted', 'BisWeighted', 'BISWEIGHTED', 'IsWeighted']);
    const weighted = weightedRaw === '1' || /^true$/i.test(weightedRaw) ? 1 : 0;
    const unitPrice = round2(Number(getTag(b, ['UnitOfMeasurePrice', 'UNITOFMEASUREPRICE'])) || 0);

    items.push({
      code,
      name,
      manufacturer,
      qty,
      unit,
      weighted,
      price,
      unitPrice,
    });
  }
  return { xmlStoreId, items };
}

function round2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
