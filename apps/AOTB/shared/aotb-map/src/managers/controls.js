// controls.js
// Centralizes interactions (mouse, touch, wheel, pinch) and the UI buttons.

export function setupControls(options) {
  const {
    viewport,
    panCamera,
    zoomBy,
    clampCameraPosition,
    updateCameraLookAt,
    resetCamera,
    onClick,
    showMouseCursor,
    hideMouseCursor,
    createCursor,
    removeCursor,
    removeAllCursors,
    getPointerColor,
    enableZoom = true,
    enableTouchPinchZoom = true
  } = options;

  if (!viewport) throw new Error('viewport element required for controls');

  const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  const useTouchFallback = !supportsPointerEvents;

  let pendingPan = null;
  let pendingZoom = 0;
  let gestureRaf = null;
  let activePointerType = 'mouse';

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Zoom smoothing: consume large deltas over multiple frames.
  const ZOOM_DAMPING = 0.35;      // fraction consumed per frame
  const ZOOM_STEP_MAX = 120;      // max zoom delta applied per frame
  const ZOOM_EPS = 0.05;          // stop threshold

  function flushGestures() {
    gestureRaf = null;
    if (pendingPan && panCamera) {
      panCamera(pendingPan.x, pendingPan.y, { pointerType: activePointerType });
      pendingPan = null;
    }

    if (!enableZoom) {
      pendingZoom = 0;
    }

    if (enableZoom && pendingZoom !== 0) {
      // Apply a damped step so trackpad wheel bursts don't cause laggy jumps.
      let step = pendingZoom * ZOOM_DAMPING;
      step = clamp(step, -ZOOM_STEP_MAX, ZOOM_STEP_MAX);
      // Ensure we always make progress even for tiny values.
      if (Math.abs(step) < ZOOM_EPS) step = pendingZoom;

      if (zoomBy) zoomBy(step);
      if (clampCameraPosition) clampCameraPosition();
      if (updateCameraLookAt) updateCameraLookAt();

      pendingZoom -= step;
      if (Math.abs(pendingZoom) <= ZOOM_EPS) pendingZoom = 0;

      // Keep animating until the buffered zoom is fully consumed.
      if (pendingZoom !== 0) queueGesture();
    }
  }

  function queueGesture() {
    if (gestureRaf !== null) return;
    gestureRaf = requestAnimationFrame(flushGestures);
  }

  // Buttons
  document.querySelectorAll('[data-action="zoomIn"]').forEach(btn => {
    if (!zoomBy || !enableZoom) return;
    btn.addEventListener('click', () => {
      zoomBy(-100);
      clampCameraPosition && clampCameraPosition();
      updateCameraLookAt && updateCameraLookAt();
    });
  });
  document.querySelectorAll('[data-action="zoomOut"]').forEach(btn => {
    if (!zoomBy || !enableZoom) return;
    btn.addEventListener('click', () => {
      zoomBy(100);
      clampCameraPosition && clampCameraPosition();
      updateCameraLookAt && updateCameraLookAt();
    });
  });
  document.querySelectorAll('[data-action="resetCamera"]').forEach(btn => {
    if (!resetCamera) return;
    btn.addEventListener('click', resetCamera);
  });

  // Pointer + multi-pointer (pinch) handling
  const pointers = new Map(); // id -> {x,y,startX,startY,hasMoved,startedOnBubble,color}
  let lastPinchDist = null;
  let lastMultiMid = null;
  const moveThresholdSq = 25; // 5px
  const PINCH_SENSITIVITY = 1.6;

  function getDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx*dx + dy*dy);
  }

  function updateMoveState(pointerState, e) {
    const dx = e.clientX - pointerState.startX;
    const dy = e.clientY - pointerState.startY;
    if ((dx * dx + dy * dy) > moveThresholdSq) {
      pointerState.hasMoved = true;
    }
  }

  function accumulatePan(dx, dy, pointerType) {
    if (!panCamera) return;
    activePointerType = pointerType || activePointerType;
    pendingPan = pendingPan || { x: 0, y: 0 };
    pendingPan.x += dx;
    pendingPan.y += dy;
    queueGesture();
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  }

  function centroid(list) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of arr) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / arr.length, y: sy / arr.length };
  }

  function farthestPair(list) {
    const arr = Array.isArray(list) ? list : [];
    if (arr.length < 2) return null;
    let bestI = 0;
    let bestJ = 1;
    let bestD = -1;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const dx = arr[i].x - arr[j].x;
        const dy = arr[i].y - arr[j].y;
        const d = dx * dx + dy * dy;
        if (d > bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    return [arr[bestI], arr[bestJ]];
  }

  viewport.addEventListener('pointerdown', e => {
    viewport.setPointerCapture && viewport.setPointerCapture(e.pointerId);
    const color = typeof getPointerColor === 'function' ? getPointerColor(e) : 'shared';
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
      startedOnBubble: !!e.target?.closest && !!e.target.closest('.wonder-bubble, .wonder-bubble-wrapper'),
      color
    });
    activePointerType = e.pointerType || 'mouse';
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      lastPinchDist = getDistance(a, b);
      lastMultiMid = midpoint(a, b);
    } else if (pointers.size === 1) {
      lastPinchDist = null;
      lastMultiMid = null;
    } else if (pointers.size > 2) {
      const list = Array.from(pointers.values());
      const pair = farthestPair(list);
      lastPinchDist = pair ? getDistance(pair[0], pair[1]) : null;
      lastMultiMid = centroid(list);
    }
    if (createCursor) createCursor(e);
    if (showMouseCursor) showMouseCursor(e.clientX, e.clientY);
    e.preventDefault();
  }, {passive:false});

  viewport.addEventListener('pointermove', e => {
    const state = pointers.get(e.pointerId);
    if (!state) return;
    if (createCursor) createCursor(e);

    // Update per-pointer movement tracking
    updateMoveState(state, e);

    // Refresh stored position before calculating group gestures
    const prev = { x: state.x, y: state.y };
    state.x = e.clientX;
    state.y = e.clientY;
    pointers.set(e.pointerId, state);

    const pointerList = Array.from(pointers.values());
    const uniqueColors = new Set(pointerList.map(p => p.color || 'shared'));

    if (pointers.size === 1) {
      // Markers should be clickable, but they must not block pan/zoom.
      // Suppress pan only until the pointer has moved beyond the threshold,
      // so taps still register as clicks.
      if (!state.startedOnBubble || state.hasMoved) {
        accumulatePan(state.x - prev.x, state.y - prev.y, e.pointerType);
      }
    } else if (uniqueColors.size === 1) {
      // Same user: allow PAN with 2+ fingers, and PINCH with 2 fingers.
      if (pointerList.length === 2) {
        const mid = midpoint(pointerList[0], pointerList[1]);
        if (lastMultiMid) {
          accumulatePan(mid.x - lastMultiMid.x, mid.y - lastMultiMid.y, e.pointerType);
        }
        lastMultiMid = mid;

        const dist = getDistance(pointerList[0], pointerList[1]);
        if (enableZoom && enableTouchPinchZoom && lastPinchDist !== null) {
          // Slightly less sensitive to avoid accidental zoom on weak touchscreens.
          const pinchDelta = clamp(-(dist - lastPinchDist) * PINCH_SENSITIVITY, -260, 260);
          pendingZoom += pinchDelta;
          queueGesture();
        }
        lastPinchDist = dist;
      } else {
        // 3+ fingers: pan by centroid, pinch by farthest pair (stable).
        const mid = centroid(pointerList);
        if (mid && lastMultiMid) {
          accumulatePan(mid.x - lastMultiMid.x, mid.y - lastMultiMid.y, e.pointerType);
        }
        lastMultiMid = mid;

        const pair = farthestPair(pointerList);
        if (pair) {
          const dist = getDistance(pair[0], pair[1]);
          if (enableZoom && enableTouchPinchZoom && lastPinchDist !== null) {
            const pinchDelta = clamp(-(dist - lastPinchDist) * PINCH_SENSITIVITY, -260, 260);
            pendingZoom += pinchDelta;
            queueGesture();
          }
          lastPinchDist = dist;
        } else {
          lastPinchDist = null;
        }
      }
    } else {
      // Multi-user: sum independent pans
      if (!state.startedOnBubble || state.hasMoved) {
        accumulatePan(state.x - prev.x, state.y - prev.y, e.pointerType);
      }
      lastPinchDist = null;
      lastMultiMid = null;
    }
    e.preventDefault();
  }, {passive:false});

  function releasePointer(e) {
    const state = pointers.get(e.pointerId);
    if (removeCursor) removeCursor(e);
    pointers.delete(e.pointerId);
    viewport.releasePointerCapture && viewport.releasePointerCapture(e.pointerId);
    lastPinchDist = null;
    if (pointers.size === 0) lastMultiMid = null;
    if (pointers.size === 0) {
      if (hideMouseCursor) hideMouseCursor();
      if (removeAllCursors) removeAllCursors();

      // If it was a quick tap without movement, fire the click handler
      // IMPORTANT: taps on bubbles are handled by the bubble element itself (onclick).
      // Calling onClick here would double-handle and can trigger unwanted zoom/focus.
      if (onClick && state && !state.hasMoved && !state.startedOnBubble) {
        onClick(e.clientX, e.clientY, e);
      }
    }
  }

  viewport.addEventListener('pointerup', releasePointer, {passive:false});
  viewport.addEventListener('pointercancel', releasePointer, {passive:false});

  // Wheel zoom
  viewport.addEventListener('wheel', e => {
    if (!enableZoom) {
      e.preventDefault();
      return;
    }
    // Normalize wheel units (trackpad/smooth scrolling vs line/page mode)
    const modeScale = (e.deltaMode === 1) ? 16 : (e.deltaMode === 2) ? 120 : 1;
    const raw = e.deltaY * modeScale;
    const wheelDelta = clamp(raw * 0.35, -260, 260);
    pendingZoom += wheelDelta;
    queueGesture();
    e.preventDefault();
  }, {passive:false});

  // Touch fallback: ensure multi-touch pinch works in environments without proper pointer events
  if (useTouchFallback) {
    const touchState = new Map(); // id -> {x,y,startX,startY,hasMoved,color,startedOnBubble}

    function touchColor(t) {
      return typeof getPointerColor === 'function' ? getPointerColor(t) : 'shared';
    }

    function updateTouchMoveState(state, t) {
      const dx = t.clientX - state.startX;
      const dy = t.clientY - state.startY;
      if ((dx * dx + dy * dy) > moveThresholdSq) state.hasMoved = true;
    }

    viewport.addEventListener('touchstart', function(e){
      activePointerType = 'touch';
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        touchState.set(t.identifier, {
          x: t.clientX,
          y: t.clientY,
          startX: t.clientX,
          startY: t.clientY,
          hasMoved: false,
          startedOnBubble: !!t.target?.closest && !!t.target.closest('.wonder-bubble, .wonder-bubble-wrapper'),
          color: touchColor(t)
        });
      }
      if (createCursor) for (let i=0;i<e.touches.length;i++) createCursor(e.touches[i]);
      if (touchState.size >= 2) {
        const arr = Array.from(touchState.values());
        const pair = farthestPair(arr) || [arr[0], arr[1]];
        lastPinchDist = getDistance(pair[0], pair[1]);
      } else {
        lastPinchDist = null;
      }
    }, {passive:false});

    viewport.addEventListener('touchmove', function(e){
      if (createCursor) {
        for (let i = 0; i < e.touches.length; i++) createCursor(e.touches[i]);
      }
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const state = touchState.get(t.identifier);
        if (!state) continue;
        updateTouchMoveState(state, t);
        const prev = { x: state.x, y: state.y };
        state.x = t.clientX;
        state.y = t.clientY;
        touchState.set(t.identifier, state);
        const touches = Array.from(touchState.values());
        const uniqueColors = new Set(touches.map(p => p.color || 'shared'));

        if (touchState.size === 1) {
          if (!state.startedOnBubble || state.hasMoved) {
            accumulatePan(state.x - prev.x, state.y - prev.y, 'touch');
          }
        } else if (uniqueColors.size === 1 && touches.length >= 2) {
          const pair = farthestPair(touches) || [touches[0], touches[1]];
          const dist = getDistance(pair[0], pair[1]);
          if (enableZoom && enableTouchPinchZoom && lastPinchDist !== null) {
            pendingZoom += clamp(-(dist - lastPinchDist) * PINCH_SENSITIVITY, -260, 260);
            queueGesture();
          }
          lastPinchDist = dist;
        } else {
          if (!state.startedOnBubble || state.hasMoved) {
            accumulatePan(state.x - prev.x, state.y - prev.y, 'touch');
          }
          lastPinchDist = null;
        }
      }
      e.preventDefault();
    }, {passive:false});

    viewport.addEventListener('touchend', function(e){
      if (removeCursor && e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) removeCursor(e.changedTouches[i]);
      }
      let clickFired = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const state = touchState.get(t.identifier);
        touchState.delete(t.identifier);
        if (state && !state.hasMoved && !state.startedOnBubble && onClick && e.touches.length === 0 && !clickFired) {
          onClick(t.clientX, t.clientY, e);
          clickFired = true;
        }
      }
      if (touchState.size === 0) {
        lastPinchDist = null;
        if (removeAllCursors) removeAllCursors();
      }
    }, {passive:false});
  }


  return {
    dispose() {
      // Detach listeners if cleanup is needed later
      viewport.replaceWith(viewport.cloneNode(true));
    }
  };
}
