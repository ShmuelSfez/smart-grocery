// Maps numeric Israeli CBS locality codes (סמל ישוב, e.g. "6400" -> "הרצליה")
// and normalizes Hebrew city names across supermarket Stores feeds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data/cbs-cities.json');
const CBS_API_URL = 'https://data.gov.il/api/3/action/datastore_search?resource_id=5c78e9fa-c2e2-4771-93ff-7f400a12f7ba&limit=2000';

// Common spelling aliases so different chains' Stores files group under one city entry
const CITY_ALIASES = new Map([
  ['תל אביב - יפו', 'תל אביב-יפו'],
  ['תל אביב יפו', 'תל אביב-יפו'],
  ['תל אביב', 'תל אביב-יפו'],
  ['ת"א', 'תל אביב-יפו'],
  ['פתח תקוה', 'פתח תקווה'],
  ['פ"ת', 'פתח תקווה'],
  ['ראשון-לציון', 'ראשון לציון'],
  ['ראשל"צ', 'ראשון לציון'],
  ['באר-שבע', 'באר שבע'],
  ['מודיעין מכבים רעות', 'מודיעין-מכבים-רעות'],
  ['מודיעין', 'מודיעין-מכבים-רעות'],
  ['נהרייה', 'נהריה'],
  ['הרצלייה', 'הרצליה'],
  ['קריית אתא', 'קרית אתא'],
  ['קריית גת', 'קרית גת'],
  ['קריית ביאליק', 'קרית ביאליק'],
  ['קריית מוצקין', 'קרית מוצקין'],
  ['קריית ים', 'קרית ים'],
  ['קריית אונו', 'קרית אונו'],
  ['קריית שמונה', 'קרית שמונה'],
  ['קריית מלאכי', 'קרית מלאכי'],
]);

export function cleanCityString(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/["״]/g, '"')
    .replace(/['׳`]/g, "'")
    .replace(/\)\s*([^()]+?)\s*\(/g, '($1)')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  // Normalize קריית -> קרית for consistent grouping unless overridden
  if (CITY_ALIASES.has(s)) s = CITY_ALIASES.get(s);
  s = s.replace(/^קריית\s+/, 'קרית ');
  if (CITY_ALIASES.has(s)) s = CITY_ALIASES.get(s);
  return s;
}

export function loadLocalCityMap() {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const out = new Map();
  for (const [code, name] of Object.entries(raw)) {
    const cleanCode = String(code).trim().replace(/^0+/, '');
    const cleanName = cleanCityString(name);
    if (cleanCode && cleanName) out.set(cleanCode, cleanName);
  }
  return out;
}

export async function loadCityMap({ fetchRemote = false } = {}) {
  const map = loadLocalCityMap();
  if (!fetchRemote) return map;
  try {
    const res = await fetch(CBS_API_URL, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const json = await res.json();
      for (const r of json.result?.records || []) {
        const code = String(r['סמל_ישוב'] ?? '').trim().replace(/^0+/, '');
        const name = cleanCityString(r['שם_ישוב'] ?? '');
        if (code && name && name !== 'לא רשום') map.set(code, name);
      }
    }
  } catch {
    // Offline or data.gov.il unreachable: committed snapshot is already loaded
  }
  return map;
}

export function resolveCityName(rawCity, cityMap, storeName = '') {
  const trimmed = String(rawCity || '').trim();
  if (/^\d+$/.test(trimmed)) {
    const code = trimmed.replace(/^0+/, '');
    if (!code || code === '9999') return inferCityFromStoreName(storeName, cityMap);
    return cityMap.get(code) || inferCityFromStoreName(storeName, cityMap);
  }
  const cleaned = cleanCityString(trimmed);
  if (!cleaned || /^(לא ידוע|unknown|null|none|-)$/i.test(cleaned)) {
    return inferCityFromStoreName(storeName, cityMap);
  }
  return cleaned;
}

function inferCityFromStoreName(storeName, cityMap) {
  const s = cleanCityString(storeName);
  if (!s) return '';
  for (const city of cityMap.values()) {
    if (city.length >= 3 && (s === city || s.startsWith(city + ' ') || s.endsWith(' ' + city) || s.includes(' ' + city + ' '))) {
      return city;
    }
  }
  return '';
}
