(() => {
  const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
  const normalizeLang = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const getBaseLang = (value) => normalizeLang(value).split('-')[0];
  const uniqueLanguages = (values) => [...new Set(values.map(normalizeLang).filter(Boolean))];
  const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

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
    if (!available.length) return supported;
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

    return getDefaultLang();
  };

  const setSelectedLang = (lang) => {
    if (getLockedLang()) return;
    const nextLang = normalizeLang(lang);
    if (!nextLang) return;

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', nextLang);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
    }
  };

  const getBaseUrl = () => new URL(getMeta('i18n-base') || './lang/', window.location.href).toString();
  const getForcedDirection = () => {
    const value = normalizeLang(getMeta('i18n-force-dir') || getMeta('i18n-layout-dir'));
    return value === 'rtl' || value === 'ltr' ? value : '';
  };
  const getLanguageDirection = (lang) => getForcedDirection() || (RTL_LANGUAGES.has(getBaseLang(lang)) ? 'rtl' : 'ltr');

  const getByPath = (obj, path) => {
    if (!obj || !path) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];

    const parts = String(path).split('.').filter(Boolean);
    let current = obj;
    for (const part of parts) {
      if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  };

  const interpolate = (template, vars) => {
    if (!vars) return template;
    return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return '';
      return String(vars[key]);
    });
  };

  let langData = {};
  let currentLang = getSelectedLang();

  const fetchLanguageData = async (lang) => {
    const url = new URL(`${lang}.json`, getBaseUrl()).toString();
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to load language file: ${url} (${response.status})`);
    return response.json();
  };

  const load = async (lang) => {
    const requestedLang = normalizeLang(lang) || getDefaultLang();
    const allowedLanguages = getSwitchableLanguages();
    const defaultLang = getDefaultLang();
    const resolvedLang = requestedLang === defaultLang || allowedLanguages.includes(requestedLang)
      ? requestedLang
      : defaultLang;

    try {
      langData = await fetchLanguageData(resolvedLang);
      currentLang = resolvedLang;
    } catch (error) {
      if (resolvedLang === defaultLang) throw error;
      langData = await fetchLanguageData(defaultLang);
      currentLang = defaultLang;
    }

    setSelectedLang(currentLang);
  };

  const t = (key, vars) => {
    const raw = getByPath(langData, key);
    if (raw === undefined || raw === null) return key;
    if (typeof raw === 'string') return interpolate(raw, vars);
    return raw;
  };

  const applyToElement = (element) => {
    if (!element || element.nodeType !== 1) return;

    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = t(key);

    const htmlKey = element.getAttribute('data-i18n-html');
    if (htmlKey) element.innerHTML = t(htmlKey);

    const attrMap = element.getAttribute('data-i18n-attr');
    if (!attrMap) return;

    attrMap.split(';').map((value) => value.trim()).filter(Boolean).forEach((pair) => {
      const index = pair.indexOf(':');
      if (index <= 0) {
        if (key) element.setAttribute(pair, t(key));
        return;
      }

      const attr = pair.slice(0, index).trim();
      const attrKey = pair.slice(index + 1).trim();
      if (!attr || !attrKey) return;
      element.setAttribute(attr, t(attrKey));
    });
  };

  const apply = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach(applyToElement);

    const titleKey = getMeta('i18n-title-key');
    if (titleKey) document.title = t(titleKey);

    const dir = getLanguageDirection(currentLang);
    document.documentElement.lang = currentLang;
    document.documentElement.dir = dir;
    document.documentElement.dataset.langDir = dir;
  };

  const createEventDetail = () => ({
    lang: currentLang,
    dir: getLanguageDirection(currentLang),
    data: langData,
    defaultLang: getDefaultLang(),
    primaryLang: getPrimaryLang(),
    supportedLanguages: getSupportedLanguages(),
    availableLanguages: getAvailableLanguages(),
    switchableLanguages: getSwitchableLanguages(),
  });

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
    setLang: async (lang) => {
      const nextLang = getLockedLang() || normalizeLang(lang);
      if (!nextLang) return;
      await load(nextLang);
      apply();
      window.dispatchEvent(new CustomEvent('i18n:changed', { detail: createEventDetail() }));
    },
  };

  window.i18n = api;
  api.ready = (async () => {
    await load(currentLang);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
    } else {
      apply();
    }

    window.dispatchEvent(new CustomEvent('i18n:ready', { detail: createEventDetail() }));
    return true;
  })();
})();
