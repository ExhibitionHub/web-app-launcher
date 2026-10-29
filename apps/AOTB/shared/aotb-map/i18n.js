(() => {
  const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
  const normalizeLang = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const uniqueLanguages = (values) => [...new Set(values.map(normalizeLang).filter(Boolean))];

  const getDefaultLang = () => normalizeLang(getMeta('i18n-default-lang')) || 'en';
  const getSupportedLanguages = () => {
    const fromMeta = uniqueLanguages((getMeta('i18n-supported-langs') || '').split(','));
    return fromMeta.length ? fromMeta : [getDefaultLang()];
  };

  const getAvailableLanguages = () => {
    const url = new URL(window.location.href);
    return uniqueLanguages((url.searchParams.get('availableLangs') || getMeta('i18n-available-langs') || '').split(','));
  };

  const getPrimaryLang = () => {
    const url = new URL(window.location.href);
    return normalizeLang(url.searchParams.get('primaryLang') || getMeta('i18n-primary-lang'));
  };

  const getSwitchableLanguages = () => {
    const supported = getSupportedLanguages();
    const available = getAvailableLanguages();
    if (!available.length) {
      return supported;
    }

    const intersection = available.filter((language) => supported.includes(language));
    return intersection.length ? intersection : supported;
  };

  const getLockedLang = () => {
    const raw = (getMeta('i18n-lock-lang') || '').trim();
    if (!raw || raw === '0' || raw.toLowerCase() === 'false') return '';
    if (raw === '1' || raw.toLowerCase() === 'true') return getDefaultLang();
    return normalizeLang(raw);
  };

  const getSelectedLang = () => {
    const locked = getLockedLang();
    if (locked) return locked;

    const url = new URL(window.location.href);
    const fromQuery = normalizeLang(url.searchParams.get('lang'));
    if (fromQuery) return fromQuery;

    const fromPrimary = getPrimaryLang();
    if (fromPrimary) return fromPrimary;

    const fromStorage = (() => {
      try { return normalizeLang(window.localStorage.getItem('lang')); } catch { return ''; }
    })();
    if (fromStorage) return fromStorage;

    return getDefaultLang();
  };

  const setSelectedLang = (lang) => {
    if (getLockedLang()) return;

    const nextLang = normalizeLang(lang);
    if (!nextLang) return;

    try { window.localStorage.setItem('lang', nextLang); } catch { /* ignore */ }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', nextLang);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // ignore
    }
  };

  const getBaseUrl = () => {
    const base = getMeta('i18n-base');
    if (base) return new URL(base, window.location.href).toString();
    return new URL('./lang/', window.location.href).toString();
  };

  const getPreservedQueryKeys = () => (getMeta('i18n-link-preserve') || 'lang,availableLangs,primaryLang')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const buildLanguageUrl = (lang) => {
    const url = new URL(window.location.href);
    const nextLang = normalizeLang(lang);
    if (nextLang) {
      url.searchParams.set('lang', nextLang);
    } else {
      url.searchParams.delete('lang');
    }

    return `${url.pathname}${url.search}${url.hash}`;
  };

  const getByPath = (obj, path) => {
    if (!obj || !path) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];

    const parts = String(path).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        return undefined;
      }
    }
    return cur;
  };

  const interpolate = (template, vars) => {
    if (!vars) return template;
    return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return '';
      return String(vars[key]);
    });
  };

  const stripBom = (text) => {
    if (!text) return text;
    if (text.charCodeAt(0) === 0xFEFF) return text.slice(1);
    return text;
  };

  const hasWindowRequire = typeof window !== 'undefined' && typeof window.require === 'function';
  const fs = hasWindowRequire ? window.require('fs') : null;
  const path = hasWindowRequire ? window.require('path') : null;

  const getFsBasePath = () => {
    if (!fs || !path) return '';
    try {
      if (typeof process !== 'undefined' && process && process.resourcesPath) {
        return process.resourcesPath;
      }
    } catch {
      // ignore
    }

    try {
      if (typeof __dirname !== 'undefined') {
        let base = __dirname;
        if (base.includes('resources\\app') || base.includes('resources/app')) {
          base = path.dirname(base);
        }
        return base;
      }
    } catch {
      // ignore
    }

    try {
      const pathname = String(window.location.pathname || '');
      return path.dirname(pathname);
    } catch {
      return '';
    }
  };

  const findFsCandidatePath = (relativePath) => {
    if (!fs || !path) return '';
    const basePath = getFsBasePath();
    const normalized = String(relativePath || '')
      .replace(/^\.\//, '')
      .replace(/^file:\/\//, '')
      .replace(/^\/+/, '');

    const prefixes = [
      '',
      'app',
      'app-maps',
      path.join('app', 'app-maps'),
      'app.asar',
      path.join('app.asar', 'app-maps'),
      'app.asar.unpacked',
      path.join('app.asar.unpacked', 'app-maps')
    ];

    const candidates = [];
    for (const prefix of prefixes) {
      candidates.push(path.join(basePath, prefix, normalized));
    }
    candidates.push(path.join(basePath, normalized));

    const seen = new Set();
    const uniqueCandidates = [];
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      uniqueCandidates.push(candidate);
    }

    const existing = uniqueCandidates.find((candidate) => {
      try { return fs.existsSync(candidate); } catch { return false; }
    });

    return existing || uniqueCandidates[0] || '';
  };

  const fileUrlToPath = (url) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'file:') return null;

      let normalizedPath = decodeURIComponent(parsedUrl.pathname || '');
      if (/^\/[a-zA-Z]:\//.test(normalizedPath)) normalizedPath = normalizedPath.slice(1);
      if (path && typeof path.normalize === 'function') return path.normalize(normalizedPath);
      return normalizedPath;
    } catch {
      return null;
    }
  };

  let langData = {};
  let currentLang = getSelectedLang();

  const loadViaFs = (fileUrl) => {
    if (!fs || !path) throw new Error('fs/path not available');
    const filePath = fileUrlToPath(fileUrl);
    if (!filePath) throw new Error('Not a file url');
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripBom(text));
  };

  const loadViaFsRelative = (relativePath) => {
    if (!fs || !path) throw new Error('fs/path not available');
    const fullPath = findFsCandidatePath(relativePath);
    if (!fullPath) throw new Error('Unable to resolve language file path');
    const text = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(stripBom(text));
  };

  const loadViaFetch = async (fileUrl) => {
    const res = await fetch(fileUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Unable to load language file: ${fileUrl} (${res.status})`);
    const text = await res.text();
    return JSON.parse(stripBom(text));
  };

  const loadRawLanguageData = async (lang) => {
    const baseUrl = getBaseUrl();
    const fileUrl = new URL(`${lang}.json`, baseUrl).toString();
    const baseMeta = getMeta('i18n-base') || './lang/';
    const metaLooksLikeUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(baseMeta);

    let parsed = null;
    if (fs) {
      if (fileUrl.startsWith('file:')) {
        parsed = loadViaFs(fileUrl);
      } else if (!metaLooksLikeUrl) {
        const baseRel = String(baseMeta || './lang/').replace(/\\/g, '/');
        const rel = baseRel.endsWith('/') ? `${baseRel}${lang}.json` : `${baseRel}/${lang}.json`;
        parsed = loadViaFsRelative(rel);
      }
    }

    if (!parsed) {
      parsed = await loadViaFetch(fileUrl);
    }

    return parsed || {};
  };

  const load = async (lang) => {
    const requestedLang = normalizeLang(lang) || getDefaultLang();
    const allowedLanguages = getSwitchableLanguages();
    const fallbackLang = allowedLanguages[0] || getDefaultLang();
    const resolvedLang = allowedLanguages.includes(requestedLang) ? requestedLang : fallbackLang;

    try {
      langData = await loadRawLanguageData(resolvedLang);
      currentLang = resolvedLang;
    } catch (error) {
      if (resolvedLang === fallbackLang) throw error;
      langData = await loadRawLanguageData(fallbackLang);
      currentLang = fallbackLang;
    }

    setSelectedLang(currentLang);
  };

  const t = (key, vars) => {
    const raw = getByPath(langData, key);
    if (raw === undefined || raw === null) return key;
    if (typeof raw === 'string') return interpolate(raw, vars);
    return raw;
  };

  const applyToElement = (el) => {
    if (!el || el.nodeType !== 1) return;

    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);

    const htmlKey = el.getAttribute('data-i18n-html');
    if (htmlKey) el.innerHTML = t(htmlKey);

    const attrMap = el.getAttribute('data-i18n-attr');
    if (attrMap) {
      attrMap.split(';').map((value) => value.trim()).filter(Boolean).forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx <= 0) return;

        const attr = pair.slice(0, idx).trim();
        const attrKey = pair.slice(idx + 1).trim();
        if (!attr || !attrKey) return;
        el.setAttribute(attr, t(attrKey));
      });
    }
  };

  const decorateLinks = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    const keys = getPreservedQueryKeys();
    const currentUrl = new URL(window.location.href);

    scope.querySelectorAll('a[href]').forEach((link) => {
      const rawHref = link.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return;
      }

      let resolvedUrl;
      try {
        resolvedUrl = new URL(rawHref, window.location.href);
      } catch {
        return;
      }

      if (resolvedUrl.origin !== window.location.origin) return;

      keys.forEach((queryKey) => {
        if (queryKey === 'lang') {
          if (currentLang) {
            resolvedUrl.searchParams.set('lang', currentLang);
          } else {
            resolvedUrl.searchParams.delete('lang');
          }
          return;
        }

        const queryValue = currentUrl.searchParams.get(queryKey);
        if (queryValue) {
          resolvedUrl.searchParams.set(queryKey, queryValue);
        } else {
          resolvedUrl.searchParams.delete(queryKey);
        }
      });

      link.setAttribute('href', `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`);
    });
  };

  const apply = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach(applyToElement);

    const titleKey = getMeta('i18n-title-key');
    if (titleKey) document.title = t(titleKey);
    document.documentElement.lang = currentLang;
    decorateLinks(scope);
  };

  const createEventDetail = () => ({
    lang: currentLang,
    data: langData,
    defaultLang: getDefaultLang(),
    primaryLang: getPrimaryLang(),
    supportedLanguages: getSupportedLanguages(),
    availableLanguages: getAvailableLanguages(),
    switchableLanguages: getSwitchableLanguages(),
  });

  const dispatchCompatEvent = (eventName, detail) => {
    try {
      if (typeof window === 'undefined') return;
      if (typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
        return;
      }

      const event = document.createEvent('Event');
      event.initEvent(eventName, true, true);
      window.dispatchEvent(event);
    } catch {
      // ignore
    }
  };

  const emitChange = () => {
    const detail = createEventDetail();
    dispatchCompatEvent('i18n:change', detail);
    dispatchCompatEvent('i18n:changed', detail);
  };

  const emitReady = () => {
    dispatchCompatEvent('i18n:ready', createEventDetail());
  };

  const api = {
    get lang() { return currentLang; },
    get data() { return langData; },
    get defaultLang() { return getDefaultLang(); },
    get primaryLang() { return getPrimaryLang(); },
    get supportedLanguages() { return getSupportedLanguages(); },
    get availableLanguages() { return getAvailableLanguages(); },
    get switchableLanguages() { return getSwitchableLanguages(); },
    t,
    apply,
    decorateLinks,
    buildLanguageUrl,
    setLang: async (lang) => {
      const nextLang = getLockedLang() || normalizeLang(lang);
      if (!nextLang) return;
      await load(nextLang);
      apply();
      emitChange();
    },
  };

  window.i18n = api;

  api.ready = (async () => {
    await load(currentLang);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        apply();
        emitChange();
        emitReady();
      }, { once: true });
    } else {
      apply();
      emitChange();
      emitReady();
    }
    return true;
  })();
})();
