// Unit tests for importer, synonyms, xlsx/zip bounds & self-closing XML, CSV mid-field quotes, Rami Levy promos, and asymmetric delivery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { importFromText, importFromSheetText, importFromGrid, applyItemsToList } from '../web/js/importer.js';
import { checkAmbiguousTerm, resolveGrocerySynonym } from '../web/js/synonyms.js';
import { parseXlsxBuffer } from '../web/js/xlsx.js';
import { listZipEntries } from '../web/js/zip.js';
import { parseGrid, isSectionHeaderText } from '../web/js/sheets.js';
import { chargeQty, compareBasket } from '../web/js/pricing.js';
import { buildCatalogBundle, matchLineAcrossChains } from '../web/js/prices.js';
import { parsePromosXml } from '../pipeline/promos.mjs';
import { writeZip } from './regression/lib/zip-writer.mjs';

test('importer & applyItemsToList: preserves bought (checked: false), flags ambiguous, and never overwrites unit mismatches (C2, D3, D4)', () => {
  const res = importFromText('✅ 2 חלב 3%\nסודה\n1.5 ק"ג עגבניות\n~~לחם מלא~~ 2');
  assert.equal(res.error, null);
  assert.equal(res.added.length, 4);

  const milk = res.added.find((x) => x.name.includes('חלב'));
  assert.equal(milk.checked, false);
  assert.equal(milk.qty, 2);

  const bread = res.added.find((x) => x.name.includes('לחם'));
  assert.equal(bread.checked, false);
  assert.equal(bread.qty, 2);
  assert.equal(bread.name, 'לחם מלא'); // no leftover ~~ markup (M10)

  const soda = res.added.find((x) => x.name === 'סודה');
  assert.ok(soda.ambiguous && soda.ambiguous.choices.length >= 2);

  // Add onto existing list: unit mismatch ("עגבניות" unit vs kg) keeps two distinct lines instead of overwriting!
  const { nextList } = applyItemsToList(res.added, [{ name: 'עגבניות', qty: 4, unit: 'unit', checked: true }]);
  const tomatoLines = nextList.filter((x) => x.name.includes('עגבני'));
  assert.equal(tomatoLines.length, 2);
  assert.equal(nextList.find((x) => x.name.includes('חלב')).checked, false);
  assert.ok(nextList.find((x) => x.name === 'סודה').ambiguous);
});

test('synonyms: generalizes to unseen plural/qualified ambiguous terms and never merges competing brands or distinct products (C1, H3)', () => {
  // Unseen plural & qualified ambiguous terms
  for (const raw of ['פלפלים', 'גבינות', 'ניירות', 'סודה גדולה', 'בקבוק שמן', 'קופסת טונה']) {
    assert.ok(checkAmbiguousTerm(raw), `expected "${raw}" to be flagged ambiguous`);
  }
  // Disambiguated phrases must NOT be flagged
  for (const raw of ['פלפל אדום', 'גבינה צהובה', 'נייר טואלט', 'מי סודה', 'שמן זית', 'טונה בשמן']) {
    assert.equal(checkAmbiguousTerm(raw), null, `expected "${raw}" NOT to be ambiguous`);
  }

  // Must-NOT-merge pairs (H3)
  const mustStaySeparate = [
    ['נרות שבת', 'גפרורים'],
    ['קוקה קולה זירו', 'פפסי מקס'],
    ['עדשים כתומות', 'עדשים ירוקות'],
    ['תה שחור ויסוצקי', 'תה ירוק ויסוצקי'],
    ['בירה גולדסטאר', 'בירה מכבי'],
    ['ג׳ל כביסה פרסיל', 'ג׳ל כביסה אריאל'],
    ['חומוס אחלה', 'חומוס צבר'],
    ['קרואסון חמאה', 'קרואסון שוקולד'],
  ];
  for (const [a, b] of mustStaySeparate) {
    const imp = importFromText(`1 ${a}\n1 ${b}`);
    assert.equal(imp.added.length, 2, `expected "${a}" and "${b}" NOT to merge`);
  }
});

test('sheets & importer: word-bounded deny rules keep בורגול/המבורגר/מלח שולחן/מסיר אבנית and #\\-: keeps חטיפים 3 (H7, H8, M7)', () => {
  assert.equal(isSectionHeaderText('חטיפים 3'), false);
  assert.equal(isSectionHeaderText('בשר 1'), false);
  assert.equal(isSectionHeaderText('=== בשר ודגים ==='), true);

  const res = importFromText('2 בורגול\n2 המבורגר בקר\nמלח שולחן\nמפיות נייר לשולחן\nמסיר אבנית אנטי קאלק\n2 שקיות זבל');
  assert.equal(res.error, null);
  assert.equal(res.skipped.length, 0);
  assert.equal(res.added.length, 6);
  const bags = res.added.find((x) => x.name.includes('שקיות'));
  assert.ok(bags, 'expected "שקיות זבל" to retain container noun');
  assert.equal(bags.qty, 2);
});

test('CSV & TSV parser: mid-field gershayim (ק"ג, תפו"א) never swallow subsequent rows (H6)', () => {
  const csv = 'פריט,כמות,יחידה\nתפו"א,2,ק"ג\nעגבניות,3,ק"ג\nחלב 3%,1,יח\'';
  const grid = parseGrid(csv);
  assert.equal(grid.length, 4);
  const imp = importFromSheetText(csv);
  assert.equal(imp.added.length, 3);
  assert.equal(imp.added[0].qty, 2);
  assert.equal(imp.added[0].unit, 'kg');
});

test('xlsx: handles self-closing cells/rows, mixed <xf> styles, workbook sheet order, rich-text strike, and zip-bomb limits (H5, M2, L1)', async () => {
  const wbXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Main" sheetId="1" r:id="rIdSheet2"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSheet2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <fonts count="2"><font><sz val="11"/></font><font><strike/><sz val="11"/></font></fonts>
    <cellXfs count="3">
      <xf numFmtId="0" fontId="0"/>
      <xf numFmtId="0" fontId="0"><alignment readingOrder="2"/></xf>
      <xf numFmtId="0" fontId="1" applyFont="1"><alignment readingOrder="2"/></xf>
    </cellXfs>
  </styleSheet>`;
  const sstXml = `<?xml version="1.0" encoding="UTF-8"?><sst count="3" uniqueCount="3"><si><t>חלב 3%</t></si><si><t>לחם מלא</t></si><si><r><rPr><strike/></rPr><t>ביצים L</t></r></si></sst>`;
  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
    <row r="1" s="1"/>
    <row r="2"><c r="A2" s="1"/><c r="B2" t="s" s="1"><v>0</v></c><c r="C2" t="s" s="2"><v>1</v></c></row>
    <row r="3"><c r="B3" t="s"><v>2</v></c></row>
  </sheetData></worksheet>`;

  const buf = writeZip([
    { name: 'xl/workbook.xml', data: wbXml },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: stylesXml },
    { name: 'xl/sharedStrings.xml', data: sstXml },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml },
  ]);

  const parsed = await parseXlsxBuffer(buf);
  assert.equal(parsed.grid[1][1], 'חלב 3%');
  assert.equal(parsed.grid[1][2], 'לחם מלא');
  assert.equal(parsed.grid[2][1], 'ביצים L');
  assert.ok(parsed.strikeCells.has('1:2'), 'mixed <xf> strikethrough cell C2 must be detected');
  assert.ok(parsed.strikeCells.has('2:1'), 'rich-text <rPr><strike/> cell B3 must be detected');

  // Zip-bomb / maxXmlBytes rejection check (M2)
  const hugeZeros = Buffer.alloc(300_000, 'A');
  const deflatedHuge = zlib.deflateRawSync(hugeZeros);
  // Build zip with small maxXmlBytes limit (50 KB) and verify immediate rejection
  const bombZip = writeZip([
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${hugeZeros.toString()}</t></is></c></row></sheetData></worksheet>` },
  ]);
  await assert.rejects(
    () => parseXlsxBuffer(bombZip, { maxXmlBytes: 50_000 }),
    /exceeds limit|XLSX_ENTRY_TOO_LARGE/i,
  );
  void deflatedHuge;
  void listZipEntries;
});

test('promos: parses Rami Levy <PromotionItems><Item> and skips per-item IsGiftItem=1 (H2)', () => {
  const rlXml = `<Promotions><StoreId>039</StoreId>
    <Promotion>
      <PromotionStartDate>2026-11-01</PromotionStartDate>
      <PromotionEndDate>2026-12-01</PromotionEndDate>
      <MinQty>2</MinQty>
      <DiscountedPrice>25</DiscountedPrice>
      <Clubs><ClubId>0</ClubId></Clubs>
      <PromotionItems count="2">
        <Item><ItemCode>7290110322014</ItemCode><IsGiftItem>0</IsGiftItem></Item>
        <Item><ItemCode>2684206</ItemCode><IsGiftItem>1</IsGiftItem></Item>
      </PromotionItems>
    </Promotion>
  </Promotions>`;
  const { promosByItem } = parsePromosXml(rlXml, { now: new Date('2026-11-18T12:00:00Z') });
  assert.deepEqual(promosByItem.get('7290110322014'), { type: 'bundle', qty: 2, price: 25 });
  assert.equal(promosByItem.has('2684206'), false);
});

test('pricing: compares on apples-to-apples subtotal when delivery fees are asymmetric (M1)', () => {
  const lines = [{
    id: '1',
    qty: 1,
    unit: 'unit',
    matches: {
      shufersal: { price: 95 },
      ramilevy: { price: 100 },
    },
  }];
  const cmp = compareBasket(lines, ['shufersal', 'ramilevy'], {
    shufersal: { fee: 29.9, freeOver: 750 },
    ramilevy: { fee: null, freeOver: null },
  }, { includeDelivery: true });

  assert.equal(cmp.perChain.shufersal.total, 124.9);
  assert.equal(cmp.perChain.ramilevy.total, 100);
  assert.equal(cmp.comparedOnSubtotalOnly, true);
  assert.equal(cmp.cheapestId, 'shufersal'); // 95 < 100 apples-to-apples subtotal
  assert.equal(cmp.savings, 5);
});

test('produce weight pipeline: preserves qtyExplicit across text/sheets/applyItemsToList and prices pieces vs bare defaults', () => {
  const imp = importFromText('3 גזרים\n5 מלפפונים\nפלפל חריף\n1.5 ק״ג גזר\n1 אבטיח ?');
  assert.equal(imp.error, null);
  const { nextList } = applyItemsToList([], imp.added);

  const carrots3 = nextList.find((x) => x.name === 'גזרים' && x.unit === 'unit');
  assert.equal(carrots3.qty, 3);
  assert.equal(carrots3.unit, 'unit');
  assert.equal(carrots3.qtyExplicit, true);
  assert.equal(chargeQty(carrots3, { weighted: true }).qty, 0.36);

  const carrotsKg = nextList.find((x) => x.name === 'גזר' && x.unit === 'kg');
  assert.equal(carrotsKg.qty, 1.5);
  assert.equal(carrotsKg.unit, 'kg');
  assert.equal(carrotsKg.qtyExplicit, true);
  assert.equal(chargeQty(carrotsKg, { weighted: true }).qty, 1.5);

  const cukes5 = nextList.find((x) => x.name === 'מלפפונים');
  assert.equal(cukes5.qty, 5);
  assert.equal(cukes5.qtyExplicit, true);
  assert.equal(chargeQty(cukes5, { weighted: true }).qty, 0.65);

  const hotPepperBare = nextList.find((x) => x.name === 'פלפל חריף');
  assert.equal(hotPepperBare.qty, 1);
  assert.equal(hotPepperBare.qtyExplicit, false);
  assert.equal(chargeQty(hotPepperBare, { weighted: true }).qty, 0.25);

  const watermelon1 = nextList.find((x) => x.name === 'אבטיח');
  assert.equal(watermelon1.qty, 1);
  assert.equal(watermelon1.qtyExplicit, true);
  assert.equal(chargeQty(watermelon1, { weighted: true }).qty, 6);

  // Bare "גזר" in free text AND in structured sheet table (empty vs non-empty qtyCol)
  const bareText = importFromText('גזר');
  assert.equal(bareText.added[0].qtyExplicit, false);
  assert.equal(chargeQty(bareText.added[0], { weighted: true }).qty, 1.0);

  const sheetRes = importFromSheetText('מוצר,כמות,יחידה\nגזר,,\nעגבניה,1,יח\'');
  const { nextList: sheetList } = applyItemsToList([], sheetRes.added);
  const bareCarrot = sheetList.find((x) => x.name === 'גזר');
  const oneTomato = sheetList.find((x) => x.name === 'עגבניה');
  assert.equal(bareCarrot.qtyExplicit, false);
  assert.equal(chargeQty(bareCarrot, { weighted: true }).qty, 1.0);
  assert.equal(oneTomato.qtyExplicit, true);
  assert.equal(chargeQty(oneTomato, { weighted: true }).qty, 0.15);

  // Packaged unit ("3 חבילות גזר") gives +18 bonus to non-weighted packaged catalog entries
  const catalog = buildCatalogBundle({
    '100': ['גזר במשקל', '', 1, 'ק"ג', 1],
    '200': ['גזר ארוז בשקית', '', 1, 'יח', 0],
  });
  const branchData = {
    shufersal: { catalog, storePrices: { '100': [6.9, 6.9], '200': [8.9, 8.9] } },
  };
  const packImp = importFromText('3 חבילות גזר');
  const packMatch = matchLineAcrossChains(packImp.added[0], branchData);
  assert.equal(packMatch.shufersal.code, '200');
  assert.equal(packMatch.shufersal.weighted, false);
});
