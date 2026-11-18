// SmartCart DV Regression Runner: Stimulus -> DUT -> Independent Reference Model & Scoreboard -> Coverage & Maturity Report.
// Usage:
//   node tests/regression/run.mjs                 # full 620-list regression (100 directed + 520 random)
//   node tests/regression/run.mjs --smoke         # fast 66-list smoke subset
//   node tests/regression/run.mjs --seeds=800     # custom random seed count
//   node tests/regression/run.mjs --strict        # exit 1 if any check fails
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Pipeline modules (used ONCE at startup to build the DUT's catalog/store JSON from the frozen XML snapshot,
// so S10 verifies BOTH pipeline XML->JSON conversion AND web/js runtime pricing against the independent oracle!)
import { parsePricesXml } from '../../pipeline/parse.mjs';
import { parsePromosXml } from '../../pipeline/promos.mjs';

// DUT runtime modules
import { LIVE_CHAIN_IDS } from '../../web/js/chains.js';
import { buildCatalogBundle, matchLineAcrossChains } from '../../web/js/prices.js';
import { compareBasket } from '../../web/js/pricing.js';
import { parseMany, normalizeName } from '../../web/js/parser.js';
import { categorize } from '../../web/js/categories.js';
import { parseGrid, analyzeSheetGrid } from '../../web/js/sheets.js';

// Verification environment (Reference Model, Stimulus Generator, Directed Suite)
import { loadReferenceSnapshot, refEvaluateBasket, buildPriceEstimator } from './refmodel/price-model.mjs';
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

/** Build the DUT's in-memory `branchData` from the frozen snapshot using the real `pipeline/` parsers. */
function buildDutBranchDataFromSnapshot(refSnap) {
  const branchData = {};
  for (const cid of LIVE_CHAIN_IDS) {
    const raw = refSnap.chains[cid];
    const { items } = parsePricesXml(raw.rawPricesXml);
    const { promosByItem } = raw.rawPromosXml
      ? parsePromosXml(raw.rawPromosXml, { now: refSnap.refDate })
      : { promosByItem: new Map() };
    const catalogObj = {};
    const storePrices = {};
    for (const it of items) {
      catalogObj[it.code] = [it.name, it.manufacturer, it.qty, it.unit, it.weighted];
      const p = promosByItem.get(it.code);
      storePrices[it.code] = p ? [it.price, it.unitPrice, p] : [it.price, it.unitPrice];
    }
    branchData[cid] = {
      catalog: buildCatalogBundle(catalogObj),
      storePrices,
      store: { storeId: raw.storeId, name: `${cid} online`, kind: 'online' },
    };
  }
  return branchData;
}

/** Load optional `web/js/importer.js` + `web/js/xlsx.js` if implemented; otherwise fall back to legacy DUT path. */
async function loadDutImporter() {
  const impPath = path.join(REPO_ROOT, 'web', 'js', 'importer.js');
  const xlsxPath = path.join(REPO_ROOT, 'web', 'js', 'xlsx.js');
  let importerMod = null;
  let xlsxMod = null;
  if (fs.existsSync(impPath)) importerMod = await import('../../web/js/importer.js');
  if (fs.existsSync(xlsxPath)) xlsxMod = await import('../../web/js/xlsx.js');

  return async function runDutImport(stimulus) {
    if (importerMod) {
      if (stimulus.channel === 'text') return importerMod.importFromText(stimulus.payload);
      if (stimulus.channel === 'tsv' || stimulus.channel === 'csv') return importerMod.importFromSheetText(stimulus.payload);
      if (stimulus.channel === 'xlsx') {
        if (!xlsxMod) return { error: 'XLSX_UNSUPPORTED', added: [], skipped: [] };
        const parsed = await xlsxMod.parseXlsxBuffer(stimulus.payload);
        return importerMod.importFromGrid(parsed.grid, { strikeCells: parsed.strikeCells });
      }
    }
    // Legacy baseline path (before importer.js / xlsx.js)
    if (stimulus.channel === 'text') {
      const items = parseMany(stimulus.payload).map((it, i) => ({
        id: `legacy_${i}`,
        name: it.name,
        qty: it.qty || 1,
        unit: it.unit || 'unit',
        category: categorize(it.name),
        checked: true,
        note: it.note || '',
      }));
      return { error: null, added: items, skipped: [] };
    }
    if (stimulus.channel === 'tsv' || stimulus.channel === 'csv') {
      const grid = parseGrid(stimulus.payload);
      const { relevant, skipped } = analyzeSheetGrid(grid);
      return {
        error: null,
        added: relevant.map((it, i) => ({
          id: `legacy_${i}`,
          name: it.name,
          qty: it.qty || 1,
          unit: it.unit || 'unit',
          category: it.category,
          checked: true,
          note: it.note || '',
        })),
        skipped,
      };
    }
    return { error: 'XLSX_UNSUPPORTED', added: [], skipped: [] };
  };
}

function normLookup(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["״'׳`]/g, '')
    .replace(/[^\p{L}\p{N}%.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDictLookup(dictionary) {
  const map = new Map();
  for (const e of [...dictionary.realItems, ...dictionary.rareItems]) {
    map.set(normLookup(e.canonical), e.id);
    for (const a of e.aliases || []) map.set(normLookup(a), e.id);
  }
  for (const a of dictionary.ambiguousItems) {
    map.set(normLookup(a.term), a.id);
    for (const al of a.aliases || []) map.set(normLookup(al), a.id);
  }
  return map;
}

function toBaseQty(qty, unit) {
  if (unit === 'kg') return { dim: 'weight', val: qty * 1000 };
  if (unit === 'g') return { dim: 'weight', val: qty };
  return { dim: 'count', val: qty };
}

function checkSemanticAcceptance(productName, exp) {
  const low = normLookup(productName);
  const inc = (exp.mustIncludeAny || []).map(normLookup).filter(Boolean);
  const exc = (exp.mustExcludeAny || []).map(normLookup).filter(Boolean);
  if (inc.length && !inc.some((k) => low.includes(k))) {
    return { ok: false, reason: `"${productName}" missing [${exp.mustIncludeAny.join(' / ')}]` };
  }
  for (const bad of exc) {
    if (bad && low.includes(bad)) {
      return { ok: false, reason: `"${productName}" matched forbidden "${bad}"` };
    }
  }
  return { ok: true };
}

const SPEC_RULES = [
  ['S1', 'Empty / No-Grocery Error'],
  ['S2', 'Mixed Non-Grocery Filtering'],
  ['S3', 'Headers, Chat & Formatting Noise'],
  ['S4', 'Bought Marks -> Unchecked'],
  ['S5', 'Quantities & Units'],
  ['S6', 'Synonyms, Typos & Deduplication'],
  ['S7', 'Ambiguous Terms Flagged & Unpriced'],
  ['S8', 'Rare / Missing -> Partial Basket'],
  ['S9', 'Semantic Product Acceptance'],
  ['S10', 'Independent XML Price & Winner Oracle'],
];

async function main() {
  const opts = parseCli(process.argv);
  const t0 = Date.now();

  const dictionary = JSON.parse(fs.readFileSync(path.join(REG_DIR, 'dictionary', 'items.json'), 'utf8'));
  const deliveryFile = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'web', 'data', 'delivery.json'), 'utf8'));
  const deliveryChains = deliveryFile.chains || {};

  const refSnap = loadReferenceSnapshot();
  const branchData = buildDutBranchDataFromSnapshot(refSnap);
  const priceEst = buildPriceEstimator(dictionary, refSnap);
  const dictLookup = buildDictLookup(dictionary);
  const runDutImport = await loadDutImporter();

  const allDirected = buildDirectedCases(dictionary);
  const directed = opts.smoke ? allDirected.filter((_, i) => i % 3 === 0) : allDirected;
  const randomCases = [];
  for (let s = 1; s <= opts.seeds; s++) {
    randomCases.push(generateRandomCase(s, dictionary, priceEst));
  }
  const suite = [...directed, ...randomCases];

  // Scoreboard & Coverage state
  const ruleStats = Object.fromEntries(SPEC_RULES.map(([id, title]) => [id, { title, pass: 0, fail: 0, samples: [] }]));
  const recordRule = (ruleId, ok, tcId, detail = '') => {
    const st = ruleStats[ruleId];
    if (ok) st.pass++;
    else {
      st.fail++;
      if (st.samples.length < 8) st.samples.push(`${tcId}: ${detail}`);
    }
  };

  // Functional coverage bins
  const covDims = {
    channel: new Set(['text', 'tsv', 'csv', 'xlsx']),
    layout: new Set(LAYOUTS),
    budget: new Set(['none', ...BUDGET_BUCKETS.map((b) => b.id)]),
    noise: new Set(NOISE_PROFILES),
    ambiguity: new Set(AMBIG_PROFILES),
    rarity: new Set(RARITY_PROFILES),
    qtyStyle: new Set(QTY_STYLES),
  };
  const covHits = Object.fromEntries(Object.keys(covDims).map((k) => [k, new Map()]));
  const crossHits = new Set(); // layout x budget, layout x noise, layout x ambiguity

  let passedCases = 0;
  const failedCaseSamples = [];

  for (const tc of suite) {
    // Record functional coverage hits
    for (const [dim, val] of Object.entries(tc.bins)) {
      covHits[dim].set(val, (covHits[dim].get(val) || 0) + 1);
    }
    if (tc.bins.budget !== 'none') crossHits.add(`layout_budget:${tc.bins.layout}×${tc.bins.budget}`);
    crossHits.add(`layout_ambig:${tc.bins.layout}×${tc.bins.ambiguity}`);

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
      if (!caseFailures.length) passedCases++;
      else if (failedCaseSamples.length < 15) failedCaseSamples.push({ id: tc.id, errors: caseFailures });
      continue;
    } else if (imp.error) {
      fail('S1', `unexpected import error=${imp.error} on valid grocery list`);
      if (failedCaseSamples.length < 15) failedCaseSamples.push({ id: tc.id, errors: caseFailures });
      continue;
    } else {
      pass('S1');
    }

    // --- S2: Non-Grocery Filtering ---
    if (tc.expected.expectedSkippedMin > 0 || tc.expected.forbiddenItemSubstrings.length > 0) {
      const leaked = added.find((a) =>
        tc.expected.forbiddenItemSubstrings.some((sub) => normLookup(a.name).includes(normLookup(sub))),
      );
      const hasReasons = skipped.length >= tc.expected.expectedSkippedMin && skipped.every((s) => Boolean(s.reason));
      if (!leaked && hasReasons) pass('S2');
      else fail('S2', leaked ? `non-grocery "${leaked.name}" leaked into added` : `skipped=${skipped.length} < ${tc.expected.expectedSkippedMin}`);
    }

    // --- S3: Headers, WhatsApp Prefixes & Formatting Noise ---
    const noisyLeak = added.find((a) => /^(\[\d{1,2}\/\d{1,2}|[-•*▪●]|\[[ xXvV]\]|[☐☑✅]|\*\*|===)/.test(a.name.trim()));
    if (noisyLeak) fail('S3', `unstripped prefix/markup in item "${noisyLeak.name}"`);
    else pass('S3');

    // Match DUT added items to expectedItems by dictId / canonical name
    const usedDutIdx = new Set();
    const matchedPairs = []; // { exp, dut }
    const missingExps = [];

    for (const exp of tc.expected.expectedItems) {
      let foundIdx = -1;
      for (let i = 0; i < added.length; i++) {
        if (usedDutIdx.has(i)) continue;
        const d = added[i];
        const resolvedId = d.dictId || dictLookup.get(normLookup(d.canonicalName || d.name));
        if (resolvedId === exp.dictId || normLookup(d.name) === normLookup(exp.canonical)) {
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

    // --- S6: Item Set & Synonym Deduplication ---
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

    // --- S5: Quantities & Units ---
    let qtyOk = matchedPairs.length > 0;
    for (const { exp, dut } of matchedPairs) {
      const bExp = toBaseQty(exp.qty, exp.unit);
      const bDut = toBaseQty(dut.qty, dut.unit);
      if (bExp.dim !== bDut.dim || Math.abs(bExp.val - bDut.val) > 0.05 * Math.max(1, bExp.val)) {
        qtyOk = false;
        fail('S5', `"${dut.name}" qty=${dut.qty} ${dut.unit}, expected ${exp.qty} ${exp.unit}`);
        break;
      }
    }
    if (qtyOk) pass('S5');

    // --- Basket Matching & Pricing across Online Stores ---
    const checkedDut = added.filter((x) => x.checked);
    const lineMatches = new Map();
    const cmpLines = [];
    for (const it of checkedDut) {
      const matches = it.ambiguous
        ? Object.fromEntries(LIVE_CHAIN_IDS.map((cid) => [cid, null]))
        : matchLineAcrossChains(it, branchData);
      lineMatches.set(it.id, matches);
      cmpLines.push({ id: it.id, qty: it.qty, unit: it.unit, matches });
    }
    const cmp = compareBasket(cmpLines, LIVE_CHAIN_IDS, deliveryChains, { includeDelivery: true });

    // --- S7: Ambiguity Handling ---
    if (tc.bins.ambiguity !== 'none') {
      let ambOk = true;
      for (const { exp, dut } of matchedPairs) {
        if (exp.kind === 'ambiguous') {
          if (!dut.ambiguous || !Array.isArray(dut.ambiguous.choices) || dut.ambiguous.choices.length < 2) {
            ambOk = false;
            fail('S7', `ambiguous term "${exp.canonical}" was NOT flagged with choices`);
            break;
          }
          if (dut.checked && cmp.cheapestId !== null) {
            ambOk = false;
            fail('S7', `basket with unresolved ambiguous "${exp.canonical}" still declared cheapestId=${cmp.cheapestId}`);
            break;
          }
        } else if (dut.ambiguous) {
          ambOk = false;
          fail('S7', `unambiguous item "${dut.name}" falsely flagged ambiguous`);
          break;
        }
      }
      if (ambOk && !missingExps.some((e) => e.kind === 'ambiguous')) pass('S7');
      else if (missingExps.some((e) => e.kind === 'ambiguous')) fail('S7', 'ambiguous item dropped instead of flagged');
    }

    // --- S8: Rare / Missing -> Partial Basket Honesty ---
    let s8Checked = false;
    let s8Ok = true;
    for (const cid of LIVE_CHAIN_IDS) {
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

    // --- S9: Semantic Product Acceptance ---
    let semOk = true;
    let semChecked = false;
    for (const { exp, dut } of matchedPairs) {
      if (exp.kind === 'ambiguous' || !dut.checked) continue;
      const mByChain = lineMatches.get(dut.id) || {};
      for (const cid of LIVE_CHAIN_IDS) {
        const m = mByChain[cid];
        if (!m || !m.productName) continue;
        semChecked = true;
        const chk = checkSemanticAcceptance(m.productName, exp);
        if (!chk.ok) {
          semOk = false;
          fail('S9', `${cid} for "${exp.canonical}" (${dut.name}): ${chk.reason}`);
          break;
        }
      }
      if (!semOk) break;
    }
    if (semChecked && semOk) pass('S9');

    // --- S10: Independent XML Price & Winner Oracle ---
    const ref = refEvaluateBasket(checkedDut, lineMatches, refSnap, deliveryChains, true);
    let priceOk = true;
    for (const cid of LIVE_CHAIN_IDS) {
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
  const expectedCrossTotal = LAYOUTS.length * BUDGET_BUCKETS.length + (LAYOUTS.length * AMBIG_PROFILES.length);
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

  console.log(`\n=== SmartCart DV Regression (${opts.smoke ? 'SMOKE' : 'FULL'}) ===`);
  console.log(`Commit: ${commitHash} | Lists: ${passedCases}/${suite.length} (${listPassPct}%) | Assertions: ${passedAssertions}/${totalAssertions} (${assertPassPct}%) | Coverage: ${singleBinPct}% (cross: ${crossPct}%) | Time: ${elapsedSec}s\n`);
  for (const [id, st] of Object.entries(ruleStats)) {
    const tot = st.pass + st.fail;
    const pct = tot ? ((st.pass / tot) * 100).toFixed(1) : 'N/A';
    const icon = st.fail === 0 ? '✅' : '❌';
    console.log(`  ${icon} ${id.padEnd(4)} ${st.title.padEnd(38)} ${String(st.pass).padStart(4)}/${String(tot).padEnd(4)} (${pct}%)`);
    for (const smp of st.samples.slice(0, 2)) console.log(`         ↳ ${smp}`);
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
      elapsedSec: Number(elapsedSec),
      rules: Object.fromEntries(
        Object.entries(ruleStats).map(([id, st]) => {
          const tot = st.pass + st.fail;
          return [id, { pass: st.pass, fail: st.fail, pct: tot ? Math.round((st.pass / tot) * 1000) / 10 : 100 }];
        }),
      ),
    };
    history.push(runRecord);
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n');

    const md = buildMarkdownReport(runRecord, ruleStats, dimSummary, history, failedCaseSamples, refSnap.capturedAt);
    fs.writeFileSync(path.join(REPORTS_DIR, 'latest.md'), md);
    console.log(`\nWrote ${path.relative(REPO_ROOT, path.join(REPORTS_DIR, 'latest.md'))} and updated history.json.`);
  }

  if (opts.strict && passedCases < suite.length) {
    process.exit(1);
  }
}

function buildMarkdownReport(rec, ruleStats, dimSummary, history, failedSamples, snapDate) {
  const ruleRows = SPEC_RULES.map(([id, title]) => {
    const st = ruleStats[id];
    const tot = st.pass + st.fail;
    const pct = tot ? ((st.pass / tot) * 100).toFixed(1) + '%' : 'N/A';
    const status = st.fail === 0 ? '✅ PASS' : '❌ FAIL';
    return `| **${id}** | ${title} | ${st.pass} / ${tot} | **${pct}** | ${status} |`;
  }).join('\n');

  const covRows = Object.entries(dimSummary)
    .map(([dim, { hit, total }]) => `| \`${dim}\` | ${hit} / ${total} | ${((hit / total) * 100).toFixed(1)}% |`)
    .join('\n');

  const histRows = history.slice(-10).map((h, i) =>
    `| ${i + 1} | \`${h.commit}\` | ${h.timestamp.slice(0, 16).replace('T', ' ')} | ${h.passedLists}/${h.totalLists} (**${h.listPassPct}%**) | **${h.assertPassPct}%** | ${h.singleBinPct}% / ${h.crossPct}% |`,
  ).join('\n');

  const failureSection = failedSamples.length
    ? `## Sample Failures (Top Diagnostic Signatures)\n` + failedSamples.slice(0, 10).map((f) => `- **\`${f.id}\`**: ${f.errors.join(' · ')}`).join('\n')
    : '## Failures\nNone — 100% of directed and constrained-random lists passed all scoreboard assertions.';

  return `# SmartCart DV Regression & Maturity Report

- **Commit:** \`${rec.commit}\`
- **Executed At:** \`${rec.timestamp}\` (${rec.elapsedSec}s)
- **Frozen Online-Store Snapshot:** \`${snapDate}\` (\`Shufersal 413\`, \`Rami Levy 39\`, \`Carrefour 471\`)
- **Overall List Maturity Score:** **${rec.listPassPct}%** (${rec.passedLists} / ${rec.totalLists} lists green)
- **Scoreboard Assertion Score:** **${rec.assertPassPct}%** (${rec.passedAssertions} / ${rec.totalAssertions} checks)
- **Functional Coverage:** **${rec.singleBinPct}%** single-dimension bins · **${rec.crossPct}%** cross-coverage bins

---

## 1. Per-Rule Specification Scoreboard (\`S1\`–\`S10\`)

| Rule | Specification Requirement | Passed / Checked | Pass Rate | Status |
|---|---|---:|---:|---|
${ruleRows}

---

## 2. Functional Coverage Closure

| Dimension | Bins Hit | Closure |
|---|---:|---:|
${covRows}

---

## 3. Maturity Trend Across Commits

| Run | Commit | Timestamp (UTC) | Lists Passed | Assertions Passed | Coverage (1D / Cross) |
|---:|---|---|---:|---:|---:|
${histRows}

---

${failureSection}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
