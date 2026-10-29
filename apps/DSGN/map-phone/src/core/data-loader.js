const DATA_FILES = [
  'case.json',
  'characters.json',
  'locations.json',
  'events.json',
  'messages.json',
  'ui-flow.json',
];

function normalizeLang(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0] || 'en';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]));
  }

  return value;
}

function deepMerge(target, source) {
  if (Array.isArray(source)) {
    return source.map(cloneValue);
  }

  if (!isPlainObject(source)) {
    return cloneValue(source);
  }

  const base = isPlainObject(target) ? { ...target } : {};

  Object.entries(source).forEach(([key, value]) => {
    base[key] = deepMerge(base[key], value);
  });

  return base;
}

function getActiveDataLang() {
  return normalizeLang(window.i18n?.lang || document.documentElement.lang || 'en');
}

function getDefaultDataLang() {
  return normalizeLang(window.i18n?.defaultLang || 'en');
}

function getLocalizedDataUrl(fileName, lang) {
  const localizedName = fileName.replace(/\.json$/i, `.${lang}.json`);
  return new URL(`../../lang/data/${localizedName}`, import.meta.url);
}

async function loadOptionalLocalizedJson(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    const message = String(error?.message || '');
    if (
      message.includes('Failed to fetch') ||
      message.includes('Load failed') ||
      message.includes('ERR_FILE_NOT_FOUND')
    ) {
      return null;
    }

    throw error;
  }
}

export async function loadAppData(baseData = {}, baseUrl = new URL('../../data/', import.meta.url)) {
  let merged = deepMerge({}, baseData);
  const activeLang = getActiveDataLang();
  const defaultLang = getDefaultDataLang();

  for (const fileName of DATA_FILES) {
    const response = await fetch(new URL(fileName, baseUrl), { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to load data file: ${fileName} (${response.status})`);
    }

    const json = await response.json();
    merged = deepMerge(merged, json);

    if (activeLang !== defaultLang) {
      const localizedJson = await loadOptionalLocalizedJson(getLocalizedDataUrl(fileName, activeLang));
      if (localizedJson) {
        merged = deepMerge(merged, localizedJson);
      }
    }
  }

  return merged;
}