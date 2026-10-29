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
  const getLanguageLabel = (lang) => {
    const normalized = normalizeLang(lang);
    if (!normalized) return '';

    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
        const label = new Intl.DisplayNames([normalized], { type: 'language' }).of(normalized);
        if (label) return label.charAt(0).toUpperCase() + label.slice(1);
      }
    } catch {
    }

    const fallbackLabels = {
      en: 'English',
      de: 'Deutsch',
      es: 'Espanol',
      fr: 'Francais',
      nl: 'Nederlands',
    };

    return fallbackLabels[normalized] || normalized.toUpperCase();
  };

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
    if (attrMap) {
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
    }
  };

  const decorateLinks = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    const keys = getPreservedQueryKeys();
    const currentUrl = new URL(window.location.href);

    scope.querySelectorAll('a[href]').forEach((link) => {
      if (link.hasAttribute('data-lang-switch-option')) return;

      const rawHref = link.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) return;

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

  const ensureLanguageSwitcherStyles = () => {
    if (document.getElementById('eh-lang-switcher-select-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'eh-lang-switcher-select-styles';
    style.textContent = `
      [data-lang-switcher] .lang-switcher__select {
        appearance: none;
        -webkit-appearance: none;
        min-width: 7rem;
        max-width: 100%;
        min-height: 46px;
        padding: 0.7rem 2.4rem 0.7rem 0.95rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(0, 0, 0, 0.36);
        color: inherit;
        font: inherit;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
      }

      [data-lang-switcher] .lang-switcher__select:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.38);
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  };

  const renderLanguageSwitchers = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    const languages = getSwitchableLanguages();
    const locked = getLockedLang();

    scope.querySelectorAll('[data-lang-switcher]').forEach((container) => {
      container.textContent = '';

      if (locked || languages.length <= 1) {
        container.hidden = true;
        return;
      }

      container.hidden = false;
      container.setAttribute('data-lang-count', String(languages.length));
      ensureLanguageSwitcherStyles();

      const select = document.createElement('select');
      select.className = 'lang-switcher__select';
      select.setAttribute('aria-label', container.getAttribute('aria-label') || 'Language selector');

      languages.forEach((language) => {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = getLanguageLabel(language);
        option.setAttribute('lang', language);
        select.appendChild(option);
      });

      select.value = currentLang;
      select.addEventListener('change', () => {
        const nextLanguage = normalizeLang(select.value);
        if (!nextLanguage || nextLanguage === currentLang) {
          return;
        }

        void api.setLang(nextLanguage).catch((error) => {
          console.error('Unable to switch language:', error);
        });
      });

      container.appendChild(select);
    });
  };

  const apply = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]').forEach(applyToElement);

    const titleKey = getMeta('i18n-title-key');
    if (titleKey) document.title = t(titleKey);
    document.documentElement.lang = currentLang;
    renderLanguageSwitchers(scope);
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
    renderLanguageSwitchers,
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