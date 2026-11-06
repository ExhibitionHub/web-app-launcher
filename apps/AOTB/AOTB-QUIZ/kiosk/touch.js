/*
 * One tap = one action.
 *  - only the first finger counts; extra fingers are ignored
 *  - a tap must start and end on the same button, without sliding
 *  - a long press is not a tap
 *  - taps that come too fast after the previous one are dropped
 */
(function (K) {
  'use strict';

  var MAX_SLIDE = 28;
  var MAX_PRESS_MS = 1200;
  var MIN_GAP_MS = 350;

  var handler = null;
  var current = null; // the finger being followed
  var lockedUntil = 0;
  var accepted = 0;
  var dropped = 0;

  function targetOf(node) {
    return node && node.closest ? node.closest('[data-action]') : null;
  }

  function release() {
    if (current && current.el) current.el.classList.remove('is-pressed');
    current = null;
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.isPrimary) {
      dropped += 1;
      return;
    }
    if (current) release();
    var el = targetOf(e.target);
    current = { id: e.pointerId, el: el, x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    if (el && !el.hasAttribute('data-disabled')) el.classList.add('is-pressed');
    if (e.cancelable) e.preventDefault(); // no focus, no text selection
  }

  function onMove(e) {
    if (!current || e.pointerId !== current.id) return;
    if (Math.abs(e.clientX - current.x) > MAX_SLIDE || Math.abs(e.clientY - current.y) > MAX_SLIDE) {
      current.moved = true;
      if (current.el) current.el.classList.remove('is-pressed');
    }
  }

  function onUp(e) {
    if (!current || e.pointerId !== current.id) return;
    var tap = current;
    release();
    var now = Date.now();
    var el = tap.el;
    if (!el || el.hasAttribute('data-disabled') || tap.moved || now - tap.t > MAX_PRESS_MS) return;
    var under = document.elementFromPoint(e.clientX, e.clientY);
    if (targetOf(under) !== el) return;
    if (now < lockedUntil) {
      dropped += 1;
      return;
    }
    lockedUntil = now + MIN_GAP_MS;
    accepted += 1;
    if (handler) handler(el);
  }

  function onCancel(e) {
    if (current && e.pointerId === current.id) release();
  }

  K.touch = {
    install: function (fn) {
      handler = fn;
      window.addEventListener('pointerdown', onDown, { capture: true, passive: false });
      window.addEventListener('pointermove', onMove, { capture: true, passive: true });
      window.addEventListener('pointerup', onUp, { capture: true, passive: true });
      window.addEventListener('pointercancel', onCancel, { capture: true, passive: true });
    },
    /** Ignore taps for a short time, for example right after a new screen appears. */
    lockFor: function (ms) {
      lockedUntil = Math.max(lockedUntil, Date.now() + ms);
    },
    stats: function () {
      return { accepted: accepted, dropped: dropped };
    },
  };
})((window.Kiosk = window.Kiosk || {}));
