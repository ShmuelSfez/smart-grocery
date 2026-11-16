const SHUFERSAL = 'https://www.shufersal.co.il/online/he/';
const $ = (id) => document.getElementById(id);
const get = (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k])));
const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));

async function refresh() {
  const pending = await get('pending');
  $('pendingInfo').textContent = pending
    ? `יש רשימה ממתינה${pending.items ? ` (${pending.items.length} מוצרים)` : ''} – פתח את שופרסל כדי להמשיך.`
    : 'אין רשימה ממתינה. שלח רשימה מהאפליקציה ("שלח לשופרסל").';

  const mappings = (await get('mappings')) || {};
  const keys = Object.keys(mappings).sort();
  $('mapsTitle').textContent = `מוצרים שמורים (${keys.length})`;
  const box = $('maps');
  box.innerHTML = '';
  if (!keys.length) box.innerHTML = '<div class="muted">עוד אין. בכל פעם שתבחר מוצר בשופרסל הוא יישמר כאן.</div>';
  for (const k of keys) {
    const p = mappings[k];
    const row = document.createElement('div');
    row.className = 'map';
    const img = document.createElement('img');
    if (p.img) img.src = p.img;
    const g = document.createElement('div');
    g.className = 'g';
    const a = document.createElement('div');
    a.innerHTML = '<b></b>';
    a.firstChild.textContent = k;
    const b = document.createElement('div');
    b.className = 'muted';
    b.textContent = p.name;
    g.append(a, b);
    const x = document.createElement('button');
    x.className = 'x';
    x.title = 'שכח את הבחירה';
    x.textContent = '✕';
    x.onclick = async () => { delete mappings[k]; await set({ mappings }); refresh(); };
    row.append(img, g, x);
    box.append(row);
  }
}

async function openShufersal() {
  const tabs = await chrome.tabs.query({ url: 'https://www.shufersal.co.il/*' });
  if (tabs.length) {
    const t = tabs[0];
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    chrome.tabs.sendMessage(t.id, { type: 'smartlist-open' }).catch(() => chrome.tabs.reload(t.id));
  } else {
    await chrome.tabs.create({ url: SHUFERSAL });
  }
  window.close();
}

$('open').onclick = openShufersal;
$('import').onclick = async () => {
  const m = $('code').value.match(/smartlist=([^&\s]+)/) || $('code').value.trim().match(/^([zp][A-Za-z0-9_-]+)$/);
  if (!m) { $('pendingInfo').textContent = '⚠️ לא נמצא קוד רשימה בטקסט.'; return; }
  await set({ pending: { code: m[1], ts: Date.now(), items: null } });
  openShufersal();
};

refresh();
