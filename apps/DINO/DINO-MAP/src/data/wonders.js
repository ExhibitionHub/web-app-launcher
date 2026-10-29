// wonders.js
// Generic data loader - loads points from the dataset configured by ?data= URL param.
import { loadFileAsText, getResourcePath } from '../utils/fileLoader.js';
import { DATASET } from './datasetConfig.js';

export let cubeWonderMap = new Map();

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
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

export function fetchWonders(callback) {
  let called = false;
  const done = (list) => {
    if (called) return;
    called = true;
    try {
      callback(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[Data] callback error:', err);
    }
  };

  // dataPath can be a string (single file) or an array (merge multiple files)
  const paths = Array.isArray(DATASET.dataPath) ? DATASET.dataPath : [DATASET.dataPath];
  const allData = [];
  let remaining = paths.length;
  let hadError = false;

  function onFileLoaded() {
    remaining--;
    if (remaining <= 0) {
      finalize(allData);
    }
  }

  function finalize(data) {
    const usedIds = new Set();
    for (const w of data) {
      if (!w || typeof w !== 'object') continue;

      const name = String(w.Name ?? w.name ?? '').trim();
      const position = String(w.position ?? w.Position ?? w.Place ?? '').trim();

      // Stable ID
      const seed = name + '|' + position;
      let id = fnv1a32(seed);
      if (usedIds.has(id)) {
        let n = 1;
        while (usedIds.has(id)) id = fnv1a32(seed + '|' + (n++));
      }
      usedIds.add(id);
      w.id = id;

      // Ensure cat is a string
      if (typeof w.cat !== 'string') w.cat = String(w.cat ?? '');

      // Ensure Country is set
      if (!w.Country && w.country) w.Country = w.country;
      if (!w.Place && w.place) w.Place = w.place;
    }

    done(data);
  }

  for (const p of paths) {
    const jsonPath = getResourcePath(p);
    loadFileAsText(
      jsonPath,
      jsonText => {
        try {
          const parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed)) {
            allData.push(...parsed);
          }
        } catch (err) {
          console.error('[Data] Error parsing JSON from', p, err);
        }
        onFileLoaded();
      },
      err => {
        console.error('[Data] Error loading data from', p, err);
        onFileLoaded();
      }
    );
  }
}

export { showWonderPanel } from '../ui/popup.js';
