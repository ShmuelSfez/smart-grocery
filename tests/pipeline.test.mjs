// Unit tests for the Price Transparency pipeline, promotions, city mapping,
// Q15 hybrid cross-chain matching, and SLCodec decompression size caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import os from 'node:os';
import { loadLocalCityMap, resolveCityName } from '../pipeline/cities.mjs';
import { decodeFeedBuffer, extractFileMeta, parseStoresXml, parsePricesXml } from '../pipeline/parse.mjs';
import { parsePromosXml } from '../pipeline/promos.mjs';
import { tryCarryForwardChain } from '../pipeline/build.mjs';
import { createLaibCatalogSource, parseLaibFilesPayload, parseLaibHtmlLinks } from '../pipeline/sources/laibcatalog.mjs';
import { createCerberusSource } from '../pipeline/sources/cerberus.mjs';
import { CHAINS, LIVE_CHAIN_IDS, ONLINE_LIVE_CHAIN_IDS } from '../web/js/chains.js';
import { buildCatalogBundle, searchCatalogProducts, matchLineAcrossChains } from '../web/js/prices.js';
import { compareBasket } from '../web/js/pricing.js';
import { writeZip } from './regression/lib/zip-writer.mjs';

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
    type: 'branch',
  });
  assert.equal(stores[2].city, 'פתח תקווה');
  assert.equal(stores[1].type, 'online');

  // ZIP archive disguised as .gz (Rami Levy online store) decodes like gzip
  const pricesXmlForZip = fs.readFileSync(path.join(FIXTURES, 'prices-sample.xml'), 'utf8');
  for (const deflate of [true, false]) {
    const zipBuf = writeZip([{ name: 'PriceFull7290058140886-039-202611180519.xml', data: pricesXmlForZip }], { deflate });
    assert.equal(parsePricesXml(decodeFeedBuffer(zipBuf)).items.length, 2);
  }

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
        '7290004127329': ["קוטג' תנובה 5% שומן 250 גרם", 'תנובה', 250, 'גרם', 0],
        '7290004127000': ["קוטג' תנובה בקטנה 5%", 'תנובה', 100, 'גרם', 0],
      }),
      storePrices: {
        '7290004131074': [6.7, 6.7],
        '7290004127329': [6.1, 2.44],
        '7290004127000': [3.2, 3.2],
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

  // Generic "קוטג'" prefers standard 250g SKU over mini "בקטנה" 100g cup
  const cotMatches = matchLineAcrossChains({ id: 'c1', name: "קוטג'", qty: 1, unit: 'unit', product: null }, branchData);
  assert.equal(cotMatches.carrefour.code, '7290004127329');
  assert.equal(cotMatches.carrefour.price, 6.1);

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
  // Compress 350 KB of repeated JSON (compresses to < 2 KB in deflate, expands > 256 KB)
  const hugeJson = JSON.stringify({ v: 1, i: [['חלב', 1, 'unit', 'dairy'], ['א'.repeat(350_000), 1, 'unit', '']] });
  const deflated = zlib.deflateSync(Buffer.from(hugeJson, 'utf8'));
  assert.ok(deflated.length < 32768, 'compressed bomb fits under string length check');
  const b64url = deflated.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await assert.rejects(
    () => decodePayload('d' + b64url),
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

test('laibcatalog adapter: parses WebAPI JSON + HTML fallback, filters foreign GLNs, and picks newest per store', async () => {
  const samplePayload = [
    { fileName: 'Stores7290696200003-000-20261118060100-060100.gz', fileType: 'stores' },
    { fileName: 'StoresFull7290696200003-000-20261119060100-060100.xml.gz', fileType: 'storesfull' },
    { fileName: 'PriceFull7290696200003-001-097-20261119-050000.gz', fileType: 'pricefull' },
    { fileName: 'PriceFull7290696200003-001-097-20261119-080408.gz', fileType: 'pricefull' },
    { fileName: 'PromoFull7290696200003-001-097-20261119-080415.gz', fileType: 'promofull' },
    { fileName: 'Price7290696200003-001-097-20261119-220000.gz', fileType: 'price' }, // incremental Price -> ignored
    { fileName: 'PriceFull7290661400001-003-097-20261119-090000.gz', fileType: 'pricefull' }, // foreign GLN -> ignored
  ];

  const parsedEntries = parseLaibFilesPayload(samplePayload, '7290696200003', 'https://laibcatalog.co.il');
  assert.equal(parsedEntries.length, 5);

  const htmlSample = `
    <table><tr><td>
      <a href='CompetitionRegulationsFiles\\latest\\7290661400001/StoresFull7290661400001-000-202611190627-000.xml.gz'>dl</a>
      <a href='CompetitionRegulationsFiles\\latest\\7290455000004/StoresFull7290455000004-000-202611190627-000.xml.gz'>foreign</a>
    </td></tr></table>`;
  const htmlEntries = parseLaibHtmlLinks(htmlSample, '7290661400001', 'https://laibcatalog.co.il');
  assert.equal(htmlEntries.length, 1);
  assert.equal(htmlEntries[0].kind, 'Stores');
  assert.equal(htmlEntries[0].url, 'https://laibcatalog.co.il/CompetitionRegulationsFiles/latest/7290661400001/StoresFull7290661400001-000-202611190627-000.xml.gz');

  const gzBody = zlib.gzipSync(Buffer.from('<Root><StoreID>97</StoreID></Root>', 'utf8'));
  const mockFetch = async (url) => {
    if (String(url).includes('/webapi/api/getfiles')) {
      return new Response(JSON.stringify(samplePayload), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(gzBody, { status: 200 });
  };

  const victorySrc = createLaibCatalogSource({
    chainId: 'victory',
    chainGln: '7290696200003',
    fetchImpl: mockFetch,
  });
  const feeds = await victorySrc.listFeeds();
  assert.equal(feeds.chainId, 'victory');
  assert.equal(feeds.storesFile.filename, 'StoresFull7290696200003-000-20261119060100-060100.xml.gz');
  assert.equal(feeds.priceFiles.size, 1);
  assert.equal(feeds.priceFiles.get('97').filename, 'PriceFull7290696200003-001-097-20261119-080408.gz');
  assert.equal(feeds.promoFiles.get('97').filename, 'PromoFull7290696200003-001-097-20261119-080415.gz');
  const dlBuf = await feeds.priceFiles.get('97').download();
  assert.match(decodeFeedBuffer(dlBuf), /<StoreID>97<\/StoreID>/);
});

test('cerberus adapter: maintains cookie+CSRF session, paginates /file/json/dir, and filters foreign GLNs', async () => {
  const seenCookies = [];
  const seenPosts = [];
  const mockFetch = async (url, opts = {}) => {
    const u = String(url);
    if (opts.headers?.cookie) seenCookies.push(opts.headers.cookie);
    if (u.endsWith('/login')) {
      return new Response('<meta name="csrftoken" content="csrf-init-111">', {
        status: 200,
        headers: { 'set-cookie': 'cftpSID=sess-abc; Path=/' },
      });
    }
    if (u.endsWith('/login/user')) {
      seenPosts.push(opts.body);
      return new Response('', {
        status: 302,
        headers: { 'set-cookie': 'cftpAUTH=ok-999; Path=/' },
      });
    }
    if (u.endsWith('/file')) {
      return new Response('<meta name="csrftoken" content="csrf-auth-222">', { status: 200 });
    }
    if (u.endsWith('/file/json/dir')) {
      const params = new URLSearchParams(opts.body);
      const sSearch = params.get('sSearch');
      assert.equal(params.get('csrftoken'), 'csrf-auth-222');
      let aaData = [];
      if (sSearch === 'Stores') {
        aaData = [{ fname: 'Stores7290785400000-000-20261119-051000.xml' }];
      } else if (sSearch === 'PriceFull') {
        aaData = [
          { fname: 'PriceFull7290055700007-0820-202403281445.gz' }, // foreign GLN -> must be ignored
          { fname: 'PriceFull7290785400000-001-116-20261119-000500.gz' },
          { fname: 'PriceFull7290785400000-001-116-20261119-021000.gz' },
        ];
      } else if (sSearch === 'PromoFull') {
        aaData = [{ fname: 'PromoFull7290785400000-001-116-20261119-021200.gz' }];
      }
      return new Response(JSON.stringify({ iTotalDisplayRecords: aaData.length, aaData }), { status: 200 });
    }
    if (u.includes('/file/d/')) {
      return new Response(Buffer.from('<Root><StoreID>116</StoreID></Root>', 'utf8'), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${u}`);
  };

  const keshetSrc = createCerberusSource({
    chainId: 'keshet',
    username: 'Keshet',
    chainGln: '7290785400000',
    fetchImpl: mockFetch,
  });
  const feeds = await keshetSrc.listFeeds();
  assert.equal(feeds.chainId, 'keshet');
  assert.ok(seenPosts[0].includes('username=Keshet'));
  assert.ok(seenCookies.some((c) => c.includes('cftpSID=sess-abc') && c.includes('cftpAUTH=ok-999')));
  assert.equal(feeds.priceFiles.size, 1); // foreign 7290055700007 filtered out!
  assert.equal(feeds.priceFiles.get('116').filename, 'PriceFull7290785400000-001-116-20261119-021000.gz');
  assert.equal(feeds.promoFiles.get('116').filename, 'PromoFull7290785400000-001-116-20261119-021200.gz');
});

test('parseStoresXml + chains: disambiguates Nibit StoreType=2 physical branches and exposes ONLINE_LIVE_CHAIN_IDS', () => {
  const cityMap = loadLocalCityMap();
  const nibitXml = `<Root><SubChains><SubChain><Stores>
    <Store><StoreID>020</StoreID><StoreType>2</StoreType><StoreName>20 להבים</StoreName><Address>מרכז מסחרי להבים 1</Address><City>להבים</City></Store>
    <Store><StoreID>097</StoreID><StoreType>2</StoreType><StoreName>97 אינטרנט</StoreName><Address></Address><City></City></Store>
  </Stores></SubChain></SubChains></Root>`;
  const parsed = parseStoresXml(nibitXml, 'mahsaneihashuk', cityMap);
  assert.equal(parsed.find((s) => s.storeId === '20').type, 'branch');
  assert.equal(parsed.find((s) => s.storeId === '97').type, 'online');

  assert.ok(LIVE_CHAIN_IDS.length >= 9);
  assert.ok(ONLINE_LIVE_CHAIN_IDS.includes('mahsaneihashuk'));
  assert.ok(ONLINE_LIVE_CHAIN_IDS.includes('victory'));
  assert.ok(!ONLINE_LIVE_CHAIN_IDS.includes('osherad'));
  assert.ok(!ONLINE_LIVE_CHAIN_IDS.includes('yochananof'));
  for (const c of CHAINS) {
    assert.equal(typeof c.hasOnlineStore, 'boolean');
    assert.ok(['auto', 'guided', 'none'].includes(c.cartFill));
  }
});

test('tryCarryForwardChain: preserves last-known-good catalog and stores during midnight portal rollover', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartcart-carry-'));
  try {
    const prev = {
      meta: { chains: { victory: { ok: true, storesCount: 2, catalogCount: 100, promoItemsCount: 10, latestStamp: '202611190601' } } },
      cities: { 'הרצליה': [{ chain: 'victory', storeId: '74', name: 'שבעת הכוכבים', address: 'שבעת הכוכבים 8' }] },
      online: { victory: [{ storeId: '97', name: 'אינטרנט', address: 'victoryonline.co.', city: 'כללי', itemsCount: 8662, quick: false }] },
    };
    const mockFetch = async (url) => {
      if (String(url).endsWith('/victory/catalog.json')) return new Response('{"7290004127329":["קוטג","תנובה",250,"גרם",0]}', { status: 200 });
      if (String(url).endsWith('/stores/74.json') || String(url).endsWith('/stores/97.json')) return new Response('{"7290004127329":[5.8,2.32]}', { status: 200 });
      return new Response('', { status: 404 });
    };
    const carried = await tryCarryForwardChain('victory', tmpDir, prev, 'midnight rollover', mockFetch);
    assert.ok(carried);
    assert.equal(carried.meta.ok, true);
    assert.equal(carried.meta.carriedForward, true);
    assert.equal(carried.cityEntries.length, 1);
    assert.equal(carried.onlineEntries[0].storeId, '97');
    assert.ok(fs.existsSync(path.join(tmpDir, 'victory', 'catalog.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'victory', 'stores', '97.json')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
