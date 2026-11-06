/*
 * Nothing technical is ever shown to a visitor.
 * A script error sends the screen back to the start. Too many errors in a row reload the page once.
 */
(function (K) {
  'use strict';

  var recent = [];
  var total = 0;
  var softReset = null;
  var installed = false;

  function mark(kind, detail) {
    total += 1;
    var now = Date.now();
    recent = recent.filter(function (t) {
      return now - t < 60000;
    });
    recent.push(now);
    K.host.log('page ' + kind + ': ' + String(detail).slice(0, 300));

    if (recent.length > 5) {
      var stamp = 0;
      try {
        stamp = Number(window.sessionStorage.getItem('aotb.lastReload')) || 0;
      } catch (e) {
        stamp = 0;
      }
      if (now - stamp > 30000) {
        try {
          window.sessionStorage.setItem('aotb.lastReload', String(now));
        } catch (e) {
          /* ignore */
        }
        K.lockdown.allowUnload();
        window.location.reload();
        return;
      }
    }
    if (softReset) {
      try {
        softReset();
      } catch (e) {
        /* nothing else to try */
      }
    }
  }

  K.errors = {
    install: function (onSoftReset) {
      softReset = onSoftReset;
      if (installed) return;
      installed = true;
      window.addEventListener('error', function (e) {
        if (e && e.target && e.target !== window) return; // a missing image is handled by the image itself
        mark('error', (e && e.message) || 'error');
        e.preventDefault();
      });
      window.addEventListener('unhandledrejection', function (e) {
        mark('rejection', e && e.reason);
        e.preventDefault();
      });
    },
    count: function () {
      return total;
    },
  };
})((window.Kiosk = window.Kiosk || {}));
