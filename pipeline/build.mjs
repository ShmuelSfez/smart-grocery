// Builds static JSON price data (data/v1/) from official Israeli Price Transparency feeds.
// Usage: node pipeline/build.mjs [--chains=shufersal,ramilevy,carrefour] [--limit-stores=N] [--out=data/v1]
import fs from 'node:fs';
import path from 'node:path';
import { loadCityMap } from './cities.mjs';
import { decodeFeedBuffer, parseStoresXml, parsePricesXml } from './parse.mjs';
import { parsePromosXml } from './promos.mjs';
import * as shufersal from './sources/shufersal.mjs';
import * as ramilevy from './sources/ramilevy.mjs';
import * as carrefour from './sources/carrefour.mjs';

const SOURCES = { shufersal, ramilevy, carrefour };
const PRIORITY_CITIES = ['הרצליה', 'תל אביב-יפו', 'ירושלים', 'חיפה', 'באר שבע', 'ראשון לציון', 'פתח תקווה'];

function parseArgs(argv) {
  const opts = {
    chains: ['shufersal', 'ramilevy', 'carrefour'],
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

      const branchPrices = {};
      for (const it of items) {
        if (!catalog[it.code]) {
          catalog[it.code] = [it.name, it.manufacturer, it.qty, it.unit, it.weighted];
        } else if (!catalog[it.code][1] && it.manufacturer) {
          catalog[it.code][1] = it.manufacturer;
        }
        const promo = promosByItem.get(it.code);
        if (promo) {
          branchPrices[it.code] = [it.price, it.unitPrice, promo];
          totalPromoItems++;
        } else {
          branchPrices[it.code] = [it.price, it.unitPrice];
        }
      }

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

async function main() {
  const opts = parseArgs(process.argv);
  const outRoot = path.resolve(opts.outDir);
  fs.mkdirSync(outRoot, { recursive: true });

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
          if (!onlineIndex[chainId]) onlineIndex[chainId] = [];
          onlineIndex[chainId].push({
            storeId: s.storeId,
            name: s.name,
            address: s.address,
            city: s.city,
            itemsCount: s.itemsCount,
            quick: /קוויק|quick/i.test(s.name),
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
        console.warn(`[${chainId}] WARNING: no online (StoreType=2) store built – delivery mode has no price list for this chain`);
      }
    } catch (err) {
      console.error(`[${chainId}] FAILED: ${err.message}`);
      metaChains[chainId] = { ok: false, error: err.message, storesCount: 0, catalogCount: 0 };
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
  // Online stores per chain: standard delivery store first (most items, not "quick"), quick-commerce last
  for (const list of Object.values(onlineIndex)) {
    list.sort((a, b) => (a.quick - b.quick) || (b.itemsCount - a.itemsCount));
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
        ? `| \`${cid}\` | ✅ OK | ${m.storesCount} | ${m.catalogCount} | ${m.promoItemsCount} | \`${m.latestStamp}\` |`
        : `| \`${cid}\` | ❌ Error | 0 | 0 | 0 | ${m.error} |`);
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  console.log(`\nBuild complete -> ${outRoot} (${meta.citiesCount} cities across ${succeededChains}/${opts.chains.length} chains).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
