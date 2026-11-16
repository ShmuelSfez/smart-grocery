// Aisle categorization (Hebrew-first, English supported).
import { normalizeName } from './parser.js';

export const CATEGORIES = [
  { id: 'produce', he: 'פירות וירקות', emoji: '🥬' },
  { id: 'dairy', he: 'חלב, גבינות וביצים', emoji: '🧀' },
  { id: 'bakery', he: 'לחם ומאפים', emoji: '🍞' },
  { id: 'meat', he: 'בשר, עוף ודגים', emoji: '🍗' },
  { id: 'deli', he: 'נקניקים ומעדנייה', emoji: '🥓' },
  { id: 'pantry', he: 'מזווה ובישול', emoji: '🥫' },
  { id: 'breakfast', he: 'דגני בוקר וממרחים', emoji: '🥣' },
  { id: 'frozen', he: 'קפואים', emoji: '🧊' },
  { id: 'drinks', he: 'משקאות', emoji: '🥤' },
  { id: 'snacks', he: 'חטיפים ומתוקים', emoji: '🍫' },
  { id: 'cleaning', he: 'ניקיון וכביסה', emoji: '🧽' },
  { id: 'personal', he: 'טואלטיקה ופארם', emoji: '🧴' },
  { id: 'baby', he: 'תינוקות', emoji: '🍼' },
  { id: 'pets', he: 'חיות מחמד', emoji: '🐾' },
  { id: 'home', he: 'כלי בית וחד-פעמי', emoji: '🍽️' },
  { id: 'other', he: 'אחר', emoji: '🛒' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// Keywords match the START of a word (so "עגבני" matches "עגבניות", "עגבניה").
// Multi-word phrases match anywhere and beat single words.
const KEYWORDS = {
  produce: `עגבני מלפפו גזר בצל שום תפוח בננ תפוז קלמנטינ מנדרינ אבוקדו לימון ליים חסה כרוב כרובית ברוקולי
    פלפל קישוא חציל תפוא בטט דלעת דלורית סלק צנון צנונית פטרוזיליה כוסברה שמיר נענע בזיליקום עירית
    פטריות פטריה ענב אבטיח מלון אגס אפרסק נקטרינ שזיף משמש מנגו אננס קיווי רימון תות פירות ירקות מנגולד
    סלרי שעועית ירוקה אפונה תירס קולרבי ארטישוק אספרגוס תרד עלי ג'ינג'ר גינגר אוכמני פומלה אשכולית
    תמר תמרים פסיפלורה ליצ'י קוקוס חמוציות שרי בצלצל כרישה
    tomato cucumber carrot onion garlic apple banana orange avocado lemon lime lettuce cabbage cauliflower
    broccoli pepper zucchini eggplant potato potatoes sweet pumpkin beet radish parsley cilantro dill mint basil
    mushroom mushrooms grape grapes watermelon melon pear peach plum mango pineapple kiwi pomegranate strawberry
    strawberries fruit vegetables celery corn spinach ginger blueberries
    | תפוחי אדמה | תפוח אדמה | בצל ירוק | שעועית ירוקה | עגבניות שרי | פלפל חריף`,
  dairy: `חלב גבינ קוטג' קוטג קוטגי יוגורט לבן שמנת חמאה ביצ ביצים מעדן פודינג אשל ריקוטה מוצרלה
    בולגרית פטה צפתית לאבנה לבנה מסקרפונה פרמזן שוקו דנונה מילקי יופלה אקטיביה קשקבל
    milk cheese cottage yogurt yoghurt cream butter egg eggs mozzarella feta parmesan ricotta labneh
    | שמנת מתוקה | שמנת חמוצה | גבינה צהובה | גבינה לבנה | חלב סויה | חלב שקדים | חלב שיבולת | משקה שיבולת`,
  bakery: `לחם לחמני חלה חלות פיתה פיתות בגט באגט טורטיה לאפה מאפה קרואסון עוגה עוגות עוגיות בורקס פוקאצ'ה
    כעך כעכים בייגל חמניה חמניות פרוסות לחמניה מצות מצה רוגלך שמרים קרקר פריכיות פריכית
    bread bun buns pita baguette tortilla croissant cake cookies bagel crackers rolls
    | לחם מלא | לחם אחיד | לחם שיפון`,
  meat: `עוף חזה שניצל כרעיים כנפיים פרגית פרגיות שוקיים בשר טחון סטייק אנטריקוט צלעות כבד קציצות המבורגר
    הודו פילה סלמון דג דגים אמנון דניס לברק בורי מושט שרימפס קבב אסאדו צלי שייטל כתף
    פרגית נתחי בקר כבש טלה אוסובוקו
    chicken breast schnitzel wings thighs beef ground steak ribs liver meatballs burger turkey fish salmon
    shrimp lamb
    | בשר טחון | חזה עוף | פילה סלמון | שוקיים עוף | ירכיים עוף | פילה אמנון`,
  deli: `נקניק נקניקיה נקניקיות פסטרמה סלמי קבנוס חזה הודו פרוס חומוס טחינה מטבוחה חציל סלט סלטים
    כבד קצוץ זיתים חמוצים מלפפון חמוץ
    sausage sausages salami pastrami hummus tahini olives pickles
    | חזה הודו | סלט חצילים | מלפפונים חמוצים | זיתים ירוקים | זיתים שחורים`,
  pantry: `אורז פסטה ספגטי פתיתים קוסקוס בורגול קינואה עדשים חומוס-יבש שעועית-יבשה גריסים קמח סוכר מלח פלפל-שחור
    שמן שמן-זית חומץ רסק רוטב קטשופ קטשופ מיונז חרדל סויה תבלין תבלינים פפריקה כמון כורכום אורגנו
    קינמון וניל אבקת סודה שמרים קורנפלור פירורי פרורי שקדים אגוזים בוטנים צנוברים גרעינים צימוקים
    שימורים שימור תירס-שימורים טונה-שימורים זיתים-שימורים מרק אבקת-מרק ציר דבש סילאן ריבה ממרח-תמרים
    מקרוני נודלס אטריות לזניה ניוקי פירה טונה סולת חיטה כוסמין דמררה
    rice pasta spaghetti couscous bulgur quinoa lentils flour sugar salt oil vinegar sauce ketchup mayonnaise
    mustard soy spice spices paprika cumin turmeric oregano cinnamon vanilla baking yeast almonds nuts
    peanuts raisins canned soup honey jam noodles lasagna
    | שמן זית | שמן קנולה | רסק עגבניות | רוטב עגבניות | פלפל שחור | אבקת אפייה | סוכר חום | תירס שימורים | אפונה קטנה
    | טונה בשמן | טונה במים | קמח מלא | קמח תופח | קמח כוסמין | פירורי לחם | אבקת מרק | חלב קוקוס | קרם קוקוס | אבקת שקדים | שעועית לבנה`,
  breakfast: `קורנפלקס דגני גרנולה שיבולת קוואקר פתיתי-שיבולת נוטלה ממרח חמאת-בוטנים קפה נס נסקפה טורקי תה
    שוקולית קקאו קפסולות פולי קינמונים
    cereal cornflakes granola oats oatmeal nutella spread coffee tea cocoa capsules
    | חמאת בוטנים | דגני בוקר | שיבולת שועל | קפה שחור | קפה נמס | ממרח שוקולד`,
  frozen: `קפוא קפואים קפואה גלידה ארטיק שלגון פיצה-קפואה בצק-עלים בצק בורקס-קפוא אדממה ירקות-קפואים
    צ'יפס ציפס נאגטס מלאווח ג'חנון קרח
    frozen ice cream popsicle fries nuggets
    | בצק עלים | ירקות קפואים | פיצה קפואה | אפונה קפואה | שעועית קפואה`,
  drinks: `מים מיץ סודה קולה קוקה ספרייט פאנטה בירה יין ויסקי וודקה ערק משקה משקאות תפוזים-מיץ פריגת
    פטל תרכיז נביעות עין-גדי מי-עדן נסטי אייס סיידר אנרגיה רדבול שוופס
    water juice soda cola coke sprite beer wine whiskey vodka drink drinks
    | מים מינרליים | מיץ תפוזים | מיץ ענבים | מיץ תפוחים | בקבוק מים | שישיית מים`,
  snacks: `במבה ביסלי תפוצ'יפס תפוציפס צ'יטוס דוריטוס פופקורן פרינגלס שוקולד ופל ופלים סוכריות סוכריה מסטיק
    קליק פסק-זמן קינדר עוגיות-שוקולד חטיף חטיפים בייגלה אפרופו מרשמלו חלווה מנטוס טוויקס סניקרס קיטקט
    בונבוניירה קרמבו
    chocolate chips snack snacks candy gum popcorn pretzels wafers
    | חטיפי אנרגיה | חטיף חלבון | שוקולד מריר | שוקולד חלב`,
  cleaning: `סבון-כלים נוזל אקונומיקה כביסה מרכך אבקת-כביסה ג'ל-כביסה מטליות מטלית ספוג ספוגים סקוטש מגבונים-לחים
    שקיות-זבל שקית-זבל אשפה מנקה מסיר כלורקס סנו פיירי פרסיל אריאל מבריק טבליות-למדיח מדיח וניש
    cleaner detergent bleach laundry softener sponge sponges trash dishwasher
    | נוזל כלים | סבון כלים | שקיות זבל | נייר אפייה | נייר כסף | נייר סופג | מגבות נייר | טבליות למדיח
    | אבקת כביסה | ג'ל כביסה | מרכך כביסה | נוזל רצפות | מטהר אוויר`,
  personal: `שמפו מרכך-שיער סבון דאודורנט משחת מברשת חוט-דנטלי קרם תחבושות טמפונים פדים גילוח סכיני ג'ילט
    קצף טישו ממחטות צמר-גפן מקלוני אקמול נורופן אופטלגין ויטמין ויטמינים פלסטרים קונדישנר
    shampoo conditioner soap deodorant toothpaste toothbrush floss lotion pads tampons razor tissues vitamins
    | נייר טואלט | משחת שיניים | מברשת שיניים | סבון ידיים | ג'ל רחצה | קרם הגנה | קרם ידיים | מי פה`,
  baby: `טיטולים חיתולים האגיס פמפרס מטרנה סימילאק דייסה מחית מגבונים בקבוק-תינוק מוצץ
    diapers wipes formula baby
    | מגבונים לחים | מחית תינוקות | תרכובת מזון | קרם החתלה`,
  pets: `חתול חתולים כלב כלבים חול-לחתולים אוכל-לכלבים אוכל-לחתולים פדיגרי ויסקאס פריסקיז
    cat dog litter pet
    | חול לחתולים | אוכל לכלבים | אוכל לחתולים | מזון לכלבים | מזון לחתולים`,
  home: `צלחות כוסות סכו"ם סכום חד-פעמי מפיות נרות נר סוללות מצית גפרורים נורה ניילון-נצמד תבנית
    plates cups napkins candles batteries foil
    | חד פעמי | ניילון נצמד | כוסות חד פעמיות | צלחות חד פעמיות | נייר כסף | סוללות AA | שקית קוקי | שקיות קוקי`,
};

// Build lookup tables
const PHRASES = []; // [phrase, cat]
const WORDS = []; // [word, cat]
for (const [cat, text] of Object.entries(KEYWORDS)) {
  const [wordsPart, ...phraseParts] = text.split('|');
  for (const w of wordsPart.split(/\s+/).filter(Boolean)) {
    const word = normalizeName(w.replace(/-/g, ' '));
    if (word.includes(' ')) PHRASES.push([word, cat]);
    else WORDS.push([word, cat]);
  }
  for (const p of phraseParts) {
    const phrase = normalizeName(p);
    if (phrase) PHRASES.push([phrase, cat]);
  }
}
PHRASES.sort((a, b) => b[0].length - a[0].length);
WORDS.sort((a, b) => b[0].length - a[0].length);

function matchWord(token) {
  // strip common Hebrew prefixes only as a second attempt (ה, ו)
  const candidates = [token];
  if (/^[הו][\u0590-\u05FF]{3,}/.test(token)) candidates.push(token.slice(1));
  for (const t of candidates) {
    for (const [w, cat] of WORDS) {
      if (w.length <= 2 ? t === w : t.startsWith(w)) return cat;
    }
  }
  return null;
}

const HEBREW = /[\u0590-\u05FF]/;

export function categorize(name, overrides = {}) {
  const norm = normalizeName(name);
  if (!norm) return 'other';
  if (overrides[norm]) return overrides[norm];

  for (const [phrase, cat] of PHRASES) {
    if ((' ' + norm + ' ').includes(' ' + phrase + ' ') || norm.startsWith(phrase)) return cat;
  }

  const tokens = norm.split(' ');
  // Head-noun first: in Hebrew the main noun is the first word ("מיץ תפוזים", "שוקולד חלב"),
  // in English it is the last ("orange juice", "milk chocolate").
  const ordered = HEBREW.test(norm) ? tokens : [...tokens].reverse();
  for (const t of ordered) {
    const cat = matchWord(t);
    if (cat) return cat;
  }
  return 'other';
}
