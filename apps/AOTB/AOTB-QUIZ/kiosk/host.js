/*
 * Link with the native launcher (WebView2). Everything here is a no-op in a normal browser.
 * The launcher injects window.__AOTB_HOST = { stats: {...} } before the page starts.
 */
(function (K) {
  'use strict';

  var wv = window.chrome && window.chrome.webview;
  var info = window.__AOTB_HOST || null;
  var query = window.location.search || '';

  var host = {
    present: !!(wv && info),
    // true when the page runs as a real kiosk: native launcher, or ?kiosk=1 in a kiosk browser
    kiosk: !!(wv && info) || /[?&]kiosk=1(&|$)/.test(query),
    initialStats: info && info.stats ? info.stats : null,

    post: function (message) {
      if (!wv) return;
      try {
        wv.postMessage(message);
      } catch (e) {
        /* the launcher is gone: nothing to do */
      }
    },

    heartbeat: function (state) {
      host.post({ t: 'hb', at: Date.now(), state: state || '' });
    },

    log: function (text) {
      host.post({ t: 'log', text: String(text) });
    },
  };

  K.host = host;
})((window.Kiosk = window.Kiosk || {}));
