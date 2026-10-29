// controls.js
// Centralizes interactions (mouse, touch, wheel, pinch) and the UI buttons.

export function setupControls(options) {
  const {
    viewport,
    panCamera,
    zoomBy,
    clampCameraPosition,
    updateCameraLookAt,
    setFilter,
    resetCamera,
    onClick,
    showMouseCursor,
    hideMouseCursor,
    createCursor,
    removeCursor,
    removeAllCursors,
    getPointerColor
  } = options;

  if (!viewport) throw new Error('viewport element required for controls');

  const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  const useTouchFallback = !supportsPointerEvents;

  let pendingPan = null;
  let pendingZoom = 0;
  let gestureRaf = null;
  let activePointerType = 'mouse';

  function flushGestures() {
    gestureRaf = null;
    if (pendingPan && panCamera) {
      panCamera(pendingPan.x, pendingPan.y, { pointerType: activePointerType });
      pendingPan = null;
    }
    if (pendingZoom !== 0) {
      if (zoomBy) zoomBy(pendingZoom);
      if (clampCameraPosition) clampCameraPosition();
      if (updateCameraLookAt) updateCameraLookAt();
      pendingZoom = 0;
    }
  }

  function queueGesture() {
    if (gestureRaf !== null) return;
    gestureRaf = requestAnimationFrame(flushGestures);
  }

  // Buttons
  document.querySelectorAll('[data-filter]').forEach(btn => {
    if (!setFilter) return;
    const target = btn.getAttribute('data-filter');
    if (!target) return;
    btn.addEventListener('click', () => setFilter(target));
  });
  document.querySelectorAll('[data-action="zoomIn"]').forEach(btn => {
    if (!zoomBy) return;
    btn.addEventListener('click', () => {
      zoomBy(-100);
      clampCameraPosition && clampCameraPosition();
      updateCameraLookAt && updateCameraLookAt();
    });
  });
  document.querySelectorAll('[data-action="zoomOut"]').forEach(btn => {
    if (!zoomBy) return;
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
  const moveThresholdSq = 25; // 5px

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

  viewport.addEventListener('pointerdown', e => {
    viewport.setPointerCapture && viewport.setPointerCapture(e.pointerId);
    const color = typeof getPointerColor === 'function' ? getPointerColor(e) : 'shared';
    pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
      startedOnBubble: !!e.target.closest && !!e.target.closest('.wonder-bubble'),
      color
    });
    activePointerType = e.pointerType || 'mouse';
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      lastPinchDist = getDistance(a, b);
    } else if (pointers.size === 1) {
      lastPinchDist = null;
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
      if (!state.startedOnBubble) {
        accumulatePan(state.x - prev.x, state.y - prev.y, e.pointerType);
      }
    } else if (uniqueColors.size === 1) {
      // Same user: pinch/zoom
      if (pointerList.length >= 2) {
        const dist = getDistance(pointerList[0], pointerList[1]);
        if (lastPinchDist !== null) {
          pendingZoom += -(dist - lastPinchDist) * 2;
          queueGesture();
        }
        lastPinchDist = dist;
      }
    } else {
      // Multi-user: sum independent pans
      if (!state.startedOnBubble) {
        accumulatePan(state.x - prev.x, state.y - prev.y, e.pointerType);
      }
      lastPinchDist = null;
    }
    e.preventDefault();
  }, {passive:false});

  function releasePointer(e) {
    const state = pointers.get(e.pointerId);
    if (removeCursor) removeCursor(e);
    pointers.delete(e.pointerId);
    viewport.releasePointerCapture && viewport.releasePointerCapture(e.pointerId);
    lastPinchDist = null;
    if (pointers.size === 0) {
      if (hideMouseCursor) hideMouseCursor();
      if (removeAllCursors) removeAllCursors();

      // If it was a quick tap without movement, fire the click handler
      if (onClick && state && !state.hasMoved) {
        onClick(e.clientX, e.clientY, e);
      }
    }
  }

  viewport.addEventListener('pointerup', releasePointer, {passive:false});
  viewport.addEventListener('pointercancel', releasePointer, {passive:false});

  // Wheel zoom
  viewport.addEventListener('wheel', e => {
    pendingZoom += e.deltaY * 0.5;
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
          startedOnBubble: !!t.target && !!t.target.closest && !!t.target.closest('.wonder-bubble'),
          color: touchColor(t)
        });
      }
      if (createCursor) for (let i=0;i<e.touches.length;i++) createCursor(e.touches[i]);
      if (touchState.size >= 2) {
        const arr = Array.from(touchState.values());
        lastPinchDist = getDistance(arr[0], arr[1]);
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
          if (!state.startedOnBubble) {
            accumulatePan(state.x - prev.x, state.y - prev.y, 'touch');
          }
        } else if (uniqueColors.size === 1 && touches.length >= 2) {
          const dist = getDistance(touches[0], touches[1]);
          if (lastPinchDist !== null) {
            pendingZoom += -(dist - lastPinchDist) * 2;
            queueGesture();
          }
          lastPinchDist = dist;
        } else {
          if (!state.startedOnBubble) {
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
        if (state && !state.hasMoved && onClick && e.touches.length === 0 && !clickFired) {
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
