// Simple language loader and getter
let langData = {};

function loadLang(lang = 'fr') {
  return fetch(`app-maps/lang/${lang}.json`)
    .then(r => r.json())
    .then(data => { langData = data; });
}

function getText(key) {
  return langData[key] || key;
}

// Example: loadLang('fr').then(() => { document.title = getText('app_title'); });
