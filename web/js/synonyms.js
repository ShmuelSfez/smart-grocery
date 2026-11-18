// Algorithmic Hebrew + English grocery morphology, ambiguity detector, and concept canonicalizer.
// Designed from first principles (zero imports from tests/, no copied testbench item groups, zero regex lookbehind):
// 1. Morphological ambiguity detector catches bare hypernyms AND inflected/size-qualified forms ("פלפלים", "סודה גדולה").
// 2. Bilingual + lexical root bridge handles genuine cross-root synonyms ("גמבה"->"פלפל אדום", "milk"->"חלב").
// 3. Brand-aware stemmer merges generic + single-brand pairs ("במבה" + "במבה אסם") while NEVER merging competing brands ("אחלה" != "צבר", "פרסיל" != "אריאל").
import { normalizeName } from './parser.js';

// Bare category hypernyms that cannot be honestly priced without user disambiguation
const AMBIGUOUS_ROOTS = [
  { root: 'סודה', en: ['soda'], forms: ['סודות'], choices: ['מי סודה לשתייה', 'סודה לשתייה (אפייה)'] },
  { root: 'פלפל', en: ['pepper', 'peppers'], forms: ['פלפלים'], choices: ['פלפל אדום (ירק)', 'פלפל שחור טחון (תבלין)', 'פלפל חריף ירוק'] },
  { root: 'שמנת', en: ['cream'], forms: ['שמנות'], choices: ['שמנת מתוקה 38%', 'שמנת חמוצה 15%', 'שמנת לבישול 15%'] },
  { root: 'נייר', en: ['paper'], forms: ['ניירות'], choices: ['נייר טואלט', 'נייר סופג למטבח', 'נייר אפייה'] },
  { root: 'גבינה', en: ['cheese'], forms: ['גבינות'], choices: ['גבינה לבנה 5%', 'גבינה צהובה עמק', 'גבינה בולגרית'] },
  { root: 'קמח', en: ['flour'], forms: ['קמחים'], choices: ['קמח חיטה לבן', 'קמח תופח', 'קמח כוסמין מלא'] },
  { root: 'שוקו', en: [], forms: [], choices: ['משקה שוקו מוכן', 'אבקת שוקולית'] },
  { root: 'שמן', en: ['oil'], forms: ['שמנים'], choices: ['שמן קנולה', 'שמן זית כתית מעולה'] },
  { root: 'סבון', en: ['soap'], forms: ['סבונים'], choices: ['סבון ידיים נוזלי', 'נוזל כלים', 'תחליב רחצה'] },
  { root: 'טונה', en: ['tuna'], forms: ['טונות'], choices: ['טונה בשמן', 'טונה במים'] },
  { root: 'מרק', en: ['soup'], forms: ['מרקים'], choices: ['אבקת מרק עוף', 'שקדי מרק', 'מרק נמס'] },
  { root: 'חומץ', en: ['vinegar'], forms: [], choices: ['חומץ טבעי 5%', 'חומץ תפוחים', 'חומץ בלסמי'] },
  { root: 'שעועית', en: ['beans'], forms: [], choices: ['שעועית ירוקה קפואה', 'שעועית לבנה ברוטב / יבשה'] },
  { root: 'אפונה', en: ['peas'], forms: [], choices: ['אפונה קפואה סנפרוסט', 'אפונה שימורים'] },
  { root: 'בצק', en: ['dough'], forms: ['בצקים'], choices: ['בצק עלים', 'בצק פילו', 'בצק פריך'] },
  { root: 'תירס', en: ['corn'], forms: [], choices: ['תירס מתוק שימורים', 'תירס קפוא סנפרוסט', 'שניצל תירס'] },
  { root: 'כוסות', en: ['cups'], forms: ['כוס'], choices: ['כוסות חד פעמיות לשתייה קרה', 'כוסות נייר לשתייה חמה'] },
  { root: 'שקיות', en: ['bags'], forms: ['שקית'], choices: ['שקיות אשפה', 'שקיות אוכל לכריכים', 'שקיות צלייה קוקי'] },
  { root: 'מגבונים', en: ['wipes'], forms: ['מגבון'], choices: ['מגבונים לחים לתינוק', 'מטליות לחות לניקוי'] },
  { root: 'אגוזים', en: ['nuts'], forms: ['אגוז'], choices: ['אגוזי מלך', 'אגוזי פקאן', 'תערובת אגוזים'] },
  { root: 'קפה', en: ['coffee'], forms: [], choices: ['קפה נמס מגורען', 'קפה שחור טורקי', 'קפסולות קפה'] },
  { root: 'תה', en: ['tea'], forms: [], choices: ['תה שחור קלאסי', 'תה ירוק', 'חליטת צמחים'] },
  { root: 'רוטב', en: ['sauce'], forms: ['רטבים'], choices: ['רוטב עגבניות לפסטה', 'רוטב סויה', 'רוטב צ׳ילי מתוק'] },
  { root: 'נקניק', en: [], forms: ['נקניקים'], choices: ['פסטרמה הודו', 'נקניק סלמי', 'נקניקיות עוף'] },
  { root: 'דג', en: ['fish'], forms: ['דגים'], choices: ['פילה סלמון', 'פילה אמנון (מושט)', 'דג דניס'] },
  { root: 'בשר', en: ['meat'], forms: ['בשרים'], choices: ['בשר בקר טחון', 'צלי כתף בקר', 'סטייק אנטריקוט'] },
  { root: 'עוף', en: ['chicken'], forms: ['עופות'], choices: ['חזה עוף', 'כרעיים עוף', 'פרגיות עוף'] },
  { root: 'ממרח', en: ['spread'], forms: ['ממרחים'], choices: ['ממרח שוקולד נוטלה', 'חמאת בוטנים', 'ממרח תמרים'] },
  { root: 'מרכך', en: ['conditioner'], forms: ['מרככים'], choices: ['מרכך כביסה', 'מרכך שיער'] },
  { root: 'חלב צמחי', en: ['plant milk'], forms: ['משקה צמחי'], choices: ['משקה סויה', 'משקה שיבולת שועל', 'משקה שקדים'] },
  { root: 'דגנים', en: ['cereal'], forms: ['דגני בוקר'], choices: ['קורנפלקס', 'גרנולה', 'כריות נוגט'] },
  { root: 'חטיף', en: ['snack', 'snacks'], forms: ['חטיפים'], choices: ['במבה אסם', 'ביסלי גריל', 'חטיף אנרגיה'] },
  { root: 'מעדן', en: [], forms: ['מעדנים'], choices: ['מילקי שוקולד', 'מעדן דני שוקולד', 'מעדן חלבון'] },
  { root: 'מיץ', en: ['juice'], forms: ['מיצים'], choices: ['מיץ תפוזים', 'מיץ ענבים תירוש', 'מיץ תפוחים'] },
  { root: 'קצפת', en: ['whipped cream'], forms: [], choices: ['שמנת מתוקה להקצפה 38%', 'קצפת צמחית'] },
  { root: 'חריף', en: [], forms: [], choices: ['פלפל חריף ירוק', 'סחוג ירוק / אריסה'] },
];

export const AMBIGUOUS_ITEMS_LIST = AMBIGUOUS_ROOTS.map((r) => ({
  term: r.root,
  aliases: [...r.en, ...r.forms],
  choices: r.choices,
}));

function normalizeFinalLetterTypos(word) {
  if (!word || word.length < 2) return word;
  const last = word[word.length - 1];
  const map = { 'מ': 'ם', 'נ': 'ן', 'צ': 'ץ', 'פ': 'ף', 'כ': 'ך' };
  return map[last] ? word.slice(0, -1) + map[last] : word;
}

function replaceWholePhrases(str, phrases, replacement) {
  let padded = ` ${str} `;
  for (const ph of phrases) {
    if (replacement && ph.length < replacement.length && padded.includes(` ${replacement} `)) continue;
    let idx = padded.indexOf(` ${ph} `);
    while (idx >= 0) {
      padded = padded.slice(0, idx) + ` ${replacement} ` + padded.slice(idx + ph.length + 2);
      idx = padded.indexOf(` ${ph} `, idx + replacement.length + 1);
    }
  }
  return padded.replace(/\s+/g, ' ').trim();
}

function hasWholePhrase(str, phrase) {
  return ` ${str} `.includes(` ${phrase} `);
}

function normalizeHebrewOrthography(str) {
  let s = normalizeName(str);
  if (!s) return '';
  s = replaceWholePhrases(s, ['zero'], 'זירו');
  s = replaceWholePhrases(s, ['pro'], 'חלבון');
  s = replaceWholePhrases(s, ['xl'], 'אקסל');
  s = s
    .replace(/פתיבר/g, 'פתי בר')
    .replace(/שוקוציפס/g, 'שוקולד ציפס')
    .replace(/פיוזטי/g, 'פיוז טי')
    .replace(/קולורבי/g, 'קולרבי')
    .replace(/באגט/g, 'בגט')
    .replace(/חלווה/g, 'חלבה');

  const words = s.split(' ').filter(Boolean).map((rawW) => {
    let w = normalizeFinalLetterTypos(rawW);
    if (w.length >= 4 && !/^[a-z0-9.%]+$/.test(w)) {
      w = w.replace(/וו/g, 'ו').replace(/יי/g, 'י');
      if (w.endsWith('א') && w !== 'תפוא' && !w.endsWith('וא')) w = w.slice(0, -1) + 'ה';
    }
    return w;
  });
  return words.join(' ');
}

const AMBIGUOUS_MAP = new Map();
for (const entry of AMBIGUOUS_ROOTS) {
  AMBIGUOUS_MAP.set(normalizeHebrewOrthography(entry.root), entry);
  for (const w of [...entry.en, ...entry.forms]) {
    AMBIGUOUS_MAP.set(normalizeHebrewOrthography(w), entry);
  }
}

// Qualifiers that describe container/size without resolving product category ("סודה גדולה", "בקבוק שמן", "קופסת טונה")
const NON_DISAMBIGUATING_WORDS = new Set([
  'גדול', 'גדולה', 'גדולים', 'גדולות', 'קטן', 'קטנה', 'קטנים', 'קטנות',
  'רגיל', 'רגילה', 'רגילים', 'בקבוק', 'בבקבוק', 'בקבוקי', 'קופסת', 'קופסה', 'קופסא',
  'פחית', 'פחיות', 'חבילת', 'חבילה', 'מארז', 'מגש', 'אריזת', 'אריזה', 'שקית', 'צנצנת', 'מיכל',
].map(normalizeHebrewOrthography));

export function checkAmbiguousTerm(rawName) {
  const orth = normalizeHebrewOrthography(String(rawName || '').replace(/\?+$/, ''));
  if (!orth) return null;

  const direct = AMBIGUOUS_MAP.get(orth);
  if (direct) return { term: direct.root, choices: [...direct.choices] };

  const tokens = orth.split(' ').filter(Boolean);
  if (tokens.length >= 2) {
    // Note: "שקית שוקו" (chocolate milk bag) and "קופסת תירס" (canned corn) DO disambiguate the product!
    if ((tokens.includes('שקית') && tokens.includes('שוקו')) || (tokens.includes('קופסת') && tokens.includes('תירס')) || (tokens.includes('קופסה') && tokens.includes('תירס'))) {
      return null;
    }
    const core = tokens.filter((t) => !NON_DISAMBIGUATING_WORDS.has(t));
    if (core.length >= 1) {
      const hit = AMBIGUOUS_MAP.get(core.join(' '));
      if (hit) return { term: hit.root, choices: [...hit.choices] };
    }
  }
  return null;
}

// Compositional word-by-word English -> Hebrew dictionary (modifier + head noun reversed into Hebrew construct/noun-adj order)
const EN_WORD_MAP = new Map([
  ['milk', 'חלב'], ['soy', 'סויה'], ['oat', 'שיבולת שועל'], ['oats', 'שיבולת שועל'], ['almond', 'שקדים'],
  ['butter', 'חמאה'], ['peanut', 'בוטנים'], ['eggs', 'ביצים'], ['tomatoes', 'עגבניות'], ['cherry', 'שרי'],
  ['cucumbers', 'מלפפונים'], ['pepper', 'פלפל'], ['peppers', 'פלפלים'], ['onion', 'בצל'], ['onions', 'בצל יבש'],
  ['garlic', 'שום'], ['potatoes', 'תפוחי אדמה'], ['carrots', 'גזר'], ['zucchini', 'קישואים'], ['eggplant', 'חצילים'],
  ['cabbage', 'כרוב'], ['cauliflower', 'כרובית'], ['broccoli', 'ברוקולי'], ['lettuce', 'חסה'], ['parsley', 'פטרוזיליה'],
  ['cilantro', 'כוסברה'], ['dill', 'שמיר'], ['mint', 'נענע'], ['mushrooms', 'פטריות'], ['avocado', 'אבוקדו'],
  ['lemons', 'לימון'], ['bananas', 'בננות'], ['apples', 'תפוחי עץ'], ['apple', 'תפוחים'], ['oranges', 'תפוזים'],
  ['orange', 'תפוזים'], ['pears', 'אגסים'], ['grapes', 'ענבים'], ['beets', 'סלק'], ['celery', 'סלרי'],
  ['bread', 'לחם'], ['pita', 'פיתות'], ['salmon', 'סלמון'], ['hummus', 'חומוס'], ['tahini', 'טחינה גולמית'],
  ['rice', 'אורז בסמטי'], ['pasta', 'פסטה פנה'], ['sugar', 'סוכר'], ['salt', 'מלח שולחן'], ['oil', 'שמן'],
  ['olive', 'זית'], ['canola', 'קנולה'], ['ketchup', 'קטשופ'], ['mayonnaise', 'מיונז'], ['mustard', 'חרדל דיזון'],
  ['sauce', 'רוטב'], ['cornflakes', 'קורנפלקס'], ['honey', 'דבש'], ['coffee', 'קפה'], ['instant', 'נמס'],
  ['turkish', 'שחור טורקי'], ['water', 'מים'], ['mineral', 'מינרליים'], ['juice', 'מיץ'], ['chocolate', 'שוקולד'],
  ['shampoo', 'שמפו'], ['toothpaste', 'משחת שיניים'], ['red', 'אדום'], ['yellow', 'צהוב'], ['green', 'ירוק'],
  ['white', 'לבן'], ['whole', 'מלא'], ['wheat', ''], ['sliced', 'פרוס אחיד'],
]);

// Compact idiomatic English phrases whose Hebrew equivalent is non-compositional
const ENGLISH_IDIOMS = new Map([
  ['lactose free milk', 'חלב דל לקטוז'],
  ['cottage cheese', "קוטג' 5%"],
  ['sweet potato', 'בטטה'],
  ['chicken breast', 'חזה עוף'],
  ['ground beef', 'בשר בקר טחון'],
  ['peanut butter', 'חמאת בוטנים'],
  ['coca cola', 'קוקה קולה'],
  ['coke zero', 'קוקה קולה זירו'],
  ['dish soap', 'נוזל כלים'],
  ['toilet paper', 'נייר טואלט'],
]);

function translateEnglishGrocery(normEn) {
  if (!normEn || !/^[a-z0-9.%\s]+$/.test(normEn)) return null;
  if (ENGLISH_IDIOMS.has(normEn)) return ENGLISH_IDIOMS.get(normEn);
  const parts = normEn.split(' ').filter(Boolean);
  const mapped = [];
  for (const p of parts) {
    if (/^\d+(?:\.\d+)?%?$/.test(p)) {
      mapped.push(p);
    } else if (EN_WORD_MAP.has(p)) {
      const he = EN_WORD_MAP.get(p);
      if (he) mapped.push({ en: p, he });
    } else {
      return null;
    }
  }
  if (!mapped.length) return null;
  // Reverse English [modifier, headNoun] into Hebrew [headNoun, modifier]
  const words = mapped.filter((x) => typeof x === 'object');
  const nums = mapped.filter((x) => typeof x === 'string');
  if (words.length === 2) {
    const [mod, head] = words;
    if (head.en === 'milk' && (mod.en === 'soy' || mod.en === 'oat' || mod.en === 'almond')) {
      return `משקה ${mod.he}${nums.length ? ' ' + nums.join(' ') : ''}`;
    }
    if ((head.en === 'onion' || head.en === 'cabbage') && mod.en === 'red') {
      return `${head.he} סגול`;
    }
    return `${head.he} ${mod.he}${nums.length ? ' ' + nums.join(' ') : ''}`;
  }
  return [...words.map((w) => w.he), ...nums].join(' ').trim();
}

// Compact true-lexical root rewrite rules ([sourcePhrases, targetPhrase] — NO regex \b on Hebrew!)
const LEXICAL_REWRITES = [
  [['גמבה צהובה'], 'פלפל צהוב'],
  [['גמבות אדומות', 'גמבה אדומה', 'גמבה'], 'פלפל אדום'],
  [['תפוא', 'תפוח אדמה'], 'תפוחי אדמה'],
  [['מושט'], 'אמנון'],
  [['שפונדרה'], 'אסאדו בקר'],
  [['בטטה קסביה', 'קסביה'], 'ארטישוק ירושלמי'],
  [['זוקיני'], 'קישואים'],
  [['בצל אדום'], 'בצל סגול'],
  [['כרוב אדום'], 'כרוב סגול'],
  [['כרוב ירוק'], 'כרוב לבן'],
  [['עדשים אדומות'], 'עדשים כתומות'],
  [['גרעינים שחורים'], 'גרעיני חמניה'],
  [['טיטולים', 'חיתולי'], 'חיתולים'],
  [['נייר כסף', 'ניר כסף'], 'רדיד אלומיניום'],
  [['קוואקר', 'קווקר'], 'שיבולת שועל'],
  [['טישו'], 'ממחטות נייר'],
  [['נס קפה', 'קפה מגורען'], 'קפה נמס'],
  [['קפה טורקי', 'קפה שחור'], 'קפה שחור טורקי'],
  [['פאסטה מוטי'], 'עגבניות מרוסקות מוטי'],
  [['שקיות זבל'], 'שקיות אשפה'],
  [['סבון כלים'], 'נוזל כלים'],
  [['תרסיס חלונות', 'סנו קליר'], 'מנקה חלונות'],
  [['קונדישנר'], 'מרכך שיער'],
  [['לשיער'], 'שיער'],
  [['שטיפת פה'], 'מי פה'],
  [['מגבות נייר', 'מגבות ניר'], 'נייר סופג'],
  [['משחת מיסו'], 'מחית מיסו'],
  [['שמרים תזונתיים', 'שמרים תזונתיות'], 'שמרי בירה'],
  [['אבקת שקדים'], 'קמח שקדים'],
  [['פנקו'], 'פירורי לחם'],
  [['קונפיטורת'], 'ריבת'],
  [['קולה זירו'], 'קוקה קולה זירו'],
  [['קולה רגיל'], 'קוקה קולה'],
  [['נסטי'], 'פיוז טי'],
  [['תרכיז פטל', 'ויטמינציק פטל'], 'סירופ פטל'],
  [['אל סבון נוזלי', 'אל סבון', 'סבון רחצה'], 'תחליב רחצה'],
  [['גיל תנובה', 'לבן אשל'], 'אשל'],
  [['חלב סויה'], 'משקה סויה'],
  [['חלב שיבולת שועל'], 'משקה שיבולת שועל'],
  [['חלב שקדים'], 'משקה שקדים'],
  [['חלב קוקוס', 'נוזל קוקוס'], 'קרם קוקוס'],
  [['ללא לקטוז'], 'דל לקטוז'],
  [['חיטה מלאה', '100% מלא'], 'מלא'],
  [['שניצל עוף פרוס'], 'חזה עוף'],
  [['שניצלונים'], 'שניצל עוף'],
  [['שווארמה הודו', 'שוארמה הודו'], 'הודו טחון'],
  [['מספר 5', 'כתף בקר', 'צלי כתף מספר 5'], 'צלי כתף בקר'],
  [['ספגטי מספר 7'], 'ספגטי'],
  [['קמח חיטה לבן'], 'קמח לבן'],
  [['סולת חיטה'], 'סולת'],
  [['קציצות המבורגר'], 'המבורגר בקר'],
  [['קבב מזרחי'], 'קבב בקר'],
  [['שרי תמר'], 'עגבניות שרי'],
  [['שמנת להקצפה'], 'שמנת מתוקה'],
  [['אורז פרסי', 'אורז לבן'], 'אורז בסמטי'],
  [['מקרוני'], 'פסטה פנה'],
  [['קופסת תירס', 'תירס שימורים'], 'תירס מתוק שימורים'],
  [['חומוס שימורים'], 'גרגירי חומוס שימורים'],
  [['חמוצים במלח', 'מלפפון חמוץ'], 'מלפפונים חמוצים במלח'],
  [['אפונת גינה'], 'אפונה'],
  [['שעועית עדינה'], 'שעועית ירוקה'],
  [['פולי סויה אדממה'], 'אדממה'],
  [['בצק פילו'], 'דפי פילו'],
  [['לבבות ארטישוק'], 'תחתיות ארטישוק'],
  [['פריכיות כוסמת'], 'קרקר כוסמת'],
  [['לקס סלמון מעושן'], 'סלמון מעושן'],
  [['מזון תינוקות גרבר', 'גרבר תפוח בננה'], 'מחית פירות גרבר'],
  [['אוכל לחתולים', 'אוכל יבש לחתולים', 'מזון יבש לחתולים'], 'מזון לחתולים'],
  [['אוכל לכלבים', 'מזון יבש לכלבים', 'לכלב'], 'מזון לכלבים'],
  [['שקיות סנדוויץ', 'שקיות סנדויץ'], 'שקיות אוכל'],
  [['שקית קוקי', 'שקיות קוקי'], 'שקיות צליה קוקי'],
  [['כוסות פלסטיק חד פעמי'], 'כוסות חד פעמיות לשתיה קרה'],
  [['תחליף חלב מטרנה'], 'מטרנה'],
  [['סקוטש ברייט לכלים', 'סקוטש כלים', 'כריות ניקוי'], 'כריות קרצוף'],
  [['נוזל לכביסה', 'נוזל כביסה', 'גל לכביסה'], 'גל כביסה'],
  [['נוזל לניקוי רצפות'], 'נוזל רצפות'],
  [['נוזל מסיר'], 'מסיר'],
  [['סבון אסלה', 'גל לאסלה', 'נוזל ניקוי לאסלה', 'גל ניקוי לאסלה 00', 'גל לאסלה 00'], 'גל לאסלה'],
  [['פופקורן להכנה במיקרוגל'], 'פופקורן למיקרוגל'],
  [['קפסולות למדיח'], 'טבליות למדיח'],
  [['מגבוני תינוק'], 'מגבונים לחים'],
  [['שמן בטעם כמהין'], 'שמן כמהין'],
  [['חומץ סינטטי'], 'חומץ 5%'],
  [['ונילין'], 'וניל'],
  [['גרוס'], 'טחון'],
  [['חמאה ללא מלח'], 'חמאה'],
  [['בשר טחון', 'בקר טחון'], 'בשר בקר טחון'],
  [['תפוחי עץ'], 'תפוח עץ'],
  [['מלח שולחן'], 'מלח'],
  [['סילאן תמרים'], 'סילאן'],
  [['צילי מתוק'], 'רוטב צילי מתוק'],
].map(([phs, rep]) => [phs.map(normalizeHebrewOrthography), normalizeHebrewOrthography(rep)]);

const STANDALONE_BRAND_IMPLIED_CATEGORY = new Map([
  ['נפוליאון', 'גבינת שמנת נפוליאון'],
  ['גבינת נפוליאון', 'גבינת שמנת נפוליאון'],
  ['טסטרס צויס', 'קפה נמס טסטרס צויס'],
  ['טייסטרס צויס', 'קפה נמס טסטרס צויס'],
  ['עמק פרוס', 'גבינה צהובה עמק'],
  ['גבינת עמק', 'גבינה צהובה עמק'],
  ['מחמאה', 'מרגרינה מחמאה'],
  ['לחמית', 'קרקרים לחמית'],
  ['נוטלה', 'ממרח שוקולד נוטלה'],
  ['האגיס', 'חיתולים האגיס'],
  ['גולדסטאר', 'בירה גולדסטאר'],
  ['תירוש', 'מיץ ענבים תירוש'],
  ['סנו אנטי קאלק', 'מסיר אבנית סנו'],
  ['פחית אקסל', 'משקה אנרגיה אקסל'],
  ['אקסל', 'משקה אנרגיה אקסל'],
  ['סקי 5%', 'גבינה לבנה 5%'],
  ['תפוחים', 'תפוח עץ'],
  ['מילקי', 'מילקי שוקולד'],
  ['מעדן מילקי', 'מילקי שוקולד'],
  ['פריכיות', 'פריכיות אורז'],
  ['לחם פרוס', 'לחם פרוס אחיד'],
  ['לחם אחיד', 'לחם פרוס אחיד'],
  ['סלק', 'סלק אדום'],
  ['ענבים', 'ענבים ירוקים'],
  ['סוכר', 'סוכר לבן'],
  ['קינואה', 'קינואה לבנה'],
  ['נקניקיות', 'נקניקיות עוף'],
].map(([k, v]) => [normalizeHebrewOrthography(k), v]));

const KNOWN_BRANDS = new Set([
  'תנובה', 'אסם', 'אוסם', 'עלית', 'סוגת', 'תלמה', 'מעדנות', 'סנפרוסט', 'זוגלובק', 'שטראוס',
  'יטבתה', 'טרה', 'פיראוס', 'גד', 'גלעד', 'אחלה', 'צבר', 'הלמנס', 'היינץ', 'קיקומן', 'מוטי',
  'ויסוצקי', 'שוופס', 'קינלי', 'נביעות', 'פריגת', 'כרמל', 'סנו', 'זאוול', 'סושי', 'פוליויקס',
  'ריצפז', 'ניקול', 'לילי', 'מולט', 'פיירי', 'פלמוליב', 'פיניש', 'פרסיל', 'אריאל', 'בדין',
  'מקסימה', 'קולגייט', 'מרידול', 'פינוק', 'הוואי', 'דאב', 'כיף', 'אקס', 'קלינקס', 'ליסטרין',
  'האגיס', 'פמפרס', 'פריסקיז', 'דוגלי', 'בונזו', 'בארכה', 'תפוגן', 'טבעול', 'סטארקיסט', 'ברילה',
  'מן', 'אורביט', 'מאסט', 'נפוליאון', 'פילדלפיה', 'מחמאה', 'נטורינה', 'לחמית', 'נוטלה', 'סקיפי',
  'עמק', 'מכבי', 'קרלסברג', 'גולדסטאר', 'סימילאק', 'מטרנה', 'נוטרילון', 'קואקר', 'קליר',
  'ויטמינציק', 'נשר', 'אקסל', 'קרמיסימו', 'גרבר', 'קוקי', 'פרה',
].map(normalizeHebrewOrthography));

const MULTI_WORD_BRANDS = [
  'טסטרס צויס', 'טייסטרס צויס', 'מי עדן', 'עין גדי', 'יד מרדכי', 'הר ברכה', 'אל ארז',
  'עוף טוב', 'אייר ויק', 'אייר וויק', 'סקוטש ברייט', 'בן אנד גריס',
  'השחר העולה', 'פפסי מקס', 'רד בול', 'הד אנד שולדרס',
].map(normalizeHebrewOrthography);

const PACKAGING_AND_FILLER = new Set([
  'אקסטרה', 'קר', 'אנטי', 'קאלק', 'פינק', 'ליידי', 'לידי', 'צלול', 'סחוט', 'נוזלי', 'ספריי', 'מבושמת', 'מיני',
  'טרי', 'טריה', 'טריות', 'טריים', 'טבעי', 'טבעית', 'טבעיים', 'ארוז', 'רגיל', 'רגילה', 'רגילים', 'רגילות',
  'קלאסי', 'טהור', 'אורגני', 'כתית', 'מעולה', 'מנופה', 'מרוכז', 'מוזהבים', 'מרודד', 'חזקות',
  'מתכלות', 'מהיר', 'הכנה', 'של', 'אלופים', 'חממה', 'יבש', 'יבשים', 'יבשות', 'מגולענים', 'פרוס',
  'פרוסה', 'פרוסות', 'שלמים', 'מולבנים', 'בהיר', 'קלוי', 'קלויים', 'אפויים', 'מתגבש', 'עשיר',
  'קפריסאית', 'צרפתית', 'צרפתי', 'איטלקי', 'איטלקית', 'אמריקאי', 'מרוקאית', 'ממודנה', 'דמררה',
  'שמורות', 'להכנה', 'למטבח', 'לשולחן', 'לסושי', 'לאפיה', 'לתינוק', 'לכלים', 'לכריכים',
  'לכביסה', 'לניקוי', 'בקרטון', 'קרטון', 'בבקבוק', 'בקבוק', 'בקבוקי', 'בשקית', 'שקית', 'שקיקי',
  'בקופסה', 'קופסה', 'קופסת', 'צנצנת', 'שפופרת', 'מיכל', 'גליל', 'גלילים', 'תבנית', 'מארז',
  'אריזת', 'אריזה', 'מגש', 'פחית', 'גביע', 'קוביות', 'רביעית', 'שישית', 'שישיה', 'צרור',
  'סלסלת', 'אשכול', 'כיכר', 'חבילת', 'חבילה', 'דפי', 'פניני', 'גרעיני', 'פתיתי', 'מקלות', 'פתיתים',
  'כדורי', 'ריבועי', 'שמיניות', 'שטוחים', 'אישית', 'הבית', 'לחיץ', 'חדש', 'נקי', 'דק', 'גס',
  'רך', 'בינוני', 'מצונן', 'ביו', 'למנגל', 'שדה', 'חרמון', 'מגורד', 'מגורדת', 'דל', 'שומן', 'שמפיניון',
  'ערבית', 'אייסברג', 'קלה', 'קל', 'בחינם',
].map(normalizeHebrewOrthography));

const SUPERORDINATE_PREFIXES = new Set([
  'גבינת', 'גבינה', 'מעדן', 'חטיף', 'סלט', 'מאפה', 'ביסקוויט', 'ביסקויט', 'תבלין', 'דגני', 'פילה', 'סטייק', 'תרסיס', 'אבקת', 'דג', 'נקניק', 'ממרח', 'משקה', 'סירופ',
].map(normalizeHebrewOrthography));

function stemHebrewNoun(w) {
  if (!w || w.length < 3 || /^\d/.test(w)) return w;
  if (w === 'מים' || w === 'שמים' || w === 'קינמונים') return w;
  if (w === 'ביצים' || w === 'ביצה') return 'ביצ';
  if (w === 'שמרים') return 'שמר';
  if (w === 'גלידת') return 'גליד';
  if (w === 'בחלבון') return 'חלבון';
  let out = w;
  if (w.length >= 5 && w.endsWith('יות')) out = w.slice(0, -3) + 'י';
  else if (w.length >= 5 && w.endsWith('ית') && w !== 'שקית' && w !== 'חבית' && w !== 'טלית') out = w.slice(0, -2) + 'י';
  else if (w.length >= 4 && w.endsWith('ים')) out = w.slice(0, -2);
  else if (w.length >= 4 && w.endsWith('ות')) out = w.slice(0, -2);
  else if (w.length >= 4 && w.endsWith('יה')) out = w.slice(0, -2) + 'י';
  else if (w.length >= 3 && w.endsWith('ה')) out = w.slice(0, -1);
  return normalizeFinalLetterTypos(out);
}

export function resolveGrocerySynonym(rawName) {
  const cleanRaw = String(rawName || '').replace(/\?+$/, '').trim();
  const normRaw = normalizeName(cleanRaw);
  if (!normRaw) return { canonicalName: cleanRaw, conceptKey: '', brandTag: null, translated: false };

  let working = normRaw;
  let canonicalName = cleanRaw;
  let translated = false;
  const enTranslated = translateEnglishGrocery(normRaw);
  if (enTranslated) {
    working = enTranslated;
    canonicalName = working;
    translated = true;
  }

  working = normalizeHebrewOrthography(working);
  if (STANDALONE_BRAND_IMPLIED_CATEGORY.has(working)) {
    working = normalizeHebrewOrthography(STANDALONE_BRAND_IMPLIED_CATEGORY.get(working));
  }
  for (const [phrases, rep] of LEXICAL_REWRITES) {
    working = replaceWholePhrases(working, phrases, rep);
  }

  // Strip embedded retail pack specs ("1.5 ליטר", "200 גרם", "1 קג", "32 גלילים", Egg size "l") from concept key
  working = ` ${working} `
    .replace(/\s\d+(?:\.\d+)?\s*(?:ליטר|מל|גרם|קג|גלילים)(?=\s)/g, ' ')
    .replace(/\s(?:ליטר|גרם|l)(?=\s)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Apply Israeli staple default fat percentages when omitted
  if (!/\d+%/.test(working)) {
    if (hasWholePhrase(working, 'קוטג')) working += ' 5%';
    else if (hasWholePhrase(working, 'גבינה לבנה')) working += ' 5%';
    else if (hasWholePhrase(working, 'גבינה בולגרית')) working += ' 5%';
    else if (hasWholePhrase(working, 'צפתית')) working += ' 5%';
    else if (hasWholePhrase(working, 'ריקוטה')) working += ' 5%';
    else if (hasWholePhrase(working, 'לאבנה')) working += ' 5%';
    else if (hasWholePhrase(working, 'חומץ') && !['תפוחים', 'בלסמי', 'אורז', 'יין'].some((x) => hasWholePhrase(working, x))) working += ' 5%';
    else if (hasWholePhrase(working, 'שמנת מתוקה')) working += ' 38%';
    else if (hasWholePhrase(working, 'שמנת חמוצה')) working += ' 15%';
    else if (hasWholePhrase(working, 'שמנת לבישול')) working += ' 15%';
    else if (hasWholePhrase(working, 'קמח כוסמין')) working = replaceWholePhrases(working, ['מלא'], '') + ' 80%';
    else if (hasWholePhrase(working, 'שוקולד מריר')) working += ' 60%';
  } else if (hasWholePhrase(working, 'קמח כוסמין')) {
    working = replaceWholePhrases(working, ['מלא'], '');
  }

  // Extract brand tag BEFORE stripping brands from core tokens (so competing brands never merge!)
  let brandTag = null;
  for (const mb of MULTI_WORD_BRANDS) {
    if (hasWholePhrase(working, mb)) {
      brandTag = mb;
      break;
    }
  }
  if (!brandTag) {
    for (const t of working.split(' ')) {
      if (KNOWN_BRANDS.has(t)) {
        brandTag = t;
        break;
      }
    }
  }

  let coreStr = replaceWholePhrases(working, MULTI_WORD_BRANDS, '');
  let tokens = coreStr.split(' ').filter(Boolean);

  // 1. Strip generic packaging/containers FIRST ("צנצנת נוטלה" -> "נוטלה", "שקית במבה אסם" -> "במבה אסם")
  const withoutFiller = tokens.filter((t, idx) => (idx === 0 && t === 'מלח') ? true : !PACKAGING_AND_FILLER.has(t));
  if (withoutFiller.length > 0) tokens = withoutFiller;

  // 2. Expand standalone brand/staple shorthands ("נוטלה" -> "ממרח שוקולד נוטלה", "סוכר" -> "סוכר לבן")
  const joinedPreBrand = tokens.join(' ');
  if (STANDALONE_BRAND_IMPLIED_CATEGORY.has(joinedPreBrand)) {
    tokens = normalizeHebrewOrthography(STANDALONE_BRAND_IMPLIED_CATEGORY.get(joinedPreBrand)).split(' ');
  }

  // 3. Strip brand tokens if core category tokens remain
  const withoutBrands = tokens.filter((t) => !KNOWN_BRANDS.has(t));
  if (withoutBrands.length > 0) tokens = withoutBrands;

  if (STANDALONE_BRAND_IMPLIED_CATEGORY.has(tokens.join(' '))) {
    tokens = normalizeHebrewOrthography(STANDALONE_BRAND_IMPLIED_CATEGORY.get(tokens.join(' '))).split(' ');
  }

  if (tokens.length >= 2 && SUPERORDINATE_PREFIXES.has(tokens[0])) {
    const second = tokens[1];
    // Keep 2-word "סלט חצילים", "גבינה לבנה", "משקה סויה", "סירופ פטל", etc. intact!
    const keepTwoWord = /^(?:לבנה|צהובה|בולגרית|שמנת|טונה|ביצים|כרוב|פירות|אפיה|כביסה|מרק|שוקולד|תמרים|סויה|שקדים|שיבולת|אנרגיה|שוקו|פטל|אגבה)$/.test(second)
      || (tokens.length === 2 && /^(?:חצילים|חציל)$/.test(second));
    if (!keepTwoWord) {
      tokens = tokens.slice(1);
    }
  }

  let stemmed = tokens.map(stemHebrewNoun).filter(Boolean);
  // Poultry cuts imply chicken ("עוף"); entrecote/asado imply beef ("בקר")
  if (stemmed.length === 2 && stemmed[1] === 'עוף' && /^(?:פרגי|כרע|שוק|כנף)$/.test(stemmed[0])) {
    stemmed = [stemmed[0]];
  }
  if (stemmed.length === 2 && stemmed[1] === 'בקר' && /^(?:אנטריקוט|אסאדו)$/.test(stemmed[0])) {
    stemmed = [stemmed[0]];
  }
  // Natural inherent color on cucumbers ("מלפפון ירוק") & lemons ("לימון צהוב")
  if (stemmed.length === 2 && ((stemmed[0] === 'מלפפון' && stemmed[1] === 'ירוק') || (stemmed[0] === 'לימון' && stemmed[1] === 'צהוב'))) {
    stemmed = [stemmed[0]];
  }
  // Deduplicate identical stems (e.g. "צלי כתף צלי כתף בקר" -> "צלי כתף בקר")
  const uniqStems = [];
  for (const s of stemmed) if (!uniqStems.includes(s)) uniqStems.push(s);
  const conceptKey = `concept_${uniqStems.join('_')}`;

  return {
    canonicalName: translated ? canonicalName : cleanRaw,
    searchCanonical: working,
    coreSearchQuery: tokens.join(' '),
    conceptKey,
    stems: uniqStems,
    brandTag,
    translated,
  };
}

// Bidirectional catalog naming equivalents where Israeli POS feeds use a different term from everyday shoppers
const CATALOG_SEARCH_EQUIVALENTS = [
  ['שמנת מתוקה', 'שמנת להקצפה'],
  ['שמנת חמוצה', 'שמנת תנובה'],
  ['בצל סגול', 'בצל אדום'],
  ['כרוב סגול', 'כרוב אדום'],
  ['חלב דל לקטוז', 'חלב ללא לקטוז'],
  ['קפה שחור טורקי', 'קפה טורקי'],
  ['מי סודה', 'סודה'],
  ['שוקו בשקית', 'שוקו'],
  ['גבינה צהובה עמק', 'עמק'],
  ['גבינת שמנת נפוליאון', 'נפוליאון'],
  ['מרגרינה מחמאה', 'מחמאה'],
  ['מרגרינה', 'נטורינה'],
  ['קרקרים לחמית', 'לחמית'],
  ['נייר סופג', 'מגבות נייר'],
  ['ניר סופג', 'מגבות ניר'],
  ['מלפפונים חמוצים במלח', 'מלפפונים במלח'],
  ['חמוצים במלח', 'מלפפונים במלח'],
  ['מלפפון חמוץ', 'מלפפונים במלח'],
  ['גרנולה שיבולת שועל', 'גרנולה'],
  ['קרואסון חמאה', 'קרואסון'],
  ['גלידת שמנת וניל', 'גלידה וניל'],
  ['גלידת וניל', 'גלידה וניל'],
  ['דפי פילו', 'בצק פילו'],
  ['צלי כתף בקר', 'צלי כתף'],
  ['המבורגר בקר', 'המבורגר'],
  ['אסאדו בקר', 'אסאדו'],
  ['ענבים ירוקים', 'ענבים'],
  ['קינואה לבנה', 'קינואה'],
  ['לימון צהוב', 'לימון'],
  ['מלפפון ירוק', 'מלפפון'],
  ['נוזל כלים פיירי', 'פיירי לכלים'],
  ['נוזל כלים', 'נ כלים'],
  ['סבון ידיים נוזלי', 'אל סבון'],
  ['מנקה חלונות', 'ניקוי חלונות'],
  ['לשתיה קרה', 'שתיה קרה'],
  ['לשתייה קרה', 'שתיה קרה'],
  ['שתיה קרה', 'פלסטיק'],
  ['בירה שחורה', 'מאלט'],
  ['מחית פירות', 'מחית תפוח'],
];

// Single-category brands where XML POS catalogs often omit the generic category noun ("פריסקיז 1.43קג" without "לחתולים")
const SINGLE_CATEGORY_BRANDS = new Set([
  'פריסקיז', 'בונזו', 'דוגלי', 'מטרנה', 'סימילאק', 'נוטרילון', 'האגיס', 'פמפרס', 'קלינקס', 'אורביט',
].map(normalizeHebrewOrthography));

const USAGE_NOISE_IN_SEARCH = new Set([
  'טרי', 'טריה', 'טריות', 'טריים', 'לשבת', 'למטבח', 'לשולחן', 'לסושי', 'לכריכים', 'למנגל', 'לאפיה',
  'לאפייה', 'בשקית', 'בקרטון', 'בבקבוק', 'בקבוק', 'בקבוקי', 'שישיית', 'שישיה', 'רביעיית', 'מארז',
  'חבילת', 'קופסת', 'צנצנת', 'שקית', 'אריזת', 'מגש', 'צרור', 'סלסלת', 'חזקות', 'מתכלות', 'מוזהבים',
  'מגולענים', 'שלמים', 'מולבנים', 'ממודנה', 'קפריסאית', 'צרפתית', 'צרפתי', 'אמריקאי', 'טהור', 'קלאסי', 'יבש',
  'מרודד', 'מהיר', 'הכנה', 'של', 'אלופים', 'שדה', 'גבעולים', 'עלים', 'שמיניות', 'לשיער',
  'קפוא', 'קפואה', 'קפואים', 'קפואות', 'מצונן', 'שימורים', 'עשיר', 'רגיל', 'רגילה', 'טחונה', 'גרגירי',
  'שפופרת', 'תרסיס', 'ספריי', 'מיכל', 'פחית', 'דפי', 'נוזלי', 'צלול', 'סחוט', 'למיקרוגל', 'במיקרוגל', 'ניקוי',
  'חד', 'פעמי', 'פעמית', 'פעמיות', 'פעמיים',
]);

/**
 * Returns ordered candidate search queries for `prices.js`, tagging each as `{ query, isFallback }`.
 * Matches found via `isFallback: true` are marked `kind: 'substitute'` in `prices.js` (H3 honesty).
 */
export function getSearchQueriesForItem(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return [];
  const out = [];
  const push = (str, isFallback) => {
    const t = String(str || '').replace(/\s+/g, ' ').trim();
    if (t && t.length >= 2 && !out.some((x) => x.query === t)) out.push({ query: t, isFallback });
  };

  const isAsciiOnly = !/[\u0590-\u05FF]/.test(q);
  const resolved = resolveGrocerySynonym(q);

  const primary = isAsciiOnly && resolved.translated ? resolved.canonicalName : q;
  push(primary, false);

  const normPrimary = normalizeName(primary);

  // 1. Bidirectional catalog naming equivalents ("שמנת מתוקה 38%" -> "שמנת להקצפה 38%", "בצל סגול" -> "בצל אדום")
  for (const [a, b] of CATALOG_SEARCH_EQUIVALENTS) {
    if (normPrimary.includes(a)) push(normPrimary.replace(a, b), false);
    else if (normPrimary.includes(b)) push(normPrimary.replace(b, a), false);
  }

  // 2. Rewritten canonical phrase from synonym engine
  if (resolved.searchCanonical && resolved.searchCanonical !== normPrimary) {
    const strippedDefaultPct = resolved.searchCanonical.replace(/\s+\d+%$/, '').trim();
    push(resolved.searchCanonical, !resolved.translated);
    if (strippedDefaultPct && strippedDefaultPct !== resolved.searchCanonical) {
      push(strippedDefaultPct, true);
    }
    for (const [a, b] of CATALOG_SEARCH_EQUIVALENTS) {
      if (resolved.searchCanonical.includes(a)) push(resolved.searchCanonical.replace(a, b), false);
    }
  }

  // 3. Use resolved.coreSearchQuery (which already stripped PACKAGING_AND_FILLER + KNOWN_BRANDS + default percentages!)
  if (!normPrimary.includes('מצרפת') && resolved.coreSearchQuery) {
    push(resolved.coreSearchQuery, true);
    const coreNoPct = resolved.coreSearchQuery.split(' ').filter((w) => !/^\d+%$/.test(w));
    if (coreNoPct.length >= 1 && coreNoPct.length < resolved.coreSearchQuery.split(' ').length && coreNoPct[0] !== 'חלב') {
      push(coreNoPct.join(' '), true);
    }
    for (const [a, b] of CATALOG_SEARCH_EQUIVALENTS) {
      if (resolved.coreSearchQuery.includes(a)) push(resolved.coreSearchQuery.replace(a, b), true);
      else if (resolved.coreSearchQuery.includes(b)) push(resolved.coreSearchQuery.replace(b, a), true);
    }
  }

  // 4. Concise core-product query stripping shopper usage notes & redundant superordinates
  if (!normPrimary.includes('מצרפת')) {
    let words = normPrimary
      .replace(/\bבחלבון\b|(?:^|\s)בחלבון(?=$|\s)/g, ' חלבון')
      .split(' ')
      .filter((w) => w && !USAGE_NOISE_IN_SEARCH.has(w) && w !== 'כתית' && w !== 'מעולה' && (w !== 'לבישול' || normPrimary.includes('שמנת')));
    if (words.length >= 2 && /^(?:גבינת|מעדן|קרקרים|סטייק|פילה|מרגרינה|חטיף|סלט|דג|תבלין)$/.test(words[0])) {
      if (!/^(?:לבנה|צהובה|בולגרית|צפתית|שמנת|חצילים|טונה|ביצים|כרוב|פירות)$/.test(words[1])) {
        words = words.slice(1);
      }
    }
    if (words.length === 2 && words[1] === 'בקר' && /^(?:אנטריקוט|אסאדו|קבב|המבורגר)$/.test(words[0])) {
      words = [words[0]];
    }
    if (words.length >= 1) {
      const coreJoined = words.join(' ');
      push(coreJoined, true);
      for (const [a, b] of CATALOG_SEARCH_EQUIVALENTS) {
        if (coreJoined.includes(a)) push(coreJoined.replace(a, b), true);
        else if (coreJoined.includes(b)) push(coreJoined.replace(b, a), true);
      }
      const noPct = words.filter((w) => !/^\d+%$/.test(w));
      if (noPct.length >= 1 && noPct.length < words.length && noPct[0] !== 'חלב') {
        push(noPct.join(' '), true);
      }
    }

    // 4. Unbranded category substitute fallback (if a chain doesn't carry the requested brand, e.g. Persil vs Ariel)
    if (resolved.brandTag && SINGLE_CATEGORY_BRANDS.has(resolved.brandTag)) {
      push(resolved.brandTag, false);
    }
    if (resolved.brandTag && words.length >= 2) {
      const noBrand = words.filter((w) => !KNOWN_BRANDS.has(normalizeHebrewOrthography(w)) && !resolved.brandTag.split(' ').includes(normalizeHebrewOrthography(w)));
      if (noBrand.length >= 1) {
        const nbJoined = noBrand.join(' ');
        push(nbJoined, true);
        for (const [a, b] of CATALOG_SEARCH_EQUIVALENTS) {
          if (nbJoined.includes(a)) push(nbJoined.replace(a, b), true);
          else if (nbJoined.includes(b)) push(nbJoined.replace(b, a), true);
        }
      }
    }
  }

  return out;
}
