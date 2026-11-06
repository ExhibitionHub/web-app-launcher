/*
 * Content loader.
 *   1. https / http: read the JSON file (always the freshest content).
 *   2. file:// (double-click): fetch() of a local file is refused by the browser,
 *      so the page falls back to the script twin written by tools/sync-config.mjs.
 */
(function (K) {
  'use strict';

  function fetchJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('timeout'));
        }
      }, timeoutMs || 4000);
      fetch(url, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('status ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(data);
          }
        })
        .catch(function (e) {
          if (!done) {
            done = true;
            clearTimeout(timer);
            reject(e);
          }
        });
    });
  }

  function load(url, twinName) {
    var canFetch = window.location.protocol !== 'file:' && typeof fetch === 'function';
    var attempt = canFetch ? fetchJson(url) : Promise.reject(new Error('file protocol'));
    return attempt.catch(function () {
      var twin = window[twinName];
      if (twin) return twin;
      throw new Error('no content available for ' + url);
    });
  }

  /** Language files are named in <meta name="i18n-supported-langs">. Returns { en: {...}, es: {...}, ... } */
  function loadLang() {
    var meta = document.querySelector('meta[name="i18n-supported-langs"]');
    var codes = ((meta && meta.getAttribute('content')) || 'en')
      .split(',')
      .map(function (c) {
        return c.trim();
      })
      .filter(Boolean);
    var bundle = window.AOTB_LANG || {};
    var canFetch = window.location.protocol !== 'file:' && typeof fetch === 'function';
    return Promise.all(
      codes.map(function (code) {
        var attempt = canFetch ? fetchJson('lang/' + code + '.json') : Promise.reject(new Error('file protocol'));
        return attempt.catch(function () {
          if (bundle[code]) return bundle[code];
          throw new Error('no texts for language ' + code);
        });
      })
    ).then(function (tables) {
      var out = {};
      codes.forEach(function (code, i) {
        out[code] = tables[i];
      });
      return out;
    });
  }

  K.config = { load: load, loadLang: loadLang };
})((window.Kiosk = window.Kiosk || {}));
