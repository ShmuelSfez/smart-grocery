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
  localStorage.setItem(key, JSON.stringify(value));
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
    if (!data || data.version !== 1) throw new Error('קובץ גיבוי לא תקין');
    if (data.list) save(KEYS.list, data.list);
    if (data.history) save(KEYS.history, data.history);
    if (data.catOverrides) save(KEYS.catOverrides, data.catOverrides);
    if (data.mappings) save(KEYS.mappings, data.mappings);
  },
};
