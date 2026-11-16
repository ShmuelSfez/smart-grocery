// Optional AI: turn free text ("ארוחת שישי ל-8", a pasted recipe, a messy note) into list items.
// Uses the Gemini API directly from the browser with the user's own key (stored only locally).
import { CATEGORIES } from './categories.js';

export async function aiToItems(text, { apiKey, model }) {
  if (!apiKey) throw new Error('NO_KEY');
  const prompt = `אתה עוזר קניות לסופרמרקט ישראלי (שופרסל).
הפוך את הטקסט הבא לרשימת קניות. כללים:
- שמות מוצרים בעברית, כפי שהיו מחפשים אותם באתר שופרסל, כלליים (בלי מותג אלא אם צוין).
- אם מדובר במתכון או ארוחה – פרק למצרכים, והתאם כמויות למספר הסועדים אם צוין.
- unit: "unit" ליחידות/אריזות בודדות, "kg" לפירות/ירקות/בשר במשקל, "g" לגרמים, "pack" לחבילה.
- אל תכלול מים מהברז, מלח או מוצרים שלא קונים בסופר.
- category אחת מ: ${CATEGORIES.map((c) => c.id).join(', ')}.

הטקסט:
"""${text}"""`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            qty: { type: 'NUMBER' },
            unit: { type: 'STRING', enum: ['unit', 'kg', 'g', 'pack'] },
            category: { type: 'STRING', enum: CATEGORIES.map((c) => c.id) },
          },
          required: ['name', 'qty', 'unit', 'category'],
        },
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '[]';
  const items = JSON.parse(txt);
  return items
    .filter((i) => i && i.name)
    .map((i) => ({ name: String(i.name).trim(), qty: Number(i.qty) || 1, unit: i.unit || 'unit', category: i.category || 'other' }));
}
