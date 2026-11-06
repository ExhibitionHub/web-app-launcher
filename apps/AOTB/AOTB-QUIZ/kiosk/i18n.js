/*
 * Texts in several languages.
 *   t(key, vars)   UI text from lang/<code>.json
 *   pick(object)   a text written as { en: "...", es: "...", ca: "..." } in the content file
 * A missing text falls back to the default language, never to a raw key.
 */
(function (K) {
  'use strict';

  var state = { bundle: {}, langs: ['en'], def: 'en', lang: 'en', missing: [] };

  function format(text, vars) {
    var out = String(text).replace(/\{(\w+)\}/g, function (m, name) {
      return vars && vars[name] != null ? String(vars[name]) : '';
    });
    return out.replace(/ %/g, ' %');
  }

  var i18n = {
    init: function (bundle, langs, defaultLang) {
      state.bundle = bundle || {};
      state.langs = langs && langs.length ? langs.slice() : ['en'];
      state.def = state.langs.indexOf(defaultLang) >= 0 ? defaultLang : state.langs[0];
      state.lang = state.def;
      state.missing = [];
      document.documentElement.setAttribute('lang', state.lang);
    },
    langs: function () {
      return state.langs.slice();
    },
    defaultLang: function () {
      return state.def;
    },
    lang: function () {
      return state.lang;
    },
    setLang: function (code) {
      if (state.langs.indexOf(code) < 0) return false;
      state.lang = code;
      document.documentElement.setAttribute('lang', code);
      return true;
    },
    reset: function () {
      i18n.setLang(state.def);
    },
    t: function (key, vars, lang) {
      var code = lang || state.lang;
      var table = state.bundle[code] || {};
      var text = table[key];
      if (text == null) {
        text = (state.bundle[state.def] || {})[key];
        state.missing.push(code + ':' + key);
      }
      return text == null ? '' : format(text, vars);
    },
    pick: function (obj, lang) {
      if (obj == null) return '';
      if (typeof obj === 'string') return obj;
      var code = lang || state.lang;
      var text = obj[code];
      if (text == null || text === '') {
        text = obj[state.def];
        if (text == null || text === '') {
          state.missing.push(code + ':content');
          var first = Object.keys(obj)[0];
          text = first ? obj[first] : '';
        }
      }
      return String(text).replace(/ %/g, ' %');
    },
    missing: function () {
      return state.missing.slice();
    },
  };

  K.i18n = i18n;
})((window.Kiosk = window.Kiosk || {}));
