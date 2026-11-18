// 100 Hand-Crafted Directed Corner-Case Tests covering S1–S10 in spec.md.
import { buildStyledXlsxBuffer } from '../gen/render.mjs';

export function buildDirectedCases(dictionary) {
  const realById = new Map(dictionary.realItems.map((x) => [x.id, x]));
  const rareById = new Map(dictionary.rareItems.map((x) => [x.id, x]));
  const cases = [];
  let seq = 1;

  const nextId = (tag) => `DIR_${String(seq++).padStart(3, '0')}_${tag}`;

  const expReal = (id, qty = 1, unitOverride = null, checked = true) => {
    const e = realById.get(id) || rareById.get(id);
    return {
      dictId: e.id,
      canonical: e.canonical,
      kind: rareById.has(id) ? 'rare' : 'real',
      qty,
      unit: unitOverride || e.defaultUnit,
      checked,
      allowedCategories: e.category,
      mustIncludeAny: e.mustIncludeAny,
      mustExcludeAny: e.mustExcludeAny,
    };
  };

  // --- GROUP 1: 15 S1 No-Grocery / Error Corner Cases ---
  const noGroceryPayloads = [
    ['empty_str', 'text', 'lines', ''],
    ['spaces_only', 'text', 'lines', '   \n\t  \n  '],
    ['punctuation_only', 'text', 'lines', '???\n---\n***\n!!!'],
    ['headers_only_text', 'text', 'headers', '**מוצרי חלב**\nפירות וירקות:\n=== בשר ודגים ===\nרשימת קניות'],
    ['hardware_only_text', 'text', 'lines', 'מקדחה רוטטת בוש\nדיבלים 8 מ"מ וברגים\nפטיש 500 גרם\nפלס בנאים'],
    ['furniture_only_text', 'text', 'bullets', '• כיסא משרדי ארגונומי\n• שולחן פינת אוכל מאיקאה\n• ספה תלת מושבית'],
    ['errands_only_whatsapp', 'text', 'whatsapp', '[18/11/2026, 18:01] רוני: להתקשר לאמא לפני שבת\n[18/11/2026, 18:02] שמואל: לקבוע תור לרופא שיניים\n[18/11/2026, 18:03] רוני: לקחת חבילה מהדואר'],
    ['gibberish_ascii', 'text', 'commas', 'asdfghjkl, qwerty12345, zxcvbnm999'],
    ['urls_and_numbers', 'text', 'lines', 'https://example.com/item1\nwww.test.co.il\n123456\n99.90'],
    ['tsv_irrelevant_cols_only', 'tsv', 'tsv_horizontal', 'ציוד בניה\tריהוט\tאלקטרוניקה\nמקדחים 4 מ"מ\tארון בגדים 4 דלתות\tכבל HDMI 2 מטר\nמפתח שוודי\tשטיח סלון\tעכבר אלחוטי'],
    ['tsv_headers_only', 'tsv', 'tsv_vertical', 'רשימת קניות\tהערות\nפירות וירקות\t\nמוצרי חלב\t'],
    ['csv_empty_rows', 'csv', 'csv_quoted', '\uFEFFמוצר,כמות,יחידה\r\n,,\r\n  , , \r\n'],
    ['csv_appliances_only', 'csv', 'csv_quoted', '\uFEFFמוצר,כמות\r\n"מיקסר קנווד שף",1\r\n"מדפסת לייזר ביתית",1'],
    ['xlsx_hardware_only', 'xlsx', 'xlsx_styled', buildStyledXlsxBuffer([
      { rowKind: 'non_grocery', text: 'מקדחה רוטטת בוש' },
      { rowKind: 'non_grocery', text: 'שולחן פינת אוכל מאיקאה' },
    ])],
    ['clothes_only', 'text', 'numbered', '1. חולצת טי שירט לבנה\n2. מכנסי ג׳ינס כחולים\n3. נעלי ספורט נייקי'],
  ];

  for (const [tag, channel, layout, payload] of noGroceryPayloads) {
    cases.push({
      id: nextId(tag),
      kind: 'directed',
      seed: 0,
      bins: { channel, layout: layout === 'headers' ? 'lines' : layout, budget: 'none', noise: 'non_grocery', ambiguity: 'none', rarity: 'common_only', qtyStyle: 'plain_num' },
      stimulus: { channel, payload },
      expected: {
        expectNoGroceryError: true,
        expectedItems: [],
        expectedSkippedMin: payload.toString().trim() ? 1 : 0,
        forbiddenItemSubstrings: [],
      },
    });
  }

  // --- GROUP 2: All 36 Ambiguous Terms (S7) across channels ---
  dictionary.ambiguousItems.forEach((amb, idx) => {
    const mode = idx % 4;
    let stimulus;
    let layout;
    if (mode === 0) {
      layout = 'lines';
      stimulus = { channel: 'text', payload: `חלב 3%\n2 ${amb.term}\nלחם פרוס אחיד` };
    } else if (mode === 1) {
      layout = 'tsv_cols_qty';
      stimulus = { channel: 'tsv', payload: `מוצר\tכמות\tיחידה\nחלב 3%\t1\tיח'\n${amb.term}\t2\tיח'\nלחם פרוס אחיד\t1\tיח'` };
    } else if (mode === 2) {
      layout = 'csv_quoted';
      stimulus = { channel: 'csv', payload: `\uFEFFפריט,כמות,יחידה\r\nחלב 3%,1,יח'\r\n"${amb.term}",2,יח'\r\nלחם פרוס אחיד,1,יח'` };
    } else {
      layout = 'xlsx_styled';
      stimulus = {
        channel: 'xlsx',
        payload: buildStyledXlsxBuffer([
          { rowKind: 'item', text: 'חלב 3%', qty: 1, unit: 'unit', bought: false },
          { rowKind: 'item', text: amb.term, qty: 2, unit: 'unit', bought: false },
          { rowKind: 'item', text: 'לחם פרוס אחיד', qty: 1, unit: 'unit', bought: false },
        ]),
      };
    }

    cases.push({
      id: nextId(amb.id),
      kind: 'directed',
      seed: 0,
      bins: { channel: stimulus.channel, layout, budget: 'none', noise: 'clean', ambiguity: 'single_ambig', rarity: 'common_only', qtyStyle: 'plain_num' },
      stimulus,
      expected: {
        expectNoGroceryError: false,
        expectedItems: [
          expReal('milk_3', 1),
          {
            dictId: amb.id,
            canonical: amb.term,
            kind: 'ambiguous',
            qty: 2,
            unit: 'unit',
            checked: true,
            allowedCategories: null,
            ambiguousChoices: amb.choices,
          },
          expReal('bread_sliced', 1),
        ],
        expectedSkippedMin: 0,
        forbiddenItemSubstrings: [],
      },
    });
  });

  // --- GROUP 3: 12 Disambiguated Counterpart Pairs (must NOT trigger S7 ambiguity, must pass S9) ---
  const disambigPairs = [
    ['disamb_soda', 'מי סודה שוופס\nאבקת אפייה', [expReal('soda_water', 1, 'unit'), expReal('baking_powder', 1)]],
    ['disamb_pepper', '1 ק"ג פלפל אדום\nפלפל שחור טחון', [expReal('red_pepper', 1, 'kg'), expReal('black_pepper_ground', 1)]],
    ['disamb_cream', '2 שמנת מתוקה 38%\nשמנת חמוצה 15%', [expReal('sweet_cream_38', 2), expReal('sour_cream', 1)]],
    ['disamb_paper', 'נייר טואלט\nנייר סופג למטבח\nנייר אפייה', [expReal('toilet_paper', 1), expReal('paper_towels', 1), expReal('baking_paper', 1)]],
    ['disamb_apple_potato', '2 ק"ג תפוחי אדמה\n1.5 ק"ג תפוחי עץ', [expReal('potatoes', 2, 'kg'), expReal('apples', 1.5, 'kg')]],
    ['disamb_butter_pb', 'חמאה תנובה\nחמאת בוטנים', [expReal('butter', 1), expReal('peanut_butter', 1)]],
    ['disamb_milk_choc', '2 חלב 3%\n3 שוקולד חלב פרה', [expReal('milk_3', 2), expReal('milk_chocolate', 3)]],
    ['disamb_conditioner', 'מרכך כביסה בדין\nמרכך שיער פינוק', [expReal('fabric_softener', 1), expReal('hair_conditioner', 1)]],
    ['disamb_soap', 'נוזל כלים פיירי\nסבון ידיים נוזלי', [expReal('dish_soap', 1), expReal('hand_soap', 1)]],
    ['disamb_oil_olives', 'שמן זית כתית מעולה\nזיתים ירוקים', [expReal('olive_oil', 1), expReal('olives_green', 1)]],
    ['disamb_tuna', '2 טונה בשמן\nטונה במים', [expReal('tuna_oil', 2), expReal('tuna_water', 1)]],
    ['disamb_coffee', 'קפה נמס טסטרס צ׳ויס\nקפה שחור טורקי עלית', [expReal('instant_coffee', 1), expReal('turkish_coffee', 1)]],
  ];

  for (const [tag, payload, expectedItems] of disambigPairs) {
    cases.push({
      id: nextId(tag),
      kind: 'directed',
      seed: 0,
      bins: { channel: 'text', layout: 'lines', budget: 'b200_400', noise: 'clean', ambiguity: 'disambiguated', rarity: 'common_only', qtyStyle: 'plain_num' },
      stimulus: { channel: 'text', payload },
      expected: { expectNoGroceryError: false, expectedItems, expectedSkippedMin: 0, forbiddenItemSubstrings: [] },
    });
  }

  // --- GROUP 4: 12 Bought-Mark & Styled XLSX Cases (S4 + D5) ---
  const boughtCases = [
    ['bought_check_emoji', 'text', 'lines', '✅ 2 חלב 3%\nלחם פרוס אחיד\n☑ ביצים L', [expReal('milk_3', 2, 'unit', false), expReal('bread_sliced', 1, 'unit', true), expReal('eggs_l', 1, 'unit', false)]],
    ['bought_brackets_x', 'text', 'checkboxes', '[x] קוטג\' 5%\n[ ] 2 במבה אסם\n[V] חומוס אחלה', [expReal('cottage_5', 1, 'unit', false), expReal('bamba', 2, 'unit', true), expReal('hummus_salad', 1, 'unit', false)]],
    ['bought_markdown_strike', 'text', 'bullets', '• ~~שמן קנולה~~\n• 2 אורז בסמטי', [expReal('canola_oil', 1, 'unit', false), expReal('rice_basmati', 2, 'unit', true)]],
    ['bought_whatsapp', 'text', 'whatsapp', '[18/11/2026, 19:10] רוני: ✅ חלב 3%\n[18/11/2026, 19:11] שמואל: 2 ק"ג עגבניות', [expReal('milk_3', 1, 'unit', false), expReal('tomatoes', 2, 'kg', true)]],
    ['bought_tsv_true_col', 'tsv', 'tsv_cols_qty', 'מוצר\tכמות\tיחידה\tסטטוס\nחלב 3%\t2\tיח\'\tTRUE\nקוטג\' 5%\t3\tיח\'\tFALSE', [expReal('milk_3', 2, 'unit', false), expReal('cottage_5', 3, 'unit', true)]],
    ['bought_tsv_heb_col', 'tsv', 'tsv_cols_qty', 'פריט\tכמות\tנקנה\nלחם מלא\t1\tכן\nגבינה צהובה עמק\t2\tלא', [expReal('bread_whole', 1, 'unit', false), expReal('yellow_cheese', 2, 'unit', true)]],
    ['bought_csv_v_col', 'csv', 'csv_quoted', '\uFEFFמוצר,כמות,יחידה,נקנה\r\n"פסטה פנה",3,יח\',V\r\n"קטשופ אסם",1,יח\',', [expReal('pasta_penne', 3, 'unit', false), expReal('ketchup', 1, 'unit', true)]],
    ['xlsx_strike_and_colors_1', 'xlsx', 'xlsx_styled', buildStyledXlsxBuffer([
      { rowKind: 'header', text: 'מוצרי חלב' },
      { rowKind: 'item', text: 'חלב 3%', qty: 2, unit: 'unit', bought: true },
      { rowKind: 'item', text: "קוטג' 5%", qty: 2, unit: 'unit', bought: false },
      { rowKind: 'item', text: 'גבינה צהובה עמק', qty: 1, unit: 'unit', bought: false },
    ]), [expReal('milk_3', 2, 'unit', false), expReal('cottage_5', 2, 'unit', true), expReal('yellow_cheese', 1, 'unit', true)]],
    ['xlsx_strike_mixed_noise', 'xlsx', 'xlsx_styled', buildStyledXlsxBuffer([
      { rowKind: 'item', text: 'עגבניות', qty: 1.5, unit: 'kg', bought: false },
      { rowKind: 'item', text: 'מלפפונים', qty: 2, unit: 'kg', bought: true },
      { rowKind: 'non_grocery', text: 'מקדחה רוטטת בוש' },
    ]), [expReal('tomatoes', 1.5, 'kg', true), expReal('cucumbers', 2, 'kg', false)], 1],
    ['xlsx_all_bought_zero_total', 'xlsx', 'xlsx_styled', buildStyledXlsxBuffer([
      { rowKind: 'item', text: 'חלב 3%', qty: 1, unit: 'unit', bought: true },
      { rowKind: 'item', text: 'ביצים L', qty: 1, unit: 'unit', bought: true },
    ]), [expReal('milk_3', 1, 'unit', false), expReal('eggs_l', 1, 'unit', false)]],
    ['tsv_horiz_bought_cell', 'tsv', 'tsv_horizontal', 'פירות וירקות\tמוצרי חלב\n✅ 2 ק"ג עגבניות\t2 חלב 3%\n1 ק"ג מלפפונים\tקוטג\' 5%', [expReal('tomatoes', 2, 'kg', false), expReal('milk_3', 2, 'unit', true), expReal('cucumbers', 1, 'kg', true), expReal('cottage_5', 1, 'unit', true)]],
    ['csv_multiline_quoted_note', 'csv', 'csv_quoted', '\uFEFFמוצר,כמות,יחידה,הערות,נקנה\r\n"חזה עוף",2,"ק""ג","טרי,\nפרוס דק לשניצל",\r\n"אורז בסמטי",1,יח\',"סוגת",כן', [expReal('chicken_breast', 2, 'kg', true), expReal('rice_basmati', 1, 'unit', false)]],
  ];

  for (const [tag, channel, layout, payload, expectedItems, skippedMin = 0] of boughtCases) {
    cases.push({
      id: nextId(tag),
      kind: 'directed',
      seed: 0,
      bins: { channel, layout, budget: 'b200_400', noise: 'bought_marks', ambiguity: 'none', rarity: 'common_only', qtyStyle: 'mixed_styles' },
      stimulus: { channel, payload },
      expected: { expectNoGroceryError: false, expectedItems, expectedSkippedMin: skippedMin, forbiddenItemSubstrings: [] },
    });
  }

  // --- GROUP 5: 10 Quantity Styles & Synonym Merge Cases (S5 + S6) ---
  const qtyMergeCases = [
    ['qty_fractions_half_kg', '1/2 ק"ג עגבניות\nחצי קילו מלפפונים\n1500 גרם חזה עוף', 'fractions_weights', [expReal('tomatoes', 0.5, 'kg'), expReal('cucumbers', 0.5, 'kg'), expReal('chicken_breast', 1.5, 'kg')]],
    ['qty_hebrew_words', 'שתי חבילות פיתות\nשלוש במבה אסם\nקילו בננות', 'hebrew_words', [expReal('pita', 2, 'pack'), expReal('bamba', 3, 'unit'), expReal('bananas', 1, 'kg')]],
    ['qty_mult_x_variants', 'במבה אסם x4\nx3 ביסלי גריל\n2x קוקה קולה זירו', 'mult_x', [expReal('bamba', 4), expReal('bissli', 3), expReal('cola_zero', 2)]],
    ['qty_glued_units', '2ק"ג תפוחי אדמה\n500גרם גזר\nחלב 3% 2', 'fractions_weights', [expReal('potatoes', 2, 'kg'), expReal('carrots', 500, 'g'), expReal('milk_3', 2, 'unit')]],
    ['qty_product_numbers_preserved', '2 חלב 3%\nקוקה קולה 1.5 ליטר\nשמנת מתוקה 38%', 'plain_num', [expReal('milk_3', 2), expReal('coca_cola', 1), expReal('sweet_cream_38', 1)]],
    ['syn_merge_cottage', "2 קוטג' 5%\nקוטג 5%\n1 קוטג׳ 5%", 'synonym_merge', [expReal('cottage_5', 4)]],
    ['syn_merge_tomatoes', '1.5 ק"ג עגבניות\n1 ק"ג עגבניה', 'synonym_merge', [expReal('tomatoes', 2.5, 'kg')]],
    ['syn_merge_bilingual_milk', '2 חלב 3%\n1 milk 3%', 'synonym_merge', [expReal('milk_3', 3)]],
    ['syn_merge_cola_zero', '3 קוקה קולה זירו\n2 קולה זירו', 'synonym_merge', [expReal('cola_zero', 5)]],
    ['syn_merge_diapers_tahini', '1 טיטולים האגיס\n2 חיתולי האגיס\nטחינה גולמית', 'synonym_merge', [expReal('diapers', 3), expReal('tahini_raw', 1)]],
  ];

  for (const [tag, payload, qtyStyle, expectedItems] of qtyMergeCases) {
    cases.push({
      id: nextId(tag),
      kind: 'directed',
      seed: 0,
      bins: { channel: 'text', layout: 'lines', budget: 'b200_400', noise: 'clean', ambiguity: 'none', rarity: 'common_only', qtyStyle },
      stimulus: { channel: 'text', payload },
      expected: { expectNoGroceryError: false, expectedItems, expectedSkippedMin: 0, forbiddenItemSubstrings: [] },
    });
  }

  // --- GROUP 6: 15 Orthogonal Layouts, Weird Headlines, WhatsApp Chats & Rare Items (S2, S3, S8) ---
  const specialCases = [
    {
      tag: 'rare_unobtainable_partial',
      channel: 'text',
      layout: 'lines',
      rarity: 'with_rare',
      noise: 'clean',
      payload: 'חלב 3%\nפטריות כמהין שחורות טריות מצרפת\nלחם פרוס אחיד',
      expectedItems: [expReal('milk_3', 1), expReal('rare_camel_truffle_fantasy', 1), expReal('bread_sliced', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'rare_gourmet_basket',
      channel: 'text',
      layout: 'bullets',
      rarity: 'with_rare',
      noise: 'clean',
      payload: '• גבינת חלומי\n• גבינת מסקרפונה\n• שמן כמהין\n• אצות נורי לסושי\n• קמח כוסמין מלא',
      expectedItems: [expReal('rare_halloumi', 1), expReal('rare_mascarpone', 1), expReal('rare_truffle_oil', 1), expReal('rare_nori', 1), expReal('rare_spelt_flour', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'rare_asian_cooking',
      channel: 'text',
      layout: 'commas',
      rarity: 'with_rare',
      noise: 'clean',
      payload: 'חומץ אורז לסושי, שמן שומשום קלוי, מחית מיסו בהיר, טופו משי רך, 2 אורז בסמטי',
      expectedItems: [expReal('rare_rice_vinegar', 1), expReal('rare_sesame_oil', 1), expReal('rare_miso', 1), expReal('rare_silken_tofu', 1), expReal('rice_basmati', 2)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'weird_decorated_headlines',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'headers',
      payload: '✨ === קניות לשבת קודש === ✨\n--- מוצרי חלב: ---\n2 חלב 3%\n**פירות וירקות**\n2 ק"ג עגבניות\n### לחם ומאפים ###\n2 חלה לשבת',
      expectedItems: [expReal('milk_3', 2), expReal('tomatoes', 2, 'kg'), expReal('challah', 2)],
      skippedMin: 0,
      forbidden: ['קניות לשבת', 'מוצרי חלב', 'פירות וירקות', 'לחם ומאפים'],
    },
    {
      tag: 'whatsapp_family_mixed_chat',
      channel: 'text',
      layout: 'whatsapp',
      rarity: 'common_only',
      noise: 'whatsapp_chat',
      payload: [
        '[18/11/2026, 17:40] אמא: רשימת קניות',
        '[18/11/2026, 17:41] אמא: 2 חלב 3%',
        '[18/11/2026, 17:42] שמואל: תביאו גם 3 במבה אסם',
        '[18/11/2026, 17:43] רוני: להתקשר לאמא לפני שבת',
        '[18/11/2026, 17:44] דני: מקדחה רוטטת בוש',
        '[18/11/2026, 17:45] אמא: 1.5 ק"ג עגבניות',
      ].join('\n'),
      expectedItems: [expReal('milk_3', 2), expReal('bamba', 3), expReal('tomatoes', 1.5, 'kg')],
      skippedMin: 2,
      forbidden: ['להתקשר לאמא', 'מקדחה', 'אמא:', 'שמואל:'],
    },
    {
      tag: 'orthogonal_5col_family_sheet',
      channel: 'tsv',
      layout: 'tsv_horizontal',
      rarity: 'common_only',
      noise: 'heavy_mixed',
      payload: [
        'דברים שצמחו באדמה\tדברים חלביים\tמזווה\tציוד בניה\tקניות כלליות',
        '2 ק"ג עגבניות\t2 חלב 3%\tאורז בסמטי\tמקדחים 4,6,8 מ"מ\tכיסא משרדי ארגונומי',
        '1 ק"ג מלפפונים\tקוטג\' 5%\tפסטה פנה\tדיבלים 8 מ"מ וברגים\tשולחן פינת אוכל מאיקאה',
        '1 ק"ג בצל יבש\tביצים L\tשמן קנולה\t\tכבל HDMI 2 מטר',
      ].join('\n'),
      expectedItems: [
        expReal('tomatoes', 2, 'kg'), expReal('milk_3', 2), expReal('rice_basmati', 1),
        expReal('cucumbers', 1, 'kg'), expReal('cottage_5', 1), expReal('pasta_penne', 1),
        expReal('onions', 1, 'kg'), expReal('eggs_l', 1), expReal('canola_oil', 1),
      ],
      skippedMin: 5,
      forbidden: ['מקדחים', 'דיבלים', 'כיסא', 'שולחן', 'HDMI'],
    },
    {
      tag: 'multi_ambiguous_plus_real',
      channel: 'text',
      layout: 'bullets',
      rarity: 'common_only',
      noise: 'clean',
      ambiguity: 'multi_ambig',
      payload: '• סודה\n• פלפל\n• נייר\n• 2 חלב 3%',
      expectedItems: [
        { dictId: 'amb_soda', canonical: 'סודה', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, ambiguousChoices: ['מי סודה לשתייה', 'סודה לשתייה (אפייה)'] },
        { dictId: 'amb_pepper', canonical: 'פלפל', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, ambiguousChoices: ['פלפל אדום (ירק)', 'פלפל שחור טחון (תבלין)', 'פלפל חריף ירוק'] },
        { dictId: 'amb_paper', canonical: 'נייר', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, ambiguousChoices: ['נייר טואלט', 'נייר סופג למטבח', 'נייר אפייה'] },
        expReal('milk_3', 2),
      ],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'xlsx_large_hosting_shabbat',
      channel: 'xlsx',
      layout: 'xlsx_styled',
      rarity: 'with_rare',
      noise: 'headers',
      payload: buildStyledXlsxBuffer([
        { rowKind: 'header', text: 'בשר ודגים לשבת' },
        { rowKind: 'item', text: 'סטייק אנטריקוט', qty: 3, unit: 'kg', bought: false },
        { rowKind: 'item', text: 'פילה סלמון', qty: 2, unit: 'kg', bought: false },
        { rowKind: 'item', text: 'חזה עוף', qty: 3, unit: 'kg', bought: false },
        { rowKind: 'header', text: 'יינות וגבינות' },
        { rowKind: 'item', text: 'יין אדום יבש', qty: 4, unit: 'unit', bought: false },
        { rowKind: 'item', text: 'גבינת חלומי', qty: 2, unit: 'unit', bought: false },
      ]),
      expectedItems: [expReal('entrecote', 3, 'kg'), expReal('salmon_fillet', 2, 'kg'), expReal('chicken_breast', 3, 'kg'), expReal('red_wine', 4), expReal('rare_halloumi', 2)],
      skippedMin: 0,
      forbidden: ['בשר ודגים לשבת', 'יינות וגבינות'],
    },
    {
      tag: 'uncertain_question_mark_items',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: 'כרובית?\n2 אבוקדו?\nלחם מלא',
      expectedItems: [expReal('cauliflower', 1), expReal('avocado', 2, 'unit'), expReal('bread_whole', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'qualifiers_at_least_approx',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: 'סלק אדום לפחות 2 ק"ג\nעגבניות בערך 3 ק"ג\nבמבה אסם לפחות 4',
      expectedItems: [expReal('beets', 2, 'kg'), expReal('tomatoes', 3, 'kg'), expReal('bamba', 4)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'english_only_basket',
      channel: 'text',
      layout: 'commas',
      rarity: 'common_only',
      noise: 'clean',
      payload: '2 milk 3%, cottage cheese, 2 kg tomatoes, 1 kg bananas, ketchup, olive oil',
      expectedItems: [expReal('milk_3', 2), expReal('cottage_5', 1), expReal('tomatoes', 2, 'kg'), expReal('bananas', 1, 'kg'), expReal('ketchup', 1), expReal('olive_oil', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'baby_and_pets_household',
      channel: 'tsv',
      layout: 'tsv_cols_qty',
      rarity: 'common_only',
      noise: 'clean',
      payload: "מוצר\tכמות\tיחידה\nחיתולי האגיס\t3\tיח'\nמטרנה אקסטרה קר\t2\tיח'\nמגבונים לחים לתינוק האגיס\t2\tיח'\nמזון יבש לחתולים פריסקיז\t2\tיח'\nחול מתגבש לחתולים\t1\tיח'",
      expectedItems: [expReal('diapers', 3), expReal('baby_formula', 2), expReal('baby_wipes', 2), expReal('cat_food', 2), expReal('cat_litter', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'cleaning_full_closet',
      channel: 'csv',
      layout: 'csv_quoted',
      rarity: 'common_only',
      noise: 'clean',
      payload: '\uFEFFפריט,כמות,יחידה\r\n"ג׳ל כביסה פרסיל",2,יח\'\r\n"מרכך כביסה בדין",2,יח\'\r\n"טבליות למדיח פיניש",2,יח\'\r\n"אקונומיקה סנו ז׳אוול",2,יח\'\r\n"שקיות אשפה חזקות",3,יח\'\r\n"נייר טואלט לילי 32 גלילים",2,יח\'',
      expectedItems: [expReal('laundry_gel', 2), expReal('fabric_softener', 2), expReal('dishwasher_tabs', 2), expReal('bleach', 2), expReal('trash_bags', 3), expReal('toilet_paper', 2)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'semicolons_and_arabic_comma',
      channel: 'text',
      layout: 'commas',
      rarity: 'common_only',
      noise: 'clean',
      payload: '2 חלב 3%； קוטג\' 5% ، 2 לחם פרוס אחיד ; 3 במבה אסם',
      expectedItems: [expReal('milk_3', 2), expReal('cottage_5', 1), expReal('bread_sliced', 2), expReal('bamba', 3)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'spices_and_baking_shelf',
      channel: 'text',
      layout: 'numbered',
      rarity: 'with_rare',
      noise: 'clean',
      payload: '1. קמח חיטה לבן\n2. קמח תופח\n3. סוכר לבן\n4. סוכר חום דמררה\n5. אבקת אפייה\n6. סוכר וניל\n7. שמרים יבשים\n8. קמח שקדים מולבנים',
      expectedItems: [expReal('flour_white', 1), expReal('flour_self_rising', 1), expReal('sugar_white', 1), expReal('sugar_brown', 1), expReal('baking_powder', 1), expReal('vanilla_sugar', 1), expReal('dry_yeast', 1), expReal('rare_almond_flour', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    // --- GROUP 7: 10 Post-Review Hardening Cases (H2, H3, H6, H7, H8, C1, M7, M10) ---
    {
      tag: 'deny_boundary_burgul_burger_salt_descaler',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '2 בורגול\n2 המבורגר בקר\nמלח שולחן\nמפיות נייר לשולחן\nמסיר אבנית אנטי קאלק\n2 שקיות זבל',
      expectedItems: [expReal('bulgur', 2), expReal('burgers', 2), expReal('salt', 1), expReal('napkins', 1), expReal('limescale_remover', 1), expReal('trash_bags', 2)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'csv_midfield_gershayim_units',
      channel: 'csv',
      layout: 'csv_quoted',
      rarity: 'common_only',
      noise: 'clean',
      payload: '\uFEFFפריט,כמות,יחידה\r\nתפו"א,2,ק"ג\r\nחלב 3%,2,יח\'\r\nלחם מלא,1,יח\'',
      expectedItems: [expReal('potatoes', 2, 'kg'), expReal('milk_3', 2), expReal('bread_whole', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'unseen_plural_and_qualified_ambiguous',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      ambiguity: 'multi_ambig',
      payload: 'פלפלים\nגבינות\nסודה גדולה\nבקבוק שמן\n2 חלב 3%',
      expectedItems: [
        { dictId: 'amb_pepper', canonical: 'פלפל', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, vocabSplit: 'unseen', ambiguousChoices: ['פלפל אדום (ירק)', 'פלפל שחור טחון (תבלין)', 'פלפל חריף ירוק'] },
        { dictId: 'amb_cheese', canonical: 'גבינה', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, vocabSplit: 'unseen', ambiguousChoices: ['גבינה לבנה 5%', 'גבינה צהובה עמק', 'גבינה בולגרית'] },
        { dictId: 'amb_soda', canonical: 'סודה', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, vocabSplit: 'unseen', ambiguousChoices: ['מי סודה לשתייה', 'סודה לשתייה (אפייה)'] },
        { dictId: 'amb_oil', canonical: 'שמן', kind: 'ambiguous', qty: 1, unit: 'unit', checked: true, vocabSplit: 'unseen', ambiguousChoices: ['שמן קנולה', 'שמן זית כתית מעולה'] },
        expReal('milk_3', 2),
      ],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'inline_partial_strikethrough_with_qty',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'bought_marks',
      payload: '~~חלב 3%~~ 2\n3 במבה אסם',
      expectedItems: [expReal('milk_3', 2, 'unit', false), expReal('bamba', 3, 'unit', true)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'header_range_trailing_digits_preserved',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: 'חלה לשבת 2\nלחם פרוס אחיד 3\nקוטג\' 5% 4',
      expectedItems: [expReal('challah', 2), expReal('bread_sliced', 3), expReal('cottage_5', 4)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'must_not_merge_milk_fats_and_tuna',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '2 חלב 3%\n1 חלב 1%\n2 טונה בשמן\n1 טונה במים',
      expectedItems: [expReal('milk_3', 2), expReal('milk_1', 1), expReal('tuna_oil', 2), expReal('tuna_water', 1)],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'must_not_merge_sugars_flours_onions',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '1 סוכר לבן\n1 סוכר חום דמררה\n1 קמח חיטה לבן\n1 קמח תופח\n1 ק"ג בצל יבש\n1 ק"ג בצל סגול',
      expectedItems: [expReal('sugar_white', 1), expReal('sugar_brown', 1), expReal('flour_white', 1), expReal('flour_self_rising', 1), expReal('onions', 1, 'kg'), expReal('red_onion', 1, 'kg')],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'unseen_heldout_aliases_merge',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '1 קרטון חלב 3% תנובה\n2 חלב רגיל 3%\n1 קופסא גבינה לבנה 5%\n1 גבינה לבנה 5% תנובה\n1 טחינא גולמית\n1 צנצנת טחינה גולמית',
      expectedItems: [
        { ...expReal('milk_3', 3), vocabSplit: 'unseen' },
        { ...expReal('white_cheese_5', 2), vocabSplit: 'unseen' },
        { ...expReal('tahini_raw', 2), vocabSplit: 'unseen' },
      ],
      skippedMin: 0,
      forbidden: [],
    },
    // --- GROUP 8: Israeli Weighted-Produce Piece-Weight vs. Bare-Default Specification ---
    {
      tag: 'produce_piece_weight_explicit_counts',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '3 גזרים\n5 מלפפונים\n1.5 ק"ג תפוחי אדמה',
      expectedItems: [expReal('carrots', 3, 'unit'), expReal('cucumbers', 5, 'unit'), expReal('potatoes', 1.5, 'kg')],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'produce_bare_household_defaults',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: 'גזר\nשום\nלימון',
      expectedItems: [expReal('carrots', 1, 'unit'), expReal('garlic', 1, 'unit'), expReal('lemons', 1, 'unit')],
      skippedMin: 0,
      forbidden: [],
    },
    {
      tag: 'produce_packaged_vs_single_head',
      channel: 'text',
      layout: 'lines',
      rarity: 'common_only',
      noise: 'clean',
      payload: '3 חבילות גזר\n1 כרובית\nכרוב לבן',
      expectedItems: [expReal('carrots', 3, 'pack'), expReal('cauliflower', 1, 'unit'), expReal('cabbage_white', 1, 'unit')],
      skippedMin: 0,
      forbidden: [],
    },
  ];

  for (const sc of specialCases) {
    cases.push({
      id: nextId(sc.tag),
      kind: 'directed',
      seed: 0,
      bins: {
        channel: sc.channel,
        layout: sc.layout,
        budget: 'b200_400',
        noise: sc.noise,
        ambiguity: sc.ambiguity || 'none',
        rarity: sc.rarity,
        qtyStyle: 'mixed_styles',
      },
      stimulus: { channel: sc.channel, payload: sc.payload },
      expected: {
        expectNoGroceryError: false,
        expectedItems: sc.expectedItems,
        expectedSkippedMin: sc.skippedMin,
        forbiddenItemSubstrings: sc.forbidden,
      },
    });
  }

  return cases;
}
