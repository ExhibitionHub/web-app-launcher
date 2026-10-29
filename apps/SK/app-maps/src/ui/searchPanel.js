const DEFAULT_MAX_RESULTS = 30;

function toCleanText(v) {
  if (v == null) return '';
  return String(v).trim();
}

function toNumber(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const s = toCleanText(v);
  if (!s) return fallback;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function readField(obj, ...aliases) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of aliases) {
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const v = obj[key];
      if (v == null) continue;
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) return s;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        return String(v);
      }
    }
  }
  return '';
}

function normalizeForSearch(str) {
  const s = String(str ?? '').toLowerCase();
  // Remove accents/diacritics.
  try {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return s;
  }
}

function normalizeCountryKeyForPriority(value) {
  return normalizeForSearch(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function countryPriorityRank(normValue, labelValue) {
  const key = normalizeCountryKeyForPriority(normValue || labelValue);
  // Keep the two main exhibits first (after "All"/"Unknown").
  const rankByKey = new Map([
    // USA aliases
    ['united states', 0],
    ['vereinigte staaten', 0],
    ['usa', 0],
    ['u s', 0],
    ['u s a', 0],
    ['etats unis', 0],
    // United Kingdom aliases
    ['united kingdom', 1],
    ['vereinigtes konigreich', 1],
    ['uk', 1],
    ['u k', 1],
    ['great britain', 1],
    ['britain', 1],
    ['england', 1],
    ['scotland', 1],
    ['wales', 1],
    ['northern ireland', 1],
    // Ireland aliases
    ['ireland', 2],
    ['irlande', 2],
    ['irland', 2],
  ]);
  return rankByKey.has(key) ? rankByKey.get(key) : 999;
}

function tokenize(query) {
  const q = normalizeForSearch(query);
  return q
    .split(/[^a-z0-9]+/g)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildSearchDoc(w) {
  const name = toCleanText(readField(w, 'Name', 'name'));
  const aka = toCleanText(readField(w, 'Nickname / AKA', 'Nickname', 'AKA', 'aka', 'nickname'));

  const country = toCleanText(readField(w, 'Country', 'country', 'Nationality', 'nationality'));
  const place = toCleanText(readField(
    w,
    'Place',
    'place',
    'Location',
    'location',
    'City',
    'city',
    'State',
    'state',
    'Region',
    'region'
  ));

  const notesOrSummary = toCleanText(readField(w, 'Notes', 'Summary', 'summary', 'notes'));
  const description = notesOrSummary || toCleanText(readField(w, 'description', 'Description', 'overview', 'Overview', 'history', 'History'));

  const status = toCleanText(readField(w, 'Status', 'status'));
  const cat = toCleanText(readField(w, 'cat', 'Category', 'category'));

  const id = (w && w.id != null) ? String(w.id) : '';
  const interestScore = toNumber(readField(w, 'interest_score', 'Interest_Score', 'Interest score', 'Interest Score', 'interestScore'), 0);
  const countryKey = toCleanText(readField(w, 'countryKey', 'CountryKey')) || normalizeCountryKeyForPriority(country);

  const combined = [name, aka, country, place, description, status, cat, id].filter(Boolean).join(' \n ');

  return {
    ref: w,
    id,
    name,
    aka,
    country,
    place,
    description,
    status,
    cat,
    countryKey,
    interestScore,
    _n: {
      name: normalizeForSearch(name),
      aka: normalizeForSearch(aka),
      country: normalizeForSearch(country),
      place: normalizeForSearch(place),
      description: normalizeForSearch(description),
      status: normalizeForSearch(status),
      cat: normalizeForSearch(cat),
      id: normalizeForSearch(id),
      all: normalizeForSearch(combined)
    }
  };
}

function scoreDoc(doc, query, tokens) {
  const q = normalizeForSearch(query);
  const name = doc._n.name;

  // Must match all tokens somewhere for a "powerful" search.
  for (const t of tokens) {
    if (!doc._n.all.includes(t)) return 0;
  }

  let score = 0;

  if (q && name === q) score += 200;
  if (q && name.startsWith(q)) score += 120;
  if (q && name.includes(q)) score += 70;

  // Per-token weighted scoring.
  for (const t of tokens) {
    if (!t) continue;

    if (name === t) score += 110;
    else if (name.startsWith(t)) score += 80;
    else if (name.includes(t)) score += 55;

    if (doc._n.aka.includes(t)) score += 35;
    if (doc._n.country.includes(t)) score += 28;
    if (doc._n.place.includes(t)) score += 28;
    if (doc._n.status.includes(t)) score += 18;
    if (doc._n.cat.includes(t)) score += 14;
    if (doc._n.description.includes(t)) score += 10;
    if (doc._n.id === t) score += 120;
  }

  // Small preference for shorter names when tied.
  score += Math.max(0, 8 - Math.min(8, Math.floor(doc.name.length / 8)));

  return score;
}

function computePopupPoint(panelEl) {
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  const rect = panelEl && panelEl.getBoundingClientRect ? panelEl.getBoundingClientRect() : null;
  const panelRight = rect ? rect.right : 0;
  const safeX = Math.max(panelRight + 24, w * 0.55);
  const safeY = Math.max(24, Math.min(h * 0.42, h - 24));
  return { x: safeX, y: safeY };
}

const KEYBOARD_LAYOUTS = {
  azerty: [
    ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'],
    ['w', 'x', 'c', 'v', 'b', 'n'],
    ['é', 'è', 'à', 'ç', '-', '\'', '.'],
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  ],
  qwerty: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
    ['-', '\'', '.', ',', '?'],
    ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  ]
};

function isLetterKey(key) {
  const s = String(key ?? '');
  // Basic Latin letters + common French diacritics.
  return /^[a-zA-Zàâäçéèêëîïôöùûüÿ]$/.test(s);
}

function normalizeKeyboardLayout(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(KEYBOARD_LAYOUTS, normalized)
    ? normalized
    : 'azerty';
}

export function createSearchPanel({ onSelect, onCountryChange, defaultKeyboardLayout } = {}) {
  const t = (key, vars) => (window.i18n && typeof window.i18n.t === 'function')
    ? window.i18n.t(key, vars)
    : key;

  const panel = document.getElementById('mapSearch');
  if (!panel) {
    return {
      setItems: () => {},
      setQuery: () => {},
      focus: () => {},
    };
  }

  const input = panel.querySelector('#mapSearchInput');
  const resultsEl = panel.querySelector('#mapSearchResults');
  const keyboardEl = panel.querySelector('#mapSearchKeyboard');
  const countryEl = panel.querySelector('#mapSearchCountry');
  const clearBtn = panel.querySelector('[data-action="search-clear"]');
  const toggleBtn = panel.querySelector('[data-action="search-toggle"]');
  const layoutBtn = panel.querySelector('[data-action="search-layout"]');

  let docs = [];
  let maxResults = DEFAULT_MAX_RESULTS;
  let currentLayout = normalizeKeyboardLayout(defaultKeyboardLayout);
  let shift = false;
  let selectedCountryNorm = '';

  function emitCountryChange() {
    if (typeof onCountryChange !== 'function') return;
    try { onCountryChange(selectedCountryNorm); } catch { /* ignore */ }
  }

  function getCountryNormFromDoc(doc) {
    if (!doc) return '';
    const key = toCleanText(doc.countryKey);
    if (key) return key;
    const display = toCleanText(doc.country);
    return display ? normalizeForSearch(display) : '';
  }

  function rebuildCountryOptions() {
    if (!countryEl) return;

    const prev = selectedCountryNorm;

    const byNorm = new Map();
    let hasUnknown = false;

    for (const d of docs) {
      const norm = getCountryNormFromDoc(d);
      const display = toCleanText(d.country);
      if (!norm) {
        hasUnknown = true;
        continue;
      }
      if (!byNorm.has(norm)) byNorm.set(norm, display || norm);
    }

    const opts = [];
    opts.push({ value: '', label: t('mapApp.search.countryAll') });
    if (hasUnknown) opts.push({ value: '__unknown__', label: t('mapApp.search.countryUnknown') });

    Array.from(byNorm.entries())
      .sort((a, b) => {
        const ar = countryPriorityRank(a[0], a[1]);
        const br = countryPriorityRank(b[0], b[1]);
        if (ar !== br) return ar - br;
        return String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: 'base' });
      })
      .forEach(([norm, label]) => opts.push({ value: norm, label }));

    countryEl.innerHTML = '';
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      countryEl.appendChild(opt);
    }

    // Keep selection if possible.
    const values = new Set(opts.map(o => o.value));
    if (!values.has(selectedCountryNorm)) selectedCountryNorm = '';
    countryEl.value = selectedCountryNorm;

    if (prev !== selectedCountryNorm) emitCountryChange();
  }

  function setItems(items) {
    const list = Array.isArray(items) ? items : [];
    docs = list.map(buildSearchDoc);
    rebuildCountryOptions();
    render();
  }

  function setQuery(q) {
    if (!input) return;
    input.value = String(q ?? '');
    render();
  }

  function focus() {
    try { input && input.focus && input.focus(); } catch { /* ignore */ }
  }

  function setCollapsed(collapsed) {
    panel.classList.toggle('is-collapsed', !!collapsed);
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  }

  function toggleCollapsed() {
    setCollapsed(!panel.classList.contains('is-collapsed'));
  }

  function renderResults(rows) {
    if (!resultsEl) return;
    if (!rows || rows.length === 0) {
      resultsEl.innerHTML = `<div class="map-search__empty">${escapeHtml(t('mapApp.search.noResults'))}</div>`;
      return;
    }

    const html = rows.map(r => {
      const subtitleParts = [r.country, r.place].map(s => toCleanText(s)).filter(Boolean);
      const subtitle = subtitleParts.join(' • ');

      return `
        <button type="button" class="map-search__result" role="option" data-wonder-id="${escapeHtml(r.id)}">
          <div class="map-search__result-main">
            <div class="map-search__result-name">${escapeHtml(r.name || t('mapApp.search.unnamed'))}</div>
            ${subtitle ? `<div class="map-search__result-sub">${escapeHtml(subtitle)}</div>` : ''}
          </div>
        </button>
      `;
    }).join('');

    resultsEl.innerHTML = html;

    resultsEl.querySelectorAll('.map-search__result').forEach(btn => {
      btn.addEventListener('click', () => {
        const wid = btn.getAttribute('data-wonder-id') || '';
        const doc = docs.find(d => String(d.id) === String(wid)) || null;
        const ref = doc ? doc.ref : null;
        if (!ref) return;

        if (typeof onSelect === 'function') {
          const pt = computePopupPoint(panel);
          onSelect(ref, pt);
        }
      });
    });
  }

  function render() {
    if (!input) return;
    const query = toCleanText(input.value);
    const tokens = tokenize(query);

    const countryFilter = selectedCountryNorm;
    const countryMatches = (doc) => {
      if (!countryFilter) return true;
      if (countryFilter === '__unknown__') return !toCleanText(doc.country);
      return getCountryNormFromDoc(doc) === countryFilter;
    };

    if (!query || tokens.length === 0) {
      // Show everything by default (kiosk-friendly).
      // Dataset size is expected to stay reasonable; if needed, DEFAULT_MAX_RESULTS can be lowered.
      const rows = docs
        .filter(countryMatches)
        .slice()
        .sort((a, b) => {
          const ar = countryPriorityRank(getCountryNormFromDoc(a), a.country);
          const br = countryPriorityRank(getCountryNormFromDoc(b), b.country);
          if (ar !== br) return ar - br;
          const ai = Number.isFinite(a.interestScore) ? a.interestScore : 0;
          const bi = Number.isFinite(b.interestScore) ? b.interestScore : 0;
          if (bi !== ai) return bi - ai;
          return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        })
        .map(d => ({
          id: d.id,
          name: d.name,
          country: d.country,
          countryKey: d.countryKey,
          place: d.place,
          score: 0,
          interestScore: d.interestScore,
          ref: d.ref
        }));

      renderResults(rows);
      return;
    }

    const scored = [];
    for (const doc of docs) {
      if (!countryMatches(doc)) continue;
      const s = scoreDoc(doc, query, tokens);
      if (s > 0) {
        scored.push({
          id: doc.id,
          name: doc.name,
          country: doc.country,
          countryKey: doc.countryKey,
          place: doc.place,
          score: s,
          interestScore: doc.interestScore,
          ref: doc.ref
        });
      }
    }

    scored.sort((a, b) => {
      const ar = countryPriorityRank(a.countryKey, a.country);
      const br = countryPriorityRank(b.countryKey, b.country);
      if (ar !== br) return ar - br;
      const ai = Number.isFinite(a.interestScore) ? a.interestScore : 0;
      const bi = Number.isFinite(b.interestScore) ? b.interestScore : 0;
      if (bi !== ai) return bi - ai;
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });

    renderResults(scored.slice(0, maxResults));
  }

  function keyLabel(key) {
    if (key === 'space') return t('mapApp.search.keys.space');
    if (key === 'backspace') return t('mapApp.search.keys.backspace');
    if (key === 'clear') return t('mapApp.search.keys.clear');
    if (key === 'shift') return t('mapApp.search.keys.shift');
    return String(key);
  }

  function pressKey(key) {
    if (!input) return;

    if (key === 'backspace') {
      input.value = input.value.slice(0, -1);
    } else if (key === 'clear') {
      input.value = '';
    } else if (key === 'space') {
      input.value = input.value + ' ';
    } else if (key === 'shift') {
      shift = !shift;
      renderKeyboard();
      return;
    } else {
      const raw = String(key);
      const k = (shift && isLetterKey(raw)) ? raw.toUpperCase() : raw;
      input.value = input.value + k;
      if (shift) {
        shift = false;
        renderKeyboard();
      }
    }

    try { input.focus(); } catch { /* ignore */ }
    render();
  }

  function makeKeyButton(key, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `map-search__key ${extraClass}`.trim();
    btn.textContent = keyLabel(key);

    // Touch-friendly: avoid focus stealing issues.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pressKey(key);
    });

    return btn;
  }

  function renderKeyboard() {
    if (!keyboardEl) return;
    keyboardEl.innerHTML = '';

    const layout = KEYBOARD_LAYOUTS[currentLayout] || KEYBOARD_LAYOUTS.azerty;

    const topRow = document.createElement('div');
    topRow.className = 'map-search__kbd-row map-search__kbd-row--controls';
    topRow.appendChild(makeKeyButton('shift', shift ? 'is-active' : ''));
    topRow.appendChild(makeKeyButton('space', 'is-wide'));
    topRow.appendChild(makeKeyButton('backspace', 'is-wide'));
    topRow.appendChild(makeKeyButton('clear', 'is-wide'));
    keyboardEl.appendChild(topRow);

    for (const rowKeys of layout) {
      const row = document.createElement('div');
      row.className = 'map-search__kbd-row';
      for (const k of rowKeys) {
        const raw = String(k);
        const label = (shift && isLetterKey(raw)) ? raw.toUpperCase() : raw;
        row.appendChild(makeKeyButton(label));
      }
      keyboardEl.appendChild(row);
    }
  }

  function refreshTranslations() {
    if (layoutBtn) layoutBtn.textContent = currentLayout.toUpperCase();
    renderKeyboard();
    rebuildCountryOptions();
    render();
  }

  // Wire events
  if (input) {
    input.addEventListener('input', render);
    input.addEventListener('focus', () => {
      // Expand panel when user interacts.
      panel.classList.remove('is-collapsed');
    });
  }

  if (countryEl) {
    countryEl.addEventListener('change', () => {
      selectedCountryNorm = String(countryEl.value || '');
      emitCountryChange();
      render();
      try { input && input.focus && input.focus(); } catch { /* ignore */ }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!input) return;
      input.value = '';
      render();
      try { input.focus(); } catch { /* ignore */ }
    });
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleCollapsed);
  }

  if (layoutBtn) {
    layoutBtn.addEventListener('click', () => {
      currentLayout = (currentLayout === 'azerty') ? 'qwerty' : 'azerty';
      layoutBtn.textContent = currentLayout.toUpperCase();
      renderKeyboard();
      try { input.focus(); } catch { /* ignore */ }
    });
  }

  // Initial
  refreshTranslations();

  // If i18n exists, re-render keyboard labels after it is ready.
  if (window.i18n && window.i18n.ready && typeof window.i18n.ready.then === 'function') {
    window.i18n.ready.then(() => {
      refreshTranslations();
    }).catch(() => {
      /* ignore */
    });
  }

  return {
    setItems,
    setQuery,
    focus,
    setCollapsed,
    getState: () => ({
      query: input ? String(input.value || '') : '',
      country: selectedCountryNorm,
      collapsed: panel.classList.contains('is-collapsed')
    }),
    refreshTranslations,
    setCountryFilter: (norm) => {
      selectedCountryNorm = String(norm || '');
      if (countryEl) countryEl.value = selectedCountryNorm;
      emitCountryChange();
      render();
    },
  };
}
