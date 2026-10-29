// wonders.js
import { loadFileAsText, getResourcePath } from '../utils/fileLoader.js';
import { COUNTRY_CENTROIDS, normalizeCountryName } from './countryCentroids.js';

export let cubeWonderMap = new Map();

// The project uses 3 JSON files:
// - ressource/data/wonders.points.json: list of killers (metadata + a human-readable `position` label)
// - ressource/data/wonders.images.json: { [Name]: imagePath }
// - ressource/data/wonders.positions.json: { [normalizedPosition]: "lat,lon" }
//
// We enrich wonders.points.json at runtime:
// - add stable `id` (required by the map UI)
// - add `img` from wonders.images.json
// - add `lat/lon` from wonders.positions.json
// - add `Country`/`Place` derived from `position` for search/filter UX
//
// Keep the country centroid enrichment available as a fallback, but disabled by default.
const APPLY_COUNTRY_CENTROID_GEO = false;

// Toggle to true only if you want to fallback-place entries that have no coordinates.
const ENABLE_FALLBACK_COUNTRY_PLACEMENT_FOR_MISSING_POINTS = false;

const WONDERS_POINTS_PATH = 'ressource/data/wonders.points.json';
const WONDERS_IMAGES_PATH = 'ressource/data/wonders.images.json';
const WONDERS_POSITIONS_PATH = 'ressource/data/wonders.positions.json';
const WONDERS_POINTS_LOCALE_TEMPLATE = 'lang/data/wonders.points.{lang}.json';
const LEGACY_WONDERS_POINTS_LOCALE_TEMPLATE = 'ressource/data/wonders.points.{lang}.json';

const DE_COUNTRY_NAMES = new Map([
  ['afghanistan', 'Afghanistan'],
  ['belgium', 'Belgien'],
  ['brazil', 'Brasilien'],
  ['china', 'China'],
  ['chile', 'Chile'],
  ['colombia', 'Kolumbien'],
  ['czech republic', 'Tschechien'],
  ['eswatini', 'Eswatini'],
  ['france', 'Frankreich'],
  ['germany', 'Deutschland'],
  ['greece', 'Griechenland'],
  ['india', 'Indien'],
  ['iran', 'Iran'],
  ['iraq', 'Irak'],
  ['ireland', 'Irland'],
  ['morocco', 'Marokko'],
  ['pakistan', 'Pakistan'],
  ['peru', 'Peru'],
  ['philippines', 'Philippinen'],
  ['russia', 'Russland'],
  ['south africa', 'Südafrika'],
  ['switzerland', 'Schweiz'],
  ['ukraine', 'Ukraine'],
  ['united kingdom', 'Vereinigtes Königreich'],
  ['united states', 'Vereinigte Staaten'],
  ['uzbekistan', 'Usbekistan'],
  ['venezuela', 'Venezuela'],
  ['zambia', 'Sambia']
]);

const ES_COUNTRY_NAMES = new Map([
  ['afghanistan', 'Afganistan'],
  ['belgium', 'Belgica'],
  ['brazil', 'Brasil'],
  ['china', 'China'],
  ['chile', 'Chile'],
  ['colombia', 'Colombia'],
  ['czech republic', 'Republica Checa'],
  ['eswatini', 'Esuatini'],
  ['france', 'Francia'],
  ['germany', 'Alemania'],
  ['greece', 'Grecia'],
  ['india', 'India'],
  ['iran', 'Iran'],
  ['iraq', 'Irak'],
  ['ireland', 'Irlanda'],
  ['morocco', 'Marruecos'],
  ['pakistan', 'Pakistan'],
  ['peru', 'Peru'],
  ['philippines', 'Filipinas'],
  ['russia', 'Rusia'],
  ['south africa', 'Sudafrica'],
  ['switzerland', 'Suiza'],
  ['ukraine', 'Ucrania'],
  ['united kingdom', 'Reino Unido'],
  ['united states', 'Estados Unidos'],
  ['uzbekistan', 'Uzbekistan'],
  ['venezuela', 'Venezuela'],
  ['zambia', 'Zambia']
]);

function getLocalizedCountryNames(lang) {
  if (lang === 'de') return DE_COUNTRY_NAMES;
  if (lang === 'es') return ES_COUNTRY_NAMES;
  return null;
}

function mergeWonderGeo(baseList, withPointsList) {
  if (!Array.isArray(baseList) || !Array.isArray(withPointsList)) return;

  const geoById = new Map();
  for (const w of withPointsList) {
    if (!w || typeof w !== 'object') continue;
    const id = w.id;
    if (id == null) continue;

    // Preferred: lat/lon in degrees.
    const lat = toNumber(w.lat) ?? toNumber(w.latitude);
    const lon = toNumber(w.lon) ?? toNumber(w.lng) ?? toNumber(w.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      geoById.set(String(id), { lat, lon });
      continue;
    }

    // Back-compat: if the file still contains xy, keep it (map.js can use it directly).
    const xy = w.xy;
    if (Array.isArray(xy) && xy.length >= 2 && Number.isFinite(Number(xy[0])) && Number.isFinite(Number(xy[1]))) {
      geoById.set(String(id), { xy: [Number(xy[0]), Number(xy[1])] });
    }
  }

  for (const w of baseList) {
    if (!w || typeof w !== 'object') continue;
    // Don't override any explicit coordinates already present in base list.
    if (Array.isArray(w.xy) && w.xy.length >= 2) continue;
    if (typeof w.lat === 'number' && typeof w.lon === 'number') continue;
    const id = w.id;
    if (id == null) continue;
    const geo = geoById.get(String(id));
    if (!geo) continue;
    if (geo.xy) {
      w.xy = geo.xy;
    } else if (Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
      w.lat = geo.lat;
      w.lon = geo.lon;
      w.geoSource = w.geoSource || 'withPoints';
    }
  }
}

function applyCustomLonLatOverrides(list) {
  if (!Array.isArray(list)) return;
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const isCustom = (w.custom === true) || (w.custom && typeof w.custom === 'object' && w.custom.enabled === true);
    if (!isCustom) continue;
    const ll = readCustomLatLon(w);
    if (!ll) continue;
    w.lat = ll.lat;
    w.lon = ll.lon;
    w.geoSource = 'custom-lonlat';
    delete w.xy;
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeLocationKey(s) {
  const raw = String(s ?? '').toLowerCase();
  try {
    return raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  } catch {
    return raw.replace(/[^a-z0-9]+/g, ' ').trim();
  }
}

function normalizePositionKey(position) {
  const p = String(position ?? '').trim();
  if (!p) return '';
  const idx = p.indexOf(' - ');
  if (idx >= 0) {
    const country = p.slice(0, idx).trim();
    const place = p.slice(idx + 3).trim();
    const c = normalizeLocationKey(country);
    const pl = normalizeLocationKey(place);
    if (c && pl) return `${c} - ${pl}`;
    return c || pl;
  }
  return normalizeLocationKey(p);
}

function parseLatLonString(s) {
  const str = String(s ?? '').trim();
  if (!str) return null;
  const parts = str.split(',').map(x => x.trim());
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function splitCountryPlaceFromPosition(position) {
  const p = String(position ?? '').trim();
  if (!p) return { country: '', place: '' };
  const idx = p.indexOf(' - ');
  if (idx < 0) return { country: p, place: '' };
  return {
    country: p.slice(0, idx).trim(),
    place: p.slice(idx + 3).trim()
  };
}

function getStableWonderCountryKey(w) {
  if (!w || typeof w !== 'object') return '';

  const explicit = String(w.countryKey ?? w.CountryKey ?? '').trim();
  if (explicit) return normalizeCountryName(explicit);

  const directCountry = String(w.Country ?? w.country ?? '').trim();
  if (directCountry) return normalizeCountryName(directCountry);

  const position = String(w.position ?? w.Position ?? '').trim();
  if (!position) return '';

  const { country } = splitCountryPlaceFromPosition(position);
  return normalizeCountryName(country);
}

function applyStableCountryKeys(list) {
  if (!Array.isArray(list)) return;
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const key = getStableWonderCountryKey(w);
    if (key) w.countryKey = key;
  }
}

function getRequestedDataLang() {
  const raw = (typeof window !== 'undefined' && window.i18n && window.i18n.lang)
    ? window.i18n.lang
    : 'en';
  return String(raw || 'en').trim().toLowerCase().split('-')[0] || 'en';
}

function getLocalizedPointsPath(lang) {
  return WONDERS_POINTS_LOCALE_TEMPLATE.replace('{lang}', lang);
}

function getLegacyLocalizedPointsPath(lang) {
  return LEGACY_WONDERS_POINTS_LOCALE_TEMPLATE.replace('{lang}', lang);
}

function getLocalizedPointsCandidatePaths(lang) {
  const paths = [
    getLocalizedPointsPath(lang),
    getLegacyLocalizedPointsPath(lang)
  ].filter(Boolean);

  return Array.from(new Set(paths));
}

function buildWonderSourceKey(w) {
  const explicit = String(w?.__sourceKey ?? w?.sourceKey ?? '').trim();
  if (explicit) return explicit;
  const name = String(w?.Name ?? w?.name ?? '').trim();
  const posLabel = String(w?.position ?? w?.Position ?? '').trim();
  return `${name}|${posLabel}`;
}

function translateCountryName(country, lang) {
  const raw = String(country ?? '').trim();
  const countryNames = getLocalizedCountryNames(lang);
  if (!raw || !countryNames) return raw;
  const translated = countryNames.get(normalizeLocationKey(raw));
  return translated || raw;
}

function localizePositionLabel(position, lang) {
  const raw = String(position ?? '').trim();
  if (!raw || !getLocalizedCountryNames(lang)) return raw;
  const { country, place } = splitCountryPlaceFromPosition(raw);
  const localizedCountry = translateCountryName(country, lang);
  if (!place) return localizedCountry || raw;
  if (!localizedCountry) return raw;
  return `${localizedCountry} - ${place}`;
}

function applyLocalizedCountryFields(list, lang) {
  if (!Array.isArray(list) || !getLocalizedCountryNames(lang)) return;
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    if (w.Country) w.Country = translateCountryName(w.Country, lang);
    const localizedPosition = localizePositionLabel(w.position ?? w.Position, lang);
    if (localizedPosition) {
      w.position = localizedPosition;
      const { country, place } = splitCountryPlaceFromPosition(localizedPosition);
      if (country) w.Country = country;
      if (place) w.Place = place;
    }
  }
}

function applyWonderLocaleOverlay(list, overlay) {
  if (!Array.isArray(list) || !overlay) return;

  const overlayMap = new Map();
  if (Array.isArray(overlay)) {
    for (const entry of overlay) {
      if (!entry || typeof entry !== 'object') continue;
      const sourceKey = String(entry.sourceKey ?? '').trim();
      if (!sourceKey) continue;
      overlayMap.set(sourceKey, entry);
    }
  } else if (typeof overlay === 'object') {
    for (const [sourceKey, entry] of Object.entries(overlay)) {
      if (!entry || typeof entry !== 'object') continue;
      overlayMap.set(sourceKey, entry);
    }
  }

  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const sourceKey = buildWonderSourceKey(w);
    const patch = overlayMap.get(sourceKey);
    if (!patch) continue;

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'sourceKey') continue;
      w[key] = value;
    }

    if (patch.Nickname != null && patch['Nickname / AKA'] == null) {
      w['Nickname / AKA'] = patch.Nickname;
    }

    if (patch.position != null) {
      const { country, place } = splitCountryPlaceFromPosition(patch.position);
      if (country && patch.Country == null) w.Country = country;
      if (place && patch.Place == null) w.Place = place;
    }
  }
}

function loadWonderLocaleOverlay(lang, onLoaded) {
  const candidates = getLocalizedPointsCandidatePaths(lang).map((path) => getResourcePath(path));

  const tryNext = (index) => {
    if (index >= candidates.length) {
      onLoaded(null);
      return;
    }

    loadFileAsText(
      candidates[index],
      (overlayText) => onLoaded(safeParseJson(overlayText)),
      () => tryNext(index + 1)
    );
  };

  tryNext(0);
}

function finalizeWonderData(data, done) {
  applyCustomLonLatOverrides(data);

  if (ENABLE_FALLBACK_COUNTRY_PLACEMENT_FOR_MISSING_POINTS && Array.isArray(data)) {
    applyCustomOrCountryPlacement(data, null);
  }

  if (APPLY_COUNTRY_CENTROID_GEO && Array.isArray(data)) {
    applyCountryCentroidGeo(data);
  }

  applyStableCountryKeys(data);

  const lang = getRequestedDataLang();
  applyLocalizedCountryFields(data, lang);

  if (lang === 'en') {
    done(data);
    return;
  }

  loadWonderLocaleOverlay(lang, (overlayParsed) => {
    applyWonderLocaleOverlay(data, overlayParsed);
    done(data);
  });
}

export function fetchWonders(callback) {
  // IMPORTANT: the map loading overlay is dismissed only after this callback runs.
  // Never leave it hanging: always call back with a safe fallback array.
  let called = false;
  const done = (list) => {
    if (called) return;
    called = true;
    try {
      callback(Array.isArray(list) ? list : []);
    } catch (err) {
      // If the caller callback throws, avoid breaking subsequent init steps.
      console.error('[Wonders] callback error:', err);
    }
  };

  const jsonPath = getResourcePath(WONDERS_POINTS_PATH);
  loadFileAsText(
    jsonPath,
    jsonText => {
      try {
        const parsed = JSON.parse(jsonText);
        const data = Array.isArray(parsed) ? parsed : [];

        const imagesPath = getResourcePath(WONDERS_IMAGES_PATH);
        loadFileAsText(
          imagesPath,
          (imagesText) => {
            const imagesParsed = safeParseJson(imagesText);
            const imagesObj = (imagesParsed && typeof imagesParsed === 'object') ? imagesParsed : {};

            // Pre-index images by exact key and normalized key.
            const imgByNameNorm = new Map();
            for (const [k, v] of Object.entries(imagesObj || {})) {
              if (typeof v !== 'string' || !v) continue;
              const nk = normalizeLocationKey(k);
              if (nk && !imgByNameNorm.has(nk)) imgByNameNorm.set(nk, v);
            }

            const positionsPath = getResourcePath(WONDERS_POSITIONS_PATH);
            loadFileAsText(
              positionsPath,
              (positionsText) => {
                const positionsParsed = safeParseJson(positionsText);
                const positionsObj = (positionsParsed && typeof positionsParsed === 'object') ? positionsParsed : {};

                const usedIds = new Set();

                for (const w of data) {
                  if (!w || typeof w !== 'object') continue;

                  const name = String(w.Name ?? w.name ?? '').trim();
                  const posLabel = String(w.position ?? w.Position ?? '').trim();
                  w.__sourceKey = `${name}|${posLabel}`;

                  // Stable ID required by UI (bubbles, popup anchor, selection).
                  const seed = `${name}|${posLabel}`;
                  let id = fnv1a32(seed);
                  if (usedIds.has(id)) {
                    let n = 1;
                    while (usedIds.has(id)) {
                      id = fnv1a32(`${seed}|${n++}`);
                    }
                  }
                  usedIds.add(id);
                  w.id = id;

                  // Keep compat with older field name.
                  if (w.Nickname != null && w['Nickname / AKA'] == null) {
                    w['Nickname / AKA'] = w.Nickname;
                  }

                  // Ensure `cat` is a string so existing filter/search code doesn't crash.
                  if (typeof w.cat !== 'string') w.cat = String(w.cat ?? '');

                  // Country/Place used by search & bubble UI.
                  if (!w.Country) {
                    const { country, place } = splitCountryPlaceFromPosition(posLabel);
                    if (country) w.Country = country;
                    if (place && !w.Place) w.Place = place;
                  }

                  // Profile image.
                  if (name && !w.img) {
                    const direct = imagesObj && Object.prototype.hasOwnProperty.call(imagesObj, name) ? imagesObj[name] : null;
                    const img = (typeof direct === 'string' && direct) ? direct : (imgByNameNorm.get(normalizeLocationKey(name)) || null);
                    if (img) w.img = img;
                  }

                  // Geo from positions map: { [normalizedPosition]: "lat,lon" }.
                  if (posLabel && (typeof w.lat !== 'number' || typeof w.lon !== 'number')) {
                    const k = normalizePositionKey(posLabel);
                    const ll = positionsObj && Object.prototype.hasOwnProperty.call(positionsObj, k)
                      ? parseLatLonString(positionsObj[k])
                      : null;
                    if (ll) {
                      w.lat = ll.lat;
                      w.lon = ll.lon;
                      w.geoSource = w.geoSource || 'positions-map';
                    }
                  }
                }

                finalizeWonderData(data, done);
              },
              // If the positions map is missing/unreadable, continue without geo enrichment.
              () => {
                // Still attach images + ids + Country/Place.
                const usedIds = new Set();
                for (const w of data) {
                  if (!w || typeof w !== 'object') continue;
                  const name = String(w.Name ?? w.name ?? '').trim();
                  const posLabel = String(w.position ?? w.Position ?? '').trim();
                  w.__sourceKey = `${name}|${posLabel}`;
                  const seed = `${name}|${posLabel}`;
                  let id = fnv1a32(seed);
                  if (usedIds.has(id)) {
                    let n = 1;
                    while (usedIds.has(id)) id = fnv1a32(`${seed}|${n++}`);
                  }
                  usedIds.add(id);
                  w.id = id;

                  if (w.Nickname != null && w['Nickname / AKA'] == null) {
                    w['Nickname / AKA'] = w.Nickname;
                  }
                  if (typeof w.cat !== 'string') w.cat = String(w.cat ?? '');

                  if (!w.Country) {
                    const { country, place } = splitCountryPlaceFromPosition(posLabel);
                    if (country) w.Country = country;
                    if (place && !w.Place) w.Place = place;
                  }

                  if (name && !w.img) {
                    const direct = imagesObj && Object.prototype.hasOwnProperty.call(imagesObj, name) ? imagesObj[name] : null;
                    const img = (typeof direct === 'string' && direct) ? direct : (imgByNameNorm.get(normalizeLocationKey(name)) || null);
                    if (img) w.img = img;
                  }
                }

                finalizeWonderData(data, done);
              }
            );
          },
          // If the images map is missing/unreadable, continue without images.
          () => {
            const positionsPath = getResourcePath(WONDERS_POSITIONS_PATH);
            loadFileAsText(
              positionsPath,
              (positionsText) => {
                const positionsParsed = safeParseJson(positionsText);
                const positionsObj = (positionsParsed && typeof positionsParsed === 'object') ? positionsParsed : {};

                const usedIds = new Set();
                for (const w of data) {
                  if (!w || typeof w !== 'object') continue;
                  const name = String(w.Name ?? w.name ?? '').trim();
                  const posLabel = String(w.position ?? w.Position ?? '').trim();
                  w.__sourceKey = `${name}|${posLabel}`;

                  const seed = `${name}|${posLabel}`;
                  let id = fnv1a32(seed);
                  if (usedIds.has(id)) {
                    let n = 1;
                    while (usedIds.has(id)) id = fnv1a32(`${seed}|${n++}`);
                  }
                  usedIds.add(id);
                  w.id = id;

                  if (w.Nickname != null && w['Nickname / AKA'] == null) {
                    w['Nickname / AKA'] = w.Nickname;
                  }
                  if (typeof w.cat !== 'string') w.cat = String(w.cat ?? '');

                  if (!w.Country) {
                    const { country, place } = splitCountryPlaceFromPosition(posLabel);
                    if (country) w.Country = country;
                    if (place && !w.Place) w.Place = place;
                  }

                  if (posLabel && (typeof w.lat !== 'number' || typeof w.lon !== 'number')) {
                    const k = normalizePositionKey(posLabel);
                    const ll = positionsObj && Object.prototype.hasOwnProperty.call(positionsObj, k)
                      ? parseLatLonString(positionsObj[k])
                      : null;
                    if (ll) {
                      w.lat = ll.lat;
                      w.lon = ll.lon;
                      w.geoSource = w.geoSource || 'positions-map';
                    }
                  }
                }

                finalizeWonderData(data, done);
              },
              () => {
                // Only IDs + Country/Place then callback.
                const usedIds = new Set();
                for (const w of data) {
                  if (!w || typeof w !== 'object') continue;
                  const name = String(w.Name ?? w.name ?? '').trim();
                  const posLabel = String(w.position ?? w.Position ?? '').trim();
                  w.__sourceKey = `${name}|${posLabel}`;
                  const seed = `${name}|${posLabel}`;
                  let id = fnv1a32(seed);
                  if (usedIds.has(id)) {
                    let n = 1;
                    while (usedIds.has(id)) id = fnv1a32(`${seed}|${n++}`);
                  }
                  usedIds.add(id);
                  w.id = id;
                  if (w.Nickname != null && w['Nickname / AKA'] == null) {
                    w['Nickname / AKA'] = w.Nickname;
                  }
                  if (typeof w.cat !== 'string') w.cat = String(w.cat ?? '');
                  if (!w.Country) {
                    const { country, place } = splitCountryPlaceFromPosition(posLabel);
                    if (country) w.Country = country;
                    if (place && !w.Place) w.Place = place;
                  }
                }

                finalizeWonderData(data, done);
              }
            );
          }
        );
      } catch (err) {
        console.error('[Wonders] Error parsing JSON:', err);
        done([]);
      }
    },
    err => {
      console.error('[Wonders] Error loading wonders:', err);
      done([]);
    }
  );
}
export { showWonderPanel, captureOpenWonderPopupStates } from '../ui/popup.js?v=20260126a';

function seededUnitFloat(seed) {
  // Deterministic pseudo-random in [0,1).
  let x = Number(seed) || 0;
  x = (x ^ 0x9e3779b9) >>> 0;
  x = (x * 1664525 + 1013904223) >>> 0;
  return (x >>> 0) / 4294967296;
}

function fnv1a32(str) {
  const s = String(str ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seededUnitFloatFromString(seedStr) {
  let x = fnv1a32(seedStr);
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17; x >>>= 0;
  x ^= x << 5; x >>>= 0;
  return x / 4294967296;
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function readLatLonFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const lat = toNumber(obj.lat) ?? toNumber(obj.latitude);
  const lon = toNumber(obj.lon) ?? toNumber(obj.lng) ?? toNumber(obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function readCustomLatLon(w) {
  if (!w || typeof w !== 'object') return null;

  // Preferred schema:
  //   custom: true
  //   customLat: number
  //   customLon: number
  const lat1 = toNumber(w.customLat);
  const lon1 = toNumber(w.customLon);
  if (Number.isFinite(lat1) && Number.isFinite(lon1)) return { lat: lat1, lon: lon1 };

  // Alternative:
  //   customGeo: { lat, lon }
  const fromCustomGeo = readLatLonFromObject(w.customGeo);
  if (fromCustomGeo) return fromCustomGeo;

  // Alternative:
  //   custom: { lat, lon }
  if (w.custom && typeof w.custom === 'object') {
    const fromCustomObj = readLatLonFromObject(w.custom);
    if (fromCustomObj) return fromCustomObj;
  }

  return null;
}

function applyCustomOrCountryPlacement(list, countryPositions) {
  // Jitter spreads points inside a country so they don't stack perfectly.
  // Use degrees so the map can always project lat/lon -> xy.
  const DEFAULT_RADIUS_KM = 80;

  const KM_PER_DEG_LAT = 110.574;
  const kmPerDegLon = (latDeg) => {
    const latRad = (latDeg * Math.PI) / 180;
    return Math.max(1e-6, 111.320 * Math.cos(latRad));
  };

  function pickCountryPoint(countryKey, points, idSeed) {
    const list = Array.isArray(points) ? points : [];
    if (list.length === 0) return null;
    const r = seededUnitFloatFromString(`${countryKey}|${idSeed}|countryPoint`);
    const idx = Math.max(0, Math.min(list.length - 1, Math.floor(r * list.length)));
    const p = list[idx];
    const ll = readLatLonFromObject(p);
    if (!ll) return null;
    return { ...ll, idx };
  }

  function jitterWithinRadiusKm(baseLat, baseLon, radiusKm, idSeed) {
    const r1 = seededUnitFloatFromString(`${idSeed}|radius`);
    const r2 = seededUnitFloatFromString(`${idSeed}|theta`);
    const theta = r2 * Math.PI * 2;

    // Uniform in disk area.
    const distKm = Math.sqrt(r1) * Math.max(0, radiusKm || 0);
    const dxKm = distKm * Math.cos(theta);
    const dyKm = distKm * Math.sin(theta);

    const dLat = dyKm / KM_PER_DEG_LAT;
    const dLon = dxKm / kmPerDegLon(baseLat);

    return { lat: baseLat + dLat, lon: baseLon + dLon };
  }

  for (const w of list) {
    if (!w || typeof w !== 'object') continue;

    const isCustom = (w.custom === true) || (w.custom && typeof w.custom === 'object' && w.custom.enabled === true);
    if (isCustom) {
      const ll = readCustomLatLon(w);
      if (ll) {
        // Custom lon/lat should override any baked xy.
        w.lat = ll.lat;
        w.lon = ll.lon;
        w.geoSource = 'custom-lonlat';
        delete w.xy;
        continue;
      }
      // If marked custom but missing custom lon/lat, fall back to country placement.
    }

    // If we already have usable xy (from wonders.withPoints.json), keep it and skip.
    if (Array.isArray(w.xy) && w.xy.length >= 2) {
      continue;
    }

    // If explicit numeric lon/lat already exist, keep them.
    if (typeof w.lat === 'number' && typeof w.lon === 'number') {
      continue;
    }

    const countryRaw = w.Country ?? w.country ?? w.Nationality ?? w.nationality;
    if (!countryRaw) continue;
    const key = normalizeCountryName(countryRaw);
    if (!key) continue;

    const baseFromFile = countryPositions && Object.prototype.hasOwnProperty.call(countryPositions, key)
      ? countryPositions[key]
      : null;

    const idSeed = (w.id != null) ? String(w.id) : String(w.Name ?? w.name ?? key);

    // Preferred per-country schema:
    // { radiusKm: number, points: [{lat, lon, label?}, ...] }
    // Backwards compat: allow {lat, lon} as a single implicit point.
    let points = null;
    let radiusKm = DEFAULT_RADIUS_KM;
    if (baseFromFile && typeof baseFromFile === 'object') {
      if (Array.isArray(baseFromFile.points)) {
        points = baseFromFile.points;
      } else {
        const legacy = readLatLonFromObject(baseFromFile);
        if (legacy) points = [legacy];
      }

      const rkm = toNumber(baseFromFile.radiusKm);
      if (Number.isFinite(rkm) && rkm >= 0) radiusKm = rkm;
    }

    if (!points) {
      const c = COUNTRY_CENTROIDS[key];
      if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number') continue;
      points = [{ lat: c.lat, lon: c.lon }];
    }

    const picked = pickCountryPoint(key, points, idSeed);
    if (!picked) continue;

    const ll = jitterWithinRadiusKm(picked.lat, picked.lon, radiusKm, `${idSeed}|p${picked.idx}`);
    w.lon = ll.lon;
    w.lat = ll.lat;
    w.geoSource = baseFromFile ? 'country-positions-file' : 'country-centroid';
  }
}

function applyCountryCentroidGeo(list) {
  // Jitter spreads points inside a country so they don't stack perfectly.
  // Kept small so the country location remains obvious.
  // NOTE: Keep jitter very small; otherwise nearby countries (e.g. London vs Paris)
  // can visually collapse into the same area.
  const JITTER_DEG_LON = 0.35;
  const JITTER_DEG_LAT = 0.22;

  for (const w of list) {
    if (!w || typeof w !== 'object') continue;

    // If explicit numeric lat/lon already exist, keep them.
    if (typeof w.lat === 'number' && typeof w.lon === 'number') continue;

    const countryRaw = w.Country ?? w.country ?? w.Nationality ?? w.nationality;
    if (!countryRaw) continue;
    const key = normalizeCountryName(countryRaw);
    const c = COUNTRY_CENTROIDS[key];
    if (!c) continue;

    const id = (w.id != null) ? w.id : (w.Name || w.name || key);
    const r1 = seededUnitFloat(String(id).length * 2654435761);
    const r2 = seededUnitFloat((String(id).length + 1) * 1597334677);
    const jLon = (r1 - 0.5) * JITTER_DEG_LON;
    const jLat = (r2 - 0.5) * JITTER_DEG_LAT;

    w.lon = c.lon + jLon;
    w.lat = c.lat + jLat;
    w.geoSource = 'country-centroid';
  }
}
