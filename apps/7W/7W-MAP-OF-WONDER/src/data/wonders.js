// wonders.js
import { loadFileAsText, getResourcePath } from '../utils/fileLoader.js';

export let cubeWonderMap = new Map();

function loadWondersFile(relativePath, onSuccess, onError) {
  loadFileAsText(
    getResourcePath(relativePath),
    jsonText => {
      try {
        onSuccess(JSON.parse(jsonText));
      } catch (err) {
        onError(err);
      }
    },
    onError
  );
}

export function fetchWonders(callback) {
  const defaultPath = 'Ressource/wonders.json';
  const lang = String(window.i18n?.lang || document.documentElement.lang || 'en').toLowerCase();
  const loadDefault = () => loadWondersFile(
    defaultPath,
    callback,
    err => console.error('Error loading wonders:', err)
  );

  if (lang === 'en' || !/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) {
    loadDefault();
    return;
  }

  // Translated content lives next to the default file (e.g. wonders.it.json); fall back to English.
  loadWondersFile(
    defaultPath.replace(/\.json$/, `.${lang}.json`),
    callback,
    () => loadDefault()
  );
}
export { showWonderPanel } from '../ui/popup.js?v=20260730a';
