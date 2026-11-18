// Unit tests for the Price Transparency pipeline, promotions, city mapping,
// Q15 hybrid cross-chain matching, and SLCodec decompression size caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { loadLocalCityMap, resolveCityName } from '../pipeline/cities.mjs';
import { decodeFeedBuffer, extractFileMeta, parseStoresXml, parsePricesXml } from '../pipeline/parse.mjs';
import { parsePromosXml } from '../pipeline/promos.mjs';
import { buildCatalogBundle, searchCatalogProducts, matchLineAcrossChains } from '../web/js/prices.js';
import { compareBasket } from '../web/js/pricing.js';

await import('../web/js/codec.js');
const { decodePayload, sanitizeProduct } = globalThis.SLCodec;

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('cities: maps numeric CBS locality codes and normalizes aliases', () => {
  const cityMap = loadLocalCityMap();
  assert.equal(resolveCityName('6400', cityMap), 'הרצליה');
  assert.equal(resolveCityName('03000', cityMap), 'ירושלים');
  assert.equal(resolveCityName('5000', cityMap), 'תל אביב-יפו');
  assert.equal(resolveCityName('פתח תקוה', cityMap), 'פתח תקווה');
  assert.equal(resolveCityName('קריית אתא', cityMap), 'קרית אתא');
});

test('parse: decodes gzip + UTF-16LE feeds and parses Stores and PriceFull XML', () => {
  const cityMap = loadLocalCityMap();
  const storesXml = fs.readFileSync(path.join(FIXTURES, 'stores-sample.xml'), 'utf8');

  // Verify UTF-16LE + gzip round-trip (as used by Carrefour Stores files)
  const utf16WithBom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(storesXml, 'utf16le')]);
  const gzBuf = zlib.gzipSync(utf16WithBom);
  assert.equal(decodeFeedBuffer(gzBuf).slice(0, 5), '<?xml');

  const stores = parseStoresXml(decodeFeedBuffer(gzBuf), 'shufersal', cityMap);
  assert.equal(stores.length, 3);
  assert.deepEqual(stores[0], {
    chain: 'shufersal',
    storeId: '374',
    name: 'שלי הרצליה- הבנים',
    address: 'הבנים 46',
    city: 'הרצליה',
  });
  assert.equal(stores[2].city, 'פתח תקווה');

  const pricesXml = fs.readFileSync(path.join(FIXTURES, 'prices-sample.xml'), 'utf8');
  const { xmlStoreId, items } = parsePricesXml(pricesXml);
  assert.equal(xmlStoreId, '1');
  assert.equal(items.length, 2); // zero-priced item 99999 dropped
  assert.deepEqual(items[0], {
    code: '7290004127329',
    name: "קוטג' 5% שומן 250 גרם",
    manufacturer: 'תנובה',
    qty: 250,
    unit: 'גרם',
    weighted: 0,
    price: 5.8,
    unitPrice: 2.32,
  });
  assert.equal(items[1].weighted, 1);
  assert.equal(items[1].manufacturer, '');

  assert.deepEqual(extractFileMeta('PriceFull7290055700007-001-416-20261118-000011.gz'), {
    kind: 'PriceFull',
    subChainId: '001',
    storeId: '416',
    stamp: '20261118000011',
    filename: 'PriceFull7290055700007-001-416-20261118-000011.gz',
  });
});

test('promos: keeps active all-customer deals and drops club-only, coupon, expired, and conditional promos', () => {
  const promosXml = fs.readFileSync(path.join(FIXTURES, 'promos-sample.xml'), 'utf8');
  const { promosByItem, stats } = parsePromosXml(promosXml, { now: new Date('2026-11-18T10:00:00Z') });

  assert.equal(stats.total, 6);
  assert.equal(stats.kept, 2);
  assert.equal(stats.clubSkipped, 1);
  assert.equal(stats.couponSkipped, 1);
  assert.equal(stats.expiredSkipped, 1);
  assert.equal(stats.conditionalSkipped, 1);

  assert.deepEqual(promosByItem.get('7290004127329'), { type: 'bundle', qty: 2, price: 10 });
  assert.deepEqual(promosByItem.get('7290000066318'), { type: 'price', price: 8.9 });
});

test('prices + compareBasket: Q15 hybrid matching (exact barcode, substitute, missing, head-noun ranking)', () => {
  const branchData = {
    shufersal: {
      catalog: buildCatalogBundle({
        '7290027600011': ['חלב טרי שופרסל 3% 1 ליטר', 'שופרסל', 1, 'ליטר', 0],
        '7290004127329': ["קוטג' 5% 250 גרם", 'תנובה', 250, 'גרם', 0],
        '7290000000999': ['שוקולד חלב מעולה', 'עלית', 100, 'גרם', 0],
        '101': ['עגבניה חממה', '', 1, 'ק"ג', 1],
      }),
      storePrices: {
        '7290027600011': [6.9, 6.9],
        '7290004127329': [6.2, 2.48, { type: 'bundle', qty: 2, price: 11.0 }],
        '7290000000999': [7.5, 7.5],
        '101': [7.9, 7.9],
      },
    },
    ramilevy: {
      catalog: buildCatalogBundle({
        '7290004131074': ['חלב טרי 3% בקרטון 1 ליטר', 'תנובה', 1, 'ליטר', 0],
        '7290004127329': ["קוטג' תנובה 5% 250 גרם", 'תנובה', 250, 'גרם', 0],
        '202': ['עגבניה שקיל', '', 1, 'ק"ג', 1],
      }),
      storePrices: {
        '7290004131074': [6.8, 6.8],
        '7290004127329': [5.8, 2.32],
        '202': [5.9, 5.9],
      },
    },
    carrefour: {
      catalog: buildCatalogBundle({
        '7290004131074': ['חלב טרי 3% 1 ליטר', 'תנובה', 1, 'ליטר', 0],
      }),
      storePrices: {
        '7290004131074': [6.7, 6.7],
      },
    },
  };

  // Search ranks head-noun "חלב טרי..." above "שוקולד חלב"
  const milkResults = searchCatalogProducts('חלב', branchData);
  assert.ok(milkResults.length >= 2);
  assert.ok(milkResults[0].name.startsWith('חלב'));

  // Pinned private-label milk (7290027600011): exact in Shufersal, substitute in Rami Levy & Carrefour
  const pinnedMilkLine = {
    id: 'm1',
    name: 'חלב 3%',
    qty: 1,
    unit: 'unit',
    product: { code: '7290027600011', barcode: '7290027600011', name: 'חלב טרי שופרסל 3% 1 ליטר', weighted: false },
  };
  const milkMatches = matchLineAcrossChains(pinnedMilkLine, branchData);
  assert.equal(milkMatches.shufersal.kind, 'exact');
  assert.equal(milkMatches.ramilevy.kind, 'substitute');
  assert.equal(milkMatches.carrefour.kind, 'substitute');

  // Generic plural "עגבניות" matches singular weighted "עגבניה" in Shufersal & Rami Levy, missing in Carrefour
  const tomLine = { id: 't1', name: 'עגבניות', qty: 1.5, unit: 'kg', product: null };
  const tomMatches = matchLineAcrossChains(tomLine, branchData);
  assert.equal(tomMatches.shufersal.price, 7.9);
  assert.equal(tomMatches.ramilevy.price, 5.9);
  assert.equal(tomMatches.carrefour, null);

  const cmp = compareBasket(
    [
      { ...pinnedMilkLine, matches: milkMatches },
      { ...tomLine, matches: tomMatches },
    ],
    ['shufersal', 'ramilevy', 'carrefour'],
    {},
    { includeDelivery: false },
  );
  assert.equal(cmp.perChain.shufersal.complete, true);
  assert.equal(cmp.perChain.ramilevy.complete, true);
  assert.deepEqual(cmp.perChain.ramilevy.substitutes, ['m1']);
  assert.equal(cmp.perChain.carrefour.complete, false);
  assert.deepEqual(cmp.perChain.carrefour.missing, ['t1']);
  assert.equal(cmp.cheapestId, 'ramilevy');
});

test('codec security: rejects >256 KB decompression bombs and strips untrusted image hosts', async () => {
  // Compress 350 KB of repeated JSON (compresses to < 2 KB in deflate-raw, expands > 256 KB)
  const hugeJson = JSON.stringify({ v: 1, i: [['חלב', 1, 'unit', 'dairy'], ['א'.repeat(350_000), 1, 'unit', '']] });
  const deflated = zlib.deflateRawSync(Buffer.from(hugeJson, 'utf8'));
  assert.ok(deflated.length < 32768, 'compressed bomb fits under string length check');
  const b64url = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await assert.rejects(
    () => decodePayload('z' + b64url),
    /exceeds limit|too large/i,
  );

  // Oversized input string > 32 KB rejected upfront
  await assert.rejects(
    () => decodePayload('p' + 'A'.repeat(40_000)),
    /Invalid list payload size/i,
  );

  // Untrusted image URL stripped
  const clean = sanitizeProduct({
    code: 'P_7290004127329',
    name: 'חלב',
    img: 'https://evil.example.com/track.png',
  });
  assert.equal(clean.img, '');
});
