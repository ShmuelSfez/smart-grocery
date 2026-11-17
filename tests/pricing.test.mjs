// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeQty, applyPromo, lineCost, compareBasket } from '../web/js/pricing.js';

test('pricing: never invents a price (missing stays missing)', () => {
  assert.equal(lineCost({ qty: 2, unit: 'unit' }, null), null);
  assert.equal(lineCost({ qty: 2, unit: 'unit' }, { price: 0 }), null);
  const lines = [
    { id: 'a', qty: 1, unit: 'unit', matches: { shufersal: { price: 7.35 }, ramilevy: null } },
    { id: 'b', qty: 2, unit: 'unit', matches: { shufersal: { price: 5 }, ramilevy: { price: 4.5 } } },
  ];
  const r = compareBasket(lines, ['shufersal', 'ramilevy']);
  assert.equal(r.perChain.shufersal.total, 17.35);
  assert.equal(r.perChain.shufersal.complete, true);
  assert.equal(r.perChain.ramilevy.total, 9);
  assert.deepEqual(r.perChain.ramilevy.missing, ['a']);
  assert.equal(r.perChain.ramilevy.complete, false);
  // A partial basket is never "cheapest", even though its total is lower.
  assert.equal(r.cheapestId, 'shufersal');
  assert.deepEqual(r.ranking, ['shufersal', 'ramilevy']);
});

test('pricing: no complete chain means no cheapest claim', () => {
  const lines = [
    { id: 'a', qty: 1, unit: 'unit', matches: { shufersal: { price: 3 } } },
    { id: 'b', qty: 1, unit: 'unit', matches: { ramilevy: { price: 3 } } },
  ];
  const r = compareBasket(lines, ['shufersal', 'ramilevy']);
  assert.equal(r.cheapestId, null);
  assert.equal(r.savings, 0);
});

test('pricing: promotions (single price and X for Y), never raise the cost', () => {
  assert.deepEqual(applyPromo(10, 3, { type: 'price', price: 8 }), { cost: 24, savings: 6 });
  assert.deepEqual(applyPromo(6, 5, { type: 'bundle', qty: 2, price: 10 }), { cost: 26, savings: 4 });
  assert.deepEqual(applyPromo(6, 1, { type: 'bundle', qty: 2, price: 10 }), { cost: 6, savings: 0 });
  assert.deepEqual(applyPromo(5, 2, { type: 'bundle', qty: 2, price: 12 }), { cost: 10, savings: 0 });
  assert.deepEqual(applyPromo(10, 2, null), { cost: 20, savings: 0 });
});

test('pricing: weighted items charge kilograms and flag estimates', () => {
  assert.deepEqual(chargeQty({ qty: 1.5, unit: 'kg' }, { weighted: true }), { qty: 1.5, estimated: false });
  assert.deepEqual(chargeQty({ qty: 500, unit: 'g' }, { weighted: true }), { qty: 0.5, estimated: false });
  assert.deepEqual(chargeQty({ qty: 3, unit: 'unit' }, { weighted: true }), { qty: 3, estimated: true });
  assert.deepEqual(chargeQty({ qty: 2, unit: 'kg' }, { weighted: false }), { qty: 1, estimated: true });
  const c = lineCost({ qty: 2, unit: 'kg' }, { price: 7.9, weighted: true, promo: { type: 'price', price: 1 } });
  assert.equal(c.cost, 15.8); // promotions are not applied to weighted items in v1
});

test('pricing: delivery fee unknown is excluded, known fee and free threshold applied', () => {
  const lines = [{ id: 'a', qty: 1, unit: 'unit', matches: { shufersal: { price: 100 }, ramilevy: { price: 100 } } }];
  const r = compareBasket(lines, ['shufersal', 'ramilevy'], {
    shufersal: { fee: 29.9, freeOver: 50 },
    ramilevy: { fee: null, freeOver: null },
  });
  assert.equal(r.perChain.shufersal.deliveryFee, 0);
  assert.equal(r.perChain.ramilevy.deliveryFee, null);
  assert.equal(r.perChain.ramilevy.total, 100);
  const r2 = compareBasket(lines, ['shufersal'], { shufersal: { fee: 29.9, freeOver: 500 } });
  assert.equal(r2.perChain.shufersal.total, 129.9);
  const r3 = compareBasket(lines, ['shufersal'], { shufersal: { fee: 29.9, freeOver: 500 } }, { includeDelivery: false });
  assert.equal(r3.perChain.shufersal.total, 100);
});

test('pricing: substitutes are tracked separately from exact matches', () => {
  const lines = [{ id: 'a', qty: 1, unit: 'unit', matches: { carrefour: { price: 4, kind: 'substitute' } } }];
  const r = compareBasket(lines, ['carrefour']);
  assert.deepEqual(r.perChain.carrefour.substitutes, ['a']);
  assert.equal(r.perChain.carrefour.complete, true);
});
