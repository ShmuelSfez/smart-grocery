// Unit tests for SmartCart Chrome Extension v3.1.0:
// - extension/build.mjs unified & per-chain ZIP packaging (verified via listZipEntries)
// - 7-chain SmartCartChains registry & guided search/query helpers
// - Pure Self-Point (Carrefour + Mahsanei HaShuk) & Rami Levy safe cart-merge helpers
// - Strict CSP hygiene (zero inline style= attributes, codec.js byte parity)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { listZipEntries } from '../web/js/zip.js';
import {
  CHAIN_BUILD_SPECS,
  buildUnifiedZipBuffer,
  buildSingleChainZipBuffer,
  verifyExtensionZipBuffer,
} from '../extension/build.mjs';

await import('../extension/chains/selfpoint.js');
await import('../extension/chains/shufersal.js');
await import('../extension/chains/ramilevy.js');
await import('../extension/chains/carrefour.js');
await import('../extension/chains/mahsaneihashuk.js');
await import('../extension/chains/victory.js');
await import('../extension/chains/yochananof.js');
await import('../extension/chains/tivtaam.js');

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT_DIR, 'extension');

test('extension build: codec.js is byte-synced and unified zips pass listZipEntries verification', () => {
  const webCodec = fs.readFileSync(path.join(ROOT_DIR, 'web', 'js', 'codec.js'));
  const extCodec = fs.readFileSync(path.join(EXT_DIR, 'codec.js'));
  assert.ok(webCodec.equals(extCodec), 'extension/codec.js must match web/js/codec.js byte-for-byte');

  const smartcartZipPath = path.join(ROOT_DIR, 'web', 'smartcart-extension.zip');
  const shufersalZipPath = path.join(ROOT_DIR, 'web', 'shufersal-extension.zip');
  assert.ok(fs.existsSync(smartcartZipPath), 'web/smartcart-extension.zip must exist');
  assert.ok(fs.existsSync(shufersalZipPath), 'web/shufersal-extension.zip must exist');

  const smartcartBytes = fs.readFileSync(smartcartZipPath);
  const shufersalBytes = fs.readFileSync(shufersalZipPath);
  assert.ok(
    smartcartBytes.equals(shufersalBytes),
    'web/smartcart-extension.zip and web/shufersal-extension.zip must be byte-identical',
  );

  const rebuilt = buildUnifiedZipBuffer();
  assert.ok(smartcartBytes.equals(rebuilt), 'committed unified zip must match fresh buildUnifiedZipBuffer()');

  const { entries, names, manifest } = verifyExtensionZipBuffer(smartcartBytes);
  assert.equal(manifest.version, '3.1.0');
  assert.equal(manifest.host_permissions.length, 7);
  for (const spec of Object.values(CHAIN_BUILD_SPECS)) {
    assert.ok(manifest.host_permissions.includes(spec.matchPattern), `missing host permission ${spec.matchPattern}`);
  }
  assert.ok(!names.includes('build.mjs'), 'build.mjs must never be included inside extension zip');

  const bridgeEntry = entries.find((e) => e.name === 'bridge.js');
  const bridgeSrc = (bridgeEntry.method === 8 ? zlib.inflateRawSync(bridgeEntry.data) : Buffer.from(bridgeEntry.data)).toString('utf8');
  assert.ok(bridgeSrc.includes("dataset.smartcartExt = '3.1.0'"), 'bridge.js must announce v3.1.0');
});

test('extension build: per-chain zip generator scopes manifest and scripts cleanly for all 7 chains', () => {
  const allChainIds = Object.keys(CHAIN_BUILD_SPECS);
  assert.deepEqual(allChainIds, [
    'shufersal',
    'ramilevy',
    'carrefour',
    'mahsaneihashuk',
    'victory',
    'yochananof',
    'tivtaam',
  ]);

  for (const chainId of allChainIds) {
    const zipBuf = buildSingleChainZipBuffer(chainId);
    const entries = listZipEntries(zipBuf);
    const names = entries.map((e) => e.name);
    assert.ok(names.includes(`chains/${chainId}.js`), `missing chains/${chainId}.js in ${chainId} zip`);
    assert.ok(names.includes('chains/selfpoint.js'), `missing chains/selfpoint.js in ${chainId} zip`);
    for (const otherId of allChainIds) {
      if (otherId !== chainId) {
        assert.ok(!names.includes(`chains/${otherId}.js`), `unexpected chains/${otherId}.js in ${chainId} zip`);
      }
    }

    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    const manifest = JSON.parse(zlib.inflateRawSync(manifestEntry.data).toString('utf8'));
    assert.deepEqual(manifest.host_permissions, [CHAIN_BUILD_SPECS[chainId].matchPattern]);
  }
});

test('SmartCartChains registry: resolves all 7 hosts, modes, guided search URLs, and EAN vs PLU queries', () => {
  const reg = globalThis.SmartCartChains;
  assert.ok(reg, 'SmartCartChains must attach to globalThis');
  assert.equal(reg.list().length, 7);

  const expected = [
    ['www.shufersal.co.il', 'shufersal', 'auto'],
    ['www.rami-levy.co.il', 'ramilevy', 'auto'],
    ['www.carrefour.co.il', 'carrefour', 'auto'],
    ['www.mck.co.il', 'mahsaneihashuk', 'auto'],
    ['www.victoryonline.co.il', 'victory', 'guided'],
    ['yochananof.co.il', 'yochananof', 'guided'],
    ['www.tivtaam.co.il', 'tivtaam', 'guided'],
  ];

  for (const [host, id, mode] of expected) {
    const adapter = reg.getByHost(host);
    assert.ok(adapter, `expected adapter for ${host}`);
    assert.equal(adapter.id, id);
    assert.equal(adapter.mode, mode);
    assert.equal(reg.detectChainId(`https://${host}/?foo=1#smartlist=p123`), id);
  }

  assert.equal(reg.get('victory').buildSearchUrl('7290004127329'), '/search?q=7290004127329');
  assert.equal(reg.get('yochananof').buildSearchUrl('7290004127329'), '/category?search=7290004127329');
  assert.equal(reg.get('tivtaam').buildSearchUrl('חלב 3%'), `/search/${encodeURIComponent('חלב 3%')}`);

  const { resolveGuidedQuery } = reg.helpers;
  // 13-digit EAN barcode uses exact barcode by default, or Hebrew name when preferName=true
  const cottageItem = { name: "קוטג' 5%", product: { code: 'P_7290004127329', name: "קוטג' תנובה 5%" } };
  assert.equal(resolveGuidedQuery(cottageItem, false), '7290004127329');
  assert.equal(resolveGuidedQuery(cottageItem, true), "קוטג' 5%");

  // Short internal store PLU ("101" for weighted tomatoes) falls back to Hebrew item name instead of meaningless PLU
  const weightedTomato = { name: 'עגבניות', product: { code: '101', name: 'עגבניה חממה' } };
  assert.equal(resolveGuidedQuery(weightedTomato, false), 'עגבניות');
});

test('Self-Point helpers: extracts MCK/Carrefour nested fields, isolates retailerId vs branchId, and merges carts safely', () => {
  const {
    mapSelfPointProduct,
    discoverSelfPointContext,
    mergeSelfPointCartLines,
  } = globalThis.SmartCartChains.helpers;

  // Mahsanei HaShuk (MCK, retailerId=1107, defaultBranchId='836') nested branch/names structure
  const mckProduct = mapSelfPointProduct({
    barcode: '7290000123456',
    branch: { branchProductId: 99123, regularPrice: 29.9, isActive: true },
    names: { '1': { long: 'שמן זית כתית מעולה 750 מ"ל', short: 'שמן זית' } },
    brand: { names: { '1': 'יד מרדכי' } },
    images: [{ url: '/media/olive-oil.jpg' }],
  }, null, 'https://www.mck.co.il');

  assert.equal(mckProduct.retailerProductId, 99123);
  assert.equal(mckProduct.name, 'שמן זית כתית מעולה 750 מ"ל');
  assert.equal(mckProduct.price, '₪29.90');
  assert.equal(mckProduct.brand, 'יד מרדכי');
  assert.equal(mckProduct.img, 'https://www.mck.co.il/media/olive-oil.jpg');
  assert.equal(mckProduct.purchasable, true);

  // Context discovery must never mistake retailerId (1107 or 1540) for branchId
  const defaultMckCtx = discoverSelfPointContext(
    { retailerId: 1107, defaultBranchId: '836' },
    [{ selectedBranch: '1107' }],
  );
  assert.equal(defaultMckCtx.branchId, '836');

  const activeMckCtx = discoverSelfPointContext(
    { retailerId: 1107, defaultBranchId: '836' },
    [{
      sp_state: JSON.stringify({
        branchId: 842,
        cart: {
          id: 'cart_mck_99',
          lines: [{ retailerProductId: 5001, quantity: 2, type: 1, soldBy: null }],
        },
      }),
    }],
  );
  assert.equal(activeMckCtx.branchId, '842');
  assert.equal(activeMckCtx.cartId, 'cart_mck_99');
  assert.equal(activeMckCtx.existingLines.get(5001).quantity, 2);

  // Cart merge preserves existing items, sums matching product quantities, and sets soldBy='weight' on weighted items
  const merged = mergeSelfPointCartLines(activeMckCtx.existingLines, [
    { product: { retailerProductId: 5001, sellingMethod: 'BY_UNIT' }, addQty: 3 },
    { product: { retailerProductId: 7702, isWeighted: true, sellingMethod: 'BY_WEIGHT' }, addQty: 1.25 },
  ]);
  assert.deepEqual(merged, [
    { retailerProductId: 5001, quantity: 5, type: 1, soldBy: null },
    { retailerProductId: 7702, quantity: 1.25, type: 1, soldBy: 'weight' },
  ]);
});

test('Rami Levy helpers: extracts array/object carts and merges quantities without wiping existing cart', () => {
  const { extractExistingRamiCart, mergeRamiCartItems } = globalThis.SmartCartChains.helpers;
  const now = Date.parse('2026-11-19T12:00:00Z');

  const fromArr = extractExistingRamiCart(JSON.stringify({
    cart: {
      supplyAt: '2026-11-20T10:00:00.000Z',
      items: [
        { id: 101, quantity: 2 },
        { product_id: '205', qty: 0.5 },
      ],
    },
  }), now);
  assert.equal(fromArr.supplyAt, '2026-11-20T10:00:00.000Z');
  assert.deepEqual(fromArr.itemsMap, { '101': 2, '205': 0.5 });

  // Expired supplyAt is dropped while object-map items are preserved
  const fromObj = extractExistingRamiCart({
    cart: {
      supplyAt: '2026-11-10T10:00:00.000Z',
      items: { '101': 1, '309': { quantity: 1.2 } },
    },
  }, now);
  assert.equal(fromObj.supplyAt, '');
  assert.deepEqual(fromObj.itemsMap, { '101': 1, '309': 1.2 });

  const merged = mergeRamiCartItems(fromObj.itemsMap, [
    { product: { ramiId: '309' }, addQty: 0.3 },
    { product: { ramiId: '888' }, addQty: 4 },
  ]);
  assert.deepEqual(merged, {
    '101': '1',
    '309': '1.5',
    '888': '4',
  });
});

test('extension CSP & WebKit hygiene: zero inline style= attributes and zero regex lookbehinds', () => {
  const walk = (dir) => {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(full));
      else if (/\.(js|mjs|html)$/i.test(ent.name) && ent.name !== 'build.mjs') out.push(full);
    }
    return out;
  };

  const files = walk(EXT_DIR);
  assert.ok(files.length >= 13);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT_DIR, file);
    assert.equal(/\bstyle\s*=\s*["']/i.test(src), false, `inline style= attribute forbidden in ${rel}`);
    assert.equal(/\(\?<[=!]/.test(src), false, `regex lookbehind forbidden in ${rel}`);
  }
});
