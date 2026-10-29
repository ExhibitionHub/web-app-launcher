(() => {
    const getMeta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
    const normalizeLang = (value) => String(value || '').trim().toLowerCase().replace(/_/g, '-');
    const resolveLangPath = () => {
        const url = new URL(window.location.href);
        const selectedLang = normalizeLang(url.searchParams.get('lang'));
        const defaultLang = normalizeLang(getMeta('i18n-default-lang')) || 'en';
        const lang = selectedLang || defaultLang;
        const base = getMeta('i18n-base') || './lang/';

        return new URL(`${lang}.json`, new URL(base, window.location.href)).toString();
    };

    const LANG_PATH = resolveLangPath();
    const fallbackData = {};

    const getByPath = (obj, path) => {
        if (!obj || !path) return undefined;
        return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    };

    const translate = (key, fallback = '') => {
        const value = getByPath(window.langData || {}, key);
        if (value === undefined || value === null) {
            return fallback;
        }
        return value;
    };

    const applyTranslations = (data = window.langData) => {
        if (!data) return;

        if (data.meta?.documentTitle) {
            document.title = data.meta.documentTitle;
        }

        document.querySelectorAll('[data-i18n]').forEach((node) => {
            const key = node.getAttribute('data-i18n');
            const attr = node.getAttribute('data-i18n-attr');
            const value = translate(key);
            if (value === undefined || value === null || value === '') return;

            if (attr) {
                node.setAttribute(attr, value);
            } else {
                node.textContent = value;
            }
        });
    };

    window.langData = fallbackData;
    window.t = translate;
    window.applyTranslations = applyTranslations;

    window.langPromise = fetch(LANG_PATH)
        .then((resp) => {
            if (!resp.ok) throw new Error(`Unable to load language file (${resp.status})`);
            return resp.json();
        })
        .then((data) => {
            window.langData = data || {};
            applyTranslations(window.langData);
            return window.langData;
        })
        .catch((err) => {
            console.error('Lang load failed:', err);
            window.langData = fallbackData;
            return window.langData;
        });
})();
