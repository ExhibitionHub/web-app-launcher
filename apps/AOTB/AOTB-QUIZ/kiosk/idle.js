/*
 * Inactivity timer. Any touch resets it. When it runs out, the callback is called once.
 * It reads the clock every second, so a busy page cannot make it drift.
 */
(function (K) {
  'use strict';

  var last = Date.now();
  var limitMs = 60000;
  var callback = null;
  var timer = null;
  var armed = false;

  function poke() {
    last = Date.now();
  }

  function check() {
    if (!callback || Date.now() - last < limitMs) return;
    last = Date.now();
    try {
      callback();
    } catch (e) {
      /* the error handler resets the screen */
    }
  }

  K.idle = {
    start: function (seconds, fn) {
      limitMs = Math.max(5, Number(seconds) || 60) * 1000;
      callback = fn;
      poke();
      if (!armed) {
        armed = true;
        ['pointerdown', 'pointerup', 'touchstart'].forEach(function (name) {
          window.addEventListener(name, poke, { capture: true, passive: true });
        });
      }
      if (timer) clearInterval(timer);
      timer = setInterval(check, 1000);
    },
    poke: poke,
    idleMs: function () {
      return Date.now() - last;
    },
  };
})((window.Kiosk = window.Kiosk || {}));
