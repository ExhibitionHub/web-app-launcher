/*
 * Page-level kiosk lock. Keeps a visitor inside the app:
 * no selection, no menus, no drag, no zoom, no scroll, no keys, no navigation.
 * (Text selection, tap highlight and focus rings are also removed by the style sheet.)
 */
(function (K) {
  'use strict';

  var allowed = false;
  var stats = {
    keys: 0,
    contextMenus: 0,
    drags: 0,
    drops: 0,
    selections: 0,
    zoomGestures: 0,
    wheels: 0,
    multiTouch: 0,
    openCalls: 0,
    linkClicks: 0,
    unloadBlocked: 0,
  };

  function stop(e) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return false;
  }

  function on(target, names, fn, passive) {
    names.forEach(function (name) {
      target.addEventListener(name, fn, { capture: true, passive: passive === true });
    });
  }

  var installed = false;

  function install() {
    if (installed) return;
    installed = true;
    var root = document.documentElement;
    var topLevel = window.top === window;
    if (K.host.kiosk) root.classList.add('kiosk');

    // Right click and long press (a long press on a touch screen is a right click)
    on(window, ['contextmenu'], function (e) {
      stats.contextMenus += 1;
      return stop(e);
    });
    on(window, ['auxclick'], stop);
    on(window, ['mousedown'], function (e) {
      if (e.button !== 0) return stop(e);
      return undefined;
    });

    // Selection, clipboard, drag and file drop
    on(window, ['selectstart'], function (e) {
      stats.selections += 1;
      return stop(e);
    });
    on(window, ['copy', 'cut', 'paste'], stop);
    on(window, ['dragstart', 'dragenter', 'dragover', 'dragleave', 'drop'], function (e) {
      if (e.type === 'drop') stats.drops += 1;
      else if (e.type === 'dragstart') stats.drags += 1;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      return stop(e);
    });

    // Zoom and pinch
    on(window, ['gesturestart', 'gesturechange', 'gestureend'], function (e) {
      stats.zoomGestures += 1;
      return stop(e);
    });
    on(
      window,
      ['wheel'],
      function (e) {
        stats.wheels += 1;
        return stop(e);
      },
      false
    );
    on(
      window,
      ['touchstart'],
      function (e) {
        if (e.touches && e.touches.length > 1) {
          stats.multiTouch += 1;
          return stop(e);
        }
        return undefined;
      },
      false
    );
    on(window, ['touchmove'], stop, false);

    // No scroll, ever
    window.addEventListener('scroll', function () {
      window.scrollTo(0, 0);
    });

    // No keyboard at all: F1-F12, Ctrl+R/W/T/N/L/P/S/U, Ctrl+Shift+I/J/C, Alt+arrows, Esc, Backspace, Tab...
    on(window, ['keydown', 'keyup', 'keypress'], function (e) {
      if (e.type === 'keydown') stats.keys += 1;
      return stop(e);
    });

    // Never keep the focus on anything
    on(window, ['focusin'], function (e) {
      if (e.target && e.target.blur) e.target.blur();
    });

    // Nothing may leave the app
    window.open = function () {
      stats.openCalls += 1;
      return null;
    };
    window.alert = function () {};
    window.confirm = function () {
      return false;
    };
    window.prompt = function () {
      return null;
    };
    on(window, ['click'], function (e) {
      var node = e.target;
      while (node && node !== document) {
        if (node.tagName === 'A' || node.tagName === 'AREA') {
          stats.linkClicks += 1;
          return stop(e);
        }
        node = node.parentNode;
      }
      return undefined;
    });

    // Navigation guards only when the page owns the whole window.
    // Inside the App Hub frame they would interfere with the hub itself.
    if (topLevel) {
      try {
        window.history.replaceState(null, '', window.location.href);
        window.history.pushState(null, '', window.location.href);
      } catch (e) {
        /* some browsers refuse on file:// */
      }
      window.addEventListener('popstate', function () {
        try {
          window.history.pushState(null, '', window.location.href);
        } catch (e) {
          /* ignore */
        }
      });
      window.addEventListener('beforeunload', function (e) {
        if (allowed) return undefined;
        stats.unloadBlocked += 1;
        e.preventDefault();
        e.returnValue = '';
        return '';
      });
    }
  }

  K.lockdown = {
    install: install,
    stats: stats,
    /** Call right before a reload the app starts itself. */
    allowUnload: function () {
      allowed = true;
    },
  };
})((window.Kiosk = window.Kiosk || {}));
