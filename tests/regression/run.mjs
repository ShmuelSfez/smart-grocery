// SmartCart DV Regression Runner: Stimulus -> DUT (importer + applyItemsToList + prices + pricing) -> Independent Oracle & Scoreboard.
// Usage:
//   node tests/regression/run.mjs                 # full 628-list regression (108 directed + 520 random)
//   node tests/regression/run.mjs --smoke         # fast deterministic smoke subset
//   node tests/regression/run.mjs --seeds=800     # custom random seed count
//   node tests/regression/run.mjs --strict        # exit 1 if any check fails
//   node tests/regression/run.mjs --no-record     # skip writing reports/{latest.md,history.json}
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Production pipeline modules (including serializeBranchItems from build.mjs so tuple format is verified end-to-end, M12)
import { parsePricesXml } from '../../pipeline/parse.mjs';
import { parsePromosXml } from '../../pipeline/promos.mjs';
import { serializeBranchItems } from '../../pipeline/build.mjs';

// Production web runtime modules (exact modules wired into web/js/app.js, C2)
import { LIVE_CHAIN_IDS, ONLINE_LIVE_CHAIN_IDS } from '../../web/js/chains.js';
import { buildCatalogBundle, matchLineAcrossChains } from '../../web/js/prices.js';
import { compareBasket } from '../../web/js/pricing.js';
import { parseItem, normalizeName } from '../../web/js/parser.js';
import { resolveGrocerySynonym } from '../../web/js/synonyms.js';
import { importFromText, importFromSheetText, importFromGrid, applyItemsToList } from '../../web/js/importer.js';
import { parseXlsxBuffer } from '../../web/js/xlsx.js';

// Verification environment (Independent Reference Model, Stimulus Generator, Directed Suite)
import {
  loadReferenceSnapshot,
  refEvaluateBasket,
  refComputeAvailability,
  buildPriceEstimator,
} from './refmodel/price-model.mjs';
import {
  generateRandomCase,
  LAYOUTS,
  BUDGET_BUCKETS,
  NOISE_PROFILES,
  AMBIG_PROFILES,
  RARITY_PROFILES,
  QTY_STYLES,
} from './gen/generate.mjs';
import { buildDirectedCases } from './directed/cases.mjs';

const REG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(REG_DIR, '..', '..');
const REPORTS_DIR = path.join(REG_DIR, 'reports');
const MAX_ALLOWED_LEXICON_OVERLAP_PCT = 30.0;

function parseCli(argv) {
  const smoke = argv.includes('--smoke');
  const strict = argv.includes('--strict');
  const noRecord = argv.includes('--no-record');
  let seeds = smoke ? 36 : 520;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--seeds=')) seeds = Math.max(1, parseInt(a.slice('--seeds='.length), 10) || 520);
  }
  return { smoke, strict, noRecord, seeds };
}

/**
 * Non-Tautology Gate (C1): Ensures `web/js/synonyms.js` does not copy the golden reference dictionary.
 * Measures what % of multi-word phrases in `dictionary/items.json` appear as string literals in `web/js/synonyms.js`.
 */
function verifyLexiconIndependence(dictionary) {
  const synPath = path.join(REPO_ROOT, 'web', 'js', 'synonyms.js');
  const synSrc = fs.readFileSync(synPath, 'utf8');
  const dictPhrases = new Set();
  for (const e of [...dictionary.realItems, ...dictionary.rareItems]) {
    for (const p of [e.canonical, ...(e.aliases || []), ...(e.unseenAliases || [])]) {
      const n = normalizeName(p);
      if (n.split(' ').length >= 2) dictPhrases.add(n);
    }
  }
  const srcLiterals = new Set([...synSrc.matchAll(/['"]([^'"]+)['"]/g)].map((m) => normalizeName(m[1])));
  let overlap = 0;
  for (const p of dictPhrases) if (srcLiterals.has(p)) overlap++;
  const pct = Math.round((overlap / Math.max(1, dictPhrases.size)) * 1000) / 10;
  if (pct > MAX_ALLOWED_LEXICON_OVERLAP_PCT) {
    throw new Error(
      `TB_NON_TAUTOLOGY_VIOLATION: web/js/synonyms.js overlaps ${pct}% of multi-word golden dictionary phrases (limit ${MAX_ALLOWED_LEXICON_OVERLAP_PCT}%)`,
    );
  }
  return { overlap, total: dictPhrases.size, pct };
}

/** Build the DUT's in-memory `branchData` using the exact `pipeline/build.mjs` `serializeBranchItems` function (M12). */
function buildDutBranchDataFromSnapshot(refSnap) {
  const branchData = {};
  for (const cid of ONLINE_LIVE_CHAIN_IDS) {
    const raw = refSnap.chains[cid];
    if (!raw) throw new Error(`Missing frozen online snapshot for live online chain "${cid}"`);
    const { items } = parsePricesXml(raw.rawPricesXml);
    const { promosByItem } = raw.rawPromosXml
      ? parsePromosXml(raw.rawPromosXml, { now: refSnap.refDate })
      : { promosByItem: new Map() };
    const { catalog, branchPrices } = serializeBranchItems(items, promosByItem, {});
    branchData[cid] = {
      catalog: buildCatalogBundle(catalog),
      storePrices: branchPrices,
      store: { storeId: raw.storeId, name: `${cid} online`, kind: 'online' },
    };
  }
  return branchData;
}

/** Drive both `importer.js` AND `applyItemsToList` (the exact production list-addition seam in `app.js`, C2). */
async function runDutImport(stimulus) {
  let imp;
  if (stimulus.channel === 'text') {
    imp = importFromText(stimulus.payload);
  } else if (stimulus.channel === 'tsv' || stimulus.channel === 'csv') {
    imp = importFromSheetText(stimulus.payload);
  } else if (stimulus.channel === 'xlsx') {
    const parsed = await parseXlsxBuffer(stimulus.payload);
    imp = importFromGrid(parsed.grid, { strikeCells: parsed.strikeCells });
  } else {
    throw new Error(`Unsupported channel: ${stimulus.channel}`);
  }
  if (imp.error) return imp;
  const { nextList } = applyItemsToList([], imp.added);
  return { ...imp, added: nextList };
}

function normLookup(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/([\u0590-\u05FF])(\d)/g, '$1 $2')
    .replace(/(\d)([\u0590-\u05FF])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTokenBoundedPhrase(normText, phrase, rawLen = 0) {
  if (!phrase) return false;
  const padded = ` ${normText} `;
  if (padded.includes(` ${phrase} `)) return true;

  const pWords = phrase.split(' ');
  const lastP = pWords[pWords.length - 1];
  const prefixWords = pWords.length > 1 ? ` ${pWords.slice(0, -1).join(' ')} ` : ' ';

  if (lastP.length >= 3 && lastP !== 'מאסט' && lastP !== 'מולט' && lastP !== 'סופג') {
    let idx = padded.indexOf(prefixWords);
    while (idx >= 0) {
      const rest = padded.slice(idx + prefixWords.length);
      const nextSpace = rest.indexOf(' ');
      const word = nextSpace >= 0 ? rest.slice(0, nextSpace) : rest;
      if (word.startsWith(lastP) && word.length - lastP.length <= 3) return true;
      if (word.length >= lastP.length + 1 && (word[0] === 'ל' || word[0] === 'ה' || word[0] === 'ב')) {
        const stripped = word.slice(1);
        if (stripped.startsWith(lastP) && stripped.length - lastP.length <= 3) return true;
      }
      idx = padded.indexOf(prefixWords, idx + 1);
    }
  }

  if (rawLen >= 19) {
    const tWords = normText.split(' ');
    const lastT = tWords[tWords.length - 1] || '';
    if (lastT.length >= 3 && lastP.length > lastT.length && lastP.startsWith(lastT)) {
      const prefixPhrase = [...pWords.slice(0, -1), lastT].join(' ');
      if (padded.endsWith(` ${prefixPhrase} `)) return true;
    }
  }
  return false;
}

function buildDictLookup(dictionary) {
  const map = new Map();
  const reg = (surf, id, isAmbig = false) => {
    const n = normLookup(surf);
    if (n) map.set(n, id);
    const p = parseItem(surf);
    if (p && p.name) {
      const np = normLookup(p.name);
      if (np && !map.has(np)) map.set(np, id);
    }
    if (!isAmbig) {
      const syn = resolveGrocerySynonym(surf);
      if (syn.conceptKey) {
        const ck = `${syn.conceptKey}|${syn.brandTag || ''}`;
        if (!map.has(ck)) map.set(ck, id);
        if (!map.has(syn.conceptKey)) map.set(syn.conceptKey, id);
      }
    }
  };
  for (const e of [...dictionary.realItems, ...dictionary.rareItems]) {
    reg(e.canonical, e.id, false);
    for (const a of e.aliases || []) reg(a, e.id, false);
    for (const u of e.unseenAliases || []) reg(u, e.id, false);
  }
  for (const a of dictionary.ambiguousItems) {
    reg(a.term, a.id, true);
    for (const al of a.aliases || []) reg(al, a.id, true);
    for (const u of a.unseenAliases || []) reg(u, a.id, true);
  }
  return map;
}

function toBaseQty(qty, unit) {
  if (unit === 'kg') return { dim: 'weight', val: qty };
  if (unit === 'g') return { dim: 'weight', val: qty / 1000 };
  return { dim: 'count', val: qty };
}

function checkSemanticAcceptance(productName, exp) {
  const low = normLookup(productName);
  const rawLen = String(productName || '').trim().length;
  const inc = (exp.mustIncludeAny || []).map(normLookup).filter(Boolean);
  const exc = (exp.mustExcludeAny || []).map(normLookup).filter(Boolean);
  if (inc.length && !inc.some((k) => hasTokenBoundedPhrase(low, k, rawLen))) {
    return { ok: false, reason: `"${productName}" missing [${exp.mustIncludeAny.join(' / ')}]` };
  }
  for (const bad of exc) {
    if (bad && hasTokenBoundedPhrase(low, bad, rawLen)) {
      return { ok: false, reason: `"${productName}" matched forbidden "${bad}"` };
    }
  }
  return { ok: true };
}

// Strict S3 artifact detector: catches leftover WhatsApp timestamps, strikethrough ~~, bullets, numbering, checkboxes, markdown banners, or emojis (M10)
const S3_LEAK_RE = /(^\[\d{1,2}[./]\d{1,2}|^\d{1,2}[./]\d{1,2}[./]\d{2,4},?\s+\d{1,2}:\d{2}|^([-•*·▪●]+|\d+[.)])\s|\[[ xXvV✓✔]\]|[☐☑✅]|~~|===|\*\*|###|[\u{1F300}-\u{1FAFF}✨]|:\s*$)/u;

const SPEC_RULES = [
  ['S1', 'Empty / No-Grocery Error'],
  ['S2', 'Mixed Non-Grocery Filtering'],
  ['S3', 'Headers, Chat & Formatting Noise'],
  ['S4', 'Bought Marks -> Unchecked'],
  ['S5', 'Quantities & Units (±0.01)'],
  ['S6', 'Synonyms, Typos & Deduplication'],
  ['S7', 'Ambiguous Terms Flagged & Unpriced'],
  ['S8', 'Rare / Missing -> Partial Basket'],
  ['S9', 'Semantic Precision & Recall'],
  ['S10', 'Independent XML Price & Winner Oracle'],
];

const RESPONSE_BINS = [
  'promo_price_applied',
  'promo_bundle_applied',
  'ramilevy_promo_applied',
  'weighted_kg_priced',
  'substitute_flagged',
  'partial_basket_honest',
  'bought_excluded_from_total',
  'ambiguous_blocked_winner',
  'asymmetric_delivery_subtotal_cmp',
];

async function main() {
  const opts = parseCli(process.argv);
  const t0 = Date.now();

  const dictionary = JSON.parse(fs.readFileSync(path.join(REG_DIR, 'dictionary', 'items.json'), 'utf8'));
  const waiversFile = fs.existsSync(path.join(REG_DIR, 'waivers.json'))
    ? JSON.parse(fs.readFileSync(path.join(REG_DIR, 'waivers.json'), 'utf8'))
    : { waivers: [] };
  const activeWaivers = waiversFile.waivers || [];
  const isWaived = (ruleId, itemId, chainId = null) => activeWaivers.some(
    (w) => w.rule === ruleId && w.itemId === itemId && (!w.chain || w.chain === chainId),
  );

  // 1. Enforce Lexicon Non-Tautology Gate (C1)
  const overlapInfo = verifyLexiconIndependence(dictionary);

  const deliveryFile = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'web', 'data', 'delivery.json'), 'utf8'));
  const deliveryChains = deliveryFile.chains || {};

  // 2. Load Reference Snapshot (runs H1 & H2 Oracle Self-Checks automatically)
  const refSnap = loadReferenceSnapshot();
  const refAvail = refComputeAvailability(dictionary, refSnap);
  const branchData = buildDutBranchDataFromSnapshot(refSnap);
  const priceEst = buildPriceEstimator(dictionary, refSnap);
  const dictLookup = buildDictLookup(dictionary);

  const allDirected = buildDirectedCases(dictionary);
  const directed = opts.smoke ? allDirected.filter((_, i) => i % 3 === 0) : allDirected;
  const randomCases = [];
  for (let s = 1; s <= opts.seeds; s++) {
    randomCases.push(generateRandomCase(s, dictionary, priceEst));
  }
  const suite = [...directed, ...randomCases];

  const ruleStats = Object.fromEntries(SPEC_RULES.map(([id, title]) => [id, { title, pass: 0, fail: 0, waived: 0, samples: [] }]));
  const subSplits = {
    S6_seen: { pass: 0, fail: 0 },
    S6_unseen: { pass: 0, fail: 0 },
    S7_seen: { pass: 0, fail: 0 },
    S7_unseen: { pass: 0, fail: 0 },
    S9_precision: { pass: 0, fail: 0 },
    S9_recall: { pass: 0, fail: 0 },
  };

  const recordRule = (ruleId, ok, tcId, detail = '', waived = false) => {
    const st = ruleStats[ruleId];
    if (waived) {
      st.waived++;
      return;
    }
    if (ok) st.pass++;
    else {
      st.fail++;
      if (st.samples.length < 10) st.samples.push(`${tcId}: ${detail}`);
    }
  };

  // Coverage model (sampled ONLY on passing lists, M8!)
  const covDims = {
    channel: new Set(['text', 'tsv', 'csv', 'xlsx']),
    layout: new Set(LAYOUTS),
    budget: new Set(['none', ...BUDGET_BUCKETS.map((b) => b.id)]),
    noise: new Set(NOISE_PROFILES),
    ambiguity: new Set(AMBIG_PROFILES),
    rarity: new Set(RARITY_PROFILES),
    qtyStyle: new Set(QTY_STYLES),
    dutResponse: new Set(RESPONSE_BINS),
  };
  const covHits = Object.fromEntries(Object.keys(covDims).map((k) => [k, new Map()]));
  const crossHits = new Set();

  let passedCases = 0;
  const failedCaseSamples = [];

  for (const tc of suite) {
    const caseFailures = [];
    const fail = (ruleId, msg) => {
      caseFailures.push(`[${ruleId}] ${msg}`);
      recordRule(ruleId, false, tc.id, msg);
    };
    const pass = (ruleId) => recordRule(ruleId, true, tc.id);

    const imp = await runDutImport(tc.stimulus);
    const added = (imp.added || []).map((it, idx) => ({ ...it, id: it.id || `line_${idx}` }));
    const skipped = imp.skipped || [];

    // --- S1: Empty / No-Grocery Error ---
    if (tc.expected.expectNoGroceryError) {
      if (imp.error === 'NO_GROCERY_ITEMS' && added.length === 0) pass('S1');
      else fail('S1', `expected NO_GROCERY_ITEMS & 0 added, got error=${imp.error} added=${added.length}`);
      if (tc.expected.expectedSkippedMin > 0) {
        if (skipped.length >= tc.expected.expectedSkippedMin && skipped.every((s) => s.reason)) pass('S2');
        else fail('S2', `expected >=${tc.expected.expectedSkippedMin} skipped with reason, got ${skipped.length}`);
      }
      if (!caseFailures.length) {
        passedCases++;
        for (const [dim, val] of Object.entries(tc.bins)) covHits[dim].set(val, (covHits[dim].get(val) || 0) + 1);
      } else if (failedCaseSamples.length < 15) {
        failedCaseSamples.push({ id: tc.id, errors: caseFailures });
      }
      continue;
    }
    if (imp.error) {
      fail('S1', `unexpected import error=${imp.error} on valid grocery list`);
      if (failedCaseSamples.length < 15) failedCaseSamples.push({ id: tc.id, errors: caseFailures });
      continue;
    }

    // --- S2: Non-Grocery Filtering ---
    if (tc.expected.expectedSkippedMin > 0 || tc.expected.forbiddenItemSubstrings.length > 0) {
      const leaked = added.find((a) =>
        tc.expected.forbiddenItemSubstrings.some((sub) => {
          const nSub = normLookup(sub);
          return nSub.length >= 2 && normLookup(a.name).includes(nSub);
        }),
      );
      const hasReasons = skipped.length >= tc.expected.expectedSkippedMin && skipped.every((s) => Boolean(s.reason));
      if (!leaked && hasReasons) pass('S2');
      else fail('S2', leaked ? `non-grocery "${leaked.name}" leaked into added` : `skipped=${skipped.length} < ${tc.expected.expectedSkippedMin}`);
    }

    // --- S3: Headers, WhatsApp Prefixes & Formatting Noise (M10) ---
    const noisyLeak = added.find((a) => S3_LEAK_RE.test(a.name.trim()));
    if (noisyLeak) fail('S3', `unstripped markup/noise in item "${noisyLeak.name}"`);
    else pass('S3');

    // Match DUT added items to expectedItems by dictId / canonical name / stem match
    const usedDutIdx = new Set();
    const matchedPairs = [];
    const missingExps = [];

    for (const exp of tc.expected.expectedItems) {
      let foundIdx = -1;
      for (let i = 0; i < added.length; i++) {
        if (usedDutIdx.has(i)) continue;
        const d = added[i];
        const dSyn = d.ambiguous ? null : resolveGrocerySynonym(d.name);
        const resolvedId = d.dictId
          || dictLookup.get(normLookup(d.canonicalName || ''))
          || dictLookup.get(normLookup(d.name))
          || (dSyn ? (dictLookup.get(`${dSyn.conceptKey}|${dSyn.brandTag || ''}`) || dictLookup.get(dSyn.conceptKey)) : undefined);
        if (
          resolvedId === exp.dictId
          || normLookup(d.name) === normLookup(exp.canonical)
          || (exp.stimulusSurface && normLookup(d.name) === normLookup(exp.stimulusSurface))
        ) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx >= 0) {
        usedDutIdx.add(foundIdx);
        matchedPairs.push({ exp, dut: added[foundIdx] });
      } else {
        missingExps.push(exp);
      }
    }

    // --- S6: Item-level Seen vs Unseen & List Deduplication ---
    for (const exp of tc.expected.expectedItems) {
      if (exp.kind === 'ambiguous') continue;
      const bucket = exp.vocabSplit === 'unseen' ? subSplits.S6_unseen : subSplits.S6_seen;
      const wasMatched = matchedPairs.some((p) => p.exp === exp);
      if (wasMatched) bucket.pass++;
      else bucket.fail++;
    }
    if (missingExps.length === 0 && added.length === tc.expected.expectedItems.length) {
      pass('S6');
    } else {
      const extraNames = added.filter((_, i) => !usedDutIdx.has(i)).map((x) => x.name);
      fail('S6', `expected ${tc.expected.expectedItems.length} merged items, got ${added.length} (missing: ${missingExps.map((m) => m.canonical).join(', ') || 'none'}; extra: ${extraNames.join(', ') || 'none'})`);
    }

    // --- S4: Bought Marks -> Unchecked ---
    if (tc.expected.expectedItems.some((e) => !e.checked)) {
      const badBought = matchedPairs.find(({ exp, dut }) => Boolean(dut.checked) !== Boolean(exp.checked));
      if (!badBought && missingExps.length === 0) pass('S4');
      else fail('S4', badBought ? `"${badBought.dut.name}" checked=${badBought.dut.checked}, expected ${badBought.exp.checked}` : 'bought item missing');
    }

    // --- S5: Quantities & Units (±0.01 strict tolerance matching spec.md, M14) ---
    let s5Failures = 0;
    for (const { exp, dut } of matchedPairs) {
      const bExp = toBaseQty(exp.qty, exp.unit);
      const bDut = toBaseQty(dut.qty, dut.unit);
      if (bExp.dim !== bDut.dim || Math.abs(bExp.val - bDut.val) > 0.011) {
        s5Failures++;
        if (s5Failures === 1) fail('S5', `"${dut.name}" qty=${dut.qty} ${dut.unit}, expected ${exp.qty} ${exp.unit}`);
      }
    }
    if (matchedPairs.length > 0 && s5Failures === 0) pass('S5');

    // --- Basket Matching & Pricing across Online Stores ---
    const checkedDut = added.filter((x) => x.checked);
    const lineMatches = new Map();
    const cmpLines = [];
    for (const it of checkedDut) {
      const matches = it.ambiguous
        ? Object.fromEntries(LIVE_CHAIN_IDS.map((cid) => [cid, null]))
        : matchLineAcrossChains(it, branchData);
      lineMatches.set(it.id, matches);
      cmpLines.push({ id: it.id, name: it.name, qty: it.qty, unit: it.unit, qtyExplicit: Boolean(it.qtyExplicit), matches });
    }
    const cmp = compareBasket(cmpLines, ONLINE_LIVE_CHAIN_IDS, deliveryChains, { includeDelivery: true });

    // --- S7: Ambiguity Handling (Seen & Unseen) ---
    if (tc.bins.ambiguity !== 'none') {
      let ambOk = true;
      for (const { exp, dut } of matchedPairs) {
        if (exp.kind === 'ambiguous') {
          const splitBucket = exp.vocabSplit === 'unseen' ? subSplits.S7_unseen : subSplits.S7_seen;
          const validAmb = Boolean(dut.ambiguous && Array.isArray(dut.ambiguous.choices) && dut.ambiguous.choices.length >= 2)
            && !(dut.checked && cmp.cheapestId !== null);
          if (validAmb) splitBucket.pass++;
          else splitBucket.fail++;

          if (!dut.ambiguous || !Array.isArray(dut.ambiguous.choices) || dut.ambiguous.choices.length < 2) {
            ambOk = false;
            fail('S7', `ambiguous term "${exp.canonical}" was NOT flagged with choices`);
          } else if (dut.checked && cmp.cheapestId !== null) {
            ambOk = false;
            fail('S7', `basket with unresolved ambiguous "${exp.canonical}" still declared cheapestId=${cmp.cheapestId}`);
          }
        } else if (dut.ambiguous) {
          ambOk = false;
          fail('S7', `unambiguous item "${dut.name}" falsely flagged ambiguous`);
        }
      }
      for (const mExp of missingExps.filter((e) => e.kind === 'ambiguous')) {
        const splitBucket = mExp.vocabSplit === 'unseen' ? subSplits.S7_unseen : subSplits.S7_seen;
        splitBucket.fail++;
        ambOk = false;
      }
      if (ambOk && !missingExps.some((e) => e.kind === 'ambiguous')) pass('S7');
      else if (missingExps.some((e) => e.kind === 'ambiguous')) fail('S7', 'ambiguous item dropped instead of flagged');
    }

    // --- S8: Rare / Missing -> Partial Basket Honesty + Precision (H10) ---
    let s8Checked = false;
    let s8Ok = true;
    for (const { exp, dut } of matchedPairs) {
      if (exp.dictId === 'rare_camel_truffle_fantasy' && dut.checked) {
        s8Checked = true;
        const mByChain = lineMatches.get(dut.id) || {};
        for (const cid of ONLINE_LIVE_CHAIN_IDS) {
          if (mByChain[cid]) {
            s8Ok = false;
            fail('S8', `unobtainable item "${exp.canonical}" falsely matched "${mByChain[cid].productName}" on ${cid}`);
          }
        }
      }
    }
    for (const cid of ONLINE_LIVE_CHAIN_IDS) {
      const hasMissingLine = cmpLines.some((l) => !l.matches[cid]);
      if (hasMissingLine) {
        s8Checked = true;
        if (cmp.perChain[cid].complete || cmp.cheapestId === cid) {
          s8Ok = false;
          fail('S8', `chain ${cid} has missing item(s) but complete=${cmp.perChain[cid].complete}, cheapestId=${cmp.cheapestId}`);
          break;
        }
      }
    }
    if (s8Checked && s8Ok) pass('S8');

    // --- S9: Semantic Product Precision AND Recall against Oracle Availability (H10) ---
    let s9Failures = 0;
    let s9Checks = 0;
    for (const { exp, dut } of matchedPairs) {
      if (exp.kind === 'ambiguous' || !dut.checked) continue;
      const mByChain = lineMatches.get(dut.id) || {};
      const availByChain = refAvail.get(exp.dictId) || {};

      for (const cid of ONLINE_LIVE_CHAIN_IDS) {
        const m = mByChain[cid];
        if (!m || !m.productName) {
          // S9-Recall check: if this is a standard `real` item that the oracle confirms exists in `cid`, DUT must not return null!
          if (exp.kind === 'real' && availByChain[cid]) {
            if (isWaived('S9', exp.dictId, cid)) {
              recordRule('S9', true, tc.id, '', true);
              continue;
            }
            s9Checks++;
            subSplits.S9_recall.fail++;
            s9Failures++;
            const msg = `RECALL miss on ${cid} for "${exp.canonical}" (input "${dut.name}"): DUT returned null while snapshot has valid item`;
            if (s9Failures === 1) fail('S9', msg);
            else if (s9Failures === 2) caseFailures.push(`[S9] ${msg}`);
          } else if (exp.kind === 'real') {
            subSplits.S9_recall.pass++;
          }
          continue;
        }

        s9Checks++;
        subSplits.S9_recall.pass++;
        const chk = checkSemanticAcceptance(m.productName, exp);
        if (!chk.ok) {
          if (isWaived('S9', exp.dictId, cid)) {
            recordRule('S9', true, tc.id, '', true);
            continue;
          }
          subSplits.S9_precision.fail++;
          s9Failures++;
          const msg = `PRECISION mismatch on ${cid} for "${exp.canonical}" (${dut.name}): ${chk.reason}`;
          if (s9Failures === 1) fail('S9', msg);
          else if (s9Failures === 2) caseFailures.push(`[S9] ${msg}`);
        } else {
          subSplits.S9_precision.pass++;
        }
      }
    }
    if (s9Checks > 0 && s9Failures === 0) pass('S9');

    // --- S10: Independent XML Price & Winner Oracle ---
    const ref = refEvaluateBasket(checkedDut, lineMatches, refSnap, deliveryChains, true);
    let priceOk = true;
    for (const cid of ONLINE_LIVE_CHAIN_IDS) {
      const dC = cmp.perChain[cid];
      const rC = ref.perChain[cid];
      if (
        Math.abs(dC.subtotal - rC.subtotal) > 0.011
        || Math.abs(dC.promoSavings - rC.promoSavings) > 0.011
        || Math.abs(dC.total - rC.total) > 0.011
        || dC.complete !== rC.complete
      ) {
        priceOk = false;
        fail('S10', `${cid} mismatch: DUT(sub=${dC.subtotal}, promo=${dC.promoSavings}, tot=${dC.total}, comp=${dC.complete}) vs REF(sub=${rC.subtotal}, promo=${rC.promoSavings}, tot=${rC.total}, comp=${rC.complete})`);
        break;
      }
    }
    if (priceOk && cmp.cheapestId !== ref.cheapestId) {
      priceOk = false;
      fail('S10', `cheapestId mismatch: DUT=${cmp.cheapestId} vs REF=${ref.cheapestId}`);
    }
    if (priceOk) pass('S10');

    if (caseFailures.length === 0) {
      passedCases++;
      // Sample stimulus & cross coverage ONLY on passing tests (M8)
      for (const [dim, val] of Object.entries(tc.bins)) {
        covHits[dim].set(val, (covHits[dim].get(val) || 0) + 1);
      }
      if (tc.bins.budget !== 'none') crossHits.add(`layout_budget:${tc.bins.layout}×${tc.bins.budget}`);
      crossHits.add(`layout_ambig:${tc.bins.layout}×${tc.bins.ambiguity}`);
      crossHits.add(`chan_noise:${tc.bins.channel}×${tc.bins.noise}`);
      crossHits.add(`qty_chan:${tc.bins.qtyStyle}×${tc.bins.channel}`);

      // Sample DUT-Response Functional Coverpoints (M8)
      const hitResp = (bin) => covHits.dutResponse.set(bin, (covHits.dutResponse.get(bin) || 0) + 1);
      for (const cid of ONLINE_LIVE_CHAIN_IDS) {
        const pc = cmp.perChain[cid];
        if (pc.promoSavings > 0) {
          hitResp('promo_price_applied');
          if (cid === 'ramilevy') hitResp('ramilevy_promo_applied');
        }
        if (pc.substitutes.length > 0) hitResp('substitute_flagged');
        if (!pc.complete && pc.priced > 0) hitResp('partial_basket_honest');
      }
      for (const mObj of lineMatches.values()) {
        for (const m of Object.values(mObj)) {
          if (m?.promo?.type === 'bundle') hitResp('promo_bundle_applied');
          if (m?.weighted) hitResp('weighted_kg_priced');
        }
      }
      if (added.some((a) => !a.checked)) hitResp('bought_excluded_from_total');
      if (checkedDut.some((a) => a.ambiguous) && cmp.cheapestId === null) hitResp('ambiguous_blocked_winner');
      if (cmp.comparedOnSubtotalOnly) hitResp('asymmetric_delivery_subtotal_cmp');
    } else if (failedCaseSamples.length < 15) {
      failedCaseSamples.push({ id: tc.id, errors: caseFailures });
    }
  }

  // Compute Functional Coverage %
  let totalBins = 0;
  let hitBins = 0;
  const dimSummary = {};
  for (const [dim, expectedSet] of Object.entries(covDims)) {
    totalBins += expectedSet.size;
    let h = 0;
    for (const b of expectedSet) if ((covHits[dim].get(b) || 0) > 0) h++;
    hitBins += h;
    dimSummary[dim] = { hit: h, total: expectedSet.size };
  }
  const expectedCrossTotal = (LAYOUTS.length * BUDGET_BUCKETS.length)
    + (LAYOUTS.length * AMBIG_PROFILES.length)
    + (4 * (NOISE_PROFILES.length - 1))
    + (QTY_STYLES.length * 4);
  const crossPct = Math.min(100, Math.round((crossHits.size / expectedCrossTotal) * 1000) / 10);
  const singleBinPct = Math.round((hitBins / totalBins) * 1000) / 10;

  let totalAssertions = 0;
  let passedAssertions = 0;
  for (const st of Object.values(ruleStats)) {
    totalAssertions += st.pass + st.fail;
    passedAssertions += st.pass;
  }

  const listPassPct = Math.round((passedCases / suite.length) * 1000) / 10;
  const assertPassPct = totalAssertions ? Math.round((passedAssertions / totalAssertions) * 1000) / 10 : 0;
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);

  let commitHash = 'local';
  try { commitHash = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch {}

  const pctFmt = (p, f) => (p + f > 0 ? `${((p / (p + f)) * 100).toFixed(1)}% (${p}/${p + f})` : 'N/A');

  console.log(`\n=== SmartCart DV Regression (${opts.smoke ? 'SMOKE' : 'FULL'}) ===`);
  console.log(`Commit: ${commitHash} | PRIMARY KPI — Lists Green: ${passedCases}/${suite.length} (${listPassPct}%) | Cross-Cov: ${crossPct}% (1D+Resp: ${singleBinPct}%) | Assertions: ${passedAssertions}/${totalAssertions} (${assertPassPct}%) | Time: ${elapsedSec}s`);
  console.log(`Lexicon Independence Gate: ${overlapInfo.pct}% overlap (${overlapInfo.overlap}/${overlapInfo.total} <= ${MAX_ALLOWED_LEXICON_OVERLAP_PCT}%) ✅`);
  console.log(`Generalization Splits: S6-seen=${pctFmt(subSplits.S6_seen.pass, subSplits.S6_seen.fail)} · S6-unseen=${pctFmt(subSplits.S6_unseen.pass, subSplits.S6_unseen.fail)} · S7-unseen=${pctFmt(subSplits.S7_unseen.pass, subSplits.S7_unseen.fail)} · S9-recall=${pctFmt(subSplits.S9_recall.pass, subSplits.S9_recall.fail)} · S9-precision=${pctFmt(subSplits.S9_precision.pass, subSplits.S9_precision.fail)}\n`);

  for (const [id, st] of Object.entries(ruleStats)) {
    const tot = st.pass + st.fail;
    const pct = tot ? ((st.pass / tot) * 100).toFixed(1) : 'N/A';
    const icon = st.fail === 0 ? '✅' : '❌';
    const wNote = st.waived ? ` [waived: ${st.waived}]` : '';
    console.log(`  ${icon} ${id.padEnd(4)} ${st.title.padEnd(38)} ${String(st.pass).padStart(4)}/${String(tot).padEnd(4)} (${pct}%)${wNote}`);
    for (const smp of st.samples.slice(0, 3)) console.log(`         ↳ ${smp}`);
  }

  if (!opts.smoke && !opts.noRecord) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const histPath = path.join(REPORTS_DIR, 'history.json');
    const history = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
    const runRecord = {
      timestamp: new Date().toISOString(),
      commit: commitHash,
      totalLists: suite.length,
      passedLists: passedCases,
      listPassPct,
      passedAssertions,
      totalAssertions,
      assertPassPct,
      singleBinPct,
      crossPct,
      lexiconOverlapPct: overlapInfo.pct,
      splits: {
        s6SeenPct: subSplits.S6_seen.pass + subSplits.S6_seen.fail ? Math.round((subSplits.S6_seen.pass / (subSplits.S6_seen.pass + subSplits.S6_seen.fail)) * 1000) / 10 : 100,
        s6UnseenPct: subSplits.S6_unseen.pass + subSplits.S6_unseen.fail ? Math.round((subSplits.S6_unseen.pass / (subSplits.S6_unseen.pass + subSplits.S6_unseen.fail)) * 1000) / 10 : 100,
        s7UnseenPct: subSplits.S7_unseen.pass + subSplits.S7_unseen.fail ? Math.round((subSplits.S7_unseen.pass / (subSplits.S7_unseen.pass + subSplits.S7_unseen.fail)) * 1000) / 10 : 100,
        s9RecallPct: subSplits.S9_recall.pass + subSplits.S9_recall.fail ? Math.round((subSplits.S9_recall.pass / (subSplits.S9_recall.pass + subSplits.S9_recall.fail)) * 1000) / 10 : 100,
        s9PrecisionPct: subSplits.S9_precision.pass + subSplits.S9_precision.fail ? Math.round((subSplits.S9_precision.pass / (subSplits.S9_precision.pass + subSplits.S9_precision.fail)) * 1000) / 10 : 100,
      },
      elapsedSec: Number(elapsedSec),
      rules: Object.fromEntries(
        Object.entries(ruleStats).map(([id, st]) => {
          const tot = st.pass + st.fail;
          return [id, { pass: st.pass, fail: st.fail, waived: st.waived, pct: tot ? Math.round((st.pass / tot) * 1000) / 10 : 100 }];
        }),
      ),
    };
    history.push(runRecord);
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n');

    const snapSummary = Object.entries(refSnap.chains).map(([cid, ch]) => `\`${cid} ${ch.storeId}\``).join(', ');
    const md = buildMarkdownReport(runRecord, ruleStats, subSplits, dimSummary, covHits.dutResponse, history, failedCaseSamples, refSnap.capturedAt, snapSummary, overlapInfo, activeWaivers);
    fs.writeFileSync(path.join(REPORTS_DIR, 'latest.md'), md);
    console.log(`\nWrote ${path.relative(REPO_ROOT, path.join(REPORTS_DIR, 'latest.md'))} and updated history.json.`);
  }

  if (opts.strict && passedCases < suite.length) {
    process.exit(1);
  }
}

function buildMarkdownReport(rec, ruleStats, subSplits, dimSummary, respHits, history, failedSamples, snapDate, snapSummary, overlapInfo, waivers) {
  const ruleRows = SPEC_RULES.map(([id, title]) => {
    const st = ruleStats[id];
    const tot = st.pass + st.fail;
    const pct = tot ? ((st.pass / tot) * 100).toFixed(1) + '%' : 'N/A';
    const status = st.fail === 0 ? '✅ PASS' : '❌ FAIL';
    return `| **${id}** | ${title} | ${st.pass} / ${tot} | ${st.waived || 0} | **${pct}** | ${status} |`;
  }).join('\n');

  const covRows = Object.entries(dimSummary)
    .map(([dim, { hit, total }]) => `| \`${dim}\` | ${hit} / ${total} | ${((hit / total) * 100).toFixed(1)}% |`)
    .join('\n');

  const respRows = RESPONSE_BINS.map((b) => `| \`${b}\` | ${respHits.get(b) || 0} | ${(respHits.get(b) || 0) > 0 ? '✅ Hit' : '⚠️ 0'} |`).join('\n');

  const histRows = history.slice(-10).map((h, i) =>
    `| ${i + 1} | \`${h.commit}\` | ${h.timestamp.slice(0, 16).replace('T', ' ')} | ${h.passedLists}/${h.totalLists} (**${h.listPassPct}%**) | **${h.assertPassPct}%** | ${h.singleBinPct}% / ${h.crossPct}% |`,
  ).join('\n');

  const pctStr = (b) => (b.pass + b.fail > 0 ? `${((b.pass / (b.pass + b.fail)) * 100).toFixed(1)}% (${b.pass}/${b.pass + b.fail})` : 'N/A');

  const waiverSection = waivers.length
    ? `## 4. Active Triage Waivers (${waivers.length})\n` + waivers.map((w) => `- \`[${w.rule}] ${w.itemId}\` (${w.verdict}, owner: ${w.owner}): ${w.reason}`).join('\n') + '\n\n---\n\n'
    : '';

  const failureSection = failedSamples.length
    ? `## Sample Failures (Top Diagnostic Signatures)\n` + failedSamples.slice(0, 12).map((f) => `- **\`${f.id}\`**: ${f.errors.join(' · ')}`).join('\n')
    : '## Failures\nNone — 100% of directed and constrained-random lists passed all scoreboard assertions.';

  return `# SmartCart DV Regression & Maturity Report

- **Commit:** \`${rec.commit}\`
- **Executed At:** \`${rec.timestamp}\` (${rec.elapsedSec}s)
- **Frozen Online-Store Snapshot:** \`${snapDate}\` (${snapSummary})
- **Primary KPI — Overall List Pass Rate:** **${rec.listPassPct}%** (${rec.passedLists} / ${rec.totalLists} lists green)
- **Functional Cross-Coverage Closure (Passing Lists Only):** **${rec.crossPct}%** cross-coverage · **${rec.singleBinPct}%** 1D + DUT-response bins
- **Scoreboard Assertion Score:** **${rec.assertPassPct}%** (${rec.passedAssertions} / ${rec.totalAssertions} checks)
- **Non-Tautology Lexicon Gate:** **${overlapInfo.pct}%** overlap (${overlapInfo.overlap}/${overlapInfo.total} <= ${MAX_ALLOWED_LEXICON_OVERLAP_PCT}% max) ✅

### Held-Out Generalization & Recall Splits
- **S6 Seen Vocabulary:** **${pctStr(subSplits.S6_seen)}** · **S6 Held-Out / Mutated (Unseen):** **${pctStr(subSplits.S6_unseen)}**
- **S7 Seen Ambiguous:** **${pctStr(subSplits.S7_seen)}** · **S7 Held-Out Inflected/Qualified (Unseen):** **${pctStr(subSplits.S7_unseen)}**
- **S9 Catalog Recall:** **${pctStr(subSplits.S9_recall)}** · **S9 Semantic Precision:** **${pctStr(subSplits.S9_precision)}**

---

## 1. Per-Rule Specification Scoreboard (\`S1\`–\`S10\`)

| Rule | Specification Requirement | Passed / Checked | Waived | Pass Rate | Status |
|---|---|---:|---:|---:|---|
${ruleRows}

---

## 2. Stimulus & DUT-Response Coverage Closure (Sampled on Passing Lists Only)

| Dimension | Bins Hit | Closure |
|---|---:|---:|
${covRows}

### DUT-Response Coverpoints
| Coverpoint | Passing Hits | Status |
|---|---:|---|
${respRows}

---

## 3. Maturity Trend Across Commits

| Run | Commit | Timestamp (UTC) | Lists Passed | Assertions Passed | Coverage (1D / Cross) |
|---:|---|---|---:|---:|---:|
${histRows}

---

${waiverSection}${failureSection}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
