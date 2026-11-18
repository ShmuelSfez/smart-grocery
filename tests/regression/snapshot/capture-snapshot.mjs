// One-time / on-demand snapshot capture of the 3 chains' official online-store feeds (StoreType=2)
// into tests/regression/snapshot/*.xml.gz so the 600-list regression is 100% deterministic and offline.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as shufersal from '../../../pipeline/sources/shufersal.mjs';
import * as ramilevy from '../../../pipeline/sources/ramilevy.mjs';
import * as carrefour from '../../../pipeline/sources/carrefour.mjs';
import { decodeFeedBuffer } from '../../../pipeline/parse.mjs';

const SNAP_DIR = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = [
  { chain: 'shufersal', src: shufersal, storeId: '413' },
  { chain: 'ramilevy', src: ramilevy, storeId: '39' },
  { chain: 'carrefour', src: carrefour, storeId: '471' },
];

const manifest = { capturedAt: new Date().toISOString(), stores: {} };

for (const { chain, src, storeId } of TARGETS) {
  console.log(`Capturing ${chain} online store ${storeId}...`);
  const feeds = await src.listFeeds();
  const pf = feeds.priceFiles.get(storeId);
  const prf = feeds.promoFiles.get(storeId);
  if (!pf) throw new Error(`Missing PriceFull for ${chain} store ${storeId}`);

  // Normalize to clean UTF-8 XML + gzip level 9 so even ZIP-wrapped feeds are stored uniformly as .xml.gz
  const priceXml = decodeFeedBuffer(await pf.download());
  const priceGz = zlib.gzipSync(Buffer.from(priceXml, 'utf8'), { level: 9 });
  fs.writeFileSync(path.join(SNAP_DIR, `${chain}-${storeId}-prices.xml.gz`), priceGz);

  let promoBytes = 0;
  if (prf) {
    const promoXml = decodeFeedBuffer(await prf.download());
    const promoGz = zlib.gzipSync(Buffer.from(promoXml, 'utf8'), { level: 9 });
    fs.writeFileSync(path.join(SNAP_DIR, `${chain}-${storeId}-promos.xml.gz`), promoGz);
    promoBytes = promoGz.length;
  }

  manifest.stores[chain] = {
    storeId,
    priceStamp: pf.stamp,
    priceCompressedKB: Math.round(priceGz.length / 1024),
    promoCompressedKB: Math.round(promoBytes / 1024),
  };
}

fs.writeFileSync(path.join(SNAP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Snapshot captured:', manifest);
