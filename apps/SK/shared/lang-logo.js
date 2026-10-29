(() => {
  const normalizeLang = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';

  const getLogoLang = () => {
    const queryParams = (() => {
      try {
        return new URL(window.location.href).searchParams;
      } catch {
        return null;
      }
    })();

    const primaryLang = normalizeLang(
      window.i18n?.primaryLang
      || queryParams?.get('primaryLang')
      || getMeta('i18n-primary-lang')
    );

    if (primaryLang) return primaryLang;

    return normalizeLang(
      window.i18n?.lang
      || queryParams?.get('lang')
      || document.documentElement.lang
    );
  };

  const isGerman = (lang) => lang === 'de' || lang.startsWith('de-');

  const applyLangLogo = (root = document) => {
    const scope = root && root.querySelectorAll ? root : document;
    const lang = getLogoLang();

    scope.querySelectorAll('[data-lang-logo-default][data-lang-logo-de]').forEach((element) => {
      const defaultSrc = element.getAttribute('data-lang-logo-default') || '';
      const deSrc = element.getAttribute('data-lang-logo-de') || '';
      const nextSrc = isGerman(lang) ? deSrc : defaultSrc;
      if (!nextSrc || element.getAttribute('src') === nextSrc) return;
      element.setAttribute('src', nextSrc);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyLangLogo(), { once: true });
  } else {
    applyLangLogo();
  }

  window.addEventListener('i18n:ready', () => applyLangLogo());
  window.addEventListener('i18n:changed', () => applyLangLogo());
})();