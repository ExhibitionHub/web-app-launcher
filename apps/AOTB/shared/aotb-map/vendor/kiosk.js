(() => {
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';

  const home = meta('kiosk-home');
  const timeoutMsRaw = meta('kiosk-timeout-ms');
  const timeoutMs = Number(timeoutMsRaw || '90000');

  // Kiosk hardening: no context menu, no HTML drag (images/text), no right-click behavior.
  const prevent = (e) => {
    try { e.preventDefault(); } catch { /* ignore */ }
  };

  document.addEventListener('contextmenu', prevent, { capture: true });
  document.addEventListener('dragstart', prevent, { capture: true });
  document.addEventListener('dblclick', prevent, { capture: true });

  // iOS Safari pinch-zoom gesture events
  document.addEventListener('gesturestart', prevent, { capture: true });
  document.addEventListener('gesturechange', prevent, { capture: true });
  document.addEventListener('gestureend', prevent, { capture: true });

  // Some browsers still start drag-like behaviors on right mouse down.
  window.addEventListener('pointerdown', (e) => {
    if (e && typeof e.button === 'number' && e.button === 2) prevent(e);
  }, { capture: true, passive: false });
  window.addEventListener('mousedown', (e) => {
    if (e && typeof e.button === 'number' && e.button === 2) prevent(e);
  }, { capture: true, passive: false });

  const makeImagesUndraggable = (root) => {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('img').forEach((img) => {
      try { img.draggable = false; } catch { /* ignore */ }
      try { img.setAttribute('draggable', 'false'); } catch { /* ignore */ }
      if (img && img.style) {
        img.style.webkitUserDrag = 'none';
        img.style.userSelect = 'none';
      }
    });
  };

  makeImagesUndraggable(document);
  try {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const n of (m.addedNodes || [])) {
          if (n && n.nodeType === 1) {
            makeImagesUndraggable(n);
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    // ignore
  }

  // If no home is configured, only kiosk hardening applies.
  if (!home || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

  let timerId = 0;
  let lastReset = 0;

  const goHome = () => {
    try {
      window.location.href = home;
    } catch {
      // ignore
    }
  };

  const schedule = () => {
    if (timerId) window.clearTimeout(timerId);
    timerId = window.setTimeout(goHome, timeoutMs);
  };

  const reset = () => {
    const now = Date.now();
    if (now - lastReset < 750) return;
    lastReset = now;
    schedule();
  };

  const events = [
    'pointerdown',
    'pointermove',
    'keydown',
    'wheel',
    'touchstart',
    'mousemove',
    'mousedown',
    'click',
  ];

  for (const eventName of events) {
    window.addEventListener(eventName, reset, { passive: true, capture: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reset();
  });

  schedule();
})();
