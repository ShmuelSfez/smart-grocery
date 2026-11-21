// Pure Node 20+ zero-dependency builder & verifier for the SmartCart Chrome Extension (v3.1.0).
// Usage:
//   node extension/build.mjs               -> syncs codec.js + writes web/smartcart-extension.zip & web/shufersal-extension.zip
//   node extension/build.mjs --all-chains  -> also writes dist/extensions/smartcart-<chainId>.zip for all 7 chains
//   node extension/build.mjs --chain=<id>  -> writes dist/extensions/smartcart-<id>.zip (and dist/smartcart-<id>.zip)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { writeZip } from '../tests/regression/lib/zip-writer.mjs';
import { listZipEntries } from '../web/js/zip.js';

const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(EXT_DIR, '..');
const WEB_CODEC_PATH = path.join(ROOT_DIR, 'web', 'js', 'codec.js');
const EXT_CODEC_PATH = path.join(EXT_DIR, 'codec.js');
const UNIFIED_ZIP_PATH = path.join(ROOT_DIR, 'web', 'smartcart-extension.zip');
const LEGACY_SHUF_ZIP_PATH = path.join(ROOT_DIR, 'web', 'shufersal-extension.zip');
const DIST_EXT_DIR = path.join(ROOT_DIR, 'dist', 'extensions');

export const CHAIN_BUILD_SPECS = {
  shufersal: { name: 'שופרסל', matchPattern: 'https://www.shufersal.co.il/*' },
  ramilevy: { name: 'רמי לוי', matchPattern: 'https://www.rami-levy.co.il/*' },
  carrefour: { name: 'קרפור', matchPattern: 'https://www.carrefour.co.il/*' },
  mahsaneihashuk: { name: 'מחסני השוק', matchPattern: 'https://www.mck.co.il/*' },
  victory: { name: 'ויקטורי', matchPattern: 'https://www.victoryonline.co.il/*' },
  yochananof: { name: 'יוחננוף', matchPattern: 'https://yochananof.co.il/*' },
  tivtaam: { name: 'טיב טעם', matchPattern: 'https://www.tivtaam.co.il/*' },
};

const CORE_FILES = [
  'bridge.js',
  'capture.js',
  'codec.js',
  'panel.js',
  'popup.html',
  'popup.js',
  'icons/16.png',
  'icons/48.png',
  'icons/128.png',
];

const ALL_CHAIN_FILES = [
  'chains/selfpoint.js',
  'chains/shufersal.js',
  'chains/ramilevy.js',
  'chains/carrefour.js',
  'chains/mahsaneihashuk.js',
  'chains/victory.js',
  'chains/yochananof.js',
  'chains/tivtaam.js',
];

export function syncCodec() {
  const src = fs.readFileSync(WEB_CODEC_PATH);
  const cur = fs.existsSync(EXT_CODEC_PATH) ? fs.readFileSync(EXT_CODEC_PATH) : null;
  if (!cur || !cur.equals(src)) {
    fs.writeFileSync(EXT_CODEC_PATH, src);
  }
  return src;
}

export function verifyExtensionZipBuffer(zipBuf, expectedFiles = []) {
  const entries = listZipEntries(zipBuf);
  const names = entries.map((e) => e.name);

  for (const name of names) {
    if (name.includes('\\') || name.startsWith('/')) {
      throw new Error(`Invalid archive path in extension zip: "${name}"`);
    }
    if (name.endsWith('build.mjs')) {
      throw new Error('Build script must not be packaged inside extension zip');
    }
  }

  for (const req of expectedFiles) {
    if (!names.includes(req)) {
      throw new Error(`Missing required file "${req}" in extension zip`);
    }
  }

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new Error('Missing manifest.json in extension zip');
  const rawManifest = manifestEntry.method === 8
    ? zlib.inflateRawSync(manifestEntry.data)
    : Buffer.from(manifestEntry.data);
  const manifest = JSON.parse(rawManifest.toString('utf8'));
  if (manifest.manifest_version !== 3 || manifest.version !== '3.1.1') {
    throw new Error(`Unexpected manifest version in zip: ${manifest.version}`);
  }

  return { entries, names, manifest };
}

export function buildUnifiedZipBuffer() {
  syncCodec();
  const relFiles = ['manifest.json', ...CORE_FILES, ...ALL_CHAIN_FILES];
  const zipEntries = relFiles.map((rel) => ({
    name: rel.replace(/\\/g, '/'),
    data: fs.readFileSync(path.join(EXT_DIR, rel)),
  }));
  const buf = writeZip(zipEntries, { deflate: true });
  verifyExtensionZipBuffer(buf, relFiles);
  return buf;
}

export function buildSingleChainZipBuffer(chainId) {
  const spec = CHAIN_BUILD_SPECS[chainId];
  if (!spec) {
    throw new Error(`Unknown chain "${chainId}". Expected one of: ${Object.keys(CHAIN_BUILD_SPECS).join(', ')}`);
  }
  syncCodec();
  const baseManifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  const chainScripts = ['codec.js', 'chains/selfpoint.js', `chains/${chainId}.js`, 'panel.js'];
  const singleManifest = {
    ...baseManifest,
    name: `העגלה החכמה – מילוי סל ב${spec.name} (לא רשמי)`,
    description: `כלי עצמאי ובלתי רשמי למילוי סל ומעבר לתשלום ב${spec.name}.`,
    host_permissions: [spec.matchPattern],
    content_scripts: [
      baseManifest.content_scripts[0],
      {
        matches: [spec.matchPattern],
        js: ['capture.js'],
        run_at: 'document_start',
      },
      {
        matches: [spec.matchPattern],
        js: chainScripts,
        run_at: 'document_idle',
      },
    ],
  };

  const relFiles = [...CORE_FILES, 'chains/selfpoint.js', `chains/${chainId}.js`];
  const zipEntries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(singleManifest, null, 2) + '\n', 'utf8') },
    ...relFiles.map((rel) => ({
      name: rel.replace(/\\/g, '/'),
      data: fs.readFileSync(path.join(EXT_DIR, rel)),
    })),
  ];

  const buf = writeZip(zipEntries, { deflate: true });
  verifyExtensionZipBuffer(buf, ['manifest.json', ...relFiles]);
  return buf;
}

export function runBuild({ allChains = false, onlyChain = '' } = {}) {
  const outputs = [];

  if (onlyChain) {
    const chainBuf = buildSingleChainZipBuffer(onlyChain);
    fs.mkdirSync(DIST_EXT_DIR, { recursive: true });
    const distChainPath = path.join(DIST_EXT_DIR, `smartcart-${onlyChain}.zip`);
    const rootDistChainPath = path.join(ROOT_DIR, 'dist', `smartcart-${onlyChain}.zip`);
    fs.writeFileSync(distChainPath, chainBuf);
    fs.writeFileSync(rootDistChainPath, chainBuf);
    outputs.push(distChainPath, rootDistChainPath);
    return { outputs };
  }

  const unifiedBuf = buildUnifiedZipBuffer();
  fs.writeFileSync(UNIFIED_ZIP_PATH, unifiedBuf);
  fs.writeFileSync(LEGACY_SHUF_ZIP_PATH, unifiedBuf);
  outputs.push(UNIFIED_ZIP_PATH, LEGACY_SHUF_ZIP_PATH);

  if (allChains) {
    fs.mkdirSync(DIST_EXT_DIR, { recursive: true });
    for (const chainId of Object.keys(CHAIN_BUILD_SPECS)) {
      const chainBuf = buildSingleChainZipBuffer(chainId);
      const outPath = path.join(DIST_EXT_DIR, `smartcart-${chainId}.zip`);
      fs.writeFileSync(outPath, chainBuf);
      outputs.push(outPath);
    }
  }

  return { outputs, unifiedBytes: unifiedBuf.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const allChains = args.includes('--all-chains');
  const chainArg = args.find((a) => a.startsWith('--chain='));
  const onlyChain = chainArg ? chainArg.slice('--chain='.length).trim() : '';

  const res = runBuild({ allChains, onlyChain });
  for (const p of res.outputs) {
    const rel = path.relative(ROOT_DIR, p).replace(/\\/g, '/');
    const sizeKb = (fs.statSync(p).size / 1024).toFixed(1);
    console.log(`[extension/build] wrote ${rel} (${sizeKb} KB)`);
  }
}
