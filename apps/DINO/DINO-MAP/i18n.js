// Lightweight i18n runtime for Dino-map.
// - Loads ./lang/<lang>.json (base path configurable via <meta name="i18n-base">)
// - Resolves nested keys via dot-notation (e.g. "beninmask.masters.desc")
// - Applies translations to DOM nodes using data-i18n and data-i18n-attr
// - Exposes a small API on window.i18n: { lang, setLang(), t(), ready }

(function () {
  const hasWindow = typeof window !== 'undefined';
  if (!hasWindow) return;

  const doc = window.document;
  const meta = (name) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';

  const SUPPORTED_LANGS = ['fr', 'en', 'es'];
  const DEFAULT_LANG = (meta('i18n-default-lang') || 'fr').trim() || 'fr';
  const BASE_RAW = (meta('i18n-base') || './lang/').trim() || './lang/';
  const TITLE_KEY = (meta('i18n-title-key') || '').trim();
  const LOCK_RAW = (meta('i18n-lock-lang') || '').trim();

  function normalizeLang(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const base = raw.split(/[-_]/)[0];
    return SUPPORTED_LANGS.includes(base) ? base : '';
  }

  function getLockedLang() {
    if (!LOCK_RAW) return '';
    const v = (LOCK_RAW === '1' || LOCK_RAW.toLowerCase() === 'true') ? DEFAULT_LANG : LOCK_RAW;
    return normalizeLang(v);
  }

  function getInitialLang() {
    const locked = getLockedLang();
    if (locked) return locked;

    try {
      const url = new URL(window.location.href);
      const q = normalizeLang(url.searchParams.get('primaryLang') || url.searchParams.get('lang'));
      if (q) return q;
    } catch { /* ignore */ }

    try {
      const stored = normalizeLang(window.localStorage.getItem('lang'));
      if (stored) return stored;
    } catch { /* ignore */ }

    return normalizeLang(DEFAULT_LANG) || 'fr';
  }

  function resolveKey(dict, key) {
    if (!dict || typeof dict !== 'object') return undefined;
    const k = String(key || '');
    if (!k) return undefined;

    // Fast path: allow flat maps with dotted keys too.
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];

    // Dot traversal.
    const parts = k.split('.').filter(Boolean);
    let cur = dict;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function interpolate(value, vars) {
    if (!vars || typeof vars !== 'object' || !value || typeof value !== 'string') return value;
    let out = value;
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${String(k)}\\}`, 'g'), String(v));
    }
    return out;
  }

  function toBaseUrl(base) {
    try {
      // Use document.baseURI so relative bases work correctly.
      return new URL(base, doc.baseURI).toString();
    } catch {
      return base;
    }
  }

  const baseUrl = toBaseUrl(BASE_RAW);
  const cache = new Map(); // lang -> json

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} while fetching ${url}`);
    return r.json();
  }

  async function loadLangData(lang) {
    const l = normalizeLang(lang);
    if (!l) throw new Error('Unsupported lang: ' + lang);
    if (cache.has(l)) return cache.get(l);

    const url = new URL(`${l}.json`, baseUrl).toString();
    const data = await fetchJson(url);
    cache.set(l, data);
    return data;
  }

  function applyDomTranslations(root = doc) {
    const t = api.t;
    try {
      root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const translated = t(key);
        // Default to textContent for safety.
        try { el.textContent = translated; } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    try {
      root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        const raw = el.getAttribute('data-i18n-attr') || '';
        const parts = raw.split(';').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          const idx = part.indexOf(':');
          if (idx <= 0) continue;
          const attr = part.slice(0, idx).trim();
          const key = part.slice(idx + 1).trim();
          if (!attr || !key) continue;
          const translated = t(key);
          try { el.setAttribute(attr, translated); } catch { /* ignore */ }
        }
      });
    } catch { /* ignore */ }

    // Title
    if (TITLE_KEY) {
      try {
        const translated = t(TITLE_KEY);
        if (translated && translated !== TITLE_KEY) doc.title = translated;
      } catch { /* ignore */ }
    }
  }

  const api = {
    lang: getInitialLang(),
    data: null,
    ready: null,
    t(key, vars) {
      const v = resolveKey(api.data, key);
      if (typeof v === 'string') return interpolate(v, vars);
      return String(key || '');
    },
    async setLang(next) {
      const locked = getLockedLang();
      const normalized = locked || normalizeLang(next);
      if (!normalized) return;

      api.lang = normalized;
      try { doc.documentElement.lang = normalized; } catch { /* ignore */ }
      try { window.localStorage.setItem('lang', normalized); } catch { /* ignore */ }

      api.data = await loadLangData(normalized);
      applyDomTranslations(doc);
      try {
        window.dispatchEvent(new CustomEvent('i18n:loaded', { detail: { lang: normalized } }));
      } catch { /* ignore */ }
    }
  };

  // Expose globally
  window.i18n = api;

  // Initial load
  api.ready = (async () => {
    try {
      await api.setLang(api.lang);
    } catch (err) {
      // Leave api.t as key passthrough when failing.
      console.warn('[i18n] Failed to load language:', err);
    }
  })();
})();
