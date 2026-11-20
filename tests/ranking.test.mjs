// Unit tests for pure vertical chain ranking helper (web/js/ranking.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRankedChainRows } from '../web/js/ranking.js';
import { compareBasket } from '../web/js/pricing.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE_CHAINS_9 = [
  { id: 'shufersal', name: 'שופרסל', emoji: '🔴', status: 'live', cartFill: 'auto', hasOnlineStore: true },
  { id: 'ramilevy', name: 'רמי לוי', emoji: '🛒', status: 'live', cartFill: 'auto', hasOnlineStore: true },
  { id: 'carrefour', name: 'קרפור', emoji: '🔵', status: 'live', cartFill: 'auto', hasOnlineStore: true },
  { id: 'victory', name: 'ויקטורי', emoji: '🏪', status: 'live', cartFill: 'guided', hasOnlineStore: true },
  { id: 'yochananof', name: 'יוחננוף', emoji: '🛍️', status: 'live', cartFill: 'guided', hasOnlineStore: true },
  { id: 'osherad', name: 'אושר עד', emoji: '🟢', status: 'live', cartFill: 'none', hasOnlineStore: false },
  { id: 'mahsanei', name: 'מחסני השוק', emoji: '🟠', status: 'live', cartFill: 'none', hasOnlineStore: true },
  { id: 'keshet', name: 'קשת טעמים', emoji: '🌈', status: 'soon', cartFill: 'none' },
  { id: 'tivtaam', name: 'טיב טעם', emoji: '🍷', status: 'soon', cartFill: 'none' },
];

test('ranking: orders complete -> partial (fewest missing, then price) -> unpriced -> soon across 9 chains', () => {
  const calc = {
    checkedCount: 4,
    comparedOnSubtotalOnly: false,
    cheapestId: 'ramilevy',
    perChain: {
      shufersal: { subtotal: 140, deliveryFee: 29.9, total: 169.9, priced: 4, missing: [], substitutes: [], estimated: [], complete: true, hasData: true },
      ramilevy: { subtotal: 128, deliveryFee: 29.9, total: 157.9, priced: 4, missing: [], substitutes: ['i2'], estimated: [], complete: true, hasData: true },
      // Partial with lower total (60) than complete chains — must still rank AFTER all complete chains!
      carrefour: { subtotal: 60, deliveryFee: 0, total: 60, priced: 2, missing: ['i3', 'i4'], substitutes: [], estimated: [], complete: false, hasData: true },
      // Partial with only 1 missing item — must rank BEFORE partial with 2 missing items!
      victory: { subtotal: 115, deliveryFee: 29, total: 144, priced: 3, missing: ['i4'], substitutes: [], estimated: [], complete: false, hasData: true },
      // Partial also with 1 missing item, cheaper than victory — must rank BEFORE victory!
      yochananof: { subtotal: 105, deliveryFee: 25, total: 130, priced: 3, missing: ['i4'], substitutes: [], estimated: [], complete: false, hasData: true },
      // Live chain with no data yet
      mahsanei: { subtotal: 0, deliveryFee: null, total: 0, priced: 0, missing: ['i1', 'i2', 'i3', 'i4'], substitutes: [], estimated: [], complete: false, hasData: false },
    },
  };

  const activeBranchData = {
    ramilevy: { store: { name: 'רמי לוי אינטרנט' } },
    shufersal: { store: { name: 'שופרסל אונליין' } },
  };

  const rows = buildRankedChainRows(SAMPLE_CHAINS_9, calc, activeBranchData, 'delivery');
  assert.equal(rows.length, 9);
  assert.deepEqual(
    rows.map((r) => r.id),
    [
      'ramilevy',   // #1 complete (157.9)
      'shufersal',  // #2 complete (169.9)
      'yochananof', // #3 partial (1 missing, 130)
      'victory',    // #4 partial (1 missing, 144)
      'carrefour',  // #5 partial (2 missing, 60)
      'mahsanei',   // — live, unpriced (!hasData)
      'osherad',    // — live, hasOnlineStore === false in delivery mode
      'keshet',     // — soon
      'tivtaam',    // — soon
    ],
  );

  assert.deepEqual(
    rows.map((r) => r.rankLabel),
    ['#1', '#2', '#3', '#4', '#5', '—', '—', '—', '—'],
  );

  // Only ramilevy (#1 complete) wins isCheapest
  assert.equal(rows[0].id, 'ramilevy');
  assert.equal(rows[0].isCheapest, true);
  assert.equal(rows[0].deltaFromCheapest, null);
  assert.equal(rows[0].storeSubtitle, 'רמי לוי אינטרנט');

  // Second complete chain shows exact delta +12.00
  assert.equal(rows[1].id, 'shufersal');
  assert.equal(rows[1].isCheapest, false);
  assert.equal(rows[1].deltaFromCheapest, 12);

  // Partial, unpriced, and soon chains never get isCheapest or complete delta
  for (const r of rows.slice(2)) {
    assert.equal(r.isCheapest, false, `expected ${r.id} not to be cheapest`);
    assert.equal(r.deltaFromCheapest, null, `expected ${r.id} deltaFromCheapest to be null`);
  }
});

test('ranking: respects comparedOnSubtotalOnly when delivery fees are asymmetric', () => {
  const lines = [
    {
      id: 'item1',
      qty: 1,
      unit: 'unit',
      matches: {
        shufersal: { price: 92 },
        ramilevy: { price: 100 },
        carrefour: { price: 108 },
      },
    },
  ];
  const chains = SAMPLE_CHAINS_9.slice(0, 3);
  const calc = compareBasket(
    lines,
    ['shufersal', 'ramilevy', 'carrefour'],
    {
      shufersal: { fee: 29.9, freeOver: 750 }, // total = 121.9, subtotal = 92
      ramilevy: { fee: null, freeOver: null }, // total = 100, subtotal = 100
      carrefour: { fee: 0, freeOver: 0 },      // total = 108, subtotal = 108
    },
    { includeDelivery: true },
  );

  assert.equal(calc.comparedOnSubtotalOnly, true);
  const rows = buildRankedChainRows(chains, calc, {}, 'delivery');

  assert.deepEqual(rows.map((r) => r.id), ['shufersal', 'ramilevy', 'carrefour']);
  assert.equal(rows[0].isCheapest, true);
  assert.equal(rows[0].total, 121.9);
  assert.equal(rows[0].subtotal, 92);

  // Delta is computed on apples-to-apples subtotal (+8 and +16), never negative!
  assert.equal(rows[1].isCheapest, false);
  assert.equal(rows[1].deltaFromCheapest, 8);
  assert.equal(rows[2].isCheapest, false);
  assert.equal(rows[2].deltaFromCheapest, 16);
});

test('ranking: handles hasOnlineStore === false in delivery mode vs physical store mode', () => {
  const chains = [
    { id: 'shufersal', name: 'שופרסל', emoji: '🔴', status: 'live', cartFill: 'auto', hasOnlineStore: true },
    { id: 'osherad', name: 'אושר עד', emoji: '🟢', status: 'live', cartFill: 'none', hasOnlineStore: false },
    { id: 'keshet', name: 'קשת טעמים', emoji: '🌈', status: 'soon', cartFill: 'none' },
  ];

  // Even if calc had lower prices for osherad (and cheapestId pointing to osherad), delivery mode excludes it from online pricing!
  const calc = {
    checkedCount: 2,
    comparedOnSubtotalOnly: false,
    cheapestId: 'osherad',
    perChain: {
      osherad: { subtotal: 75, deliveryFee: null, total: 75, priced: 2, missing: [], complete: true, hasData: true },
      shufersal: { subtotal: 90, deliveryFee: 29.9, total: 119.9, priced: 2, missing: [], complete: true, hasData: true },
    },
  };
  const branchData = {
    osherad: { store: { name: 'אושר עד בני ברק' } },
    shufersal: { store: { name: 'שופרסל שלי הרצליה' } },
  };

  const deliveryRows = buildRankedChainRows(chains, calc, branchData, 'delivery');
  assert.deepEqual(deliveryRows.map((r) => r.id), ['shufersal', 'osherad', 'keshet']);
  assert.equal(deliveryRows[0].id, 'shufersal');
  assert.equal(deliveryRows[0].rankLabel, '#1');
  assert.equal(deliveryRows[0].isCheapest, true);

  const osherDelivery = deliveryRows.find((r) => r.id === 'osherad');
  assert.equal(osherDelivery.noOnlineStore, true);
  assert.equal(osherDelivery.unavailable, true);
  assert.equal(osherDelivery.priced, false);
  assert.equal(osherDelivery.isCheapest, false);
  assert.equal(osherDelivery.rank, null);
  assert.equal(osherDelivery.rankLabel, '—');
  assert.equal(osherDelivery.storeSubtitle, 'אין משלוח אונליין — זמין במצב סניף פיזי');

  // Switch to physical store mode ('store') -> osherad competes normally and wins #1!
  const storeRows = buildRankedChainRows(chains, calc, branchData, 'store');
  assert.deepEqual(storeRows.map((r) => r.id), ['osherad', 'shufersal', 'keshet']);
  assert.equal(storeRows[0].id, 'osherad');
  assert.equal(storeRows[0].rankLabel, '#1');
  assert.equal(storeRows[0].isCheapest, true);
  assert.equal(storeRows[0].noOnlineStore, false);
  assert.equal(storeRows[0].storeSubtitle, 'אושר עד בני ברק');
  assert.equal(storeRows[1].id, 'shufersal');
  assert.equal(storeRows[1].rankLabel, '#2');
  assert.equal(storeRows[1].isCheapest, false);
  assert.equal(storeRows[1].deltaFromCheapest, 44.9);
});

test('ranking: never awards isCheapest to partial, not-covered, no-branch, ambiguous, or soon chains', () => {
  const chains = [
    { id: 'shufersal', name: 'שופרסל', emoji: '🔴', status: 'live', cartFill: 'auto', hasOnlineStore: true },
    { id: 'ramilevy', name: 'רמי לוי', emoji: '🛒', status: 'live', cartFill: 'auto', hasOnlineStore: true },
    { id: 'victory', name: 'ויקטורי', emoji: '🏪', status: 'soon', cartFill: 'none' },
  ];

  // 1. Only partial baskets exist (even if caller passed bogus cheapestId)
  const partialCalc = {
    checkedCount: 3,
    cheapestId: 'ramilevy',
    perChain: {
      shufersal: { subtotal: 40, total: 40, priced: 2, missing: ['x'], complete: false, hasData: true },
      ramilevy: { subtotal: 35, total: 35, priced: 2, missing: ['y'], complete: false, hasData: true },
    },
  };
  const partialRows = buildRankedChainRows(chains, partialCalc, {}, 'delivery');
  assert.equal(partialRows.some((r) => r.isCheapest), false);
  assert.deepEqual(partialRows.map((r) => r.rankLabel), ['#1', '#2', '—']);

  // 2. Cheaper chain is not-covered in delivery city -> excluded from winning, covered complete chain wins
  const covCalc = {
    checkedCount: 2,
    cheapestId: 'ramilevy',
    coverage: { ramilevy: 'not-covered', shufersal: 'covered' },
    perChain: {
      ramilevy: { subtotal: 50, total: 50, priced: 2, missing: [], complete: true, hasData: true },
      shufersal: { subtotal: 65, total: 65, priced: 2, missing: [], complete: true, hasData: true },
    },
  };
  const covRows = buildRankedChainRows(chains, covCalc, {}, 'delivery');
  assert.equal(covRows[0].id, 'shufersal');
  assert.equal(covRows[0].isCheapest, true);
  const rlCov = covRows.find((r) => r.id === 'ramilevy');
  assert.equal(rlCov.isCheapest, false);
  assert.equal(rlCov.notCovered, true);
  assert.equal(rlCov.rankLabel, '—');

  // 3. Unresolved ambiguous item blocks isCheapest even if rawInfo had complete: true
  const ambigCalc = {
    checkedCount: 2,
    ambiguousCount: 1,
    cheapestId: 'shufersal',
    perChain: {
      shufersal: { subtotal: 50, total: 50, priced: 2, missing: [], complete: true, hasData: true },
    },
  };
  const ambigRows = buildRankedChainRows(chains, ambigCalc, {}, 'delivery');
  assert.equal(ambigRows.some((r) => r.isCheapest), false);
});

test('web UI CSP, Safari WebKit, and asset cache-busting hygiene', () => {
  const checkedFiles = ['web/index.html', 'web/styles.css', 'web/js/app.js', 'web/js/ranking.js'];
  for (const rel of checkedFiles) {
    const src = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    assert.equal(/\bstyle\s*=\s*["']/i.test(src), false, `inline style= attribute forbidden in ${rel}`);
    assert.equal(/\bon[a-z]+\s*=\s*["']/i.test(src), false, `inline on*= handler attribute forbidden in ${rel}`);
    assert.equal(/\(\?<[=!]/.test(src), false, `regex lookbehind forbidden in ${rel}`);
  }

  const html = fs.readFileSync(path.join(ROOT_DIR, 'web/index.html'), 'utf8');
  const versions = [...html.matchAll(/(?:styles\.css|js\/codec\.js|js\/app\.js)\?v=(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(versions.length, 3, 'expected all 3 web asset tags to carry ?v=N');
  assert.ok(versions.every((v) => v >= 26 && v === versions[0]), `expected uniform ?v=26+ across tags, got ${versions.join(',')}`);
});
