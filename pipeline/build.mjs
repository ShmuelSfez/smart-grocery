// Builds static JSON price data (data/v1/) from official Israeli Price Transparency feeds.
// Usage: node pipeline/build.mjs [--chains=shufersal,ramilevy,...] [--limit-stores=N] [--out=data/v1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCityMap } from './cities.mjs';
import { decodeFeedBuffer, parseStoresXml, parsePricesXml } from './parse.mjs';
import { parsePromosXml } from './promos.mjs';
import * as shufersal from './sources/shufersal.mjs';
import * as ramilevy from './sources/ramilevy.mjs';
import * as carrefour from './sources/carrefour.mjs';
import * as mahsaneihashuk from './sources/mahsaneihashuk.mjs';
import * as victory from './sources/victory.mjs';
import * as yochananof from './sources/yochananof.mjs';
import * as tivtaam from './sources/tivtaam.mjs';
import * as keshet from './sources/keshet.mjs';
import * as osherad from './sources/osherad.mjs';

const SOURCES = {
  shufersal,
  ramilevy,
  carrefour,
  mahsaneihashuk,
  victory,
  yochananof,
  tivtaam,
  keshet,
  osherad,
};
const PRIORITY_CITIES = ['הרצליה', 'תל אביב-יפו', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'פתח תקווה'];
const PROD_PAGES_BASE = 'https://shmuelsfez.github.io/smart-grocery/data/v1';

function parseArgs(argv) {
  const opts = {
    chains: Object.keys(SOURCES),
    limitStores: 0,
    outDir: 'data/v1',
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--chains=')) {
      opts.chains = arg.slice('--chains='.length).split(',').map((s) => s.trim()).filter((s) => SOURCES[s]);
    } else if (arg.startsWith('--limit-stores=')) {
      opts.limitStores = Math.max(0, parseInt(arg.slice('--limit-stores='.length), 10) || 0);
    } else if (arg.startsWith('--out=')) {
      opts.outDir = arg.slice('--out='.length).trim() || 'data/v1';
    }
  }
  return opts;
}

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      await worker(next);
    }
  });
  await Promise.all(runners);
}

function selectStoresToProcess(stores, priceFiles, limitStores) {
  const withPrices = stores.filter((s) => priceFiles.has(s.storeId));
  // Online (delivery) stores are always built: they are the default price source in delivery mode
  const online = withPrices.filter((s) => s.type === 'online');
  const physical = withPrices.filter((s) => s.type !== 'online');
  if (!limitStores || physical.length <= limitStores) return [...online, ...physical];
  // When --limit-stores=N is set (smoke test), pick stores from priority cities first so common cities overlap!
  const chosen = [...online];
  const usedIds = new Set(online.map((s) => s.storeId));
  const limit = online.length + limitStores;
  for (const city of PRIORITY_CITIES) {
    for (const s of physical) {
      if (chosen.length >= limit) break;
      if (s.city === city && !usedIds.has(s.storeId)) {
        chosen.push(s);
        usedIds.add(s.storeId);
        break;
      }
    }
  }
  for (const s of physical) {
    if (chosen.length >= limit) break;
    if (!usedIds.has(s.storeId)) {
      chosen.push(s);
      usedIds.add(s.storeId);
    }
  }
  return chosen;
}

/**
 * Production serializer shared by `pipeline/build.mjs` and the DV regression runner so tuple layout
 * (`catalog.json` and `stores/<storeId>.json`) is verified on the exact production code path.
 */
export function serializeBranchItems(items, promosByItem, catalog = {}) {
  const branchPrices = {};
  let promoCount = 0;
  for (const it of items) {
    if (!catalog[it.code]) {
      catalog[it.code] = [it.name, it.manufacturer, it.qty, it.unit, it.weighted];
    } else if (!catalog[it.code][1] && it.manufacturer) {
      catalog[it.code][1] = it.manufacturer;
    }
    const promo = it.weighted ? null : promosByItem.get(it.code);
    if (promo) {
      branchPrices[it.code] = [it.price, it.unitPrice, promo];
      promoCount++;
    } else {
      branchPrices[it.code] = [it.price, it.unitPrice];
    }
  }
  return { catalog, branchPrices, promoCount };
}

async function buildChain(chainId, cityMap, outRoot, limitStores) {
  const t0 = Date.now();
  console.log(`[${chainId}] Listing official feeds...`);
  const feeds = await SOURCES[chainId].listFeeds();

  const storesXml = decodeFeedBuffer(await feeds.storesFile.download());
  const allStores = parseStoresXml(storesXml, chainId, cityMap);
  const targetStores = selectStoresToProcess(allStores, feeds.priceFiles, limitStores);

  const chainDir = path.join(outRoot, chainId);
  const storesDir = path.join(chainDir, 'stores');
  fs.mkdirSync(storesDir, { recursive: true });

  const catalog = {};
  const writtenStores = [];
  let latestStamp = feeds.storesFile.stamp || '';
  let totalPromoItems = 0;
  let branchFailures = 0;
  const promoTotals = { total: 0, kept: 0, clubSkipped: 0, couponSkipped: 0, expiredSkipped: 0, conditionalSkipped: 0, unsupportedSkipped: 0 };

  console.log(`[${chainId}] Found ${allStores.length} stores (${feeds.priceFiles.size} PriceFull, ${feeds.promoFiles.size} PromoFull). Processing ${targetStores.length} branches...`);

  await runPool(targetStores, 6, async (store) => {
    const pf = feeds.priceFiles.get(store.storeId);
    if (!pf) return;
    try {
      const priceBuf = await pf.download();
      const { items } = parsePricesXml(decodeFeedBuffer(priceBuf));
      if (!items.length) {
        // A published price file with zero parsable items is a failure, never a silent skip
        throw new Error(`zero items parsed from ${pf.filename}`);
      }

      let promosByItem = new Map();
      const prf = feeds.promoFiles.get(store.storeId);
      if (prf) {
        try {
          const promoBuf = await prf.download();
          const parsedPromo = parsePromosXml(decodeFeedBuffer(promoBuf));
          promosByItem = parsedPromo.promosByItem;
          for (const k of Object.keys(promoTotals)) promoTotals[k] += parsedPromo.stats[k] || 0;
        } catch {
          // Missing/corrupt promo file should not discard valid shelf prices
        }
      }

      const { branchPrices, promoCount } = serializeBranchItems(items, promosByItem, catalog);
      totalPromoItems += promoCount;

      fs.writeFileSync(path.join(storesDir, `${store.storeId}.json`), JSON.stringify(branchPrices));
      writtenStores.push({ ...store, itemsCount: items.length });
      if (pf.stamp > latestStamp) latestStamp = pf.stamp;
    } catch (err) {
      branchFailures++;
      console.warn(`[${chainId}] Branch ${store.storeId} (${store.name}) failed: ${err.message}`);
    }
  });

  if (!writtenStores.length) {
    throw new Error(`Zero branches succeeded for ${chainId}`);
  }

  fs.writeFileSync(path.join(chainDir, 'catalog.json'), JSON.stringify(catalog));
  const catalogCount = Object.keys(catalog).length;
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${chainId}] Done in ${elapsedSec}s: ${writtenStores.length} branches, ${catalogCount} unique products, ${totalPromoItems} branch-promo entries (${branchFailures} failed).`);

  return {
    stores: writtenStores,
    meta: {
      ok: true,
      storesCount: writtenStores.length,
      catalogCount,
      promoItemsCount: totalPromoItems,
      branchFailures,
      latestStamp,
      promoStats: promoTotals,
    },
  };
}

async function loadPreviousBuildState(outRoot) {
  const readLocalJson = (rel) => {
    const p = path.join(outRoot, rel);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  };
  let meta = readLocalJson('meta.json');
  let cities = readLocalJson('cities.json');
  let online = readLocalJson('online.json');
  let fromRemote = false;

  if (!meta || !cities || !online) {
    try {
      const [mRes, cRes, oRes] = await Promise.all([
        fetch(`${PROD_PAGES_BASE}/meta.json`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${PROD_PAGES_BASE}/cities.json`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${PROD_PAGES_BASE}/online.json`, { signal: AbortSignal.timeout(10000) }),
      ]);
      if (mRes.ok && cRes.ok && oRes.ok) {
        meta = await mRes.json();
        cities = await cRes.json();
        online = await oRes.json();
        fromRemote = true;
      }
    } catch {}
  }
  return { meta, cities, online, fromRemote };
}

export async function tryCarryForwardChain(chainId, outRoot, prev, errMsg, fetchImpl = globalThis.fetch) {
  const prevMeta = prev?.meta?.chains?.[chainId];
  if (!prevMeta?.ok || !prev?.cities) return null;

  const prevCityEntries = [];
  for (const [city, branches] of Object.entries(prev.cities)) {
    for (const b of Array.isArray(branches) ? branches : []) {
      if (b.chain === chainId) prevCityEntries.push({ city, branch: b });
    }
  }
  const prevOnline = prev.online && Object.prototype.hasOwnProperty.call(prev.online, chainId)
    ? prev.online[chainId]
    : null;
  const neededStoreIds = new Set([
    ...prevCityEntries.map((x) => x.branch.storeId),
    ...(Array.isArray(prevOnline) ? prevOnline.map((s) => s.storeId) : []),
  ]);
  if (!neededStoreIds.size) return null;

  const chainDir = path.join(outRoot, chainId);
  const storesDir = path.join(chainDir, 'stores');
  fs.mkdirSync(storesDir, { recursive: true });
  const catPath = path.join(chainDir, 'catalog.json');

  if (!fs.existsSync(catPath)) {
    const r = await fetchImpl(`${PROD_PAGES_BASE}/${chainId}/catalog.json`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    fs.writeFileSync(catPath, Buffer.from(await r.arrayBuffer()));
  }
  for (const sid of neededStoreIds) {
    const sp = path.join(storesDir, `${sid}.json`);
    if (!fs.existsSync(sp)) {
      const r = await fetchImpl(`${PROD_PAGES_BASE}/${chainId}/stores/${encodeURIComponent(sid)}.json`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      fs.writeFileSync(sp, Buffer.from(await r.arrayBuffer()));
    }
  }

  return {
    meta: { ...prevMeta, ok: true, carriedForward: true, rolloverNote: errMsg },
    cityEntries: prevCityEntries,
    onlineEntries: prevOnline,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const outRoot = path.resolve(opts.outDir);
  fs.mkdirSync(outRoot, { recursive: true });

  const prevState = await loadPreviousBuildState(outRoot);
  const cityMap = await loadCityMap({ fetchRemote: true });
  const citiesIndex = {};
  const onlineIndex = {};
  const metaChains = {};
  let succeededChains = 0;

  for (const chainId of opts.chains) {
    try {
      const { stores, meta } = await buildChain(chainId, cityMap, outRoot, opts.limitStores);
      metaChains[chainId] = meta;
      succeededChains++;
      for (const s of stores) {
        if (s.type === 'online') {
          if (s.itemsCount < 200) continue;
          if (!onlineIndex[chainId]) onlineIndex[chainId] = [];
          onlineIndex[chainId].push({
            storeId: s.storeId,
            name: s.name,
            address: s.address,
            city: s.city,
            itemsCount: s.itemsCount,
            quick: /קוויק|quick|וולט|wolt/i.test(s.name),
          });
          continue;
        }
        if (!citiesIndex[s.city]) citiesIndex[s.city] = [];
        citiesIndex[s.city].push({
          chain: s.chain,
          storeId: s.storeId,
          name: s.name,
          address: s.address,
        });
      }
      if (!onlineIndex[chainId]?.length) {
        onlineIndex[chainId] = null;
        console.log(`[${chainId}] Note: no online (StoreType=2) fulfilment store published – online[${chainId}] = null (in-store mode only).`);
      }
    } catch (err) {
      const carried = await tryCarryForwardChain(chainId, outRoot, prevState, err.message).catch(() => null);
      if (carried) {
        console.warn(`[${chainId}] Upstream portal rollover (${err.message}) – carried forward ${carried.meta.storesCount} last-known-good branches.`);
        metaChains[chainId] = carried.meta;
        onlineIndex[chainId] = carried.onlineEntries;
        for (const { city, branch } of carried.cityEntries) {
          if (!citiesIndex[city]) citiesIndex[city] = [];
          citiesIndex[city].push(branch);
        }
        succeededChains++;
      } else {
        console.error(`[${chainId}] FAILED: ${err.message}`);
        metaChains[chainId] = { ok: false, error: err.message, storesCount: 0, catalogCount: 0 };
      }
    }
  }

  // When running a partial --chains= subset on an existing outDir, preserve untouched chains already built on disk
  for (const cid of Object.keys(SOURCES)) {
    if (opts.chains.includes(cid)) continue;
    const preserved = await tryCarryForwardChain(cid, outRoot, prevState, 'preserved').catch(() => null);
    if (preserved) {
      const { carriedForward, rolloverNote, ...cleanMeta } = preserved.meta;
      metaChains[cid] = cleanMeta;
      onlineIndex[cid] = preserved.onlineEntries;
      for (const { city, branch } of preserved.cityEntries) {
        if (!citiesIndex[city]) citiesIndex[city] = [];
        citiesIndex[city].push(branch);
      }
    }
  }

  if (succeededChains === 0) {
    console.error('All chains failed to build; aborting.');
    process.exit(1);
  }

  // Sort cities alphabetically (Hebrew locale) and branches by chain + name
  const sortedCities = {};
  for (const city of Object.keys(citiesIndex).sort((a, b) => a.localeCompare(b, 'he'))) {
    sortedCities[city] = citiesIndex[city].sort((a, b) => a.chain.localeCompare(b.chain) || a.name.localeCompare(b.name, 'he'));
  }

  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    citiesCount: Object.keys(sortedCities).length,
    chains: metaChains,
  };

  fs.writeFileSync(path.join(outRoot, 'cities.json'), JSON.stringify(sortedCities));
  // Online stores per chain: standard nationwide delivery store first (most items, not "quick" or Eilat), quick-commerce last
  const isEilatOnline = (s) => /אילת/.test(`${s.name} ${s.city}`);
  for (const list of Object.values(onlineIndex)) {
    if (!Array.isArray(list)) continue;
    list.sort((a, b) => (a.quick - b.quick) || (isEilatOnline(a) - isEilatOnline(b)) || (b.itemsCount - a.itemsCount));
  }
  fs.writeFileSync(path.join(outRoot, 'online.json'), JSON.stringify(onlineIndex));
  fs.writeFileSync(path.join(outRoot, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  // Write GitHub Actions Job Summary if running in Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## SmartCart Price Pipeline Summary',
      `Generated at: \`${meta.generatedAt}\` · Cities: **${meta.citiesCount}**`,
      '',
      '| Chain | Status | Branches | Unique Products | Active All-Customer Promo Entries | Latest File Stamp |',
      '|---|---|---|---|---|---|',
    ];
    for (const [cid, m] of Object.entries(metaChains)) {
      lines.push(m.ok
        ? `| \`${cid}\` | ${m.carriedForward ? '⚠️ Carried Forward' : '✅ OK'} | ${m.storesCount} | ${m.catalogCount} | ${m.promoItemsCount} | \`${m.latestStamp}\` |`
        : `| \`${cid}\` | ❌ Error | 0 | 0 | 0 | ${m.error} |`);
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  console.log(`\nBuild complete -> ${outRoot} (${meta.citiesCount} cities across ${succeededChains}/${opts.chains.length} chains).`);
}

const isDirectCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
