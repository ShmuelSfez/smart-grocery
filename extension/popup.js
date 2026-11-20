const CHAINS = {
  shufersal: {
    name: 'שופרסל',
    url: 'https://www.shufersal.co.il/online/he/',
    pattern: 'https://www.shufersal.co.il/*',
    host: 'shufersal.co.il',
  },
  ramilevy: {
    name: 'רמי לוי',
    url: 'https://www.rami-levy.co.il/he/online/market',
    pattern: 'https://www.rami-levy.co.il/*',
    host: 'rami-levy.co.il',
  },
  carrefour: {
    name: 'קרפור',
    url: 'https://www.carrefour.co.il/',
    pattern: 'https://www.carrefour.co.il/*',
    host: 'carrefour.co.il',
  },
  mahsaneihashuk: {
    name: 'מחסני השוק',
    url: 'https://www.mck.co.il/',
    pattern: 'https://www.mck.co.il/*',
    host: 'mck.co.il',
  },
  victory: {
    name: 'ויקטורי',
    url: 'https://www.victoryonline.co.il/',
    pattern: 'https://www.victoryonline.co.il/*',
    host: 'victoryonline.co.il',
  },
  yochananof: {
    name: 'יוחננוף',
    url: 'https://yochananof.co.il/',
    pattern: 'https://yochananof.co.il/*',
    host: 'yochananof.co.il',
  },
  tivtaam: {
    name: 'טיב טעם',
    url: 'https://www.tivtaam.co.il/',
    pattern: 'https://www.tivtaam.co.il/*',
    host: 'tivtaam.co.il',
  },
};

const NON_SHUF_CHAINS = Object.keys(CHAINS).filter((id) => id !== 'shufersal');

const $ = (id) => document.getElementById(id);
const get = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

function detectChainFromText(raw) {
  const s = String(raw || '').toLowerCase();
  for (const [id, meta] of Object.entries(CHAINS)) {
    if (s.includes(meta.host)) return id;
  }
  return '';
}

async function refresh() {
  const pending = await get('pending');
  const chainId = (pending && CHAINS[pending.chain]) ? pending.chain : 'shufersal';
  const chainMeta = CHAINS[chainId];

  $('open').textContent = `פתח את ${chainMeta.name} עם החלונית`;
  $('pendingInfo').textContent = pending
    ? `יש רשימה ממתינה ל${chainMeta.name}${pending.items ? ` (${pending.items.length} מוצרים)` : ''} – לחץ לפתיחה.`
    : 'אין רשימה ממתינה. לחץ "שלח סל לתשלום" באפליקציית העגלה החכמה.';

  const shufMaps = (await get('mappings')) || {};
  const chainMaps = (await get('chainMappings')) || {};
  const entries = [];
  for (const [k, p] of Object.entries(shufMaps)) {
    entries.push({ chain: 'shufersal', key: k, prod: p });
  }
  for (const cid of NON_SHUF_CHAINS) {
    for (const [k, p] of Object.entries(chainMaps[cid] || {})) {
      entries.push({ chain: cid, key: k, prod: p });
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key, 'he'));

  $('mapsTitle').textContent = `מוצרים שמורים (${entries.length})`;
  const box = $('maps');
  box.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'עוד אין. מוצרים שתאשר יתווספו לכאן לזיהוי מהיר בפעם הבאה.';
    box.append(empty);
    return;
  }

  for (const entry of entries) {
    const { chain, key, prod } = entry;
    const row = document.createElement('div');
    row.className = 'map';
    const img = document.createElement('img');
    if (prod && prod.img && globalThis.SLCodec?.isSafeImgUrl(prod.img)) img.src = prod.img;
    const g = document.createElement('div');
    g.className = 'g';
    const a = document.createElement('div');
    const bTag = document.createElement('b');
    bTag.textContent = `${key} (${CHAINS[chain]?.name || chain})`;
    a.append(bTag);
    const b = document.createElement('div');
    b.className = 'muted';
    b.textContent = prod?.name || '';
    g.append(a, b);
    const x = document.createElement('button');
    x.className = 'x';
    x.title = 'שכח את הבחירה';
    x.textContent = '✕';
    x.onclick = async () => {
      if (chain === 'shufersal') {
        delete shufMaps[key];
        await set({ mappings: shufMaps });
      } else if (chainMaps[chain]) {
        delete chainMaps[chain][key];
        await set({ chainMappings: chainMaps });
      }
      refresh();
    };
    row.append(img, g, x);
    box.append(row);
  }
}

async function openChain(chainId) {
  const target = CHAINS[chainId] || CHAINS.shufersal;
  const tabs = await chrome.tabs.query({ url: target.pattern });
  if (tabs.length) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    chrome.tabs.sendMessage(t.id, { type: 'smartlist-open' }).catch(() => chrome.tabs.reload(t.id));
  } else {
    await chrome.tabs.create({ url: target.url });
  }
  window.close();
}

$('open').onclick = async () => {
  const pending = await get('pending');
  const cid = (pending && CHAINS[pending.chain]) ? pending.chain : 'shufersal';
  openChain(cid);
};

$('import').onclick = async () => {
  const raw = $('code').value || '';
  const m = raw.match(/smartlist=([^&\s]+)/) || raw.trim().match(/^([dzp][A-Za-z0-9_-]+)$/);
  if (!m) {
    $('pendingInfo').textContent = '⚠️ לא נמצא קוד רשימה בטקסט.';
    return;
  }
  const selected = $('chainSelect')?.value || 'auto';
  let chain = selected !== 'auto' && CHAINS[selected] ? selected : detectChainFromText(raw);
  if (!chain && globalThis.SLCodec?.decodePayload) {
    try {
      const dec = await globalThis.SLCodec.decodePayload(m[1]);
      if (dec.auth?.chain && CHAINS[dec.auth.chain]) chain = dec.auth.chain;
    } catch (e) { /* ignore */ }
  }
  if (!chain) chain = 'shufersal';
  await set({ pending: { code: m[1], chain, ts: Date.now(), items: null, autoAdd: false, v: 3 } });
  openChain(chain);
};

refresh();
