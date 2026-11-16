import { parseItem, parseMany, normalizeName, formatQty } from './parser.js';
import { CATEGORIES, CATEGORY_BY_ID, categorize } from './categories.js';
import { store } from './store.js';
import { recordPurchase, runningOut, frequent, STARTER_ITEMS } from './suggest.js';
import { RECIPES, scaleRecipe } from './recipes.js';
import { aiToItems } from './ai.js';
import { parseGrid, analyzeSheetGrid, exportListToCsv } from './sheets.js';

export const CHAINS = [
  { id: 'ramilevy', name: 'רמי לוי', emoji: '🛒', url: 'https://www.rami-levy.co.il/he/online/market', extSupported: true, deliveryFee: 29.9, freeOver: 750, minOrder: 200, baseEtaHours: 5 },
  { id: 'yochananof', name: 'יוחננוף', emoji: '🛍️', url: 'https://yochananof.co.il/', extSupported: false, deliveryFee: 24.9, freeOver: 650, minOrder: 200, baseEtaHours: 8 },
  { id: 'victory', name: 'ויקטורי', emoji: '🏪', url: 'https://www.victoryonline.co.il/', extSupported: false, deliveryFee: 29.0, freeOver: 700, minOrder: 200, baseEtaHours: 7 },
  { id: 'carrefour', name: 'קרפור', emoji: '🇫🇷', url: 'https://www.carrefour.co.il/', extSupported: false, deliveryFee: 29.9, freeOver: 550, minOrder: 150, baseEtaHours: 4 },
  { id: 'shufersal', name: 'שופרסל', emoji: '🔴', url: 'https://www.shufersal.co.il/online/he/', extSupported: true, deliveryFee: 29.9, freeOver: 650, minOrder: 150, baseEtaHours: 6 },
];
const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

// City / Region coverage profiles (which chains deliver there + regional ETA offset in hours)
const CITY_DELIVERY_PROFILES = {
  'ירושלים': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'ramilevy' },
  'תל אביב': { chains: ['shufersal', 'carrefour', 'ramilevy', 'victory', 'yochananof'], fastChain: 'carrefour' },
  'מודיעין': { chains: ['ramilevy', 'shufersal', 'carrefour', 'yochananof', 'victory'], fastChain: 'ramilevy' },
  'מעלה אדומים': { chains: ['ramilevy', 'shufersal'], fastChain: 'ramilevy' },
  'אריאל': { chains: ['ramilevy', 'shufersal', 'victory'], fastChain: 'ramilevy' },
  'גוש עציון': { chains: ['ramilevy'], fastChain: 'ramilevy' },
  'אפרת': { chains: ['ramilevy'], fastChain: 'ramilevy' },
  'בית שמש': { chains: ['ramilevy', 'shufersal', 'carrefour'], fastChain: 'ramilevy' },
  'באר שבע': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'shufersal' },
  'חיפה': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory'], fastChain: 'shufersal' },
  'ראשון לציון': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'yochananof' },
  'פתח תקווה': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'ramilevy' },
  'נתניה': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'ramilevy' },
  'אשדוד': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'yochananof' },
  'רחובות': { chains: ['ramilevy', 'shufersal', 'carrefour', 'yochananof', 'victory'], fastChain: 'yochananof' },
  'אשקלון': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory'], fastChain: 'ramilevy' },
  'כפר סבא': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'carrefour' },
  'רעננה': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory'], fastChain: 'carrefour' },
  'הרצליה': { chains: ['shufersal', 'carrefour', 'ramilevy', 'victory'], fastChain: 'carrefour' },
  'חדרה': { chains: ['ramilevy', 'shufersal', 'carrefour', 'victory', 'yochananof'], fastChain: 'ramilevy' },
  'עפולה': { chains: ['ramilevy', 'shufersal', 'victory'], fastChain: 'ramilevy' },
  'טבריה': { chains: ['ramilevy', 'shufersal'], fastChain: 'ramilevy' },
  'נהריה': { chains: ['ramilevy', 'shufersal', 'victory'], fastChain: 'ramilevy' },
  'כרמיאל': { chains: ['ramilevy', 'shufersal'], fastChain: 'ramilevy' },
  'קריית שמונה': { chains: ['ramilevy', 'shufersal'], fastChain: 'ramilevy' },
  'אילת': { chains: ['ramilevy', 'shufersal'], fastChain: 'ramilevy' },
  'מודיעין עילית': { chains: ['ramilevy'], fastChain: 'ramilevy' },
  'ביתר עילית': { chains: ['ramilevy'], fastChain: 'ramilevy' },
  'שדרות': { chains: ['ramilevy', 'shufersal', 'victory'], fastChain: 'victory' },
  'נתיבות': { chains: ['ramilevy', 'shufersal', 'victory'], fastChain: 'ramilevy' },
};

const $ = (id) => document.getElementById(id);
const key = normalizeName;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

let list = store.getList();
let history = store.getHistory();
let overrides = store.getCatOverrides();
let mappings = store.getMappings();
let settings = store.getSettings();

// Selected chain: 'auto' (picks best chain automatically!) or a specific chain id ('ramilevy', 'shufersal', etc.)
let selectedChainMode = settings.selectedChain || 'auto';
let userLocation = settings.userLocation || '';
let includeDelivery = settings.includeDelivery !== false;
let sortPreference = settings.sortPreference || 'cheapest'; // 'cheapest' | 'fastest'
// Per-chain manual availability overrides: { [chainId]: true | false }
let chainAvailOverrides = settings.chainAvailOverrides || {};

const searchCache = new Map();
const openPickers = new Set();

for (const it of list) {
  if (it.checked === undefined) it.checked = true;
  if (!it.product && mappings[key(it.name)]) it.product = mappings[key(it.name)];
}

// ---------- helpers ----------
function saveList() {
  store.setList(list);
  render();
  pushFamilyRoom();
}

function toast(msg, action) {
  const t = $('toast');
  // Move toast inside any currently open top-layer modal dialog so it is never hidden behind ::backdrop
  const openDlg = document.querySelector('dialog[open]');
  (openDlg || document.body).append(t);
  t.innerHTML = '';
  t.append(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); t.hidden = true; };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), action ? 5000 : 2500);
}

function catFor(name, given) {
  const k = key(name);
  if (overrides[k]) return overrides[k];
  if (history[k]?.category) return history[k].category;
  if (given && CATEGORY_BY_ID[given]) return given;
  return categorize(name, overrides);
}

async function fetchOptions(query) {
  const q = query.trim();
  if (!q) return [];
  if (searchCache.has(q)) return searchCache.get(q);
  const p = fetch(`/api/search?q=${encodeURIComponent(q)}&limit=9`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  searchCache.set(q, p);
  const res = await p;
  searchCache.set(q, res);
  return res;
}

function ensureOptionsLoaded(it) {
  const q = it.searchQuery || it.name;
  const existing = searchCache.get(q);
  if (Array.isArray(existing)) {
    if ((!it.product || !it.product.chainPrices) && existing.length) {
      it.product = existing.find((p) => p.inStock) || existing[0];
      mappings[key(it.name)] = it.product;
      store.setMappings(mappings);
      store.setList(list);
    }
    return;
  }
  fetchOptions(q).then((res) => {
    if ((!it.product || !it.product.chainPrices) && Array.isArray(res) && res.length) {
      it.product = res.find((p) => p.inStock) || res[0];
      mappings[key(it.name)] = it.product;
      store.setMappings(mappings);
      store.setList(list);
    }
    render();
  });
}

function isChainAvailableInArea(chainId) {
  if (chainId in chainAvailOverrides) return chainAvailOverrides[chainId];
  const loc = userLocation.trim();
  if (!loc) return true;
  const profileKey = Object.keys(CITY_DELIVERY_PROFILES).find((c) => loc.includes(c) || c.includes(loc));
  if (!profileKey) return true;
  return CITY_DELIVERY_PROFILES[profileKey].chains.includes(chainId);
}

function getChainSlotInfo(chain) {
  const loc = userLocation.trim();
  const profileKey = loc ? Object.keys(CITY_DELIVERY_PROFILES).find((c) => loc.includes(c) || c.includes(loc)) : null;
  const isFastestInCity = profileKey && CITY_DELIVERY_PROFILES[profileKey]?.fastChain === chain.id;
  const etaHours = Math.max(2, chain.baseEtaHours - (isFastestInCity ? 2 : 0));
  const nowHour = new Date().getHours();
  if (nowHour + etaHours <= 21) {
    const startH = Math.max(nowHour + 2, 16);
    return { etaHours, slotLabel: `🚚 היום ${startH}:00–21:00` };
  }
  if (etaHours <= 5) {
    return { etaHours, slotLabel: '🚚 מחר 08:00–12:00' };
  }
  return { etaHours, slotLabel: '🚚 מחר 12:00–16:00' };
}

// Compute totals per supermarket chain across all checked items (including delivery fee & availability)
function computeChainTotals() {
  const checked = list.filter((i) => i.checked);
  const subTotals = Object.fromEntries(CHAINS.map((c) => [c.id, 0]));
  const deliveryFees = Object.fromEntries(CHAINS.map((c) => [c.id, 0]));
  const totals = Object.fromEntries(CHAINS.map((c) => [c.id, 0]));
  const slotInfo = {};
  const available = {};
  let pricedCount = 0;

  for (const it of checked) {
    ensureOptionsLoaded(it);
    const p = it.product;
    if (!p) continue;
    pricedCount++;
    const mult = it.unit === 'g' ? Math.max(0.1, it.qty / 1000) : (Number(it.qty) || 1);
    const cp = p.chainPrices || {};
    const fallback = parseFloat(String(p.price || '').replace(/[^\d.]/g, '')) || 10;
    for (const c of CHAINS) {
      const unitPrice = typeof cp[c.id] === 'number' ? cp[c.id] : fallback;
      subTotals[c.id] += unitPrice * mult;
    }
  }

  for (const c of CHAINS) {
    subTotals[c.id] = Math.round(subTotals[c.id] * 100) / 100;
    available[c.id] = isChainAvailableInArea(c.id);
    slotInfo[c.id] = getChainSlotInfo(c);
    if (subTotals[c.id] > 0) {
      deliveryFees[c.id] = subTotals[c.id] >= c.freeOver ? 0 : c.deliveryFee;
      totals[c.id] = Math.round((subTotals[c.id] + (includeDelivery ? deliveryFees[c.id] : 0)) * 100) / 100;
    }
  }

  const availChains = CHAINS.filter((c) => available[c.id]);
  const pool = availChains.length ? availChains : CHAINS;

  const byCheapest = [...pool].sort((a, b) => totals[a.id] - totals[b.id] || slotInfo[a.id].etaHours - slotInfo[b.id].etaHours);
  const byFastest = [...pool].sort((a, b) => slotInfo[a.id].etaHours - slotInfo[b.id].etaHours || totals[a.id] - totals[b.id]);

  const cheapestId = byCheapest[0]?.id || 'ramilevy';
  const fastestId = byFastest[0]?.id || 'ramilevy';
  const bestId = sortPreference === 'fastest' ? fastestId : cheapestId;
  const highestTotal = byCheapest[byCheapest.length - 1] ? totals[byCheapest[byCheapest.length - 1].id] : 0;
  const activeChainId = selectedChainMode === 'auto' ? bestId : (CHAIN_BY_ID[selectedChainMode] ? selectedChainMode : bestId);
  return { totals, subTotals, deliveryFees, slotInfo, available, cheapestId, fastestId, bestId, highestTotal, activeChainId, pricedCount };
}

function addItems(items, { silent = false } = {}) {
  const before = JSON.stringify(list);
  let added = 0;
  for (const it of items) {
    if (!it || !it.name) continue;
    const k = key(it.name);
    const existing = list.find((x) => key(x.name) === k);
    if (existing) {
      if (existing.unit === it.unit) existing.qty = Math.round((existing.qty + it.qty) * 1000) / 1000;
      else { existing.qty = it.qty; existing.unit = it.unit; }
      existing.checked = true;
      if (it.product) existing.product = it.product;
    } else {
      const savedProd = it.product || mappings[k] || null;
      const newItem = {
        id: uid(), name: it.name, qty: it.qty || 1, unit: it.unit || 'unit',
        category: catFor(it.name, it.category), note: it.note || '',
        checked: true, product: savedProd, addedAt: Date.now(),
      };
      list.push(newItem);
      ensureOptionsLoaded(newItem);
    }
    added++;
  }
  saveList();
  if (!silent && added) {
    toast(added === 1 ? `נוסף: ${items[0].name}` : `נוספו ${added} מוצרים`, {
      label: 'בטל', fn: () => { list = JSON.parse(before); saveList(); },
    });
  }
}

function stepFor(unit) { return unit === 'kg' ? 0.5 : unit === 'g' ? 100 : 1; }

// ---------- render ----------
function render() {
  const calc = computeChainTotals();
  const { totals, activeChainId } = calc;
  const activeChain = CHAIN_BY_ID[activeChainId] || CHAINS[0];
  renderComparisonDashboard(calc);

  if ($('authLabel')) {
    $('authLabel').textContent = `👤 אימייל לחיבור ב${activeChain.name}:`;
  }

  const box = $('listBox');
  box.innerHTML = '';
  const groups = new Map();
  for (const it of list) {
    const c = CATEGORY_BY_ID[it.category] ? it.category : 'other';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(it);
  }
  for (const cat of CATEGORIES) {
    const items = groups.get(cat.id);
    if (!items) continue;
    items.sort((a, b) => (b.checked - a.checked) || (a.addedAt - b.addedAt));
    const sec = document.createElement('section');
    sec.className = 'cat';
    const selected = items.filter((i) => i.checked).length;
    sec.innerHTML = `<div class="cat-head"><span>${cat.emoji} ${cat.he}</span><span class="count">${selected}/${items.length} נבחרו</span></div>`;
    for (const it of items) sec.append(renderItem(it, activeChainId));
    box.append(sec);
  }
  $('emptyState').hidden = list.length > 0;
  const toSend = list.filter((i) => i.checked).length;
  const activeTotal = totals[activeChainId] || 0;
  const priceTag = activeTotal > 0 ? ` · ₪${activeTotal.toFixed(2)}${includeDelivery ? ' כולל משלוח' : ''}` : '';
  $('btnSend').innerHTML = `${activeChain.emoji} שלח סל ל<b>${activeChain.name}</b> <span id="sendCount">${toSend ? `(${toSend} מוצרים${priceTag})` : ''}</span>`;
  $('btnSend').disabled = toSend === 0;
  renderSuggestions();
}

function renderComparisonDashboard(calc) {
  const { totals, subTotals, deliveryFees, slotInfo, available, cheapestId, fastestId, highestTotal, activeChainId } = calc;
  const grid = $('chainGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const hasItems = list.some((i) => i.checked);
  const autoBtn = $('btnAutoChain');
  if (autoBtn) {
    autoBtn.classList.toggle('active-auto', selectedChainMode === 'auto');
    autoBtn.onclick = () => {
      selectedChainMode = 'auto';
      settings = { ...settings, selectedChain: 'auto' };
      store.setSettings(settings);
      render();
      pushFamilyRoom();
    };
  }

  const cheapestTotal = totals[cheapestId] || 0;
  const savings = Math.max(0, highestTotal - cheapestTotal);
  const cheapestChain = CHAIN_BY_ID[cheapestId];
  const locText = userLocation ? ` באזור ${userLocation}` : '';
  if ($('compareSummary')) {
    $('compareSummary').textContent = hasItems && cheapestTotal > 0
      ? `🏆 הסל המשתלם ביותר עבורך${locText}: ${cheapestChain.name} (₪${cheapestTotal.toFixed(2)}${includeDelivery ? ' כולל משלוח' : ''} – חיסכון של ₪${savings.toFixed(2)}!):`
      : `הוסף מוצרים לרשימה כדי להשוות מחיר סל + דמי משלוח וזמני הגעה${locText}:`;
  }

  for (const c of CHAINS) {
    const isAvail = available[c.id];
    const total = totals[c.id] || 0;
    const sub = subTotals[c.id] || 0;
    const delFee = deliveryFees[c.id] || 0;
    const slot = slotInfo[c.id];
    const isCheapest = isAvail && hasItems && total > 0 && c.id === cheapestId;
    const isFastest = isAvail && c.id === fastestId;
    const isSelected = c.id === activeChainId;
    const diff = total - cheapestTotal;

    const card = document.createElement('div');
    card.className = 'chain-card' + (isSelected ? ' selected' : '') + (isCheapest ? ' cheapest' : '') + (!isAvail ? ' unavailable' : '');

    if (!isAvail) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge no-area';
      badge.textContent = '❌ לא באזורך';
      card.append(badge);
    } else if (isCheapest) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge';
      badge.textContent = '🏆 הכי זול!';
      card.append(badge);
    } else if (isFastest) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge fast';
      badge.textContent = '⚡ הכי מהיר';
      card.append(badge);
    }

    const name = document.createElement('span');
    name.className = 'chain-name';
    name.textContent = `${c.emoji} ${c.name}`;
    card.append(name);

    const price = document.createElement('span');
    price.className = 'chain-total';
    price.textContent = hasItems && total > 0 ? `₪${total.toFixed(2)}` : '—';
    card.append(price);

    if (hasItems && sub > 0) {
      const bd = document.createElement('span');
      bd.className = 'chain-breakdown';
      bd.textContent = includeDelivery
        ? `מוצרים: ₪${sub.toFixed(0)} + ${delFee === 0 ? 'משלוח חינם!' : `משלוח: ₪${delFee.toFixed(1)}`}`
        : `(ללא משלוח של ₪${c.deliveryFee.toFixed(1)})`;
      card.append(bd);
    }

    if (isAvail && slot) {
      const sl = document.createElement('span');
      sl.className = 'chain-slot';
      sl.textContent = slot.slotLabel;
      card.append(sl);
    }

    const diffEl = document.createElement('span');
    diffEl.className = 'chain-diff' + (isCheapest ? ' win' : '');
    if (!isAvail) {
      diffEl.textContent = 'לא מבצע משלוחים ליישוב';
    } else if (!hasItems || total === 0) {
      diffEl.textContent = `משלוח: ₪${c.deliveryFee.toFixed(1)} (חינם מ-₪${c.freeOver})`;
    } else if (isCheapest) {
      diffEl.textContent = savings > 0 ? `חוסך ₪${savings.toFixed(2)}` : 'המחיר הטוב ביותר';
    } else {
      diffEl.textContent = `+₪${diff.toFixed(2)} מהזול`;
    }
    card.append(diffEl);

    const toggleAvail = document.createElement('button');
    toggleAvail.type = 'button';
    toggleAvail.className = 'chain-avail-toggle';
    toggleAvail.textContent = isAvail ? '✓ מגיע אליי (שנה)' : '+ סמן שמגיע אליי';
    toggleAvail.onclick = (e) => {
      e.stopPropagation();
      chainAvailOverrides[c.id] = !isAvail;
      settings = { ...settings, chainAvailOverrides };
      store.setSettings(settings);
      render();
    };
    card.append(toggleAvail);

    card.onclick = () => {
      if (!isAvail) {
        chainAvailOverrides[c.id] = true;
      }
      selectedChainMode = c.id;
      settings = { ...settings, selectedChain: c.id, chainAvailOverrides };
      store.setSettings(settings);
      render();
      pushFamilyRoom();
    };
    grid.append(card);
  }
}

function itemPriceForChain(p, chainId) {
  if (p?.chainPrices && typeof p.chainPrices[chainId] === 'number') {
    return `${p.chainPrices[chainId].toFixed(2)} ₪`;
  }
  return p?.price || '';
}

function renderItem(it, activeChainId) {
  const row = document.createElement('div');
  row.className = 'item' + (it.checked ? '' : ' excluded');

  const main = document.createElement('div');
  main.className = 'item-main';
  main.innerHTML = `
    <input type="checkbox" ${it.checked ? 'checked' : ''} title="סמן כדי לכלול בסל" />
    <div class="name"><span class="t"></span>${it.note ? '<span class="note"></span>' : ''}</div>
    <div class="qty"><button class="plus" aria-label="הוסף">+</button><span></span><button class="minus" aria-label="הפחת">−</button></div>
    <button class="del" aria-label="מחק">✕</button>`;
  main.querySelector('.t').textContent = it.name;
  if (it.note) main.querySelector('.note').textContent = it.note;
  main.querySelector('.qty span').textContent = formatQty(it.qty, it.unit);
  main.querySelector('input').onchange = (e) => { it.checked = e.target.checked; saveList(); };
  main.querySelector('.name').onclick = () => openEdit(it);
  main.querySelector('.plus').onclick = () => { it.qty = Math.round((it.qty + stepFor(it.unit)) * 1000) / 1000; saveList(); };
  main.querySelector('.minus').onclick = () => {
    const s = stepFor(it.unit);
    if (it.qty - s >= s - 1e-9) { it.qty = Math.round((it.qty - s) * 1000) / 1000; saveList(); }
  };
  main.querySelector('.del').onclick = () => {
    const idx = list.indexOf(it);
    list.splice(idx, 1);
    saveList();
    toast(`נמחק: ${it.name}`, { label: 'בטל', fn: () => { list.splice(idx, 0, it); saveList(); } });
  };
  row.append(main);

  const pickerOpen = openPickers.has(it.id) || !it.product;
  if (it.product && !openPickers.has(it.id)) {
    const p = it.product;
    const cp = document.createElement('div');
    cp.className = 'chosen-prod';
    if (p.img && window.SLCodec?.isSafeImgUrl(p.img)) {
      const img = document.createElement('img');
      img.src = p.img;
      img.alt = '';
      img.loading = 'lazy';
      cp.append(img);
    }
    const info = document.createElement('div');
    info.className = 'cp-info';
    const cpName = document.createElement('span');
    cpName.className = 'cp-name';
    cpName.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'cp-meta';
    if (p.sponsored) {
      const sp = document.createElement('span');
      sp.className = 'cp-spons';
      sp.textContent = '⭐ ממומן';
      meta.append(sp);
    }
    if (p.brand) {
      const b = document.createElement('span');
      b.className = 'cp-brand';
      b.textContent = p.brand;
      meta.append(b);
    }
    if (p.unitDesc) meta.append(document.createTextNode(p.unitDesc));
    const pr = document.createElement('span');
    pr.className = 'cp-price';
    pr.textContent = itemPriceForChain(p, activeChainId);
    meta.append(pr);
    info.append(cpName, meta);

    if (p.chainPrices) {
      const pills = document.createElement('div');
      pills.className = 'chain-pills';
      for (const c of CHAINS) {
        if (typeof p.chainPrices[c.id] !== 'number') continue;
        const pill = document.createElement('span');
        pill.className = 'chain-pill' + (c.id === activeChainId ? ' active' : '');
        pill.textContent = `${c.name}: ₪${p.chainPrices[c.id].toFixed(2)}`;
        pills.append(pill);
      }
      info.append(pills);
    }

    const chg = document.createElement('button');
    chg.type = 'button';
    chg.className = 'change-btn';
    chg.textContent = 'החלף חברה / מותג';
    chg.onclick = () => {
      openPickers.add(it.id);
      ensureOptionsLoaded(it);
      render();
    };
    cp.append(info, chg);
    row.append(cp);
  } else if (pickerOpen && it.checked) {
    ensureOptionsLoaded(it);
    const q = it.searchQuery || it.name;
    const cached = searchCache.get(q);
    const box = document.createElement('div');
    box.className = 'picker-box';

    const head = document.createElement('div');
    head.className = 'picker-head';
    head.innerHTML = `<span>🏢 בחר מותג / מוצר (מחירי ${CHAIN_BY_ID[activeChainId]?.name || 'הרשת'}):</span>`;
    const searchWrap = document.createElement('div');
    searchWrap.className = 'picker-search';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = q;
    inp.placeholder = 'חפש מותג/מוצר…';
    const btnSearch = document.createElement('button');
    btnSearch.type = 'button';
    btnSearch.textContent = '🔍';
    const doSearch = () => {
      it.searchQuery = inp.value.trim() || it.name;
      fetchOptions(it.searchQuery).then(() => render());
      render();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } };
    btnSearch.onclick = doSearch;
    searchWrap.append(inp, btnSearch);
    if (it.product) {
      const btnClose = document.createElement('button');
      btnClose.type = 'button';
      btnClose.textContent = 'סגור';
      btnClose.onclick = () => { openPickers.delete(it.id); render(); };
      searchWrap.append(btnClose);
    }
    head.append(searchWrap);
    box.append(head);

    if (!Array.isArray(cached)) {
      const loading = document.createElement('div');
      loading.className = 'muted';
      loading.textContent = 'משווה מחירים ומותגים בין הרשתות…';
      box.append(loading);
    } else if (!cached.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'לא נמצאו תוצאות. נסה לחפש שם אחר בתיבה למעלה.';
      box.append(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'brand-grid';
      for (const p of cached) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'brand-card' + (p.sponsored ? ' sponsored' : '');
        if (p.sponsored) {
          const st = document.createElement('span');
          st.className = 'spons-tag';
          st.textContent = '⭐ ממומן';
          card.append(st);
        }
        if (p.img && window.SLCodec?.isSafeImgUrl(p.img)) {
          const img = document.createElement('img');
          img.src = p.img;
          img.alt = '';
          img.loading = 'lazy';
          card.append(img);
        } else {
          const ph = document.createElement('div');
          ph.className = 'placeholder-box';
          card.append(ph);
        }
        if (p.brand) {
          const br = document.createElement('span');
          br.className = 'bc-brand';
          br.textContent = p.brand;
          card.append(br);
        }
        const nm = document.createElement('span');
        nm.className = 'bc-name';
        nm.textContent = p.name;
        card.append(nm);
        if (p.unitDesc) {
          const un = document.createElement('span');
          un.className = 'bc-unit';
          un.textContent = p.unitDesc;
          card.append(un);
        }
        const pr = document.createElement('span');
        pr.className = 'bc-price';
        pr.textContent = itemPriceForChain(p, activeChainId);
        card.append(pr);
        card.onclick = () => {
          it.product = p;
          mappings[key(it.name)] = p;
          store.setMappings(mappings);
          openPickers.delete(it.id);
          saveList();
        };
        grid.append(card);
      }
      box.append(grid);
    }
    row.append(box);
  }
  return row;
}

function renderSuggestions() {
  const onList = new Set(list.map((i) => key(i.name)));
  let title = '';
  let chips = [];
  const due = runningOut(history, onList);
  if (due.length) {
    title = '🔔 כנראה נגמר לך';
    chips = due.map((d) => ({ name: d.name, qty: d.qty, unit: d.unit, category: d.category, hint: `כל ~${Math.round(d.avg)} ימים` }));
  } else if (Object.keys(history).length) {
    title = '⭐ קונים הרבה';
    chips = frequent(history, onList).map((d) => ({ name: d.name, qty: d.qty, unit: d.unit, category: d.category }));
  } else {
    title = '💡 להתחלה – לחץ להוספה ולהשוואת מחירים חיה בין הרשתות';
    chips = STARTER_ITEMS.filter((n) => !onList.has(key(n))).map((n) => ({ name: n, qty: 1, unit: 'unit' }));
  }
  $('suggestBox').hidden = chips.length === 0;
  $('suggestTitle').textContent = title;
  const wrap = $('suggestChips');
  wrap.innerHTML = '';
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = '+ ' + c.name;
    if (c.hint) { const s = document.createElement('small'); s.textContent = c.hint; b.append(s); }
    b.onclick = () => addItems([{ name: c.name, qty: c.qty || 1, unit: c.unit || 'unit', category: c.category }], { silent: true });
    wrap.append(b);
  }
}

// ---------- Real-Time Family Sync ----------
const urlParams = new URLSearchParams(location.search);
let currentRoomId = urlParams.get('room') || settings.familyRoomId || '';
let lastRoomUpdatedAt = 0;

function updateFamilyBanner() {
  const banner = $('familyBanner');
  if (!banner) return;
  banner.hidden = !currentRoomId;
  if (currentRoomId) {
    $('familyText').textContent = `🟢 חדר משפחתי חי (#${currentRoomId}) – מתעדכן בזמן אמת בכל המכשירים`;
  }
}

async function pushFamilyRoom() {
  if (!currentRoomId) return;
  try {
    const res = await fetch(`/api/room?id=${encodeURIComponent(currentRoomId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list, selectedChain: selectedChainMode }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.updatedAt) lastRoomUpdatedAt = data.updatedAt;
    }
  } catch {}
}

async function pollFamilyRoom() {
  if (!currentRoomId) return;
  try {
    const res = await fetch(`/api/room?id=${encodeURIComponent(currentRoomId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.updatedAt && data.updatedAt > lastRoomUpdatedAt) {
      lastRoomUpdatedAt = data.updatedAt;
      list = Array.isArray(data.list) ? data.list : list;
      if (data.selectedChain) selectedChainMode = data.selectedChain;
      store.setList(list);
      render();
    }
  } catch {}
}

function startOrCopyFamilyRoom() {
  if (!currentRoomId) {
    currentRoomId = Math.random().toString(36).slice(2, 8);
    settings = { ...settings, familyRoomId: currentRoomId };
    store.setSettings(settings);
    const newUrl = `${location.pathname}?room=${currentRoomId}${location.hash}`;
    window.history.replaceState(null, '', newUrl);
    updateFamilyBanner();
    pushFamilyRoom();
  }
  const shareUrl = `${location.origin}${location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(shareUrl).catch(() => {});
  toast('🔗 קישור החדר המשפחתי הועתק! שלח לבן/בת הזוג לסנכרון חי.');
}

if ($('btnFamily')) $('btnFamily').onclick = startOrCopyFamilyRoom;
if ($('btnCopyRoom')) $('btnCopyRoom').onclick = startOrCopyFamilyRoom;
if ($('shareFamilyRoom')) $('shareFamilyRoom').onclick = () => { $('dlgShare').close(); startOrCopyFamilyRoom(); };
if ($('btnLeaveRoom')) {
  $('btnLeaveRoom').onclick = () => {
    currentRoomId = '';
    delete settings.familyRoomId;
    store.setSettings(settings);
    window.history.replaceState(null, '', location.pathname);
    updateFamilyBanner();
    toast('יצאת מהחדר המשפחתי');
  };
}
setInterval(pollFamilyRoom, 2500);
updateFamilyBanner();
if (currentRoomId) pollFamilyRoom();

// ---------- add bar + autocomplete ----------
const addInput = $('addInput');
const ac = $('autocomplete');
let acIndex = -1;

function knownNames() {
  const names = new Map();
  for (const e of Object.values(history)) names.set(key(e.name), e.name);
  for (const n of STARTER_ITEMS) if (!names.has(key(n))) names.set(key(n), n);
  return [...names.values()];
}

addInput.addEventListener('input', () => {
  const parsed = parseItem(addInput.value);
  const q = parsed ? key(parsed.name) : '';
  acIndex = -1;
  if (q.length < 2 || addInput.value.includes(',')) { ac.hidden = true; return; }
  const onList = new Set(list.map((i) => key(i.name)));
  const matches = knownNames()
    .filter((n) => { const k = key(n); return k !== q && !onList.has(k) && (k.startsWith(q) || k.includes(' ' + q)); })
    .slice(0, 6);
  ac.innerHTML = '';
  for (const n of matches) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span></span><small>${CATEGORY_BY_ID[catFor(n)]?.emoji || ''}</small>`;
    b.firstChild.textContent = n;
    b.onclick = () => {
      addItems([{ ...parsed, name: n }], { silent: true });
      addInput.value = ''; ac.hidden = true; addInput.focus();
    };
    ac.append(b);
  }
  ac.hidden = matches.length === 0;
});

addInput.addEventListener('keydown', (e) => {
  const btns = [...ac.querySelectorAll('button')];
  if (ac.hidden || !btns.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
    btns.forEach((b, i) => b.classList.toggle('active', i === acIndex));
  } else if (e.key === 'Enter' && acIndex >= 0) {
    e.preventDefault();
    btns[acIndex].click();
  } else if (e.key === 'Escape') ac.hidden = true;
});

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const items = parseMany(addInput.value);
  if (!items.length) return;
  addItems(items, { silent: items.length === 1 });
  addInput.value = '';
  ac.hidden = true;
  addInput.focus();
});

// ---------- paste / AI ----------
let pasteMode = 'paste';
function openPaste(mode) {
  pasteMode = mode;
  const ai = mode === 'ai';
  $('pasteTitle').textContent = ai ? '✨ תגיד מה אתה צריך' : 'הדבק רשימה';
  $('pasteHint').textContent = ai
    ? 'למשל: "ארוחת שישי ל-8 עם עוף ואורז", מתכון שהדבקת, או "דברים לטיול קמפינג ליומיים".'
    : 'כל שורה או פסיק = מוצר. אפשר להדביק מוואטסאפ.';
  $('pasteOk').textContent = ai ? 'צור רשימה' : 'הוסף לרשימה';
  $('pasteText').value = '';
  $('dlgPaste').showModal();
}
$('btnPaste').onclick = () => openPaste('paste');
if ($('btnExt')) $('btnExt').onclick = () => $('dlgExt').showModal();

// ---------- Smart Google Sheets / CSV Import & Export ----------
function analyzeRawSheet(text) {
  const grid = parseGrid(text);
  const { relevant, skipped } = analyzeSheetGrid(grid, overrides);
  const hasAny = relevant.length > 0 || skipped.length > 0;
  $('sheetPreview').hidden = !hasAny;
  $('btnSheetImport').hidden = !hasAny;
  if (!hasAny) return;

  $('sheetRelTitle').textContent = `✅ רלוונטיים לסופר (${relevant.length}):`;
  const relBox = $('sheetRelList');
  relBox.innerHTML = '';
  for (const it of relevant) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.item = JSON.stringify(it);
    const txt = document.createElement('span');
    txt.textContent = `${it.name}${it.qty !== 1 || it.unit !== 'unit' ? ' – ' + formatQty(it.qty, it.unit) : ''}`;
    const cat = document.createElement('span');
    cat.className = 'why';
    cat.textContent = `${CATEGORY_BY_ID[it.category]?.emoji || ''} ${CATEGORY_BY_ID[it.category]?.he || ''}`;
    lbl.append(cb, txt, cat);
    relBox.append(lbl);
  }

  $('sheetSkipTitle').textContent = `🚫 סוננו אוטומטית כלא-רלוונטיים (${skipped.length}):`;
  const skipBox = $('sheetSkipList');
  skipBox.innerHTML = '';
  for (const sk of skipped) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = false;
    const parsed = parseItem(sk.raw) || { name: sk.raw, qty: 1, unit: 'unit' };
    cb.dataset.item = JSON.stringify({ ...parsed, category: categorize(parsed.name, overrides) });
    const txt = document.createElement('span');
    txt.textContent = sk.raw;
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = sk.reason;
    lbl.append(cb, txt, why);
    skipBox.append(lbl);
  }
}

if ($('btnSheets')) {
  const setSheetStatus = (kind, htmlOrText, isHtml = false) => {
    const box = $('sheetStatus');
    if (!box) return;
    if (!kind) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.className = 'sheet-status ' + kind;
    if (isHtml) box.innerHTML = htmlOrText;
    else box.textContent = htmlOrText;
  };
  $('btnSheets').onclick = () => {
    $('sheetRaw').value = '';
    setSheetStatus(null);
    $('sheetPreview').hidden = true;
    $('btnSheetImport').hidden = true;
    $('dlgSheets').showModal();
  };
  $('sheetRaw').addEventListener('input', () => {
    setSheetStatus(null);
    analyzeRawSheet($('sheetRaw').value);
  });
  $('sheetUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btnFetchSheet').click();
    }
  });
  $('btnUploadCsv').onclick = () => $('csvFile').click();
  $('csvFile').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSheetStatus(null);
    $('sheetRaw').value = await f.text();
    analyzeRawSheet($('sheetRaw').value);
  };
  $('btnFetchSheet').onclick = async () => {
    const url = $('sheetUrl').value.trim();
    if (!url) {
      setSheetStatus('warn', 'הדבק קישור של Google Sheets למעלה ואז לחץ טען.');
      return;
    }
    setSheetStatus(null);
    $('btnFetchSheet').disabled = true;
    $('btnFetchSheet').textContent = 'טוען…';
    try {
      const res = await fetch(`/api/sheet?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'PRIVATE_SHEET') {
          setSheetStatus('warn',
            '🔒 <b>נדרשת הרשאת צפייה לגיליון</b> – לחץ למטה או הדבק את התאים ישירות בתיבה.',
            true);
          if ($('dlgSheetPerm')) {
            $('dlgSheetPerm').showModal();
          }
        } else {
          setSheetStatus('warn', '⚠️ לא הצלחנו לקרוא את הקישור. ודא שזה קישור מלא של Google Sheets (docs.google.com/spreadsheets/d/...)');
        }
        return;
      }
      $('sheetRaw').value = data.csv || '';
      analyzeRawSheet($('sheetRaw').value);
      setSheetStatus('ok', '✅ הגיליון נטען בהצלחה! בדוק את הפריטים שזוהו למטה.');
    } catch {
      setSheetStatus('warn', '⚠️ שגיאת תקשורת בטעינת הגיליון. אפשר תמיד להעתיק-להדביק מהגיליון לתיבה למטה.');
    } finally {
      $('btnFetchSheet').disabled = false;
      $('btnFetchSheet').textContent = 'טען';
    }
  };
  if ($('permOpenSheet')) {
    $('permOpenSheet').onclick = () => {
      const u = $('sheetUrl').value.trim();
      if (/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(u)) {
        window.open(u, '_blank', 'noopener');
      }
    };
  }
  if ($('permRetry')) {
    $('permRetry').onclick = () => {
      $('dlgSheetPerm').close();
      $('btnFetchSheet').click();
    };
  }
  if ($('permPasteInstead')) {
    $('permPasteInstead').onclick = () => {
      $('dlgSheetPerm').close();
      $('sheetRaw').focus();
    };
  }
  $('btnSheetImport').onclick = () => {
    const chosen = [...$('sheetPreview').querySelectorAll('input:checked')].map((cb) => JSON.parse(cb.dataset.item));
    if (!chosen.length) return;
    addItems(chosen);
    $('dlgSheets').close();
  };
  $('btnExportCsv').onclick = () => {
    if (!list.length) { toast('הרשימה ריקה'); return; }
    const { activeChainId } = computeChainTotals();
    const csv = exportListToCsv(list, CHAIN_BY_ID, activeChainId);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smartcart-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('קובץ ה-CSV הורד – ניתן לפתוח ב-Google Sheets או Excel');
  };
  $('btnCopyTsv').onclick = async () => {
    if (!list.length) { toast('הרשימה ריקה'); return; }
    const { activeChainId } = computeChainTotals();
    const activeChainName = CHAIN_BY_ID[activeChainId]?.name || 'רשת';
    const lines = [['מחלקה', 'מוצר', 'כמות', 'יחידה', `מחיר (${activeChainName})`].join('\t')];
    for (const it of list.filter((i) => i.checked)) {
      const cat = CATEGORY_BY_ID[it.category]?.he || 'אחר';
      const pr = it.product?.chainPrices?.[activeChainId] ?? it.product?.price ?? '';
      lines.push([cat, it.name, it.qty, it.unit, typeof pr === 'number' ? pr.toFixed(2) : pr].join('\t'));
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    toast('הטבלה הועתקה! פתח Google Sheets והדבק (Ctrl+V)');
  };
}
$('btnAi').onclick = () => {
  if (!settings.apiKey) {
    toast('כדי להשתמש ב-AI הוסף מפתח Gemini בהגדרות');
    openSettings();
    return;
  }
  openPaste('ai');
};
$('pasteOk').addEventListener('click', async (e) => {
  const text = $('pasteText').value.trim();
  if (!text) return;
  if (pasteMode === 'paste') { addItems(parseMany(text)); return; }
  e.preventDefault();
  const btn = $('pasteOk');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> חושב…';
  try {
    const items = await aiToItems(text, settings);
    $('dlgPaste').close();
    addItems(items);
  } catch (err) {
    toast('שגיאת AI: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'צור רשימה';
  }
});

// ---------- recipes ----------
let curRecipe = null;
let servings = 4;
function openRecipes() {
  curRecipe = null;
  $('recipeGrid').hidden = false;
  $('recipeDetail').hidden = true;
  $('recipeAdd').hidden = true;
  const grid = $('recipeGrid');
  grid.innerHTML = '';
  for (const r of RECIPES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="e">${r.emoji}</span><span></span>`;
    b.lastChild.textContent = r.he;
    b.onclick = () => { curRecipe = r; servings = r.base; showRecipe(); };
    grid.append(b);
  }
  $('dlgRecipes').showModal();
}
function showRecipe() {
  $('recipeGrid').hidden = true;
  $('recipeDetail').hidden = false;
  $('recipeAdd').hidden = false;
  $('recipeName').textContent = `${curRecipe.emoji} ${curRecipe.he}`;
  $('servings').textContent = servings;
  const box = $('recipeItems');
  const prev = new Map([...box.querySelectorAll('input')].map((i) => [i.dataset.name, i.checked]));
  box.innerHTML = '';
  for (const it of scaleRecipe(curRecipe, servings)) {
    const l = document.createElement('label');
    const checked = prev.has(it.name) ? prev.get(it.name) : !it.staple;
    l.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}/><span></span><span class="q"></span>`;
    const input = l.querySelector('input');
    input.dataset.name = it.name;
    input.dataset.item = JSON.stringify(it);
    l.children[1].textContent = it.name;
    l.children[2].textContent = formatQty(it.qty, it.unit);
    box.append(l);
  }
}
document.querySelectorAll('#recipeDetail .step').forEach((b) => {
  b.onclick = () => { servings = Math.max(1, Math.min(30, servings + Number(b.dataset.d))); showRecipe(); };
});
$('btnRecipes').onclick = openRecipes;
$('recipeAdd').onclick = () => {
  const items = [...$('recipeItems').querySelectorAll('input:checked')].map((i) => JSON.parse(i.dataset.item));
  addItems(items);
};

// ---------- edit ----------
let editing = null;
const catSelect = $('editCat');
for (const c of CATEGORIES) catSelect.add(new Option(`${c.emoji} ${c.he}`, c.id));
function openEdit(it) {
  editing = it;
  $('editName').value = it.name;
  $('editQty').value = it.qty;
  $('editUnit').value = it.unit;
  catSelect.value = it.category;
  $('editNote').value = it.note || '';
  $('dlgEdit').showModal();
}
$('dlgEdit').addEventListener('close', () => {
  if ($('dlgEdit').returnValue !== 'ok' || !editing) return;
  const name = $('editName').value.trim() || editing.name;
  const cat = catSelect.value;
  if (cat !== editing.category || key(name) !== key(editing.name)) {
    overrides[key(name)] = cat;
    store.setCatOverrides(overrides);
  }
  Object.assign(editing, {
    name, category: cat,
    qty: Math.max(0.001, parseFloat($('editQty').value) || 1),
    unit: $('editUnit').value,
    note: $('editNote').value.trim(),
  });
  editing = null;
  saveList();
});

// ---------- settings ----------
function openSettings() {
  $('setKey').value = settings.apiKey || '';
  $('setModel').value = settings.model || 'gemini-2.5-flash';
  $('dlgSettings').showModal();
}
$('btnSettings').onclick = openSettings;
$('dlgSettings').addEventListener('close', () => {
  if ($('dlgSettings').returnValue !== 'ok') return;
  settings = { ...settings, apiKey: $('setKey').value.trim(), model: $('setModel').value.trim() || 'gemini-2.5-flash' };
  store.setSettings(settings);
  toast('נשמר');
});
$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `smart-list-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};
$('btnImport').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  try {
    store.importAll(JSON.parse(await e.target.files[0].text()));
    list = store.getList(); history = store.getHistory(); overrides = store.getCatOverrides(); mappings = store.getMappings();
    render();
    toast('הגיבוי שוחזר');
  } catch (err) { toast(err.message); }
};
$('btnResetHistory').onclick = () => {
  if (!confirm('למחוק את כל היסטוריית הקניות?')) return;
  history = {}; store.setHistory(history); render(); toast('ההיסטוריה נמחקה');
};

// ---------- Location & Delivery UI ----------
if ($('citiesList')) {
  for (const city of Object.keys(CITY_DELIVERY_PROFILES)) {
    const opt = document.createElement('option');
    opt.value = city;
    $('citiesList').append(opt);
  }
}
if ($('locInput')) {
  $('locInput').value = userLocation;
  $('locInput').addEventListener('input', () => {
    userLocation = $('locInput').value.trim();
    chainAvailOverrides = {}; // reset manual overrides when changing city
    settings = { ...settings, userLocation, chainAvailOverrides };
    store.setSettings(settings);
    render();
  });
}
if ($('btnGeo')) {
  $('btnGeo').onclick = () => {
    if (!navigator.geolocation) {
      toast('דפדפן זה אינו תומך בזיהוי מיקום');
      return;
    }
    $('btnGeo').textContent = '⏳ מזהה…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=he`);
          const data = await res.json();
          const city = data?.address?.city || data?.address?.town || data?.address?.village || data?.address?.municipality || '';
          if (city) {
            userLocation = city;
            if ($('locInput')) $('locInput').value = city;
            chainAvailOverrides = {};
            settings = { ...settings, userLocation, chainAvailOverrides };
            store.setSettings(settings);
            render();
            toast(`📍 זוהה יישוב: ${city}`);
          } else {
            toast('לא הצלחנו לזהות את שם היישוב – הקלד אותו ידנית');
          }
        } catch {
          toast('שגיאה בזיהוי היישוב');
        } finally {
          $('btnGeo').textContent = '🎯 זהה מיקום';
        }
      },
      () => {
        $('btnGeo').textContent = '🎯 זהה מיקום';
        toast('אשר הרשאת מיקום בדפדפן או הקלד את שם היישוב');
      },
      { timeout: 8000 },
    );
  };
}
if ($('incDelivery')) {
  $('incDelivery').checked = includeDelivery;
  $('incDelivery').onchange = (e) => {
    includeDelivery = e.target.checked;
    settings = { ...settings, includeDelivery };
    store.setSettings(settings);
    render();
  };
}
if ($('sortCheapest') && $('sortFastest')) {
  const syncSortBtns = () => {
    $('sortCheapest').classList.toggle('active-auto', sortPreference === 'cheapest');
    $('sortFastest').classList.toggle('active-auto', sortPreference === 'fastest');
  };
  syncSortBtns();
  $('sortCheapest').onclick = () => {
    sortPreference = 'cheapest';
    selectedChainMode = 'auto';
    settings = { ...settings, sortPreference, selectedChain: 'auto' };
    store.setSettings(settings);
    syncSortBtns();
    render();
  };
  $('sortFastest').onclick = () => {
    sortPreference = 'fastest';
    selectedChainMode = 'auto';
    settings = { ...settings, sortPreference, selectedChain: 'auto' };
    store.setSettings(settings);
    syncSortBtns();
    render();
  };
}

// ---------- Account bar (email hint only, never passwords) ----------
if (settings.shufPass) {
  delete settings.shufPass;
  store.setSettings(settings);
}
if ($('shufUser')) {
  $('shufUser').value = settings.shufUser || '';
  $('shufUser').addEventListener('input', () => {
    settings = { ...settings, shufUser: $('shufUser').value.trim() };
    store.setSettings(settings);
  });
}

// ---------- Send to Selected Supermarket ----------
async function ensureProductsChosen(items) {
  // Concurrency-limited to 3 at a time
  const queue = [...items];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const it = queue.shift();
      if (it.product && it.product.code) continue;
      const opts = await fetchOptions(it.searchQuery || it.name);
      if (Array.isArray(opts) && opts.length) {
        it.product = opts.find((p) => p.inStock) || opts[0];
        mappings[key(it.name)] = it.product;
      }
    }
  });
  await Promise.all(workers);
  store.setMappings(mappings);
  store.setList(list);
}

async function chainOrderLink(includeEmailHint = true) {
  const { activeChainId } = computeChainTotals();
  const chain = CHAIN_BY_ID[activeChainId] || CHAINS[0];
  const checkedItems = list.filter((i) => i.checked);
  await ensureProductsChosen(checkedItems);
  const items = checkedItems.map((i) => {
    const prod = i.product ? {
      ...i.product,
      code: (i.product.chainCodes && i.product.chainCodes[activeChainId]) || i.product.code,
    } : null;
    return {
      ...i,
      name: i.note ? `${i.name} ${i.note}` : i.name,
      product: prod,
    };
  });
  const auth = {
    user: includeEmailHint ? (settings.shufUser || '') : '',
    chain: activeChainId,
  };
  return chain.url + '#smartlist=' + (await SLCodec.encodeList(items, auth));
}

function recordIfWanted() {
  if ($('sendRecord') && !$('sendRecord').checked) return;
  history = recordPurchase(history, list.filter((i) => i.checked), key);
  store.setHistory(history);
}

$('btnSend').onclick = async () => {
  const { activeChainId } = computeChainTotals();
  const chain = CHAIN_BY_ID[activeChainId] || CHAINS[0];
  if (isMobile) {
    $('sendDesktop').hidden = true;
    $('sendMobile').hidden = false;
    $('sendGo').hidden = true;
    $('dlgSend').showModal();
    return;
  }
  const btn = $('btnSend');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = `${chain.emoji} שולח סל ל${chain.name}…`;
  try {
    const url = await chainOrderLink(true);
    recordIfWanted();
    window.open(url, '_blank', 'noopener');
    render();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
    render();
  }
};
$('sendGo').onclick = async () => {
  const url = await chainOrderLink(true);
  recordIfWanted();
  window.open(url, '_blank', 'noopener');
  $('dlgSend').close();
  render();
};
$('sendCopy').onclick = async () => {
  const url = await chainOrderLink(false);
  await navigator.clipboard.writeText(url);
  recordIfWanted();
  toast('הקישור הועתק – פתח אותו בכרום במחשב');
};
$('sendWa').onclick = async () => {
  const url = await chainOrderLink(false);
  recordIfWanted();
  window.open('https://wa.me/?text=' + encodeURIComponent('🛒 הסל המשתלם שלי (לפתוח בכרום במחשב):\n' + url), '_blank', 'noopener');
};

// ---------- share ----------
function listAsText() {
  const { totals, cheapestId } = computeChainTotals();
  const cheapest = CHAIN_BY_ID[cheapestId];
  const lines = ['🛒 רשימת קניות – העגלה החכמה'];
  if (totals[cheapestId] > 0) {
    lines.push(`🏆 הסל המשתלם ביותר: ${cheapest.name} (₪${totals[cheapestId].toFixed(2)})`);
  }
  for (const cat of CATEGORIES) {
    const items = list.filter((i) => i.checked && (CATEGORY_BY_ID[i.category] ? i.category : 'other') === cat.id);
    if (!items.length) continue;
    lines.push('', `${cat.emoji} ${cat.he}`);
    for (const i of items) {
      const brand = i.product?.brand ? ` [${i.product.brand}]` : '';
      lines.push(`• ${i.name}${brand}${i.qty !== 1 || i.unit !== 'unit' ? ' – ' + formatQty(i.qty, i.unit) : ''}${i.note ? ` (${i.note})` : ''}`);
    }
  }
  return lines.join('\n');
}
async function appLink() {
  return location.origin + location.pathname + '#import=' + (await SLCodec.encodeList(list.filter((i) => i.checked)));
}
$('btnShare').onclick = () => {
  $('shareNative').hidden = !navigator.share;
  $('dlgShare').showModal();
};
$('shareWaText').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(listAsText()), '_blank', 'noopener');
$('shareLink').onclick = async () => { await navigator.clipboard.writeText(await appLink()); toast('הקישור הועתק'); };
$('shareNative').onclick = async () => {
  try { await navigator.share({ title: 'רשימת קניות', text: listAsText(), url: await appLink() }); } catch {}
};

$('btnClear').onclick = () => {
  if (!list.length) return;
  const before = list;
  const hasUnchecked = list.some((i) => !i.checked);
  list = hasUnchecked ? list.filter((i) => i.checked) : [];
  saveList();
  toast(hasUnchecked ? 'הפריטים הלא-מסומנים נמחקו' : 'הרשימה נוקתה', { label: 'בטל', fn: () => { list = before; saveList(); } });
};

// ---------- import from link ----------
async function importFromHash() {
  const m = location.hash.match(/import=([^&]+)/);
  if (!m) return;
  window.history.replaceState(null, '', location.pathname + location.search);
  try {
    const items = await SLCodec.decodeList(m[1]);
    if (list.length && confirm(`התקבלה רשימה עם ${items.length} מוצרים.\nאישור = להחליף את הרשימה הנוכחית, ביטול = למזג.`)) list = [];
    addItems(items);
  } catch {
    toast('קישור לא תקין');
  }
}

// ---------- boot ----------
render();
importFromHash();
window.addEventListener('hashchange', importFromHash);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
