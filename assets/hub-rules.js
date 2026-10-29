// Rules for the hub data, shared by the hub page (browser) and the check scripts (Node).
// Pure code: no file access, no browser APIs. File and GitHub access is passed in.
//
// Schema (data/families.json + data/cards/<id>.json, built into apps/manifest.json):
//   { "families": [ { "id", "label" } ],
//     "entries":  [ launch card | download card ] }
//   launch card:   id, family, type "launch", title, description, url, languages[],
//                  defaultLanguage, idleTimeoutSec (+ optional launchQuery,
//                  launchOptions, requiresSecureContext)
//   download card: id, family, type "download", title, description,
//                  downloads [ { version, url } ]

const LAUNCH_KEYS = ['id', 'family', 'type', 'title', 'description', 'url', 'languages', 'defaultLanguage', 'idleTimeoutSec'];
const APP_MANIFEST_EXTRA_KEYS = ['launchQuery', 'launchOptions', 'requiresSecureContext'];
const CARD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLanguageCode(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

export function normalizeLanguageList(value) {
  const rawValues = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return rawValues
    .map(normalizeLanguageCode)
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

export function normalizeVersion(value) {
  return String(value ?? '').trim().replace(/^v(?=\d)/i, '');
}

export function isValidCardId(id) {
  return CARD_ID_PATTERN.test(id);
}

// "/apps/7W/7W-PASSPORT/index.html" -> { family: "7W", key: "7W-PASSPORT" }; null for remote links.
export function parseLocalAppUrl(url) {
  const match = text(url).replace(/[?#].*$/, '').replace(/\\/g, '/').match(/^(?:\.\/|\/)?apps\/([^/]+)\/([^/]+)\/index\.html$/);
  return match ? { family: match[1], key: match[2] } : null;
}

export function canonicalEntry(entry) {
  if (!isPlainObject(entry)) {
    return entry;
  }

  const base = {
    id: text(entry.id),
    family: text(entry.family),
    type: text(entry.type),
    title: text(entry.title),
    description: text(entry.description),
  };

  if (base.type === 'download') {
    return {
      ...base,
      downloads: (Array.isArray(entry.downloads) ? entry.downloads : []).map((download) => ({
        version: normalizeVersion(download?.version),
        url: text(download?.url),
      })),
    };
  }

  const known = new Set(LAUNCH_KEYS);
  const extras = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.has(key)));
  return {
    ...base,
    url: text(entry.url),
    languages: normalizeLanguageList(entry.languages),
    defaultLanguage: normalizeLanguageCode(entry.defaultLanguage),
    idleTimeoutSec: text(String(entry.idleTimeoutSec ?? '')) === '' ? NaN : Number(entry.idleTimeoutSec),
    ...extras,
  };
}

const compareAlphabetically = (left, right) => String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });

// Trims strings, puts keys in a fixed order and sorts families and cards A to Z,
// so saved files always look the same (the hub page sorts the same way).
export function canonicalizeManifest(raw) {
  if (!isPlainObject(raw)) {
    return raw;
  }

  const families = (Array.isArray(raw.families) ? raw.families : [])
    .map((family) => ({ id: text(family?.id), label: text(family?.label) }))
    .sort((left, right) => compareAlphabetically(left.label, right.label));
  const familyRank = new Map(families.map((family, index) => [family.id, index]));

  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .map(canonicalEntry)
    .sort((left, right) => (familyRank.get(left?.family) ?? families.length) - (familyRank.get(right?.family) ?? families.length)
      || compareAlphabetically(left?.title ?? '', right?.title ?? ''));

  return { families, entries };
}

// Same text everywhere a file is written, so unchanged files never show up as changes.
export function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function appManifestPath(local) {
  return `apps/${local.family}/${local.key}/app.manifest.json`;
}

// Each local web app keeps an app.manifest.json beside its files (other tools read it).
// It is generated from the card and never edited by hand.
export function buildAppManifest(entry, local) {
  const manifest = {
    appKey: local.key,
    displayName: entry.title,
    entryPath: `/apps/${local.family}/${local.key}/index.html`,
    idleTimeoutSec: entry.idleTimeoutSec,
  };

  APP_MANIFEST_EXTRA_KEYS.forEach((key) => {
    if (entry[key] !== undefined) {
      manifest[key] = entry[key];
    }
  });

  return manifest;
}

function extractMetaContent(markup, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markup.match(new RegExp(`<meta\\s+[^>]*name=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'));
  return match ? match[1] : '';
}

export function parseAppMeta(markup) {
  return {
    defaultLanguage: normalizeLanguageCode(extractMetaContent(markup, 'i18n-default-lang')),
    supportedLanguages: normalizeLanguageList(extractMetaContent(markup, 'i18n-supported-langs')),
  };
}

function isValidUrlLike(value) {
  try {
    new URL(text(value), 'https://example.invalid');
    return Boolean(text(value));
  } catch {
    return false;
  }
}

function getDriveFileId(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)drive(\.usercontent)?\.google\.com$/i.test(url.hostname)) {
      return null;
    }
    return url.pathname.match(/\/file\/d\/([^/]+)/i)?.[1] || url.searchParams.get('id') || '';
  } catch {
    return null;
  }
}

function validateDownloadUrl(url, context, errors, onDriveLink) {
  if (!isValidUrlLike(url)) {
    errors.push(`${context} has an invalid link: ${url || '(empty)'}`);
    return;
  }

  const fileId = getDriveFileId(url);
  if (fileId === null) {
    return;
  }

  if (/\/drive\/(u\/\d+\/)?folders\//i.test(url)) {
    errors.push(`${context} links to a Drive FOLDER. Open the zip itself in Drive, click Share > Copy link, and paste that link instead: ${url}`);
  } else if (!fileId) {
    errors.push(`${context} is not a Drive file link (expected https://drive.google.com/file/d/<id>/view): ${url}`);
  } else if (onDriveLink) {
    onDriveLink({ fileId, url, context });
  }
}

// getAppInfo(local) answers { meta: { defaultLanguage, supportedLanguages }, langFiles: string[] | null }
// for the app folder apps/<family>/<key>, or null when the folder has no index.html.
async function validateLaunchEntry(entry, context, getAppInfo, errors) {
  if (!text(entry.url)) {
    errors.push(`${context} is missing its launch link (url)`);
  } else if (!isValidUrlLike(entry.url)) {
    errors.push(`${context} has an invalid link: ${entry.url}`);
  }

  if (!Array.isArray(entry.languages) || !entry.languages.length) {
    errors.push(`${context} needs at least one language`);
  } else if (!entry.languages.includes(entry.defaultLanguage)) {
    errors.push(`${context} default language "${entry.defaultLanguage}" is not in its languages (${entry.languages.join(', ')})`);
  }

  if (!Number.isFinite(entry.idleTimeoutSec) || entry.idleTimeoutSec < 0) {
    errors.push(`${context} needs idleTimeoutSec as a number of seconds (0 or more)`);
  }

  const local = parseLocalAppUrl(entry.url);
  if (!local) {
    return;
  }

  if (entry.id !== local.key) {
    errors.push(`${context} has id "${entry.id}" but its folder is "${local.key}": the id of a local app must be the folder name`);
  }

  const relativeIndex = `apps/${local.family}/${local.key}/index.html`;
  const info = await getAppInfo(local);
  if (!info) {
    errors.push(`${context} points to ${relativeIndex}, which does not exist. Create the app folder first`);
    return;
  }

  if (!info.meta.defaultLanguage) {
    errors.push(`${relativeIndex} is missing meta i18n-default-lang`);
  }
  if (!info.meta.supportedLanguages.length) {
    errors.push(`${relativeIndex} is missing meta i18n-supported-langs`);
    return;
  }

  (entry.languages || []).forEach((language) => {
    if (!info.meta.supportedLanguages.includes(language)) {
      errors.push(`${context} lists language "${language}", but ${relativeIndex} only supports ${info.meta.supportedLanguages.join(', ')}`);
    }
  });

  if (info.langFiles) {
    info.meta.supportedLanguages.forEach((language) => {
      if (!info.langFiles.includes(`${language}.json`)) {
        errors.push(`missing apps/${local.family}/${local.key}/lang/${language}.json for language "${language}" declared in ${relativeIndex}`);
      }
    });
  }
}

export function validateFamilies(families) {
  const errors = [];
  const familyIds = new Set();

  families.forEach((family, index) => {
    const context = `family #${index + 1}${family?.id ? ` ("${family.id}")` : ''}`;
    if (!isPlainObject(family) || !text(family.id)) {
      errors.push(`${context} needs an id`);
      return;
    }
    if (/[/\\\s]/.test(family.id)) {
      errors.push(`${context}: the id must not contain spaces or slashes`);
    }
    if (!text(family.label)) {
      errors.push(`${context} needs a label`);
    }
    if (familyIds.has(family.id)) {
      errors.push(`${context} reuses id "${family.id}"`);
    }
    familyIds.add(family.id);
  });

  return { errors, familyIds };
}

// Checks one card (already canonicalized). takenIds are the ids of the other cards.
export async function validateEntry(entry, context, { familyIds, takenIds, getAppInfo, onDriveLink }) {
  const errors = [];

  if (!isPlainObject(entry)) {
    return [`${context} must be an object`];
  }

  if (!entry.id) {
    errors.push(`${context} needs an id`);
  } else if (!isValidCardId(entry.id)) {
    errors.push(`${context} has id "${entry.id}": use only letters, numbers, dots, dashes and underscores (it is also the file name)`);
  } else if (takenIds.has(entry.id.toLowerCase())) {
    errors.push(`${context} reuses id "${entry.id}"`);
  }

  if (!entry.title) {
    errors.push(`${context} needs a title`);
  }
  if (!familyIds.has(entry.family)) {
    errors.push(`${context} references undefined family "${entry.family}"`);
  }

  if (entry.type === 'download') {
    if (!entry.downloads.length) {
      errors.push(`${context} has no downloads`);
    }
    const seenVersions = new Set();
    entry.downloads.forEach((download, downloadIndex) => {
      const downloadContext = `${context} download #${downloadIndex + 1}`;
      if (!download.version) {
        errors.push(`${downloadContext} has no version. Add one, e.g. "1.5"`);
      } else if (seenVersions.has(download.version)) {
        errors.push(`${downloadContext} reuses version "${download.version}"`);
      }
      seenVersions.add(download.version);
      validateDownloadUrl(download.url, downloadContext, errors, onDriveLink);
    });
  } else if (entry.type === 'launch') {
    await validateLaunchEntry(entry, context, getAppInfo, errors);
  } else {
    errors.push(`${context} has type "${entry.type}": it must be "launch" or "download"`);
  }

  return errors;
}

export async function validateHubManifest(manifest, { getAppInfo, onDriveLink } = {}) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.families) || !Array.isArray(manifest.entries)) {
    return { errors: ['The data must contain a "families" list and an "entries" list'] };
  }

  const { errors, familyIds } = validateFamilies(manifest.families);
  if (!manifest.entries.length) {
    errors.push('There are no cards');
  }

  const takenIds = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    const context = `entry #${index + 1}${entry?.title ? ` ("${entry.title}")` : ''}`;
    errors.push(...await validateEntry(entry, context, { familyIds, takenIds, getAppInfo, onDriveLink }));
    takenIds.add(String(entry?.id).toLowerCase());
  }

  return { errors };
}
