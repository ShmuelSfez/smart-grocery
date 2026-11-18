// Unified shopping-list import & list-addition engine for free text, WhatsApp chats, Google Sheets, CSV/TSV, and .xlsx files.
// Pure ES module (browser + Node) with zero external dependencies, zero regex lookbehind, and zero testbench imports.
import { parseItem, normalizeName, splitLineSegments } from './parser.js';
import { categorize, CATEGORY_BY_ID } from './categories.js';
import {
  GROCERY_HEADERS,
  IRRELEVANT_HEADERS,
  parseGrid,
  analyzeSheetGrid,
  classifyIrrelevantReason,
  stripInlineBoughtMarker,
  isSectionHeaderText,
  mergeGroceryCandidates,
  canMergeResolvedConcepts,
  mergeUnitsIfCompatible,
} from './sheets.js';
import { checkAmbiguousTerm, resolveGrocerySynonym, AMBIGUOUS_ITEMS_LIST } from './synonyms.js';

export { AMBIGUOUS_ITEMS_LIST };

const WHATSAPP_PREFIX_RE = /^(?:\[\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\]|\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}\s*-\s*)[^:]{1,35}:\s*/;
const BULLET_OR_NUM_RE = /^(?:[-•*·▪●]+|\d+[.)])\s+/;
const CHAT_FILLER_RE = /^(?:תביאו גם|תביא גם|צריך גם|צריכים גם|תקנו גם|תקנה גם|אפשר גם|אל תשכחו|להוסיף גם|להוסיף)\s+/i;
const DECOR_EMOJI_RE = /[\u{1F300}-\u{1FAFF}✨]/gu;

export function enrichAndDeduplicateItems(rawItems, overrides = {}) {
  return mergeGroceryCandidates(rawItems, overrides);
}

/**
 * Pure state-transition function used by `app.js` `addItems` AND verified directly by tests (C2):
 * Adds `incomingItems` onto `existingList`, preserving `checked: false` (bought items) and `ambiguous` metadata,
 * merging compatible units for matching synonyms with matching `checked` state, and keeping separate lines on unit mismatch!
 */
export function applyItemsToList(existingList, incomingItems, { mappings = {}, overrides = {}, history = {}, makeId = null } = {}) {
  const nextList = existingList.map((x) => ({ ...x }));
  const genId = makeId || (() => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  let addedCount = 0;

  const resolveCat = (name, given) => {
    const k = normalizeName(name);
    if (overrides[k]) return overrides[k];
    if (history[k]?.category) return history[k].category;
    if (given && CATEGORY_BY_ID[given]) return given;
    return categorize(name, overrides);
  };

  for (const it of incomingItems) {
    if (!it || !it.name) continue;
    const itemChecked = it.checked !== false;
    const amb = it.ambiguous || (it.product ? null : checkAmbiguousTerm(it.name));
    const syn = amb ? null : resolveGrocerySynonym(it.name);

    // Find a compatible existing line (must match checked state AND compatible units — never overwrite incompatible units!)
    const existing = nextList.find((x) => {
      if (Boolean(x.checked) !== itemChecked) return false;
      if (amb || x.ambiguous) {
        if (!amb || !x.ambiguous) return false;
        return normalizeName(x.ambiguous.term) === normalizeName(amb.term) && mergeUnitsIfCompatible(x, it);
      }
      const xSyn = resolveGrocerySynonym(x.name);
      return canMergeResolvedConcepts(xSyn, syn) && mergeUnitsIfCompatible(x, it);
    });

    if (existing) {
      if (it.product) existing.product = it.product;
      if (!existing.note && it.note) existing.note = it.note;
    } else {
      const k = normalizeName(it.name);
      const savedProd = amb ? null : (it.product || mappings[k] || null);
      const displayIsEnglish = !amb && syn && !/[\u0590-\u05FF]/.test(it.name) && /[\u0590-\u05FF]/.test(syn.canonicalName);
      const finalName = amb ? amb.term : (displayIsEnglish ? syn.canonicalName : it.name);
      const newItem = {
        id: it.id || genId(),
        name: finalName,
        canonicalName: amb ? amb.term : (syn?.canonicalName || finalName),
        qty: it.qty || 1,
        unit: it.unit || 'unit',
        qtyExplicit: Boolean(it.qtyExplicit || (Number(it.qty) > 0 && Number(it.qty) !== 1)),
        category: resolveCat(finalName, it.category),
        note: it.note || '',
        checked: itemChecked,
        product: savedProd,
        addedAt: Number.isFinite(it.addedAt) ? it.addedAt : Date.now(),
      };
      if (amb) newItem.ambiguous = { term: amb.term, choices: [...amb.choices] };
      nextList.push(newItem);
    }
    addedCount++;
  }

  return { nextList, addedCount };
}

function finalizeImportResult(added, skipped) {
  if (!added.length) {
    return {
      error: 'NO_GROCERY_ITEMS',
      errorMessage: 'לא זוהו מוצרי סופר ברשימה',
      added: [],
      skipped,
    };
  }
  return {
    error: null,
    errorMessage: null,
    added,
    skipped,
  };
}

/**
 * Import free-form text (multi-line, comma/semicolon lists, bullets, numbered lists, checkboxes, WhatsApp chats).
 */
export function importFromText(rawText, overrides = {}) {
  const full = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!full.trim()) {
    return finalizeImportResult([], []);
  }

  const candidates = [];
  const skipped = [];

  for (const origLine of full.split('\n')) {
    const trimmedOrig = origLine.trim();
    if (!trimmedOrig) continue;

    let line = trimmedOrig.replace(WHATSAPP_PREFIX_RE, '').trim();
    if (!line) continue;

    if (!/[\p{L}\p{N}]/u.test(line)) {
      skipped.push({ raw: trimmedOrig, reason: 'סימני פיסוק / קו מפריד' });
      continue;
    }

    if (isSectionHeaderText(line)) {
      skipped.push({ raw: trimmedOrig, reason: 'כותרת סעיף / קטגוריה' });
      continue;
    }

    const segments = splitLineSegments(line);

    for (const segRaw of segments) {
      let s = segRaw;
      let bought = false;

      s = s.replace(BULLET_OR_NUM_RE, '').trim();
      const b1 = stripInlineBoughtMarker(s);
      s = b1.text;
      bought = bought || b1.bought;
      s = s.replace(BULLET_OR_NUM_RE, '').trim();
      const b2 = stripInlineBoughtMarker(s);
      s = b2.text;
      bought = bought || b2.bought;

      s = s.replace(CHAT_FILLER_RE, '').replace(DECOR_EMOJI_RE, ' ').replace(/\s+/g, ' ').trim();

      if (!s || !/[\p{L}\p{N}]/u.test(s)) {
        skipped.push({ raw: segRaw, reason: 'סימני פיסוק / ריק' });
        continue;
      }

      if (isSectionHeaderText(s)) {
        skipped.push({ raw: segRaw, reason: 'כותרת סעיף / קטגוריה' });
        continue;
      }

      const normS = normalizeName(s);
      if (GROCERY_HEADERS.has(normS) || IRRELEVANT_HEADERS.has(normS)) {
        skipped.push({ raw: segRaw, reason: 'כותרת סעיף / קטגוריה' });
        continue;
      }

      const irrelRaw = classifyIrrelevantReason(s, '');
      if (irrelRaw) {
        skipped.push({ raw: segRaw, reason: irrelRaw });
        continue;
      }

      const parsed = parseItem(s);
      if (!parsed || !parsed.name) {
        skipped.push({ raw: segRaw, reason: 'לא זוהה כמוצר' });
        continue;
      }

      const irrelParsed = classifyIrrelevantReason(parsed.name, '');
      if (irrelParsed) {
        skipped.push({ raw: segRaw, reason: irrelParsed });
        continue;
      }

      candidates.push({
        ...parsed,
        qtyExplicit: Boolean(parsed.qtyExplicit),
        checked: !bought,
        raw: segRaw,
      });
    }
  }

  const added = mergeGroceryCandidates(candidates, overrides);
  return finalizeImportResult(added, skipped);
}

/**
 * Import a parsed 2D spreadsheet grid (from Google Sheets, CSV, TSV, or `.xlsx`).
 */
export function importFromGrid(grid, opts = {}) {
  const overrides = opts.overrides || {};
  const { relevant, skipped } = analyzeSheetGrid(grid, overrides, { strikeCells: opts.strikeCells });
  return finalizeImportResult(relevant, skipped);
}

/**
 * Import raw CSV or TSV text from Google Sheets / Excel.
 */
export function importFromSheetText(rawText, overrides = {}) {
  const grid = parseGrid(rawText);
  return importFromGrid(grid, { overrides });
}
