// Local persistence (localStorage). Everything stays on the device.
const KEYS = {
  list: 'sl.list',
  history: 'sl.history',
  catOverrides: 'sl.catOverrides',
  mappings: 'sl.mappings',
  settings: 'sl.settings',
  migratedChecked: 'sl.v2_checked',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // QuotaExceededError or private-mode restriction: keep in-memory session alive without crashing
  }
}

export const store = {
  getList() {
    const list = load(KEYS.list, []);
    if (!localStorage.getItem(KEYS.migratedChecked)) {
      for (const it of list) it.checked = true;
      save(KEYS.list, list);
      localStorage.setItem(KEYS.migratedChecked, '1');
    }
    return list;
  },
  setList: (list) => save(KEYS.list, list),

  // history: { [normName]: { name, category, unit, qty, purchases: [isoDate, ...] } }
  getHistory: () => load(KEYS.history, {}),
  setHistory: (h) => save(KEYS.history, h),

  getCatOverrides: () => load(KEYS.catOverrides, {}),
  setCatOverrides: (o) => save(KEYS.catOverrides, o),

  // mappings: { [normName]: { code, name, brand, img, price, unitDesc, sellingMethod } }
  getMappings: () => load(KEYS.mappings, {}),
  setMappings: (m) => save(KEYS.mappings, m),

  getSettings: () => ({ apiKey: '', model: 'gemini-2.5-flash', ...load(KEYS.settings, {}) }),
  setSettings: (s) => save(KEYS.settings, s),

  exportAll: () => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    list: load(KEYS.list, []),
    history: load(KEYS.history, {}),
    catOverrides: load(KEYS.catOverrides, {}),
    mappings: load(KEYS.mappings, {}),
  }),
  importAll(data) {
    if (!data || typeof data !== 'object' || data.version !== 1) throw new Error('קובץ גיבוי לא תקין');
    if (Array.isArray(data.list)) {
      const cleanList = data.list.slice(0, 500).filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim()).map((x) => ({
        id: typeof x.id === 'string' && x.id.length <= 64 ? x.id : String(Date.now() + Math.random()),
        name: x.name.trim().slice(0, 120),
        qty: Math.max(0.01, Math.min(1000, Number(x.qty) || 1)),
        unit: ['unit', 'kg', 'g', 'pack'].includes(x.unit) ? x.unit : 'unit',
        category: typeof x.category === 'string' ? x.category.slice(0, 30) : 'other',
        note: typeof x.note === 'string' ? x.note.slice(0, 120) : '',
        checked: x.checked !== false,
        product: (typeof window !== 'undefined' && window.SLCodec?.sanitizeProduct) ? window.SLCodec.sanitizeProduct(x.product) : null,
        addedAt: Number.isFinite(Number(x.addedAt)) ? Number(x.addedAt) : Date.now(),
      }));
      save(KEYS.list, cleanList);
    }
    if (data.history && typeof data.history === 'object' && !Array.isArray(data.history)) save(KEYS.history, data.history);
    if (data.catOverrides && typeof data.catOverrides === 'object' && !Array.isArray(data.catOverrides)) save(KEYS.catOverrides, data.catOverrides);
    if (data.mappings && typeof data.mappings === 'object' && !Array.isArray(data.mappings)) {
      const cleanMap = {};
      for (const [k, v] of Object.entries(data.mappings).slice(0, 500)) {
        if (typeof window !== 'undefined' && window.SLCodec?.sanitizeProduct) {
          const sp = window.SLCodec.sanitizeProduct(v);
          if (sp) cleanMap[k.slice(0, 120)] = sp;
        } else if (v && typeof v === 'object' && typeof v.name === 'string') {
          cleanMap[k.slice(0, 120)] = { code: String(v.code || ''), name: String(v.name).slice(0, 120), brand: String(v.brand || '').slice(0, 80) };
        }
      }
      save(KEYS.mappings, cleanMap);
    }
  },
};
