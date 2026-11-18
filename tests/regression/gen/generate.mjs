// Constrained-random shopping-list stimulus generator (Mulberry32 deterministic PRNG).
// Generates seeded lists spanning ₪200–₪4,000 across all 11 layouts and functional coverage bins.
import { renderStimulus } from './render.mjs';

export const LAYOUTS = [
  'lines', 'commas', 'bullets', 'numbered', 'checkboxes', 'whatsapp',
  'tsv_vertical', 'tsv_horizontal', 'tsv_cols_qty', 'csv_quoted', 'xlsx_styled',
];

export const BUDGET_BUCKETS = [
  { id: 'b200_400', min: 200, max: 400 },
  { id: 'b400_800', min: 400, max: 800 },
  { id: 'b800_1500', min: 800, max: 1500 },
  { id: 'b1500_2500', min: 1500, max: 2500 },
  { id: 'b2500_4000', min: 2500, max: 4000 },
];

export const NOISE_PROFILES = ['clean', 'headers', 'non_grocery', 'whatsapp_chat', 'bought_marks', 'heavy_mixed'];
export const AMBIG_PROFILES = ['none', 'single_ambig', 'multi_ambig', 'disambiguated'];
export const RARITY_PROFILES = ['common_only', 'with_rare'];
export const QTY_STYLES = ['plain_num', 'mult_x', 'hebrew_words', 'fractions_weights', 'mixed_styles', 'synonym_merge'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deterministic Hebrew typo & inflection mutator for S6 unseen generalization verification (C1 + M11):
// Applies realistic orthographic variations (missing geresh, medial-at-end ם->מ / ן->נ, ו->וו, ה->א ending, or unseen container prefix).
const MEDIAL_AT_END = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
const UNSEEN_CONTAINERS = ['אריזת', 'מארז', 'חבילת'];

export function mutateHebrewPhrase(phrase, rng) {
  const s = String(phrase || '').trim();
  if (!/[\u0590-\u05FF]/.test(s)) return { text: s, mutated: false };
  const mode = Math.floor(rng() * 3);
  if (mode === 0) {
    // Replace final Hebrew letter with medial form on one word ("מלפפונים" -> "מלפפונימ")
    const words = s.split(' ');
    for (let i = 0; i < words.length; i++) {
      const last = words[i][words[i].length - 1];
      if (MEDIAL_AT_END[last]) {
        words[i] = words[i].slice(0, -1) + MEDIAL_AT_END[last];
        return { text: words.join(' '), mutated: true };
      }
    }
  } else if (mode === 1) {
    // Aramaic א ending on feminine noun >= 4 chars ("גבינה" -> "גבינא", "טחינה" -> "טחינא")
    const words = s.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (words[i].length >= 4 && words[i].endsWith('ה')) {
        words[i] = words[i].slice(0, -1) + 'א';
        return { text: words.join(' '), mutated: true };
      }
    }
  }
  // Prepend an unseen container word ("אריזת ...")
  const cont = UNSEEN_CONTAINERS[Math.floor(rng() * UNSEEN_CONTAINERS.length)];
  if (!s.startsWith(cont + ' ')) {
    return { text: `${cont} ${s}`, mutated: true };
  }
  return { text: s, mutated: false };
}

function chooseQty(entry, qtyStyle, rng, scaleBoost = 1) {
  const [lo, hi] = entry.qtyRange || [1, 3];
  if (entry.defaultUnit === 'kg') {
    if (qtyStyle === 'hebrew_words' || qtyStyle === 'fractions_weights') {
      return pick([0.5, 1, 1.5, 2], rng);
    }
    const steps = [0.5, 1, 1.5, 2, 2.5, 3];
    const base = pick(steps.filter((x) => x >= lo && x <= hi * scaleBoost), rng) || 1;
    return base;
  }
  if (entry.defaultUnit === 'pack') {
    return qtyStyle === 'hebrew_words' ? 2 : Math.min(6, Math.max(1, Math.round((lo + rng() * (hi - lo)) * scaleBoost)));
  }
  if (qtyStyle === 'hebrew_words') {
    return pick([1, 2, 3, 4, 5], rng);
  }
  const maxU = Math.min(12, Math.max(hi, Math.round(hi * scaleBoost)));
  return Math.max(1, Math.floor(lo + rng() * (maxU - lo + 1)));
}

export function generateRandomCase(seed, dictionary, priceEstimator) {
  const rng = mulberry32(seed * 2654435761 + 1013904223);

  // Stratified bin selection so pairwise combinations close rapidly across 500+ seeds
  let layout = LAYOUTS[(seed - 1) % LAYOUTS.length];
  const budgetObj = BUDGET_BUCKETS[Math.floor((seed - 1) / LAYOUTS.length) % BUDGET_BUCKETS.length];
  let noise = NOISE_PROFILES[(seed * 3 + Math.floor((seed - 1) / 55)) % NOISE_PROFILES.length];
  const ambiguity = AMBIG_PROFILES[(seed * 5 + Math.floor((seed - 1) / 33)) % AMBIG_PROFILES.length];
  const rarity = RARITY_PROFILES[(seed * 7 + Math.floor((seed - 1) / 11)) % RARITY_PROFILES.length];
  const qtyStyle = QTY_STYLES[(seed * 11 + Math.floor((seed - 1) / 22)) % QTY_STYLES.length];

  if (noise === 'whatsapp_chat') layout = 'whatsapp';
  if (layout === 'commas' && noise === 'headers') noise = 'clean';

  const targetMid = (budgetObj.min + budgetObj.max) / 2;
  const scaleBoost = targetMid > 2000 ? 2.2 : (targetMid > 1000 ? 1.5 : 1);

  const pool = [...dictionary.realItems];
  shuffleInPlace(pool, rng);

  const chosenReal = [];
  let estTotal = 0;

  // Disambiguated profile explicitly includes unambiguous phrases that share roots with ambiguous words
  if (ambiguity === 'disambiguated') {
    const disambigIds = ['soda_water', 'red_pepper', 'black_pepper_ground', 'sweet_cream_38', 'toilet_paper', 'olive_oil', 'dish_soap', 'tuna_oil', 'instant_coffee', 'potatoes', 'apples'];
    for (const id of disambigIds) {
      if (rng() < 0.35) {
        const entry = dictionary.realItems.find((x) => x.id === id);
        if (entry && !chosenReal.some((c) => c.entry.id === entry.id)) {
          const qty = chooseQty(entry, qtyStyle, rng, 1);
          chosenReal.push({ entry, qty, unit: entry.defaultUnit, bought: false });
          estTotal += (priceEstimator.get(entry.id) || 14) * qty;
        }
      }
    }
  }

  for (const entry of pool) {
    if (estTotal >= budgetObj.min * 0.92 && chosenReal.length >= 5) {
      if (estTotal >= targetMid || chosenReal.length >= 65) break;
    }
    if (chosenReal.some((c) => c.entry.id === entry.id)) continue;
    const qty = chooseQty(entry, qtyStyle, rng, scaleBoost);
    const estLine = (priceEstimator.get(entry.id) || 14) * qty;
    if (estTotal + estLine > budgetObj.max * 1.15 && estTotal >= budgetObj.min * 0.85) continue;
    chosenReal.push({ entry, qty, unit: entry.defaultUnit, bought: false });
    estTotal += estLine;
    if (chosenReal.length >= 75) break;
  }

  // If still below min (e.g. b2500_4000), bump quantities on higher-value items
  let guard = 0;
  while (estTotal < budgetObj.min && chosenReal.length && guard++ < 120) {
    const pickRec = pick(chosenReal, rng);
    if (pickRec.qty < 14 && qtyStyle !== 'hebrew_words') {
      pickRec.qty += 1;
      estTotal += priceEstimator.get(pickRec.entry.id) || 14;
    }
  }

  // Rarity injection
  const chosenRare = [];
  if (rarity === 'with_rare') {
    const rareCount = 1 + (seed % 2);
    const rPool = [...dictionary.rareItems];
    shuffleInPlace(rPool, rng);
    for (const entry of rPool.slice(0, rareCount)) {
      chosenRare.push({ entry, qty: 1, unit: entry.defaultUnit, bought: false });
    }
  }

  // Ambiguity injection
  const chosenAmbig = [];
  if (ambiguity === 'single_ambig' || ambiguity === 'multi_ambig') {
    const ambCount = ambiguity === 'single_ambig' ? 1 : (2 + (seed % 2));
    const aPool = [...dictionary.ambiguousItems];
    shuffleInPlace(aPool, rng);
    for (const amb of aPool.slice(0, ambCount)) {
      chosenAmbig.push({ amb, qty: 1, unit: 'unit', bought: false });
    }
  }

  // Bought marks injection (D4: imported with checked: false)
  if (noise === 'bought_marks' || noise === 'heavy_mixed') {
    const markCount = Math.min(2, Math.max(1, Math.floor(chosenReal.length * 0.15)));
    for (let i = 0; i < markCount; i++) {
      chosenReal[i].bought = true;
    }
  }

  // Build stimulus rows + ground-truth expectedItems
  const rows = [];
  const expectedItems = [];
  const forbiddenItemSubstrings = [];

  if (noise === 'headers' || noise === 'heavy_mixed') {
    const hdr = pick(dictionary.sectionHeaders, rng);
    rows.push({ rowKind: 'header', text: hdr });
  }

  const allGrocery = [
    ...chosenReal.map((r) => ({ ...r, itemKind: 'real' })),
    ...chosenRare.map((r) => ({ ...r, itemKind: 'rare' })),
  ];

  let synonymSplitUsed = false;
  for (let idx = 0; idx < allGrocery.length; idx++) {
    const g = allGrocery[idx];
    const e = g.entry;
    const seenPool = [e.canonical, ...(e.aliases || [])];
    const unseenPool = e.unseenAliases || [];
    const filterHeb = (arr) => (qtyStyle === 'hebrew_words' ? arr.filter((n) => /[\u0590-\u05FF]/.test(n)) : arr);
    const usableSeen = filterHeb(seenPool);
    const usableUnseen = filterHeb(unseenPool);

    let chosenText = pick(usableSeen.length ? usableSeen : [e.canonical], rng);
    let vocabSplit = 'seen';
    if (usableUnseen.length && rng() < 0.35) {
      chosenText = pick(usableUnseen, rng);
      vocabSplit = 'unseen';
    } else if (qtyStyle === 'mixed_styles' && idx === 0 && !g.bought) {
      const mut = mutateHebrewPhrase(chosenText, rng);
      if (mut.mutated) {
        chosenText = mut.text;
        vocabSplit = 'unseen';
      }
    }

    if (
      qtyStyle === 'synonym_merge'
      && !synonymSplitUsed
      && !g.bought
      && g.unit === 'unit'
      && (usableSeen.length + usableUnseen.length) >= 2
      && layout !== 'tsv_horizontal'
    ) {
      // Split into two rows using distinct seen + unseen/mutated synonyms to verify genuine S6 generalization!
      synonymSplitUsed = true;
      const q1 = Math.max(1, Math.floor(g.qty / 2));
      const q2 = Math.max(1, g.qty - q1);
      const totalQ = q1 + q2;
      const firstVariant = usableSeen[0] || e.canonical;
      let secondVariant = usableUnseen[0] || usableSeen[1] || mutateHebrewPhrase(firstVariant, rng).text;
      const mergeSplit = usableUnseen.length > 0 || secondVariant !== usableSeen[1] ? 'unseen' : 'seen';
      rows.push({
        rowKind: 'item',
        text: firstVariant,
        qty: q1,
        unit: g.unit,
        catLabel: e.category[0],
        bought: false,
        qtyStyle: 'plain_num',
      });
      rows.push({
        rowKind: 'item',
        text: secondVariant,
        qty: q2,
        unit: g.unit,
        catLabel: e.category[0],
        bought: false,
        qtyStyle: 'plain_num',
      });
      expectedItems.push({
        dictId: e.id,
        canonical: e.canonical,
        kind: g.itemKind,
        qty: totalQ,
        unit: g.unit,
        checked: true,
        vocabSplit: mergeSplit,
        allowedCategories: e.category,
        mustIncludeAny: e.mustIncludeAny,
        mustExcludeAny: e.mustExcludeAny,
      });
    } else {
      rows.push({
        rowKind: 'item',
        text: chosenText,
        qty: g.qty,
        unit: g.unit,
        catLabel: e.category[0],
        bought: g.bought,
        qtyStyle,
      });
      expectedItems.push({
        dictId: e.id,
        canonical: e.canonical,
        stimulusSurface: chosenText,
        kind: g.itemKind,
        qty: g.qty,
        unit: g.unit,
        checked: !g.bought,
        vocabSplit,
        allowedCategories: e.category,
        mustIncludeAny: e.mustIncludeAny,
        mustExcludeAny: e.mustExcludeAny,
      });
    }

    if ((noise === 'headers' || noise === 'heavy_mixed') && idx === Math.floor(allGrocery.length / 2)) {
      rows.push({ rowKind: 'header', text: pick(dictionary.sectionHeaders, rng) });
    }
  }

  for (const a of chosenAmbig) {
    const unseenAmb = a.amb.unseenAliases || [];
    let word = a.amb.term;
    let ambSplit = 'seen';
    if (unseenAmb.length && rng() < 0.35) {
      word = pick(unseenAmb, rng);
      ambSplit = 'unseen';
    } else if (a.amb.aliases?.length && rng() < 0.25) {
      word = pick(a.amb.aliases, rng);
    }
    rows.push({
      rowKind: 'item',
      text: word,
      qty: a.qty,
      unit: 'unit',
      catLabel: 'pantry',
      bought: false,
      qtyStyle: 'plain_num',
    });
    expectedItems.push({
      dictId: a.amb.id,
      canonical: a.amb.term,
      kind: 'ambiguous',
      qty: a.qty,
      unit: 'unit',
      checked: true,
      vocabSplit: ambSplit,
      allowedCategories: null,
      ambiguousChoices: a.amb.choices,
    });
  }

  // Non-grocery noise injection (S2)
  let expectedSkippedMin = 0;
  if (noise === 'non_grocery' || noise === 'heavy_mixed' || noise === 'whatsapp_chat') {
    const ngCount = noise === 'heavy_mixed' ? 3 : 2;
    const ngPool = [...dictionary.nonGroceryItems];
    shuffleInPlace(ngPool, rng);
    for (const ng of ngPool.slice(0, ngCount)) {
      rows.push({ rowKind: 'non_grocery', text: ng });
      forbiddenItemSubstrings.push(ng);
      expectedSkippedMin++;
    }
  }

  const stimulus = renderStimulus({ layout, rows }, rng);

  return {
    id: `RND_${String(seed).padStart(4, '0')}`,
    kind: 'random',
    seed,
    bins: {
      channel: stimulus.channel,
      layout,
      budget: budgetObj.id,
      noise,
      ambiguity,
      rarity,
      qtyStyle,
    },
    stimulus,
    expected: {
      expectNoGroceryError: false,
      expectedItems,
      expectedSkippedMin,
      forbiddenItemSubstrings,
    },
  };
}
