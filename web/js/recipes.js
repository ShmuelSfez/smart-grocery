// Built-in recipe templates (offline). Quantities are for `base` servings and scale linearly.
// staple: true => usually in the pantry, unchecked by default.
export const RECIPES = [
  {
    id: 'shakshuka', he: 'שקשוקה', emoji: '🍳', base: 4,
    items: [
      ['ביצים', 8, 'unit'], ['עגבניות', 1, 'kg'], ['פלפל אדום', 2, 'unit'], ['בצל', 1, 'unit'],
      ['שום', 1, 'unit', true], ['רסק עגבניות', 1, 'unit', true], ['פפריקה', 1, 'unit', true],
      ['כמון', 1, 'unit', true], ['לחם', 1, 'unit'], ['גבינה בולגרית', 1, 'unit'],
    ],
  },
  {
    id: 'bolognese', he: 'פסטה בולונז', emoji: '🍝', base: 4,
    items: [
      ['פסטה', 1, 'pack'], ['בשר טחון', 0.5, 'kg'], ['רוטב עגבניות', 2, 'unit'], ['בצל', 1, 'unit'],
      ['גזר', 2, 'unit'], ['שום', 1, 'unit', true], ['פרמזן', 1, 'unit'], ['שמן זית', 1, 'unit', true],
    ],
  },
  {
    id: 'schnitzel', he: 'שניצל ופירה', emoji: '🍗', base: 4,
    items: [
      ['חזה עוף', 1, 'kg'], ['ביצים', 2, 'unit'], ['פירורי לחם', 1, 'unit'], ['קמח', 1, 'unit', true],
      ['תפוחי אדמה', 1.5, 'kg'], ['חמאה', 1, 'unit'], ['חלב', 1, 'unit'], ['שמן קנולה', 1, 'unit', true],
    ],
  },
  {
    id: 'salad', he: 'סלט ישראלי', emoji: '🥗', base: 4,
    items: [
      ['עגבניות', 0.5, 'kg'], ['מלפפונים', 0.5, 'kg'], ['בצל סגול', 1, 'unit'], ['פטרוזיליה', 1, 'unit'],
      ['לימון', 1, 'unit'], ['שמן זית', 1, 'unit', true],
    ],
  },
  {
    id: 'shabbat', he: 'ארוחת שישי', emoji: '🕯️', base: 6,
    items: [
      ['חלה', 2, 'unit'], ['עוף שלם', 1, 'unit'], ['תפוחי אדמה', 1, 'kg'], ['אורז', 1, 'pack'],
      ['חומוס', 1, 'unit'], ['טחינה', 1, 'unit'], ['סלט חצילים', 1, 'unit'], ['עגבניות', 0.5, 'kg'],
      ['מלפפונים', 0.5, 'kg'], ['יין', 1, 'unit'], ['גזר', 0.5, 'kg'], ['בצל', 3, 'unit'],
    ],
  },
  {
    id: 'bbq', he: 'מנגל', emoji: '🔥', base: 6,
    items: [
      ['פרגיות', 1, 'kg'], ['קבב', 1, 'kg'], ['המבורגר', 6, 'unit'], ['פיתות', 2, 'pack'],
      ['לחמניות', 1, 'pack'], ['חומוס', 1, 'unit'], ['טחינה', 1, 'unit'], ['קטשופ', 1, 'unit', true],
      ['פחמים', 1, 'pack'], ['צלחות חד פעמיות', 1, 'pack'], ['כוסות חד פעמיות', 1, 'pack'],
      ['שתייה קלה', 2, 'unit'], ['אבטיח', 1, 'unit'],
    ],
  },
  {
    id: 'soup', he: 'מרק עוף', emoji: '🍲', base: 6,
    items: [
      ['שוקיים עוף', 1, 'kg'], ['גזר', 0.5, 'kg'], ['תפוחי אדמה', 0.5, 'kg'], ['בצל', 2, 'unit'],
      ['סלרי', 1, 'unit'], ['קישואים', 3, 'unit'], ['שמיר', 1, 'unit'], ['פטרוזיליה', 1, 'unit'],
      ['אטריות', 1, 'pack'],
    ],
  },
  {
    id: 'breakfast', he: 'ארוחת בוקר ישראלית', emoji: '🥐', base: 4,
    items: [
      ['ביצים', 8, 'unit'], ['גבינה לבנה', 1, 'unit'], ['קוטג\'', 1, 'unit'], ['גבינה צהובה', 1, 'unit'],
      ['לחם', 1, 'unit'], ['עגבניות', 0.5, 'kg'], ['מלפפונים', 0.5, 'kg'], ['זיתים', 1, 'unit'],
      ['טונה', 2, 'unit'], ['מיץ תפוזים', 1, 'unit'], ['קפה', 1, 'unit', true],
    ],
  },
  {
    id: 'pizza', he: 'פיצה ביתית', emoji: '🍕', base: 4,
    items: [
      ['קמח', 1, 'unit'], ['שמרים', 1, 'unit', true], ['רוטב עגבניות', 1, 'unit'], ['מוצרלה', 2, 'unit'],
      ['זיתים', 1, 'unit'], ['פטריות', 1, 'pack'], ['תירס שימורים', 1, 'unit'], ['שמן זית', 1, 'unit', true],
    ],
  },
];

export function scaleRecipe(recipe, servings) {
  const f = servings / recipe.base;
  return recipe.items.map(([name, qty, unit, staple]) => {
    let q = qty * f;
    if (unit === 'kg') q = Math.max(0.5, Math.round(q * 2) / 2);
    else q = Math.max(1, Math.ceil(q - 0.15));
    if (staple) q = 1;
    return { name, qty: q, unit, staple: !!staple };
  });
}
