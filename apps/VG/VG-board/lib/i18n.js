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
  const getLockedLang = () => {
    const raw = (getMeta('i18n-lock-lang') || '').trim();
    if (!raw || raw === '0' || raw.toLowerCase() === 'false') return '';
    if (raw === '1' || raw.toLowerCase() === 'true') return getDefaultLang();
    return normalizeLang(raw);
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
  const resolveRequestedLang = () => {
    const locked = getLockedLang();
    if (locked) return locked;

    const url = new URL(window.location.href);
    const fromQuery = normalizeLang(url.searchParams.get('lang'));
    if (fromQuery) return fromQuery;

    const primaryLang = getPrimaryLang();
    if (primaryLang) return primaryLang;

    return getDefaultLang();
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
  const getLanguageLabel = (lang) => {
    const normalized = normalizeLang(lang);
    if (!normalized) return '';

    const fallbackLabels = {
      de: 'Deutsch',
      en: 'English',
      et: 'Eesti',
      fr: 'Francais',
    };

    if (fallbackLabels[normalized]) {
      return fallbackLabels[normalized];
    }

    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
        const label = new Intl.DisplayNames([normalized], { type: 'language' }).of(normalized);
        if (label) return label;
      }
    } catch {
    }

    return normalized.toUpperCase();
  };

  let currentLang = resolveRequestedLang();

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
      languages.forEach((language) => {
        const option = document.createElement('a');
        option.className = 'lang-switcher__option';
        option.href = buildLanguageUrl(language);
        option.textContent = getLanguageLabel(language);
        option.setAttribute('hreflang', language);
        option.setAttribute('lang', language);
        option.dataset.lang = language;
        option.dataset.langSwitchOption = 'true';

        if (language === currentLang) {
          option.classList.add('is-active');
          option.setAttribute('aria-current', 'page');
        }

        option.addEventListener('click', (event) => {
          event.preventDefault();

          if (language === currentLang) {
            return;
          }

          void api.setLang(language);
        });

        container.appendChild(option);
      });
    });
  };

  const apply = (root = document) => {
    document.documentElement.lang = currentLang || getDefaultLang();
    renderLanguageSwitchers(root);
    decorateLinks(root);
  };

  const createEventDetail = () => ({
    lang: currentLang,
    defaultLang: getDefaultLang(),
    primaryLang: getPrimaryLang(),
    supportedLanguages: getSupportedLanguages(),
    availableLanguages: getAvailableLanguages(),
    switchableLanguages: getSwitchableLanguages(),
  });

  const api = {
    get lang() { return currentLang; },
    get defaultLang() { return getDefaultLang(); },
    get primaryLang() { return getPrimaryLang(); },
    get supportedLanguages() { return getSupportedLanguages(); },
    get availableLanguages() { return getAvailableLanguages(); },
    get switchableLanguages() { return getSwitchableLanguages(); },
    apply,
    decorateLinks,
    buildLanguageUrl,
    renderLanguageSwitchers,
    setLang: async (lang) => {
      const nextLang = getLockedLang() || normalizeLang(lang);
      const allowedLanguages = getSwitchableLanguages();
      const defaultLang = getDefaultLang();
      const resolvedLang = nextLang && allowedLanguages.includes(nextLang) ? nextLang : defaultLang;

      currentLang = resolvedLang;

      const url = new URL(window.location.href);
      url.searchParams.set('lang', currentLang);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);

      apply();
      window.dispatchEvent(new CustomEvent('i18n:changed', { detail: createEventDetail() }));
    },
  };

  window.i18n = api;
  api.ready = (async () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
    } else {
      apply();
    }

    window.dispatchEvent(new CustomEvent('i18n:ready', { detail: createEventDetail() }));
    return true;
  })();
})();