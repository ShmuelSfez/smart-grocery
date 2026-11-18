// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseItem, parseMany } from '../web/js/parser.js';
import { categorize } from '../web/js/categories.js';
import { recordPurchase, runningOut } from '../web/js/suggest.js';
import { scaleRecipe, RECIPES } from '../web/js/recipes.js';
import { normalizeName } from '../web/js/parser.js';
import { parseGrid, analyzeSheetGrid, exportListToCsv } from '../web/js/sheets.js';

await import('../web/js/codec.js'); // classic script; sets globalThis.SLCodec
const { encodeList, decodeList } = globalThis.SLCodec;

test('parser: quantities and units', () => {
  const cases = [
    ['חלב', { name: 'חלב', qty: 1, unit: 'unit' }],
    ['2 חלב', { name: 'חלב', qty: 2, unit: 'unit' }],
    ['1.5 ק"ג עגבניות', { name: 'עגבניות', qty: 1.5, unit: 'kg' }],
    ['עגבניות 2 קילו', { name: 'עגבניות', qty: 2, unit: 'kg' }],
    ['קילו בננות', { name: 'בננות', qty: 1, unit: 'kg' }],
    ['500 גרם גבינה צהובה', { name: 'גבינה צהובה', qty: 500, unit: 'g' }],
    ['במבה x3', { name: 'במבה', qty: 3, unit: 'unit' }],
    ['3x במבה', { name: 'במבה', qty: 3, unit: 'unit' }],
    ['במבה 3', { name: 'במבה', qty: 3, unit: 'unit' }],
    ['חלב 3%', { name: 'חלב 3%', qty: 1, unit: 'unit' }],
    ['קולה 1.5', { name: 'קולה 1.5', qty: 1, unit: 'unit' }],
    ['2 ליטר חלב', { name: '2 ליטר חלב', qty: 1, unit: 'unit' }],
    ['שתי חבילות פסטה', { name: 'פסטה', qty: 2, unit: 'pack' }],
    ['2ק"ג תפוחים', { name: 'תפוחים', qty: 2, unit: 'kg' }],
    ['- 2 לחם', { name: 'לחם', qty: 2, unit: 'unit' }],
    ['milk 2', { name: 'milk', qty: 2, unit: 'unit' }],
    ['1500 גרם עוף', { name: 'עוף', qty: 1.5, unit: 'kg' }],
    ['סלק לפחות 5', { name: 'סלק', qty: 5, unit: 'unit' }],
    ['כרובית?', { name: 'כרובית', qty: 1, unit: 'unit', note: 'אולי (?)' }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseItem(input), expected, input);
});

test('parser: multi-item text', () => {
  const items = parseMany('חלב, 2 לחם\n1 ק"ג עגבניות; בננות');
  assert.deepEqual(items.map((i) => i.name), ['חלב', 'לחם', 'עגבניות', 'בננות']);
});

test('categories: Hebrew head-noun and phrases', () => {
  const cases = {
    'חלב': 'dairy', 'חלב 3%': 'dairy', 'עגבניות': 'produce', 'עגבניות שרי': 'produce',
    'מיץ תפוזים': 'drinks', 'שוקולד חלב': 'snacks', 'רסק עגבניות': 'pantry', 'נייר טואלט': 'personal',
    'חזה עוף': 'meat', 'חזה הודו': 'deli', 'לחם מלא': 'bakery', 'פיתות': 'bakery', 'קוטג\'': 'dairy',
    'במבה': 'snacks', 'שמן זית': 'pantry', 'שמנת מתוקה': 'dairy', 'אבקת כביסה': 'cleaning',
    'סבון כלים': 'cleaning', 'משחת שיניים': 'personal', 'טיטולים': 'baby', 'חול לחתולים': 'pets',
    'ביצים': 'dairy', 'בננות': 'produce', 'תפוחי אדמה': 'produce', 'גלידה': 'frozen', 'קפה': 'breakfast',
    'טונה': 'pantry', 'סוכריות': 'snacks', 'סוכר': 'pantry', 'בייגלה': 'snacks', 'orange juice': 'drinks',
    'milk chocolate': 'snacks', 'eggs': 'dairy', 'דבר מוזר': 'other',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(categorize(name), cat, name);
  assert.equal(categorize('דבר מוזר', { 'דבר מוזר': 'home' }), 'home');
});

test('suggestions: running out based on interval', () => {
  let h = {};
  const item = [{ name: 'חלב', qty: 1, unit: 'unit', category: 'dairy' }];
  h = recordPurchase(h, item, normalizeName, new Date('2026-10-01'));
  h = recordPurchase(h, item, normalizeName, new Date('2026-10-08'));
  h = recordPurchase(h, item, normalizeName, new Date('2026-10-15'));
  h = recordPurchase(h, item, normalizeName, new Date('2026-10-15')); // same day ignored
  assert.equal(h['חלב'].purchases.length, 3);
  assert.equal(runningOut(h, new Set(), new Date('2026-10-17')).length, 0); // 2 of 7 days
  const due = runningOut(h, new Set(), new Date('2026-10-21'));
  assert.equal(due.length, 1);
  assert.equal(Math.round(due[0].avg), 7);
  assert.equal(runningOut(h, new Set(['חלב']), new Date('2026-10-21')).length, 0); // already on list
});

test('recipes scale', () => {
  const shak = RECIPES.find((r) => r.id === 'shakshuka');
  const eggs = scaleRecipe(shak, 8).find((i) => i.name === 'ביצים');
  assert.equal(eggs.qty, 16);
  const tom = scaleRecipe(shak, 2).find((i) => i.name === 'עגבניות');
  assert.equal(tom.qty, 0.5);
});

test('codec round-trip (Hebrew)', async () => {
  const items = [
    { name: 'חלב 3%', qty: 2, unit: 'unit', category: 'dairy' },
    { name: 'עגבניות', qty: 1.5, unit: 'kg', category: 'produce' },
  ];
  const code = await encodeList(items);
  assert.match(code, /^[dzp][A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeList(code), items);
  assert.deepEqual(await decodeList(encodeURIComponent(code)), items);
});

test('sheets: filters irrelevant hardware/furniture columns and keeps groceries', () => {
  const tsv = [
    'רשימת קניות\t\t\t\t\tארוחות לשבת',
    'דברים שצמחו באדמה\tדברים חלביים\tדברים נחמדים\tציוד בניה\tקניות כלליות',
    'ירקות\t\tסולת\tמקדחים 3,4,5 מ\'\'מ\tכיסא עבודה שמואל',
    'סלק לפחות 5\t\tביצים\tדיבלים פלוס מסמרים\tשולחן לסלון',
    'מנגולד\t\tאוסובוקו עם עצם\t\tסכום בשרי וחלבי',
    'כרובית?\t\tקינמונים\t\tצלחות כוסות קעריות',
    '\t\tשקית קוקי\t\t',
  ].join('\n');

  const grid = parseGrid(tsv);
  const { relevant, skipped } = analyzeSheetGrid(grid);
  const relNames = relevant.map((i) => i.name);

  assert.ok(relNames.includes('סלק'));
  assert.equal(relevant.find((i) => i.name === 'סלק').qty, 5);
  assert.ok(relNames.includes('מנגולד'));
  assert.ok(relNames.includes('סולת'));
  assert.ok(relNames.includes('אוסובוקו עם עצם'));
  assert.ok(relNames.includes('קינמונים'));
  assert.ok(relNames.includes('שקית קוקי'));
  assert.equal(relevant.find((i) => i.name === 'מנגולד').category, 'produce');
  assert.equal(relevant.find((i) => i.name === 'אוסובוקו עם עצם').category, 'meat');
  assert.equal(relevant.find((i) => i.name === 'קינמונים').category, 'breakfast');

  const skipRaws = skipped.map((s) => s.raw);
  assert.ok(!relNames.some((n) => n.includes('מקדח') || n.includes('כיסא') || n.includes('שולחן') || n.includes('דיבל')));
  assert.ok(skipRaws.some((r) => r.includes('מקדחים')));
  assert.ok(skipRaws.some((r) => r.includes('כיסא עבודה שמואל')));
  assert.ok(skipRaws.some((r) => r.includes('שולחן לסלון')));

  const csv = exportListToCsv([{ name: 'חלב', qty: 2, unit: 'unit', category: 'dairy', checked: true }], { ramilevy: { name: 'רמי לוי' } }, 'ramilevy');
  assert.ok(csv.startsWith('\uFEFFמחלקה,מוצר'));
});
