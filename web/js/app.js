import { parseItem, parseMany, normalizeName, formatQty } from './parser.js';
import { CATEGORIES, CATEGORY_BY_ID, categorize } from './categories.js';
import { store } from './store.js';
import { recordPurchase, runningOut, frequent, STARTER_ITEMS } from './suggest.js';
import { RECIPES, scaleRecipe } from './recipes.js';
import { aiToItems } from './ai.js';
import { parseGrid, analyzeSheetGrid, exportListToCsv } from './sheets.js';
import { CHAINS, CHAIN_BY_ID, LIVE_CHAIN_IDS } from './chains.js';
import { compareBasket, lineCost } from './pricing.js';
import {
  loadMeta,
  loadCities,
  loadChainCatalog,
  loadBranchPrices,
  findMatchingCity,
  branchesInCity,
  searchCatalogProducts,
  matchLineAcrossChains,
} from './prices.js';

export { CHAINS };

const $ = (id) => document.getElementById(id);
const key = normalizeName;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

let list = store.getList();
let history = store.getHistory();
let overrides = store.getCatOverrides();
let mappings = store.getMappings();
let settings = store.getSettings();

// Selected chain: 'auto' (picks cheapest complete chain) or a live chain id ('shufersal', 'ramilevy', 'carrefour')
let selectedChainMode = settings.selectedChain === 'auto' || LIVE_CHAIN_IDS.includes(settings.selectedChain)
  ? settings.selectedChain
  : 'auto';
let userLocation = settings.userLocation || '';
let includeDelivery = settings.includeDelivery !== false;

let deliveryConfig = { lastChecked: null, chains: {} };
let sponsoredCodes = new Set();

let priceMeta = null;
let citiesIndex = null;
let activeCity = '';
let selectedBranches = (settings.selectedBranches && typeof settings.selectedBranches === 'object') ? settings.selectedBranches : {};
let activeBranchData = {};
let loadingBranches = false;
let feedLoadError = '';
let branchLoadSeq = 0;

const QUICK_CITIES = ['הרצליה', 'ירושלים', 'תל אביב-יפו', 'חיפה', 'באר שבע', 'ראשון לציון'];

const searchCache = new Map();
const openPickers = new Set();

// Drop any legacy estimated/invented items cached in localStorage from older versions
let cleanedLegacy = false;
for (const [mk, mp] of Object.entries(mappings)) {
  if (mp?.estimated) { delete mappings[mk]; cleanedLegacy = true; }
}
if (cleanedLegacy) store.setMappings(mappings);

for (const it of list) {
  if (it.checked === undefined) it.checked = true;
  if (it.product?.estimated) it.product = null;
  if (!it.product && mappings[key(it.name)]) it.product = mappings[key(it.name)];
}

async function loadStaticConfigs() {
  try {
    const [delRes, spRes] = await Promise.all([
      fetch('./data/delivery.json'),
      fetch('./data/sponsored.json'),
    ]);
    if (delRes.ok) {
      const d = await delRes.json();
      if (d && typeof d === 'object') deliveryConfig = d;
    }
    if (spRes.ok) {
      const sp = await spRes.json();
      if (sp && sp.enabled && Array.isArray(sp.placements)) {
        sponsoredCodes = new Set(sp.placements.map((x) => String(x?.code || x || '')).filter(Boolean));
      }
    }
    if ($('deliveryCheckedNote') && deliveryConfig.lastChecked) {
      $('deliveryCheckedNote').textContent = `(נכון ל-${deliveryConfig.lastChecked})`;
    }
    render();
  } catch {}
}

function isSponsoredProduct(p) {
  if (!p || !sponsoredCodes.size) return false;
  return sponsoredCodes.has(String(p.barcode || '')) || sponsoredCodes.has(String(p.code || ''));
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

function hasAnyLoadedBranch() {
  return LIVE_CHAIN_IDS.some((cid) => activeBranchData[cid]?.catalog && activeBranchData[cid]?.storePrices);
}

function searchProductsInActiveBranches(query) {
  const q = String(query || '').trim();
  if (!q || !hasAnyLoadedBranch()) return [];
  if (searchCache.has(q)) return searchCache.get(q);
  const results = searchCatalogProducts(q, activeBranchData, { limit: 12 });
  searchCache.set(q, results);
  return results;
}

function formatPromoBadge(promo) {
  if (!promo) return '';
  if (promo.type === 'bundle') return `🏷️ ${promo.qty} ב-₪${promo.price.toFixed(2)}`;
  if (promo.type === 'price') return `🏷️ מבצע ₪${promo.price.toFixed(2)}`;
  return '';
}

// Compute real totals per supermarket chain across all checked items (never invents missing prices)
function computeChainTotals() {
  const checked = list.filter((i) => i.checked);
  const lines = [];
  const lineMatches = new Map();
  for (const it of checked) {
    const matches = matchLineAcrossChains(it, activeBranchData);
    lineMatches.set(it.id, matches);
    lines.push({ id: it.id, qty: it.qty, unit: it.unit, matches });
  }

  const cmp = compareBasket(lines, LIVE_CHAIN_IDS, deliveryConfig.chains || {}, { includeDelivery });
  const totals = Object.fromEntries(CHAINS.map((c) => [c.id, cmp.perChain[c.id]?.total || 0]));
  const bestAutoId = cmp.cheapestId || cmp.ranking.find((id) => cmp.perChain[id]?.hasData) || LIVE_CHAIN_IDS[0];
  const activeChainId = selectedChainMode === 'auto'
    ? bestAutoId
    : (LIVE_CHAIN_IDS.includes(selectedChainMode) ? selectedChainMode : bestAutoId);
  return {
    ...cmp,
    totals,
    lineMatches,
    checkedCount: checked.length,
    activeChainId,
  };
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
    for (const it of items) sec.append(renderItem(it, activeChainId, calc.lineMatches));
    box.append(sec);
  }
  $('emptyState').hidden = list.length > 0;
  const toSend = list.filter((i) => i.checked).length;
  const activeInfo = calc.perChain[activeChainId];
  const activeTotal = activeInfo?.hasData ? activeInfo.total : 0;
  const partialTag = activeInfo && !activeInfo.complete ? ' (חלקי)' : '';
  const delLabel = includeDelivery && typeof activeInfo?.deliveryFee === 'number' ? ' כולל משלוח' : '';
  const priceTag = activeTotal > 0 ? ` · ₪${activeTotal.toFixed(2)}${partialTag}${delLabel}` : '';
  const sendVerb = activeChain.cartFill === 'none' ? 'פתח את אתר' : 'שלח סל ל';
  $('btnSend').innerHTML = `${activeChain.emoji} ${sendVerb}<b>${activeChain.name}</b> <span id="sendCount">${toSend ? `(${toSend} מוצרים${priceTag})` : ''}</span>`;
  $('btnSend').disabled = toSend === 0;
  renderSuggestions();
}

function renderComparisonDashboard(calc) {
  const { perChain, cheapestId, savings, checkedCount, activeChainId } = calc;
  const grid = $('chainGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const hasItems = checkedCount > 0;
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

  const locText = activeCity ? ` ב${activeCity}` : '';
  if ($('compareSummary')) {
    if (feedLoadError) {
      $('compareSummary').textContent = `⚠️ ${feedLoadError}`;
    } else if (!activeCity) {
      $('compareSummary').textContent = 'בחר עיר למעלה (למשל הרצליה, ירושלים או תל אביב-יפו) כדי לטעון מחירי סניפים רשמיים:';
    } else if (loadingBranches) {
      $('compareSummary').textContent = `⏳ טוען קטלוג ומחירי סניפים${locText}…`;
    } else if (!hasItems) {
      $('compareSummary').textContent = `הוסף מוצרים לרשימה להשוואת סלים אמיתית${locText}:`;
    } else if (cheapestId) {
      const ch = CHAIN_BY_ID[cheapestId];
      const info = perChain[cheapestId];
      const branchName = activeBranchData[cheapestId]?.store?.name;
      const brLabel = branchName ? ` (${branchName})` : '';
      const delNote = includeDelivery && typeof info.deliveryFee === 'number' ? ' כולל משלוח' : '';
      const savNote = savings > 0 ? ` – חיסכון של ₪${savings.toFixed(2)}` : '';
      $('compareSummary').textContent = `🏆 הסל המלא הזול ביותר${locText}: ${ch.name}${brLabel} – ₪${info.total.toFixed(2)}${delNote}${savNote}`;
    } else {
      $('compareSummary').textContent = `⚠️ באף רשת${locText} אין מחיר מלא לכל המוצרים שנבחרו (סלים חלקיים מסומנים למטה):`;
    }
  }

  const cityBranchesByChain = activeCity && citiesIndex ? branchesInCity(activeCity, citiesIndex) : null;

  for (const c of CHAINS) {
    if (c.status === 'soon') {
      const card = document.createElement('div');
      card.className = 'chain-card soon';
      const badge = document.createElement('span');
      badge.className = 'chain-badge soon';
      badge.textContent = 'בקרוב';
      const name = document.createElement('span');
      name.className = 'chain-name';
      name.textContent = `${c.emoji} ${c.name}`;
      const price = document.createElement('span');
      price.className = 'chain-total';
      price.textContent = '—';
      const note = document.createElement('span');
      note.className = 'chain-diff';
      note.textContent = 'בקרוב מקובצי השקיפות';
      card.append(badge, name, price, note);
      grid.append(card);
      continue;
    }

    const info = perChain[c.id];
    const delCfg = deliveryConfig.chains?.[c.id] || {};
    const branchObj = activeBranchData[c.id]?.store || null;
    const noBranchInCity = Boolean(activeCity && cityBranchesByChain && cityBranchesByChain[c.id]?.length === 0);
    const isCheapest = hasItems && !noBranchInCity && c.id === cheapestId;
    const isSelected = c.id === activeChainId;

    const card = document.createElement('div');
    card.className = 'chain-card'
      + (isSelected ? ' selected' : '')
      + (isCheapest ? ' cheapest' : '')
      + (noBranchInCity ? ' unavailable' : '');

    if (noBranchInCity) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge no-area';
      badge.textContent = 'אין סניף בעיר';
      card.append(badge);
    } else if (isCheapest) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge';
      badge.textContent = '🏆 הכי זול!';
      card.append(badge);
    } else if (hasItems && !info.complete && info.hasData) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge partial';
      badge.textContent = `חלקי – ${info.missing.length} מוצרים חסרים`;
      card.append(badge);
    } else if (hasItems && activeCity && !loadingBranches && !info.hasData) {
      const badge = document.createElement('span');
      badge.className = 'chain-badge no-area';
      badge.textContent = 'אין נתון';
      card.append(badge);
    }

    const name = document.createElement('span');
    name.className = 'chain-name';
    name.textContent = `${c.emoji} ${c.name}`;
    card.append(name);

    if (branchObj) {
      const br = document.createElement('span');
      br.className = 'chain-branch';
      br.title = `${branchObj.name}${branchObj.address ? ' · ' + branchObj.address : ''}`;
      br.textContent = `📍 ${branchObj.name}`;
      card.append(br);
    }

    const price = document.createElement('span');
    price.className = 'chain-total';
    price.textContent = hasItems && info.hasData ? `₪${info.total.toFixed(2)}` : '—';
    card.append(price);

    if (hasItems && info.hasData) {
      const bd = document.createElement('span');
      bd.className = 'chain-breakdown';
      let delText = 'ללא דמי משלוח';
      if (includeDelivery) {
        if (info.deliveryFee === null) delText = 'משלוח: לא ידוע';
        else if (info.deliveryFee === 0) delText = 'משלוח חינם';
        else delText = `משלוח: ₪${info.deliveryFee.toFixed(2)}`;
      }
      bd.textContent = `מוצרים: ₪${info.subtotal.toFixed(2)} · ${delText}`;
      card.append(bd);

      if (info.promoSavings > 0) {
        const ps = document.createElement('span');
        ps.className = 'chain-breakdown ok-txt';
        ps.textContent = `🏷️ חיסכון מבצעים: ₪${info.promoSavings.toFixed(2)}`;
        card.append(ps);
      }
      if (info.substitutes.length > 0) {
        const sb = document.createElement('span');
        sb.className = 'chain-breakdown';
        sb.textContent = `כולל ${info.substitutes.length} חלופות`;
        card.append(sb);
      }
      if (info.estimated.length > 0) {
        const est = document.createElement('span');
        est.className = 'chain-breakdown';
        est.textContent = `* הערכת משקל ל-${info.estimated.length} פריטים`;
        card.append(est);
      }
    }

    const diffEl = document.createElement('span');
    diffEl.className = 'chain-diff' + (isCheapest ? ' win' : '');
    if (noBranchInCity) {
      diffEl.textContent = `לא נמצא סניף ב${activeCity}`;
    } else if (!activeCity) {
      diffEl.textContent = 'בחר עיר לטעינת מחירים';
    } else if (!hasItems) {
      if (typeof delCfg.fee === 'number') {
        const freeTxt = typeof delCfg.freeOver === 'number' ? ` (חינם מ-₪${delCfg.freeOver})` : '';
        const chkTxt = deliveryConfig.lastChecked ? ` · נכון ל-${deliveryConfig.lastChecked}` : '';
        diffEl.textContent = `משלוח: ₪${delCfg.fee.toFixed(2)}${freeTxt}${chkTxt}`;
      } else {
        diffEl.textContent = 'דמי משלוח: לא ידוע (לפי כתובת)';
      }
    } else if (!info.hasData) {
      diffEl.textContent = loadingBranches ? 'טוען מחירים…' : 'אין נתון למוצרים שנבחרו';
    } else if (!info.complete) {
      diffEl.textContent = `סה״כ חלקי (${info.priced}/${checkedCount} מוצרים)`;
    } else if (isCheapest) {
      diffEl.textContent = savings > 0 ? `חוסך ₪${savings.toFixed(2)}` : 'סל מלא';
    } else if (cheapestId) {
      const diff = info.total - perChain[cheapestId].total;
      diffEl.textContent = `+₪${diff.toFixed(2)} מהזול`;
    } else {
      diffEl.textContent = 'סל מלא';
    }
    card.append(diffEl);

    if (!noBranchInCity) {
      card.onclick = () => {
        selectedChainMode = c.id;
        settings = { ...settings, selectedChain: c.id };
        store.setSettings(settings);
        render();
        pushFamilyRoom();
      };
    }
    grid.append(card);
  }
}

function renderItem(it, activeChainId, allLineMatches) {
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

  const pickerOpen = openPickers.has(it.id);
  const matches = (allLineMatches && allLineMatches.get(it.id)) || (it.checked ? matchLineAcrossChains(it, activeBranchData) : {});
  const activeMatch = matches[activeChainId] || null;

  if (!pickerOpen && it.checked) {
    const p = it.product;
    const cp = document.createElement('div');
    cp.className = 'chosen-prod';
    if (p?.img && window.SLCodec?.isSafeImgUrl(p.img)) {
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
    if (p) {
      cpName.textContent = p.name;
    } else if (activeMatch?.productName) {
      cpName.textContent = `לפי שם ב${CHAIN_BY_ID[activeChainId]?.name || 'רשת'}: ${activeMatch.productName}`;
    } else {
      cpName.textContent = activeCity ? 'טרם נבחר מוצר ספציפי' : 'בחר עיר למעלה להשוואת מחירים';
    }

    const meta = document.createElement('div');
    meta.className = 'cp-meta';
    if (p && isSponsoredProduct(p)) {
      const sp = document.createElement('span');
      sp.className = 'cp-spons';
      sp.textContent = '⭐ ממומן';
      meta.append(sp);
    }
    const brandTxt = p?.brand || activeMatch?.brand || '';
    if (brandTxt) {
      const b = document.createElement('span');
      b.className = 'cp-brand';
      b.textContent = brandTxt;
      meta.append(b);
    }
    if (p?.unitDesc) meta.append(document.createTextNode(p.unitDesc));

    if (activeMatch) {
      const activeLine = lineCost(it, activeMatch);
      if (activeMatch.kind === 'substitute') {
        const sub = document.createElement('span');
        sub.className = 'sub-tag';
        sub.textContent = `חלופה: ${activeMatch.productName}`;
        meta.append(sub);
      }
      const promoLabel = formatPromoBadge(activeMatch.promo);
      if (promoLabel) {
        const pt = document.createElement('span');
        pt.className = 'promo-tag';
        pt.textContent = promoLabel;
        meta.append(pt);
      }
      const pr = document.createElement('span');
      pr.className = 'cp-price';
      pr.textContent = `₪${activeLine ? activeLine.cost.toFixed(2) : activeMatch.price.toFixed(2)}`
        + (activeLine?.estimated ? ' (הערכת משקל)' : '');
      meta.append(pr);
    } else if (activeCity && !loadingBranches) {
      const pr = document.createElement('span');
      pr.className = 'cp-price';
      pr.textContent = 'אין נתון';
      meta.append(pr);
    }
    info.append(cpName, meta);

    if (activeCity && hasAnyLoadedBranch()) {
      const pills = document.createElement('div');
      pills.className = 'chain-pills';
      for (const cid of LIVE_CHAIN_IDS) {
        const c = CHAIN_BY_ID[cid];
        const m = matches[cid];
        const pill = document.createElement('span');
        pill.className = 'chain-pill'
          + (cid === activeChainId ? ' active' : '')
          + (!m ? ' missing' : '')
          + (m?.kind === 'substitute' ? ' sub' : '');
        if (!m) {
          pill.textContent = `${c.name}: אין נתון`;
        } else {
          const lc = lineCost(it, m);
          const subTxt = m.kind === 'substitute' ? ' (חלופה)' : '';
          const prmTxt = lc && lc.savings > 0 ? ' 🏷️' : '';
          pill.textContent = `${c.name}: ₪${(lc ? lc.cost : m.price).toFixed(2)}${subTxt}${prmTxt}`;
          if (m.productName) pill.title = m.productName;
        }
        pills.append(pill);
      }
      info.append(pills);
    }

    const chg = document.createElement('button');
    chg.type = 'button';
    chg.className = 'change-btn';
    chg.textContent = p ? 'החלף מוצר' : 'בחר מוצר';
    chg.onclick = () => {
      if (!activeCity) {
        toast('בחר עיר למעלה תחילה כדי לחפש בקטלוג הסניפים');
        $('locInput')?.focus();
        return;
      }
      openPickers.add(it.id);
      render();
    };
    cp.append(info, chg);
    row.append(cp);
  } else if (pickerOpen && it.checked) {
    const q = (it.searchQuery || it.name || '').trim();
    const results = searchProductsInActiveBranches(q);
    const box = document.createElement('div');
    box.className = 'picker-box';

    const head = document.createElement('div');
    head.className = 'picker-head';
    head.innerHTML = `<span>🏢 בחר מוצר מדויק מהסניפים שנבחרו (ברקוד משותף בין הרשתות):</span>`;
    const searchWrap = document.createElement('div');
    searchWrap.className = 'picker-search';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = q;
    inp.placeholder = 'שם מוצר או ברקוד…';
    const btnSearch = document.createElement('button');
    btnSearch.type = 'button';
    btnSearch.textContent = '🔍';
    const doSearch = () => {
      it.searchQuery = inp.value.trim() || it.name;
      searchCache.delete(it.searchQuery);
      render();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } };
    btnSearch.onclick = doSearch;
    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.textContent = 'סגור';
    btnClose.onclick = () => { openPickers.delete(it.id); render(); };
    searchWrap.append(inp, btnSearch, btnClose);
    if (it.product) {
      const btnUnpin = document.createElement('button');
      btnUnpin.type = 'button';
      btnUnpin.textContent = 'בטל נעילה';
      btnUnpin.onclick = () => {
        it.product = null;
        delete mappings[key(it.name)];
        store.setMappings(mappings);
        openPickers.delete(it.id);
        saveList();
      };
      searchWrap.append(btnUnpin);
    }
    head.append(searchWrap);
    box.append(head);

    if (loadingBranches) {
      const loading = document.createElement('div');
      loading.className = 'muted';
      loading.textContent = 'טוען קטלוג סניפים…';
      box.append(loading);
    } else if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'לא נמצאו תוצאות בסניפים שנבחרו. נסה מילה אחרת או ברקוד.';
      box.append(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'brand-grid';
      for (const p of results) {
        const sponsored = isSponsoredProduct(p);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'brand-card' + (sponsored ? ' sponsored' : '');
        if (sponsored) {
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
        const priceParts = [];
        for (const cid of LIVE_CHAIN_IDS) {
          if (typeof p.chainPrices?.[cid] === 'number') {
            priceParts.push(`${CHAIN_BY_ID[cid].name}: ₪${p.chainPrices[cid].toFixed(2)}`);
          }
        }
        const pr = document.createElement('span');
        pr.className = 'bc-price';
        pr.textContent = priceParts.join(' · ') || 'אין נתון';
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

// ---------- Real-Time Family Sync (feature-flagged: local dev only until DB-backed in Phase 2) ----------
const FEATURES = {
  familySync: location.hostname === 'localhost' || location.hostname === '127.0.0.1',
};

function isValidRoomId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(id);
}

function generateRoomId() {
  const bytes = new Uint8Array(12); // 96-bit CSPRNG -> 24 hex chars
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeRoomList(rawList) {
  if (!Array.isArray(rawList)) return null;
  const out = [];
  for (const raw of rawList.slice(0, 200)) {
    if (!raw || typeof raw !== 'object') continue;
    const cleanName = String(raw.name || '').trim().slice(0, 120);
    if (!cleanName) continue;
    const unit = ['unit', 'kg', 'g', 'pack'].includes(raw.unit) ? raw.unit : 'unit';
    const qty = Math.max(0.01, Math.min(1000, Number(raw.qty) || 1));
    const catId = String(raw.category || '').slice(0, 30);
    let product = window.SLCodec?.sanitizeProduct ? window.SLCodec.sanitizeProduct(raw.product) : null;
    if (product && raw.product?.chainPrices && typeof raw.product.chainPrices === 'object') {
      const cp = {};
      for (const cid of LIVE_CHAIN_IDS) {
        const v = Number(raw.product.chainPrices[cid]);
        if (Number.isFinite(v) && v > 0 && v < 100000) cp[cid] = Math.round(v * 100) / 100;
      }
      product = { ...product, chainPrices: cp };
    }
    out.push({
      id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : uid(),
      name: cleanName,
      qty,
      unit,
      category: CATEGORY_BY_ID[catId] ? catId : catFor(cleanName),
      note: String(raw.note || '').trim().slice(0, 120),
      checked: raw.checked !== false,
      product,
      addedAt: Number.isFinite(Number(raw.addedAt)) ? Number(raw.addedAt) : Date.now(),
    });
  }
  return out;
}

const urlParams = new URLSearchParams(location.search);
const initialRoomParam = urlParams.get('room') || settings.familyRoomId || '';
let currentRoomId = FEATURES.familySync && isValidRoomId(initialRoomParam) ? initialRoomParam : '';
let lastRoomUpdatedAt = 0;
let roomPollTimer = null;

function syncRoomPolling() {
  if (roomPollTimer) {
    clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
  if (FEATURES.familySync && currentRoomId) {
    roomPollTimer = setInterval(pollFamilyRoom, 2500);
  }
}

function updateFamilyBanner() {
  if ($('btnFamily')) $('btnFamily').hidden = !FEATURES.familySync;
  if ($('shareFamilyRoom')) $('shareFamilyRoom').hidden = !FEATURES.familySync;
  const banner = $('familyBanner');
  if (!banner) return;
  const active = FEATURES.familySync && Boolean(currentRoomId);
  banner.hidden = !active;
  if (active) {
    $('familyText').textContent = `🟢 חדר משפחתי מקומי (#${currentRoomId.slice(0, 8)}…) – מתעדכן בזמן אמת`;
  }
}

async function pushFamilyRoom() {
  if (!FEATURES.familySync || !currentRoomId) return;
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
  if (!FEATURES.familySync || !currentRoomId) return;
  try {
    const res = await fetch(`/api/room?id=${encodeURIComponent(currentRoomId)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.updatedAt && data.updatedAt > lastRoomUpdatedAt) {
      const cleanList = sanitizeRoomList(data.list);
      if (!cleanList) return;
      lastRoomUpdatedAt = data.updatedAt;
      list = cleanList;
      if (data.selectedChain === 'auto' || LIVE_CHAIN_IDS.includes(data.selectedChain)) {
        selectedChainMode = data.selectedChain;
      }
      store.setList(list);
      render();
    }
  } catch {}
}

function startOrCopyFamilyRoom() {
  if (!FEATURES.familySync) return;
  if (!currentRoomId) {
    currentRoomId = generateRoomId();
    settings = { ...settings, familyRoomId: currentRoomId };
    store.setSettings(settings);
    const newUrl = `${location.pathname}?room=${currentRoomId}${location.hash}`;
    window.history.replaceState(null, '', newUrl);
    updateFamilyBanner();
    syncRoomPolling();
    pushFamilyRoom();
  }
  const shareUrl = `${location.origin}${location.pathname}?room=${currentRoomId}`;
  navigator.clipboard.writeText(shareUrl).catch(() => {});
  toast('🔗 קישור החדר המשפחתי הועתק!');
}

if (FEATURES.familySync) {
  if ($('btnFamily')) $('btnFamily').onclick = startOrCopyFamilyRoom;
  if ($('btnCopyRoom')) $('btnCopyRoom').onclick = startOrCopyFamilyRoom;
  if ($('shareFamilyRoom')) $('shareFamilyRoom').onclick = () => { $('dlgShare').close(); startOrCopyFamilyRoom(); };
  if ($('btnLeaveRoom')) {
    $('btnLeaveRoom').onclick = () => {
      currentRoomId = '';
      delete settings.familyRoomId;
      store.setSettings(settings);
      window.history.replaceState(null, '', location.pathname);
      syncRoomPolling();
      updateFamilyBanner();
      toast('יצאת מהחדר המשפחתי');
    };
  }
}
updateFamilyBanner();
syncRoomPolling();
if (FEATURES.familySync && currentRoomId) pollFamilyRoom();

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
    const { activeChainId, lineMatches } = computeChainTotals();
    const enriched = list.map((it) => {
      const m = lineMatches.get(it.id)?.[activeChainId];
      if (!m) return it;
      const lc = lineCost(it, m);
      return {
        ...it,
        product: {
          ...(it.product || {}),
          name: it.product?.name || m.productName || '',
          brand: it.product?.brand || m.brand || '',
          chainPrices: { ...(it.product?.chainPrices || {}), [activeChainId]: lc ? lc.cost : m.price },
        },
      };
    });
    const csv = exportListToCsv(enriched, CHAIN_BY_ID, activeChainId);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smartcart-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('קובץ ה-CSV הורד – ניתן לפתוח ב-Google Sheets או Excel');
  };
  $('btnCopyTsv').onclick = async () => {
    if (!list.length) { toast('הרשימה ריקה'); return; }
    const { activeChainId, lineMatches } = computeChainTotals();
    const activeChainName = CHAIN_BY_ID[activeChainId]?.name || 'רשת';
    const lines = [['מחלקה', 'מוצר', 'כמות', 'יחידה', `סה״כ שורה (${activeChainName})`].join('\t')];
    for (const it of list.filter((i) => i.checked)) {
      const cat = CATEGORY_BY_ID[it.category]?.he || 'אחר';
      const m = lineMatches.get(it.id)?.[activeChainId];
      const lc = m ? lineCost(it, m) : null;
      lines.push([cat, it.name, it.qty, it.unit, lc ? lc.cost.toFixed(2) : ''].join('\t'));
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

// ---------- Location, Branch Pickers & Price Transparency Loader ----------
function renderQuickCities() {
  const box = $('quickCities');
  if (!box) return;
  if (!citiesIndex || activeCity) {
    box.hidden = true;
    return;
  }
  box.innerHTML = '';
  const lbl = document.createElement('span');
  lbl.textContent = 'ערים נפוצות:';
  box.append(lbl);
  for (const c of QUICK_CITIES) {
    if (!citiesIndex[c]) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-btn';
    b.textContent = c;
    b.onclick = () => {
      userLocation = c;
      if ($('locInput')) $('locInput').value = c;
      settings = { ...settings, userLocation };
      store.setSettings(settings);
      syncCitySelection(c);
    };
    box.append(b);
  }
  box.hidden = false;
}

function renderBranchPickers() {
  const box = $('branchPickers');
  if (!box) return;
  if (!activeCity || !citiesIndex) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const byChain = branchesInCity(activeCity, citiesIndex);
  if (!selectedBranches[activeCity]) selectedBranches[activeCity] = {};

  box.innerHTML = '';
  for (const cid of LIVE_CHAIN_IDS) {
    const ch = CHAIN_BY_ID[cid];
    const branches = byChain[cid] || [];
    const wrap = document.createElement('div');
    wrap.className = 'branch-picker';
    const title = document.createElement('b');
    title.textContent = `${ch.emoji} ${ch.name} · סניף ▾`;
    wrap.append(title);

    if (!branches.length) {
      const none = document.createElement('span');
      none.className = 'no-branch';
      none.textContent = 'אין סניף בעיר זו';
      wrap.append(none);
    } else {
      const savedId = selectedBranches[activeCity][cid];
      const chosenId = branches.some((b) => b.storeId === savedId) ? savedId : branches[0].storeId;
      selectedBranches[activeCity][cid] = chosenId;

      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `סניף ${ch.name}`);
      for (const b of branches) {
        const label = b.address ? `${b.name} (${b.address})` : b.name;
        sel.add(new Option(label, b.storeId, false, b.storeId === chosenId));
      }
      sel.onchange = () => {
        selectedBranches[activeCity][cid] = sel.value;
        settings = { ...settings, selectedBranches };
        store.setSettings(settings);
        loadActiveCityBranches();
      };
      wrap.append(sel);
    }
    box.append(wrap);
  }
  box.hidden = false;
}

async function loadActiveCityBranches() {
  const seq = ++branchLoadSeq;
  if (!activeCity || !citiesIndex) {
    activeBranchData = {};
    searchCache.clear();
    render();
    return;
  }
  const byChain = branchesInCity(activeCity, citiesIndex);
  loadingBranches = true;
  feedLoadError = '';
  render();

  const nextData = {};
  try {
    await Promise.all(LIVE_CHAIN_IDS.map(async (cid) => {
      const branches = byChain[cid] || [];
      if (!branches.length) return;
      const storeId = selectedBranches[activeCity]?.[cid] || branches[0].storeId;
      const storeObj = branches.find((b) => b.storeId === storeId) || branches[0];
      const [catalog, storePrices] = await Promise.all([
        loadChainCatalog(cid),
        loadBranchPrices(cid, storeObj.storeId),
      ]);
      nextData[cid] = { catalog, storePrices, store: storeObj };
    }));
  } catch {
    if (seq === branchLoadSeq) {
      feedLoadError = 'שגיאה בטעינת מחירי הסניפים. בדוק חיבור אינטרנט ונסה שוב.';
    }
  }
  if (seq !== branchLoadSeq) return;
  activeBranchData = nextData;
  loadingBranches = false;
  searchCache.clear();
  render();
}

function syncCitySelection(rawInput) {
  if (!citiesIndex) return;
  const matched = findMatchingCity(rawInput, citiesIndex);
  if (matched === activeCity && (hasAnyLoadedBranch() || !matched)) {
    renderQuickCities();
    render();
    return;
  }
  activeCity = matched;
  renderQuickCities();
  renderBranchPickers();
  loadActiveCityBranches();
}

async function initPriceFeeds() {
  try {
    const [meta, cities] = await Promise.all([loadMeta(), loadCities()]);
    priceMeta = meta;
    citiesIndex = cities;
    if ($('citiesList') && cities) {
      $('citiesList').innerHTML = '';
      for (const c of Object.keys(cities)) {
        const opt = document.createElement('option');
        opt.value = c;
        $('citiesList').append(opt);
      }
    }
    if ($('pricesMetaNote') && priceMeta?.generatedAt) {
      const d = new Date(priceMeta.generatedAt);
      if (!Number.isNaN(d.getTime())) {
        $('pricesMetaNote').textContent = `מחירים עודכנו ב-${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
    syncCitySelection(userLocation);
  } catch {
    feedLoadError = 'נתוני המחירים אינם זמינים כרגע.';
    render();
  }
}

let cityDebounce = null;
if ($('locInput')) {
  $('locInput').value = userLocation;
  $('locInput').addEventListener('input', () => {
    userLocation = $('locInput').value.trim();
    settings = { ...settings, userLocation };
    store.setSettings(settings);
    clearTimeout(cityDebounce);
    cityDebounce = setTimeout(() => syncCitySelection(userLocation), 180);
  });
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
async function chainOrderLink(includeEmailHint = true) {
  const { activeChainId, lineMatches } = computeChainTotals();
  const chain = CHAIN_BY_ID[activeChainId] || CHAINS[0];
  if (chain.cartFill === 'none') return chain.url;

  const checkedItems = list.filter((i) => i.checked);
  const items = checkedItems.map((i) => {
    const m = lineMatches.get(i.id)?.[activeChainId];
    let prod = i.product || null;
    if (!prod && m && m.code) {
      prod = {
        code: activeChainId === 'shufersal' ? `P_${m.code}` : m.code,
        name: m.productName || i.name,
        brand: m.brand || '',
        sellingMethod: m.weighted ? 'BY_WEIGHT' : 'BY_UNIT',
      };
    } else if (prod) {
      const chainCode = prod.chainCodes?.[activeChainId]
        || (m?.code ? (activeChainId === 'shufersal' ? `P_${m.code}` : m.code) : prod.code);
      prod = { ...prod, code: chainCode };
    }
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
  const { perChain, cheapestId } = computeChainTotals();
  const cheapest = cheapestId ? CHAIN_BY_ID[cheapestId] : null;
  const lines = ['🛒 רשימת קניות – העגלה החכמה'];
  if (cheapest && perChain[cheapestId]?.total > 0) {
    lines.push(`🏆 הסל המלא הזול ביותר: ${cheapest.name} (₪${perChain[cheapestId].total.toFixed(2)})`);
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
loadStaticConfigs();
initPriceFeeds();
importFromHash();
window.addEventListener('hashchange', importFromHash);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
