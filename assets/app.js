// Hub page. Visitors read apps/manifest.json (built from data/ by the publish workflow).
// The "Edit mode" button asks for a GitHub token and then saves straight to the repo through the
// GitHub API (assets/github-store.js): add / edit / delete cards and families.
import { createGithubStore, StoreError } from './github-store.js';
import { SOURCE_REPO } from './hub-config.js';

const HUB_MANIFEST_PATH = './apps/manifest.json';
const TOKEN_STORAGE_KEY = 'hubGithubToken';
const LAUNCHER_LOCALE = 'en';
const HUB_COPY = {
  download: 'Download',
  languages: 'Languages',
  languagesHint: 'visitors can switch between these',
  primary: 'Default',
  primaryHint: 'app opens in this one',
  launch: 'Launch',
  launchModePrompt: 'Choose a display mode before launching the app.',
  chooseLaunchModeFor: 'Choose a launch mode for',
  show: 'Show',
  hide: 'Hide',
  inApp: 'in',
  notice: 'Notice',
  useAsPrimary: 'Use as primary language',
  auto: 'Auto',
};
const LANGUAGE_LABELS = {
  de: 'German',
  en: 'English',
  et: 'Estonian',
  es: 'Spanish',
  fr: 'French',
  nl: 'Dutch',
};
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_EDIT_MODE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';

const appList = document.getElementById('app-list');
const familyNav = document.getElementById('family-nav');
const familyTitle = document.getElementById('family-title');
const familySubtitle = document.getElementById('family-subtitle');
const editToggle = document.getElementById('edit-toggle');
const signOutButton = document.getElementById('sign-out');
const toast = document.getElementById('toast');
const emptyState = document.getElementById('empty-state');
const launchModal = document.getElementById('launch-modal');
const launchModalTitle = document.getElementById('launch-modal-title');
const launchModalDescription = document.getElementById('launch-modal-description');
const launchModalLanguages = document.getElementById('launch-modal-languages');
const launchModalAlerts = document.getElementById('launch-modal-alerts');
const editModal = document.getElementById('edit-modal');
const editModalBody = document.getElementById('edit-modal-body');

// What the page shows. Visitors see the published manifest; in edit mode it is the data read from GitHub,
// kept exactly as stored there (edits are saved back from this object).
let manifest = { families: [], entries: [] };
let publishedManifest = manifest;
let sourceManifest = null;
let store = null;
let toastTimer = 0;
const selectedLanguages = new Map();
const selectedPrimaryLanguages = new Map();
let launchDialogAppId = '';
let activeFamilyKey = '';
let editMode = false;

init();

appList.addEventListener('click', onAppListClick);
appList.addEventListener('change', onVersionChange);
familyNav.addEventListener('click', onFamilyNavClick);
launchModal.addEventListener('click', onLaunchModalClick);
editModal.addEventListener('click', onEditModalClick);
editModal.addEventListener('submit', onEditModalSubmit);
editModal.addEventListener('change', onEditModalChange);
editToggle.addEventListener('click', onEditToggleClick);
signOutButton.addEventListener('click', signOut);
window.addEventListener('keydown', onGlobalKeyDown);

async function init() {
  publishedManifest = await loadManifest();
  manifest = publishedManifest;
  syncSelectedLanguages();
  renderList();
  tryAutoLaunch();

  const savedToken = readStoredToken();
  if (savedToken) {
    await signIn(savedToken, { silent: true });
  }
}

async function loadManifest() {
  try {
    const response = await fetch(HUB_MANIFEST_PATH, { cache: 'no-store' });
    if (!response.ok) {
      return { families: [], entries: [] };
    }

    const data = await response.json();
    return {
      families: (Array.isArray(data.families) ? data.families : []).filter((family) => family && family.id),
      entries: (Array.isArray(data.entries) ? data.entries : []).filter((entry) => entry && entry.id),
    };
  } catch {
    return { families: [], entries: [] };
  }
}

function normalizeLaunchAlerts(values) {
  const rawValues = Array.isArray(values) ? values : values ? [values] : [];

  return rawValues
    .map((value) => {
      if (typeof value === 'string' && value.trim()) {
        return { title: '', message: value.trim() };
      }

      const message = pickFirstText(value?.message, value?.text, value?.label);
      return message ? { title: pickFirstText(value.title), message } : null;
    })
    .filter(Boolean);
}

function pickFirstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function normalizeLanguageCode(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function normalizeLanguageList(values) {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : [];

  const languages = [];
  rawValues.forEach((value) => {
    const normalized = normalizeLanguageCode(value);
    if (normalized && !languages.includes(normalized)) {
      languages.push(normalized);
    }
  });

  return languages;
}

function normalizeGoogleDriveDownloadUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value, window.location.href);
    if (!/drive\.google\.com$/i.test(url.hostname)) {
      return url.toString();
    }

    const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/i);
    const fileId = fileMatch?.[1] || url.searchParams.get('id');
    if (!fileId) {
      return url.toString();
    }

    // confirm=t skips Drive's "can't scan for viruses" page on large zips.
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  } catch {
    return value;
  }
}

function isExternalLink(value) {
  try {
    return new URL(value, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

// Newest version first: it gets the main button, the others go under "Older versions".
function getSortedDownloads(entry) {
  return (entry.downloads || [])
    .filter((download) => pickFirstText(download?.url))
    .map((download) => {
      const url = normalizeGoogleDriveDownloadUrl(pickFirstText(download.url));
      return { url, version: pickFirstText(String(download.version ?? '')).replace(/^v(?=\d)/i, ''), isExternal: isExternalLink(url) };
    })
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' }));
}

// "/apps/7W/X/index.html" is relative to the hub (it may be served from a sub-path); links to other sites stay as they are.
function resolveAppUrl(value) {
  const trimmed = pickFirstText(value);
  if (/^(https?:)?\/\//i.test(trimmed)) {
    return trimmed;
  }

  return new URL(trimmed.replace(/^\.?\/+/, ''), window.location.href).toString();
}

function compareAlphabetically(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

// Families and cards are always shown A to Z; nothing is placed by hand.
function getSortedFamilies() {
  return [...manifest.families].sort((left, right) => compareAlphabetically(left.label, right.label));
}

function getFamilyEntries(familyId) {
  return manifest.entries
    .filter((entry) => entry.family === familyId)
    .sort((left, right) => compareAlphabetically(left.title, right.title));
}

function getEntryById(entryId) {
  return manifest.entries.find((entry) => entry.id === entryId) || null;
}

function getLaunchAppById(appId) {
  const entry = getEntryById(appId);
  return entry && entry.type === 'launch' ? entry : null;
}

/* ---------- Rendering ---------- */

function renderList() {
  editToggle.innerHTML = ICON_EDIT_MODE;
  editToggle.title = editMode ? `Edit mode is on (signed in as ${store?.login}). Click to turn it off` : 'Turn on edit mode';
  editToggle.setAttribute('aria-label', editToggle.title);
  editToggle.setAttribute('aria-pressed', String(editMode));
  editToggle.classList.toggle('is-on', editMode);
  signOutButton.classList.toggle('hidden', !store);

  if (!manifest.families.length) {
    emptyState.classList.remove('hidden');
    appList.innerHTML = '';
    familyNav.innerHTML = editMode ? renderAddFamilyButton() : '';
    familyTitle.textContent = '';
    familySubtitle.textContent = '';
    return;
  }

  emptyState.classList.add('hidden');
  const families = getSortedFamilies();
  const activeFamily = families.find((family) => family.id === activeFamilyKey) || families[0];
  const familyChanged = activeFamilyKey !== activeFamily.id;
  activeFamilyKey = activeFamily.id;
  const entries = getFamilyEntries(activeFamily.id);
  const launchCount = entries.filter((entry) => entry.type === 'launch').length;
  const downloadCount = entries.length - launchCount;

  familyNav.innerHTML = families.map((family) => renderFamilyTab(family)).join('')
    + (editMode ? renderAddFamilyButton() : '');
  familyTitle.textContent = activeFamily.label;
  familySubtitle.textContent = [
    launchCount ? `${launchCount} web ${launchCount === 1 ? 'app' : 'apps'}` : '',
    downloadCount ? `${downloadCount} ${downloadCount === 1 ? 'download' : 'downloads'}` : '',
  ].filter(Boolean).join(' · ');

  appList.innerHTML = entries.map((entry) => (entry.type === 'download' ? renderDownloadCard(entry) : renderLaunchCard(entry))).join('')
    + (editMode ? renderAddCard() : '');

  if (!entries.length && !editMode) {
    appList.innerHTML = '<p class="card__text">Nothing here yet.</p>';
  }

  if (familyChanged) {
    appList.scrollTop = 0;
  }
}

// The token is kept for this browser tab only, or on this device when "Remember" is ticked.
function readStoredToken() {
  for (const storage of ['sessionStorage', 'localStorage']) {
    try {
      const token = window[storage].getItem(TOKEN_STORAGE_KEY);
      if (token) {
        return token;
      }
    } catch {
      // Storage can be blocked; the token is then asked for again.
    }
  }

  return '';
}

function saveToken(token, remember) {
  clearStoredToken();
  try {
    (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // The token then only lives until the page is reloaded.
  }
}

function clearStoredToken() {
  ['sessionStorage', 'localStorage'].forEach((storage) => {
    try {
      window[storage].removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 7000);
}

function setEditMode(enabled) {
  editMode = enabled;
  manifest = enabled ? sourceManifest : publishedManifest;
  syncSelectedLanguages();
  renderList();
}

// Checks the token with GitHub, then loads the latest data from the repo (the live site can lag behind it).
async function signIn(token, { remember = false, silent = false } = {}) {
  const githubStore = createGithubStore({ token, repo: SOURCE_REPO });

  try {
    const source = await githubStore.loadSource();
    sourceManifest = source.manifest;
  } catch (error) {
    if (silent) {
      if (error instanceof StoreError && (error.kind === 'auth' || error.kind === 'permission')) {
        clearStoredToken();
      }
      return false;
    }
    throw error;
  }

  store = githubStore;
  if (!silent) {
    saveToken(token, remember);
  }
  setEditMode(true);
  return true;
}

function signOut() {
  store = null;
  sourceManifest = null;
  clearStoredToken();
  setEditMode(false);
}

async function onEditToggleClick() {
  if (editMode) {
    setEditMode(false);
    return;
  }

  if (!store) {
    openUnlockForm();
    return;
  }

  try {
    sourceManifest = (await store.loadSource()).manifest;
    setEditMode(true);
  } catch (error) {
    showToast(error.message);
  }
}

function openUnlockForm() {
  openEditModal(`
    <form class="edit-form" data-form="unlock">
      <p class="launch-modal__eyebrow">Edit mode</p>
      <h2 class="launch-modal__title" id="edit-modal-title">Sign in with GitHub</h2>
      <label class="field">
        <span class="field__label">Personal access token</span>
        <input type="password" name="token" autocomplete="off" spellcheck="false" required />
        <span class="field__hint">A fine-grained token for ${escapeHtml(SOURCE_REPO.owner)}/${escapeHtml(SOURCE_REPO.name)} with "Contents: Read and write".
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create one on GitHub</a>.
          It stays in this browser and is only sent to GitHub.</span>
      </label>
      <label class="check">
        <input type="checkbox" name="remember" />
        <span>Remember it on this device until I sign out</span>
      </label>
      <p class="edit-error" data-edit-error></p>
      <div class="edit-actions">
        <span class="edit-actions__spacer"></span>
        <button class="btn btn--ghost" type="button" data-close-edit-modal>Cancel</button>
        <button class="btn btn--launch btn--inline" type="submit">Sign in</button>
      </div>
    </form>
  `);
}

async function unlockFromForm(form) {
  const data = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Checking...';

  try {
    await signIn(pickFirstText(data.get('token')), { remember: data.get('remember') === 'on' });
    closeEditModal();
  } catch (error) {
    showEditError(error.message);
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
}

function renderFamilyTab(family) {
  const isActive = family.id === activeFamilyKey;
  return `
    <div class="family-row">
      <button class="family-tab${isActive ? ' is-active' : ''}" type="button" data-family="${escapeHtml(family.id)}" aria-current="${String(isActive)}">
        <span>${escapeHtml(family.label)}</span>
        <span class="family-tab__count">${getFamilyEntries(family.id).length}</span>
      </button>
      ${editMode ? `<button class="icon-btn" type="button" data-edit-family="${escapeHtml(family.id)}" title="Edit family" aria-label="Edit family ${escapeHtml(family.label)}">${ICON_EDIT}</button>` : ''}
    </div>
  `;
}

function renderAddFamilyButton() {
  return `<button class="family-add" type="button" data-add-family>${ICON_PLUS}<span>Add family</span></button>`;
}

function renderAddCard() {
  return `<button class="card card--add" type="button" data-add-entry>${ICON_PLUS}<span>Add card</span></button>`;
}

function renderEditButton(entry) {
  return editMode
    ? `<button class="icon-btn card__edit" type="button" data-edit-entry="${escapeHtml(entry.id)}" title="Edit card" aria-label="Edit ${escapeHtml(entry.title)}">${ICON_EDIT}</button>`
    : '';
}

function renderDownloadCard(entry) {
  const downloads = getSortedDownloads(entry);
  const latest = downloads[0];
  const versionLabel = escapeHtml(`Version of ${entry.title}`);

  return `
    <article class="card card--download">
      ${renderEditButton(entry)}
      <h3 class="card__title">${escapeHtml(entry.title)}</h3>
      <span class="card__badge">Download (.zip)</span>
      ${entry.description ? `<p class="card__text">${escapeHtml(entry.description)}</p>` : ''}
      <div class="card__footer">
        ${latest ? `${renderVersionPicker(downloads, versionLabel)}${renderDownloadLink(latest, entry)}` : ''}
      </div>
    </article>
  `;
}

// One version is shown as plain text; several become a dropdown.
function renderVersionPicker(downloads, ariaLabel) {
  if (downloads.length < 2) {
    return `<span class="card__version"><span>Version</span><strong>${escapeHtml(downloads[0].version || '-')}</strong></span>`;
  }

  return `
    <label class="card__version">
      <span>Version</span>
      <select class="version-select" data-version-select aria-label="${ariaLabel}">
        ${downloads.map((download, index) => `<option value="${escapeHtml(download.url)}" data-external="${String(download.isExternal)}" ${index === 0 ? 'selected' : ''}>${escapeHtml(download.version || HUB_COPY.download)}</option>`).join('')}
      </select>
    </label>
  `;
}

function renderDownloadLink(download, entry) {
  const title = `${HUB_COPY.download} ${entry.title} ${download.version}`.trim();
  const externalAttributes = download.isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

  return `<a class="btn btn--download" data-download-link href="${escapeHtml(download.url)}" download${externalAttributes} title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${ICON_DOWNLOAD}<span>${escapeHtml(HUB_COPY.download)}</span></a>`;
}

// Picking a version points the Download button at that version's file.
function onVersionChange(event) {
  const select = event.target.closest('[data-version-select]');
  const link = select?.closest('.card')?.querySelector('[data-download-link]');
  if (!link) {
    return;
  }

  const option = select.selectedOptions[0];
  link.href = option.value;
  if (option.dataset.external === 'true') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  } else {
    link.removeAttribute('target');
    link.removeAttribute('rel');
  }

  const title = `${HUB_COPY.download} ${select.closest('.card').querySelector('.card__title').textContent} ${option.textContent}`.trim();
  link.title = title;
  link.setAttribute('aria-label', title);
}

function renderLaunchCard(app) {
  const appName = escapeHtml(app.title);
  const languages = getSelectedAvailableLanguages(app);

  return `
    <article class="card card--app">
      ${renderEditButton(app)}
      <h3 class="card__title" title="${appName}">${appName}</h3>
      <span class="card__badge">Web app</span>
      ${app.description ? `<p class="card__text">${escapeHtml(app.description)}</p>` : ''}
      <div class="card__langs">
        ${languages.map((language) => `<span class="lang-chip" title="${escapeHtml(getLanguageLabel(language))}">${escapeHtml(getLanguageShortLabel(language))}</span>`).join('')}
      </div>
      <div class="card__footer">
        <button
          class="btn btn--launch"
          type="button"
          data-open-launch-dialog="${escapeHtml(app.id)}"
          aria-haspopup="dialog"
          aria-label="${escapeHtml(HUB_COPY.chooseLaunchModeFor)} ${appName}"
        >${ICON_PLAY}<span>${escapeHtml(HUB_COPY.launch)}</span></button>
      </div>
    </article>
  `;
}

function renderAppLanguages(app, languages, selected) {
  if (!languages.length) {
    return `<span class="app-language app-language--locked">${escapeHtml(HUB_COPY.auto)}</span>`;
  }

  if (languages.length === 1) {
    return `
      <span class="app-language app-language--locked" title="${escapeHtml(getLanguageLabel(languages[0]))}">
        ${escapeHtml(getLanguageShortLabel(languages[0]))}
      </span>
    `;
  }

  return languages
    .map((language) => {
      const isActive = selected.includes(language);
      const label = getLanguageLabel(language);
      const actionLabel = isActive ? HUB_COPY.hide : HUB_COPY.show;
      return `
        <button
          class="app-language${isActive ? ' is-active' : ''}"
          type="button"
          data-select-language="${escapeHtml(language)}"
          data-app-id="${escapeHtml(app.id)}"
          aria-pressed="${String(isActive)}"
          title="${escapeHtml(actionLabel)} ${escapeHtml(label)}"
          aria-label="${escapeHtml(actionLabel)} ${escapeHtml(label)} ${escapeHtml(HUB_COPY.inApp)} ${escapeHtml(app.title)}"
        >
          ${escapeHtml(getLanguageShortLabel(language))}
        </button>
      `;
    })
    .join('');
}

function renderPrimaryLanguages(app, languages, selectedAvailableLanguages, selectedPrimaryLanguage) {
  if (!languages.length) {
    return `<span class="app-language app-language--locked">${escapeHtml(HUB_COPY.auto)}</span>`;
  }

  const availableLanguages = resolveSelectedAvailableLanguages(app, selectedAvailableLanguages);
  const primaryLanguage = resolveRequestedLanguage(app, selectedPrimaryLanguage, availableLanguages);

  if (availableLanguages.length <= 1) {
    const language = availableLanguages[0] || languages[0];
    return `
      <span class="app-language app-language--locked app-language--primary is-active" title="${escapeHtml(getLanguageLabel(language))}">
        ${escapeHtml(getLanguageShortLabel(language))}
      </span>
    `;
  }

  return availableLanguages
    .map((language) => {
      const isPrimary = language === primaryLanguage;
      const label = getLanguageLabel(language);
      return `
        <button
          class="app-language app-language--primary${isPrimary ? ' is-active' : ''}"
          type="button"
          data-select-primary-language="${escapeHtml(language)}"
          data-app-id="${escapeHtml(app.id)}"
          aria-pressed="${String(isPrimary)}"
          title="${escapeHtml(HUB_COPY.useAsPrimary)}: ${escapeHtml(label)}"
          aria-label="${escapeHtml(HUB_COPY.useAsPrimary)} ${escapeHtml(label)} ${escapeHtml(HUB_COPY.inApp)} ${escapeHtml(app.title)}"
        >
          ${escapeHtml(getLanguageShortLabel(language))}
        </button>
      `;
    })
    .join('');
}

/* ---------- Launch dialog ---------- */

function openLaunchDialog(app) {
  launchDialogAppId = app.id;
  launchModalTitle.textContent = app.title;
  launchModalDescription.textContent = pickFirstText(app.launchDescription, app.description, HUB_COPY.launchModePrompt);
  renderLaunchLanguages(app);
  launchModalAlerts.innerHTML = renderLaunchAlerts(normalizeLaunchAlerts(app.launchAlerts || app.launchNotice));
  launchModal.classList.remove('hidden');
  launchModal.setAttribute('aria-hidden', 'false');

  window.requestAnimationFrame(() => {
    launchModal.querySelector('[data-launch-modal-mode="horizontal"]')?.focus();
  });
}

function closeLaunchDialog() {
  launchDialogAppId = '';
  launchModal.classList.add('hidden');
  launchModal.setAttribute('aria-hidden', 'true');
  launchModalTitle.textContent = '';
  launchModalDescription.textContent = '';
  launchModalLanguages.innerHTML = '';
  launchModalAlerts.innerHTML = '';
}

function renderLaunchAlerts(alerts) {
  return alerts
    .map((alert) => `
      <article class="launch-alert">
        <p class="launch-alert__title">${escapeHtml(pickFirstText(alert.title, HUB_COPY.notice))}</p>
        <p class="launch-alert__message">${escapeHtml(alert.message)}</p>
      </article>
    `)
    .join('');
}

function renderLaunchLanguages(app) {
  const languages = getAppSupportedLanguages(app);
  if (languages.length < 2) {
    launchModalLanguages.innerHTML = '';
    return;
  }

  const available = getSelectedAvailableLanguages(app);
  const primary = getSelectedPrimaryLanguage(app);
  launchModalLanguages.innerHTML = `
    <div class="app-item__picker">
      <span class="app-item__legend">${escapeHtml(HUB_COPY.languages)}<small>${escapeHtml(HUB_COPY.languagesHint)}</small></span>
      <div class="app-item__languages">${renderAppLanguages(app, languages, available)}</div>
    </div>
    <div class="app-item__picker">
      <span class="app-item__legend">${escapeHtml(HUB_COPY.primary)}<small>${escapeHtml(HUB_COPY.primaryHint)}</small></span>
      <div class="app-item__languages">${renderPrimaryLanguages(app, languages, available, primary)}</div>
    </div>
  `;
}

function onLaunchModalClick(event) {
  if (handleLanguageClick(event)) {
    return;
  }

  if (event.target.closest('[data-close-launch-modal]')) {
    closeLaunchDialog();
    return;
  }

  const modeButton = event.target.closest('[data-launch-modal-mode]');
  if (!modeButton) {
    return;
  }

  const app = getLaunchAppById(launchDialogAppId);
  if (!app) {
    closeLaunchDialog();
    return;
  }

  const orientation = modeButton.dataset.launchModalMode === 'vertical' ? 'vertical' : 'horizontal';
  launchApp(app, orientation, getSelectedPrimaryLanguage(app), getSelectedAvailableLanguages(app));
}

function handleLanguageClick(event) {
  const primaryLanguageButton = event.target.closest('[data-select-primary-language]');
  const languageButton = event.target.closest('[data-select-language]');
  const button = primaryLanguageButton || languageButton;
  const app = button ? getLaunchAppById(button.dataset.appId) : null;
  if (!app) {
    return false;
  }

  if (primaryLanguageButton) {
    const primaryLanguage = resolveRequestedLanguage(app, primaryLanguageButton.dataset.selectPrimaryLanguage, getSelectedAvailableLanguages(app));
    selectedPrimaryLanguages.set(app.id, primaryLanguage);
  } else {
    const nextAvailableLanguages = toggleSelectedAvailableLanguage(app, languageButton.dataset.selectLanguage);
    selectedLanguages.set(app.id, nextAvailableLanguages);
    selectedPrimaryLanguages.set(app.id, resolveRequestedLanguage(app, getSelectedPrimaryLanguage(app), nextAvailableLanguages));
  }

  renderLaunchLanguages(app);
  renderList();
  return true;
}

function onAppListClick(event) {
  const editButton = event.target.closest('[data-edit-entry]');
  if (editButton) {
    openEntryForm(getEntryById(editButton.dataset.editEntry));
    return;
  }

  if (event.target.closest('[data-add-entry]')) {
    openEntryForm(null);
    return;
  }

  const startButton = event.target.closest('[data-open-launch-dialog]');
  const app = startButton ? getLaunchAppById(startButton.dataset.openLaunchDialog) : null;
  if (app) {
    openLaunchDialog(app);
  }
}

function onFamilyNavClick(event) {
  const editButton = event.target.closest('[data-edit-family]');
  if (editButton) {
    openFamilyForm(manifest.families.find((family) => family.id === editButton.dataset.editFamily));
    return;
  }

  if (event.target.closest('[data-add-family]')) {
    openFamilyForm(null);
    return;
  }

  const tab = event.target.closest('[data-family]');
  if (tab && tab.dataset.family !== activeFamilyKey) {
    activeFamilyKey = tab.dataset.family;
    renderList();
  }
}

/* ---------- Launching ---------- */

function buildAppLaunchUrl(app, orientation, language = '', availableLanguages = []) {
  const resolvedAvailableLanguages = resolveSelectedAvailableLanguages(app, availableLanguages);
  const selectedLanguage = resolveRequestedLanguage(app, language, resolvedAvailableLanguages);
  const url = new URL(resolveAppUrl(app.url));

  selectedLanguages.set(app.id, resolvedAvailableLanguages);
  selectedPrimaryLanguages.set(app.id, selectedLanguage);

  url.searchParams.set('mode', orientation);
  url.searchParams.set('orientation', orientation);

  if (selectedLanguage) {
    url.searchParams.set('lang', selectedLanguage);
    url.searchParams.set('primaryLang', selectedLanguage);
  }

  if (resolvedAvailableLanguages.length) {
    url.searchParams.set('availableLangs', resolvedAvailableLanguages.join(','));
  }

  return url.toString();
}

// Apps always open in their own browser tab; the hub stays open as it is.
function launchApp(app, orientation, language = '', availableLanguages = []) {
  closeLaunchDialog();
  window.open(buildAppLaunchUrl(app, orientation, language, availableLanguages), '_blank', 'noopener');
}

function tryAutoLaunch() {
  const params = new URLSearchParams(window.location.search);
  const app = getLaunchAppById(params.get('app'));
  if (!app) {
    return;
  }

  const rawMode = params.get('mode') || params.get('orientation');
  const mode = rawMode === 'vertical' ? 'vertical' : 'horizontal';
  // Deep link (?app=...): a tab opened from a bookmark can't open a pop-up, so it navigates itself.
  window.location.replace(buildAppLaunchUrl(app, mode, params.get('primaryLang') || params.get('lang') || '', normalizeLanguageList(params.get('availableLangs'))));
}

function onGlobalKeyDown(event) {
  if (event.key !== 'Escape') {
    return;
  }

  if (!editModal.classList.contains('hidden')) {
    closeEditModal();
  } else if (launchDialogAppId) {
    closeLaunchDialog();
  }
}

/* ---------- Edit mode ---------- */

function openEditModal(html) {
  editModalBody.innerHTML = html;
  editModal.classList.remove('hidden');
  editModal.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => {
    editModalBody.querySelector('input[type="text"], textarea')?.focus();
  });
}

function closeEditModal() {
  editModal.classList.add('hidden');
  editModal.setAttribute('aria-hidden', 'true');
  editModalBody.innerHTML = '';
}

function openFamilyForm(family) {
  const entryCount = family ? getFamilyEntries(family.id).length : 0;

  openEditModal(`
    <form class="edit-form" data-form="family" data-id="${escapeHtml(family?.id || '')}">
      <p class="launch-modal__eyebrow">${family ? 'Edit family' : 'New family'}</p>
      <h2 class="launch-modal__title" id="edit-modal-title">${family ? escapeHtml(family.label) : 'Add a family'}</h2>
      <label class="field">
        <span class="field__label">Name</span>
        <input type="text" name="label" value="${escapeHtml(family?.label || '')}" required />
      </label>
      <p class="edit-error" data-edit-error></p>
      <div class="edit-actions">
        ${family ? `<button class="btn btn--danger" type="button" data-delete ${entryCount ? `disabled title="Delete its ${entryCount} card(s) or change their family first"` : ''}>Delete</button>` : ''}
        <span class="edit-actions__spacer"></span>
        <button class="btn btn--ghost" type="button" data-close-edit-modal>Cancel</button>
        <button class="btn btn--launch btn--inline" type="submit">Save</button>
      </div>
    </form>
  `);
}

function renderVersionRow(download = { version: '', url: '' }) {
  return `
    <div class="version-row">
      <input type="text" name="version" value="${escapeHtml(download.version)}" placeholder="1.6" aria-label="Version" />
      <input type="text" name="downloadUrl" value="${escapeHtml(download.url)}" placeholder="https://drive.google.com/file/d/.../view" aria-label="Download link" />
      <button class="icon-btn" type="button" data-remove-version title="Remove this version" aria-label="Remove this version">×</button>
    </div>
  `;
}

function openEntryForm(entry) {
  const isNew = !entry;
  const type = entry?.type || 'launch';
  const downloads = type === 'download' ? (entry.downloads || []) : [];
  const languages = type === 'launch' ? normalizeLanguageList(entry?.languages) : [];

  openEditModal(`
    <form class="edit-form" data-form="entry" data-id="${escapeHtml(entry?.id || '')}">
      <p class="launch-modal__eyebrow">${isNew ? 'New card' : 'Edit card'}</p>
      <h2 class="launch-modal__title" id="edit-modal-title">${isNew ? 'Add a card' : escapeHtml(entry.title)}</h2>

      <div class="field">
        <span class="field__label">Type</span>
        <div class="segmented">
          <label><input type="radio" name="type" value="launch" ${type === 'launch' ? 'checked' : ''} /><span>Launch (web app)</span></label>
          <label><input type="radio" name="type" value="download" ${type === 'download' ? 'checked' : ''} /><span>Download (.zip)</span></label>
        </div>
      </div>
      <label class="field">
        <span class="field__label">Title</span>
        <input type="text" name="title" value="${escapeHtml(entry?.title || '')}" required />
      </label>
      <label class="field">
        <span class="field__label">Description</span>
        <textarea name="description" rows="3">${escapeHtml(entry?.description || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Family</span>
        <select name="family">
          ${getSortedFamilies().map((family) => `<option value="${escapeHtml(family.id)}" ${family.id === (entry?.family || activeFamilyKey) ? 'selected' : ''}>${escapeHtml(family.label)}</option>`).join('')}
        </select>
      </label>

      <div data-show="launch" ${type === 'launch' ? '' : 'hidden'}>
        <label class="field">
          <span class="field__label">Launch link</span>
          <input type="text" name="url" value="${escapeHtml(type === 'launch' ? entry?.url || '' : '')}" placeholder="/apps/7W/7W-MY-APP/index.html" />
          <span class="field__hint">The app's index.html (its folder must already exist), or a full https:// link.</span>
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field__label">Languages</span>
            <input type="text" name="languages" value="${escapeHtml(languages.join(', '))}" placeholder="en, fr, de" />
          </label>
          <label class="field">
            <span class="field__label">Default language</span>
            <input type="text" name="defaultLanguage" value="${escapeHtml(type === 'launch' ? entry?.defaultLanguage || '' : '')}" placeholder="en" />
          </label>
          <label class="field">
            <span class="field__label">Idle timeout (s)</span>
            <input type="text" inputmode="numeric" name="idleTimeoutSec" value="${escapeHtml(String(type === 'launch' ? entry?.idleTimeoutSec ?? 120 : 120))}" />
          </label>
        </div>
      </div>

      <div data-show="download" ${type === 'download' ? '' : 'hidden'}>
        <div class="field">
          <span class="field__label">Versions</span>
          <div class="version-list" data-version-list>
            ${(downloads.length ? downloads : [undefined]).map((download) => renderVersionRow(download)).join('')}
          </div>
          <button class="btn btn--ghost btn--inline" type="button" data-add-version>${ICON_PLUS}<span>Add version</span></button>
          <span class="field__hint">Paste the Google Drive share link of the zip. The highest version is the main Download button.</span>
        </div>
      </div>

      <p class="edit-error" data-edit-error></p>
      <div class="edit-actions">
        ${isNew ? '' : '<button class="btn btn--danger" type="button" data-delete>Delete</button>'}
        <span class="edit-actions__spacer"></span>
        <button class="btn btn--ghost" type="button" data-close-edit-modal>Cancel</button>
        <button class="btn btn--launch btn--inline" type="submit">Save</button>
      </div>
    </form>
  `);
}

function onEditModalChange(event) {
  if (event.target.name !== 'type') {
    return;
  }

  event.target.form.querySelectorAll('[data-show]').forEach((section) => {
    section.hidden = section.dataset.show !== event.target.value;
  });
}

function onEditModalClick(event) {
  if (event.target.closest('[data-close-edit-modal]')) {
    closeEditModal();
    return;
  }

  const form = event.target.closest('form');
  if (!form) {
    return;
  }

  if (event.target.closest('[data-add-version]')) {
    form.querySelector('[data-version-list]').insertAdjacentHTML('afterbegin', renderVersionRow());
    form.querySelector('.version-row input')?.focus();
  } else if (event.target.closest('[data-remove-version]')) {
    event.target.closest('.version-row').remove();
  } else if (event.target.closest('[data-delete]')) {
    deleteFromForm(form);
  }
}

async function onEditModalSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.dataset.form === 'unlock') {
    await unlockFromForm(form);
    return;
  }

  const draft = structuredClone(manifest);
  const error = form.dataset.form === 'family' ? applyFamilyForm(form, draft) : applyEntryForm(form, draft);

  if (error) {
    showEditError(error);
    return;
  }

  await saveDraft(draft);
}

function applyFamilyForm(form, draft) {
  const label = pickFirstText(new FormData(form).get('label'));
  if (!label) {
    return 'Enter a name.';
  }

  if (form.dataset.id) {
    draft.families.find((family) => family.id === form.dataset.id).label = label;
    return '';
  }

  const id = uniqueId(label.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'FAMILY', draft.families.map((family) => family.id));
  draft.families.push({ id, label });
  activeFamilyKey = id;
  return '';
}

function applyEntryForm(form, draft) {
  const data = new FormData(form);
  const type = data.get('type') === 'download' ? 'download' : 'launch';
  const title = pickFirstText(data.get('title'));
  if (!title) {
    return 'Enter a title.';
  }

  const index = draft.entries.findIndex((entry) => entry.id === form.dataset.id);
  const original = index === -1 ? null : draft.entries[index];
  const base = { family: data.get('family'), type, title, description: pickFirstText(data.get('description')) };
  const newId = () => uniqueId(slugify(title), draft.entries.map((item) => item.id));
  let entry;

  if (type === 'download') {
    const downloads = [...form.querySelectorAll('.version-row')]
      .map((row) => ({
        version: pickFirstText(row.querySelector('[name="version"]').value).replace(/^v(?=\d)/i, ''),
        url: pickFirstText(row.querySelector('[name="downloadUrl"]').value),
      }))
      .filter((download) => download.version || download.url);
    entry = { id: original?.id || newId(), ...base, downloads };
  } else {
    const url = pickFirstText(data.get('url'));
    const languages = normalizeLanguageList(data.get('languages'));
    const localKey = url.replace(/[?#].*$/, '').match(/^(?:\.\/|\/)?apps\/[^/]+\/([^/]+)\/index\.html$/)?.[1];
    entry = {
      // keeps fields the form does not show (launchQuery, launchOptions, ...)
      ...(original?.type === 'launch' ? original : {}),
      // the id of a local app is its folder name
      id: localKey || original?.id || newId(),
      ...base,
      url,
      languages,
      defaultLanguage: normalizeLanguageCode(data.get('defaultLanguage')) || languages[0] || '',
      idleTimeoutSec: pickFirstText(data.get('idleTimeoutSec')) === '' ? '' : Number(data.get('idleTimeoutSec')),
    };
  }

  if (index === -1) {
    draft.entries.push(entry);
  } else {
    draft.entries[index] = entry;
  }
  activeFamilyKey = entry.family;
  return '';
}

function deleteFromForm(form) {
  const draft = structuredClone(manifest);

  if (form.dataset.form === 'family') {
    const family = draft.families.find((item) => item.id === form.dataset.id);
    if (!window.confirm(`Delete the family "${family.label}"?`)) {
      return;
    }
    draft.families = draft.families.filter((item) => item.id !== form.dataset.id);
  } else {
    const entry = draft.entries.find((item) => item.id === form.dataset.id);
    if (!window.confirm(`Delete "${entry.title}"? Its files stay in the repo; only the card is removed.`)) {
      return;
    }
    draft.entries = draft.entries.filter((item) => item.id !== form.dataset.id);
  }

  saveDraft(draft);
}

async function saveDraft(draft) {
  const submit = editModalBody.querySelector('[type="submit"]');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Saving...';
  }

  try {
    const saved = await store.save(draft);
    sourceManifest = saved.manifest;
  } catch (error) {
    if (!(error instanceof StoreError)) {
      showEditError(`Something went wrong: ${error.message}`);
    } else if (error.kind === 'auth') {
      closeEditModal();
      signOut();
      showToast(error.message);
    } else if (error.kind === 'conflict') {
      closeEditModal();
      sourceManifest = store.manifest;
      setEditMode(true);
      showToast(error.message);
    } else {
      showEditError(error.message);
    }

    if (submit?.isConnected) {
      submit.disabled = false;
      submit.textContent = 'Save';
    }
    return;
  }

  closeEditModal();
  setEditMode(true);
  showToast('Saved to GitHub. The live site updates in about 1-2 minutes.');
}

function showEditError(message) {
  const target = editModalBody.querySelector('[data-edit-error]');
  if (target) {
    target.textContent = message;
  }
}

function uniqueId(base, taken) {
  let candidate = base;
  for (let number = 2; taken.includes(candidate); number += 1) {
    candidate = `${base}-${number}`;
  }
  return candidate;
}

/* ---------- Language selection ---------- */

function getInitialLanguage(app) {
  const params = new URLSearchParams(window.location.search);
  return resolveRequestedLanguage(app, params.get('primaryLang') || params.get('lang'), getInitialAvailableLanguages(app));
}

function getInitialAvailableLanguages(app) {
  const params = new URLSearchParams(window.location.search);
  return resolveSelectedAvailableLanguages(app, params.get('availableLangs'));
}

function syncSelectedLanguages() {
  manifest.entries.filter((entry) => entry.type === 'launch').forEach((app) => {
    const availableLanguages = resolveSelectedAvailableLanguages(app, selectedLanguages.get(app.id) || getInitialAvailableLanguages(app));
    selectedLanguages.set(app.id, availableLanguages);
    selectedPrimaryLanguages.set(app.id, resolveRequestedLanguage(app, selectedPrimaryLanguages.get(app.id) || getInitialLanguage(app), availableLanguages));
  });
}

function getSelectedAvailableLanguages(app) {
  return resolveSelectedAvailableLanguages(app, selectedLanguages.get(app.id));
}

function getSelectedPrimaryLanguage(app) {
  const availableLanguages = getSelectedAvailableLanguages(app);
  return resolveRequestedLanguage(app, selectedPrimaryLanguages.get(app.id) || getInitialLanguage(app), availableLanguages);
}

function resolveRequestedLanguage(app, requestedLanguage, availableLanguages = []) {
  const supportedLanguages = resolveSelectedAvailableLanguages(app, availableLanguages);
  const normalizedRequestedLanguage = normalizeLanguageCode(requestedLanguage);

  if (normalizedRequestedLanguage && (!supportedLanguages.length || supportedLanguages.includes(normalizedRequestedLanguage))) {
    return normalizedRequestedLanguage;
  }

  const normalizedDefaultLanguage = normalizeLanguageCode(app.defaultLanguage);
  if (normalizedDefaultLanguage && (!supportedLanguages.length || supportedLanguages.includes(normalizedDefaultLanguage))) {
    return normalizedDefaultLanguage;
  }

  return supportedLanguages[0] || '';
}

function getAppSupportedLanguages(app) {
  return normalizeLanguageList(app.languages);
}

function resolveSelectedAvailableLanguages(app, requestedLanguages) {
  const supportedLanguages = getAppSupportedLanguages(app);
  if (!supportedLanguages.length) {
    return [];
  }

  const selected = normalizeLanguageList(requestedLanguages).filter((language) => supportedLanguages.includes(language));
  return selected.length ? selected : supportedLanguages;
}

function toggleSelectedAvailableLanguage(app, requestedLanguage) {
  const language = normalizeLanguageCode(requestedLanguage);
  const supportedLanguages = getAppSupportedLanguages(app);
  const selectedAvailableLanguages = getSelectedAvailableLanguages(app);

  if (!language || !supportedLanguages.includes(language)) {
    return selectedAvailableLanguages;
  }

  if (selectedAvailableLanguages.includes(language)) {
    return selectedAvailableLanguages.length === 1
      ? selectedAvailableLanguages
      : selectedAvailableLanguages.filter((entry) => entry !== language);
  }

  return [...selectedAvailableLanguages, language];
}

function getLanguageLabel(language) {
  const normalized = normalizeLanguageCode(language);
  if (!normalized) {
    return '';
  }

  if (LANGUAGE_LABELS[normalized]) {
    return LANGUAGE_LABELS[normalized];
  }

  try {
    const label = new Intl.DisplayNames([LAUNCHER_LOCALE], { type: 'language' }).of(normalized);
    if (label) {
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
  } catch {
    // Fall back to the code below.
  }

  return normalized.toUpperCase();
}

function getLanguageShortLabel(language) {
  const normalized = normalizeLanguageCode(language);
  return normalized ? normalized.split('-')[0].slice(0, 2).toUpperCase() : '';
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'entry';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
