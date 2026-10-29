import * as THREE from '../lib/three/build/three.module.js';
import { GLTFLoader } from '../lib/three/examples/jsm/loaders/GLTFLoader.js';
import { setupInfiniteMap, checkInfiniteScroll, groupCubes, setScrollSize, setGeoBounds, geoToMapXY, MAP_WIDTH, MAP_HEIGHT } from './core/map.js?v=20260205h';
import { cubeWonderMap, showWonderPanel, fetchWonders, captureOpenWonderPopupStates } from './data/wonders.js?v=20260326b';
import { setupControls } from './managers/controls.js';
import { loadFileAsArrayBuffer, getResourcePath } from './utils/fileLoader.js';
import { initEnvironment } from './core/environment.js?v=20260116a';
import { createBubbleManager } from './managers/bubbleManager.js?v=20260326b';
import { createTouchCursor, removeTouchCursor, removeAllTouchCursors, getPointerColor } from './managers/cursorManager.js';
import { createSearchPanel } from './ui/searchPanel.js?v=20260126a';
import { COUNTRY_CENTROIDS, normalizeCountryName } from './data/countryCentroids.js';

// Used by app-maps/index.html bootstrap to detect failures before this module runs.
try { window.__MAP_APP_STARTED = true; } catch { /* ignore */ }

const { viewport, scene, camera, renderer, css2dRenderer } = initEnvironment();
const bubbleManager = createBubbleManager({ scene, camera, viewport });

// This project uses ONLY bubbles (CSS2D) for markers.
// We still create lightweight 3D anchors (empty Object3D) so CSS2DRenderer can position them.
function createWonderAnchor(wonder) {
  const anchor = new THREE.Object3D();
  try {
    anchor.userData.wonderId = (wonder && wonder.id != null) ? String(wonder.id) : null;
  } catch {
    // ignore
  }
  bubbleManager.createBubble(wonder, anchor);
  return anchor;
}

const idleOverlay = document.getElementById('idleOverlay');
const idleMessageEl = document.getElementById('idleMessage');

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
const homeHref = meta('kiosk-home') || '../';
const idleTimeoutMs = Number(meta('map-idle-timeout-ms') || '90000');

let idleActive = !!idleOverlay;
let idleTimer = null;
let canDismissIdleOverlay = false;
let redirectingHome = false;

let mapTextureSettled = false;
let worldMapSettled = false;
let wondersSettled = false;
let markersSettled = false;
const mapTracking = window.EHTracking
  ? window.EHTracking.createTracker({ exhibition: 'SK', application: 'app-maps' })
  : null;
let mapTrackingStarted = false;
let mapLanguageSelectionLocked = false;

function lockMapLanguageSelection() {
  if (mapLanguageSelectionLocked) {
    return;
  }

  mapLanguageSelectionLocked = true;
  document.documentElement.classList.add('lang-selection-locked');
}

function startMapExperienceTracking() {
  if (!mapTracking || mapTrackingStarted) {
    return;
  }

  mapTrackingStarted = true;
  void mapTracking.restart(0, { step: 'explore' });
}

function ensureMapTrackingStarted() {
  if (!mapTracking || mapTrackingStarted) {
    return;
  }

  startMapExperienceTracking();
}

function trackMapProgress(percentage) {
  if (!mapTracking) {
    return;
  }

  ensureMapTrackingStarted();
  void mapTracking.track(percentage);
}

const translate = (key, vars, fallback = key) => {
  try {
    if (window.i18n && typeof window.i18n.t === 'function') {
      const value = window.i18n.t(key, vars);
      if (value != null && value !== key) return value;
    }
  } catch {
    // ignore
  }
  return fallback;
};

function getWorldMapFailureMessage(kind) {
  if (kind === 'parse') {
    return translate('mapApp.loading.modelParseFailure', null, 'Unable to read the map model.');
  }

  return translate('mapApp.loading.modelLoadFailure', null, 'Unable to load the map model.');
}

let idleMessageState = {
  mode: 'key',
  key: 'mapApp.idle.loading',
  fallback: 'Loading…'
};

// BridgSign/Electron troubleshooting: if something fails early, the overlay can look like
// "loading forever". Add a watchdog message with the missing stage(s).
window.setTimeout(() => {
  if (!idleActive) return;
  if (mapTextureSettled && worldMapSettled && wondersSettled && markersSettled) return;

  const missing = [];
  if (!mapTextureSettled) missing.push('texture');
  if (!worldMapSettled) missing.push('model');
  if (!wondersSettled) missing.push('data');
  if (!markersSettled) missing.push('markers');

  // Keep this user-friendly but useful.
  setIdleStuckMessage(missing);
  console.warn('[Loading] Stuck stages:', {
    mapTextureSettled,
    worldMapSettled,
    wondersSettled,
    markersSettled
  });
}, 20000);

function maybeUnlockIdleDismiss() {
  if (canDismissIdleOverlay) return;
  if (!mapTextureSettled || !worldMapSettled || !wondersSettled || !markersSettled) return;
  canDismissIdleOverlay = true;
  // Initial load complete: hide loading screen and start idle timer.
  if (idleActive) hideIdleOverlay(true);
  resetIdleTimer();
}

function removeIdleOverlay() {
  if (!idleOverlay || !idleOverlay.parentElement) return;
  idleOverlay.parentElement.removeChild(idleOverlay);
}

function hideIdleOverlay(force = false) {
  if (!idleActive || !idleOverlay) return;
  if (!force && !canDismissIdleOverlay) return;
  idleActive = false;
  idleOverlay.classList.add('is-hidden');
  window.setTimeout(removeIdleOverlay, 350);
}

function setIdleMessage(text) {
  if (!idleMessageEl) return;
  try {
    idleMessageEl.textContent = String(text || '');
  } catch {
    // ignore
  }
}

function getLoadingStageLabel(stageKey) {
  return translate(`mapApp.loading.stages.${stageKey}`, null, stageKey);
}

function resolveIdleMessage() {
  if (idleMessageState.mode === 'stuck') {
    const stages = Array.isArray(idleMessageState.missingStages)
      ? idleMessageState.missingStages.map(getLoadingStageLabel).join(', ')
      : '';
    return translate('mapApp.loading.stuckMessage', { stages }, `Loading is stuck (${stages}). Check the resources.`);
  }

  if (idleMessageState.mode === 'error') {
    const prefix = translate('mapApp.loading.errorPrefix', null, 'Error');
    return `${prefix}: ${String(idleMessageState.errorText || '')}`;
  }

  return translate(idleMessageState.key, null, idleMessageState.fallback);
}

function refreshIdleMessage() {
  setIdleMessage(resolveIdleMessage());
}

function setIdleMessageKey(key, fallback) {
  idleMessageState = { mode: 'key', key, fallback };
  refreshIdleMessage();
}

function setIdleStuckMessage(missingStages) {
  idleMessageState = {
    mode: 'stuck',
    missingStages: Array.isArray(missingStages) ? missingStages.slice() : []
  };
  refreshIdleMessage();
}

function setIdleErrorMessage(errorText) {
  idleMessageState = {
    mode: 'error',
    errorText: String(errorText || '')
  };
  refreshIdleMessage();
}

function showLoadingOverlay(message) {
  if (!idleOverlay) return;
  if (!idleOverlay.parentElement) document.body.appendChild(idleOverlay);
  if (message) setIdleMessage(message);
  else refreshIdleMessage();
  idleOverlay.classList.remove('is-hidden');
  idleActive = true;
}

function redirectToHome() {
  if (redirectingHome) return;
  redirectingHome = true;
  setIdleMessageKey('mapApp.loading.returningHome', 'Returning to menu…');
  showLoadingOverlay();
  // Small delay so the loading UI becomes visible before navigation.
  window.setTimeout(() => {
    try {
      window.location.href = homeHref;
    } catch {
      // ignore
    }
  }, 250);
}

function resetIdleTimer() {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return;
  if (!canDismissIdleOverlay) return;
  if (idleTimer) {
    window.clearTimeout(idleTimer);
  }
  idleTimer = window.setTimeout(() => {
    redirectToHome();
  }, idleTimeoutMs);
}

// While running: activity only resets the idle redirect timer.
['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'].forEach(evt => {
  window.addEventListener(evt, () => {
    if (redirectingHome) return;
    resetIdleTimer();
  }, { passive: evt === 'wheel' || evt === 'touchstart' || evt === 'pointermove' });
});

const menuState = new Map();
function syncMenuGroup(group, isOpen) {
  menuState.set(group, isOpen);
  document.querySelectorAll(`.menu-toggle[data-menu-group="${group}"]`).forEach(btn => {
    btn.classList.toggle('is-open', isOpen);
  });
  document.querySelectorAll(`.controls-panel[data-menu-group-panel="${group}"]`).forEach(panel => {
    panel.classList.toggle('is-open', isOpen);
  });
}
document.querySelectorAll('.menu-toggle').forEach(toggle => {
  const group = toggle.getAttribute('data-menu-group') || 'default';
  if (!menuState.has(group)) {
    menuState.set(group, false);
  }
  toggle.addEventListener('click', () => {
    const current = menuState.get(group) || false;
    syncMenuGroup(group, !current);
  });
});

const zoomBase = 500;
// Zoom range (camera Z). Smaller Z = closer zoom in.
const CAMERA_Z_MIN = 55;
const CAMERA_Z_MAX = 750;
const pointerVec = new THREE.Vector2();

let cameraAnimToken = 0;

function stopCameraAnimation() {
  cameraAnimToken++;
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInOutQuint(t) {
  return t < 0.5
    ? 16 * t * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function clampTargetCameraPosition(pos) {
  const z = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, pos.z));

  // Same logic as clampCameraPosition(), but applied to an arbitrary target.
  const halfMapY = TARGET_MAP_HEIGHT * 0.5;
  const safetyMargin = 20;
  let maxY = halfMapY;
  if (camera && typeof camera.fov === 'number') {
    const fovRad = (camera.fov * Math.PI) / 180;
    const visibleHalfHeight = Math.tan(fovRad * 0.5) * z;
    maxY = Math.max(0, halfMapY - visibleHalfHeight - safetyMargin);
  }

  const y = Math.max(-maxY, Math.min(maxY, pos.y));
  return { x: pos.x, y, z };
}

function animateCameraTo({ x, y, z }, { durationMs = 900 } = {}) {
  stopCameraAnimation();
  const token = cameraAnimToken;
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const from = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const rawTo = {
    x: Number.isFinite(x) ? x : from.x,
    y: Number.isFinite(y) ? y : from.y,
    z: Number.isFinite(z) ? z : from.z,
  };
  const to = clampTargetCameraPosition(rawTo);

  function step(now) {
    if (token !== cameraAnimToken) return;
    const tRaw = ((now - start) / Math.max(1, durationMs));
    const t = Math.max(0, Math.min(1, tRaw));
    const e = easeInOutQuint(t);
    camera.position.set(
      from.x + (to.x - from.x) * e,
      from.y + (to.y - from.y) * e,
      from.z + (to.z - from.z) * e
    );
    clampCameraPosition();
    updateCameraLookAt();
    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

const _tmpVec3 = new THREE.Vector3();
function findAnchorForWonderId(wonderId) {
  if (wonderId == null) return null;
  const target = String(wonderId);
  const list = Array.isArray(groupCubes) ? groupCubes : [];

  // The map can be duplicated horizontally (wrap effect). A wonder can therefore have
  // multiple mesh instances. Pick the closest instance to the current camera so we
  // don't "tour de la map" unnecessarily.
  let best = null;
  let bestDist = Infinity;
  const camPos = camera && camera.position ? camera.position : null;

  for (const obj of list) {
    const w = cubeWonderMap && typeof cubeWonderMap.get === 'function' ? cubeWonderMap.get(obj) : null;
    if (!w || w.id == null || String(w.id) !== target) continue;

    if (!camPos || typeof obj.getWorldPosition !== 'function') {
      // Fallback: keep the first valid match.
      return obj;
    }

    obj.getWorldPosition(_tmpVec3);
    const dx = _tmpVec3.x - camPos.x;
    const dy = _tmpVec3.y - camPos.y;
    const dz = _tmpVec3.z - camPos.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = obj;
    }
  }

  return best;
}

function focusWonderOnMap(wonder) {
  const wid = wonder && wonder.id != null ? wonder.id : null;
  const anchor = findAnchorForWonderId(wid);
  if (!anchor || typeof anchor.getWorldPosition !== 'function') return false;

  anchor.getWorldPosition(_tmpVec3);
  // A bit slower + slightly closer zoom for kiosk-friendly focus.
  const targetZ = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, 140));
  animateCameraTo({ x: _tmpVec3.x, y: _tmpVec3.y, z: targetZ }, { durationMs: 1800 });
  return true;
}

// Called by bubble elements (see bubbleManager.js) so marker clicks can zoom + open popup.
try {
  window.__MAP_ON_WONDER_CLICK = (wonder, x, y) => {
    try { focusWonderOnMap(wonder); } catch { /* ignore */ }
  };
} catch {
  // ignore
}

// Performance: no marker animations (bubbles only).
const ENABLE_3D_WONDER_ANIM = false;

let markersInitialized = false;

let wonders = [];
let mapTex = null;
let worldMapObjs = [];
let suppressCountryChange = false;
let languageChangePromise = null;

function normalizeForKey(value) {
  const s = String(value ?? '').toLowerCase().trim();
  // Match `searchPanel.js` normalization (diacritics only) so option values line up.
  try {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return s;
  }
}

function getWonderCountryNorm(w) {
  if (!w || typeof w !== 'object') return '';
  const stable = normalizeCountryName((w.countryKey != null) ? w.countryKey : (w.CountryKey != null) ? w.CountryKey : '');
  if (stable) return stable;
  const raw = (w.Country != null) ? w.Country : (w.country != null) ? w.country : '';
  return normalizeCountryName(raw) || normalizeForKey(raw);
}

function isValidXY(xy) {
  return Array.isArray(xy) && xy.length >= 2 && Number.isFinite(Number(xy[0])) && Number.isFinite(Number(xy[1]));
}

function getWonderMapXY(w) {
  if (!w || typeof w !== 'object') return null;
  if (isValidXY(w.xy)) return [Number(w.xy[0]), Number(w.xy[1])];
  const lat = (typeof w.lat === 'number') ? w.lat : Number(String(w.lat ?? '').trim());
  const lon = (typeof w.lon === 'number') ? w.lon : Number(String(w.lon ?? '').trim());
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const mapped = geoToMapXY(lat, lon);
    if (mapped && mapped.length >= 2) return [Number(mapped[0]), Number(mapped[1])];
  }
  return null;
}

function mapXYToWorldXY(xy, referenceCamX = null) {
  if (!isValidXY(xy)) return null;
  const scaleX = TARGET_MAP_WIDTH / MAP_WIDTH;
  const scaleY = TARGET_MAP_HEIGHT / MAP_HEIGHT;
  const baseX = (Number(xy[0]) - MAP_WIDTH / 2) * scaleX;
  const y = (MAP_HEIGHT / 2 - Number(xy[1])) * scaleY;

  let x = baseX;
  // Map repeats horizontally; unwrap to the copy nearest the current camera.
  if (Number.isFinite(referenceCamX)) {
    const k = Math.round((referenceCamX - baseX) / TARGET_MAP_WIDTH);
    x = baseX + k * TARGET_MAP_WIDTH;
  }

  return { x, y };
}

function computeAverageWorldXY(list) {
  const arr = Array.isArray(list) ? list : [];
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  const refX = camera && camera.position ? camera.position.x : 0;
  for (const w of arr) {
    const xy = getWonderMapXY(w);
    const pt = mapXYToWorldXY(xy, refX);
    if (!pt) continue;
    sumX += pt.x;
    sumY += pt.y;
    n++;
  }
  if (!n) return null;
  return { x: sumX / n, y: sumY / n };
}

function computeBoundsWorldXY(list, referenceX) {
  const arr = Array.isArray(list) ? list : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let n = 0;
  for (const w of arr) {
    const xy = getWonderMapXY(w);
    const pt = mapXYToWorldXY(xy, referenceX);
    if (!pt) continue;
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
    n++;
  }
  if (!n) return null;
  return { minX, maxX, minY, maxY, n };
}

function computeFitZoomForBounds(bounds, { padding = 1.18, minZoomZ = 140 } = {}) {
  if (!bounds) return null;
  const w = Math.max(0, (bounds.maxX - bounds.minX)) * padding;
  const h = Math.max(0, (bounds.maxY - bounds.minY)) * padding;

  const aspect = (camera && typeof camera.aspect === 'number' && Number.isFinite(camera.aspect))
    ? camera.aspect
    : (viewport && viewport.clientHeight)
      ? (viewport.clientWidth / viewport.clientHeight)
      : 1;

  const fovDeg = (camera && typeof camera.fov === 'number') ? camera.fov : 60;
  const fovRad = (fovDeg * Math.PI) / 180;
  const tan = Math.tan(fovRad * 0.5);
  const safeTan = Number.isFinite(tan) && tan > 1e-6 ? tan : Math.tan((60 * Math.PI) / 360);

  const halfH = h * 0.5;
  const halfW = w * 0.5;
  const zH = halfH / safeTan;
  const zW = (halfW / Math.max(1e-6, aspect)) / safeTan;

  const target = Math.max(minZoomZ, zH, zW);
  return Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, target));
}

function getUsaHomeWorldXY() {
  const key = normalizeCountryName('united states') || 'united states';
  const c = COUNTRY_CENTROIDS[key] || COUNTRY_CENTROIDS.usa || COUNTRY_CENTROIDS['united states'];
  if (!c) return { x: 0, y: 0 };
  const mapped = geoToMapXY(c.lat, c.lon);
  const pt = mapXYToWorldXY(mapped, 0);
  return pt || { x: 0, y: 0 };
}

function getFilteredWonders(countryNorm) {
  const norm = String(countryNorm || '');
  return (norm && norm !== '__unknown__')
    ? wonders.filter(w => getWonderCountryNorm(w) === norm)
    : (norm === '__unknown__')
      ? wonders.filter(w => !getWonderCountryNorm(w))
      : wonders;
}

function refreshWonderMarkers(countryNorm, { clearPanels = true } = {}) {
  const filtered = getFilteredWonders(countryNorm);

  bubbleManager.clear();
  setupInfiniteMap(scene, filtered, mapTex, createWonderAnchor, cubeWonderMap);
  if (clearPanels) clearWonderPanels();

  return filtered;
}

function applyCountryFilter(countryNorm, { animate = true, clearPanels = true } = {}) {
  const norm = String(countryNorm || '');
  const filtered = refreshWonderMarkers(norm, { clearPanels });

  if (norm && animate) {
    // Compute a wrap-aware average and bounds so zoom feels right.
    // Pass 1: compute a stable reference X near the central copy.
    const baseAvg = (() => {
      const arr = Array.isArray(filtered) ? filtered : [];
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const w of arr) {
        const xy = getWonderMapXY(w);
        const pt = mapXYToWorldXY(xy, 0);
        if (!pt) continue;
        sx += pt.x;
        sy += pt.y;
        n++;
      }
      if (!n) return null;
      return { x: sx / n, y: sy / n };
    })();

    const refX = baseAvg ? baseAvg.x : (camera && camera.position ? camera.position.x : 0);
    const avg = (() => {
      const arr = Array.isArray(filtered) ? filtered : [];
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const w of arr) {
        const xy = getWonderMapXY(w);
        const pt = mapXYToWorldXY(xy, refX);
        if (!pt) continue;
        sx += pt.x;
        sy += pt.y;
        n++;
      }
      if (!n) return null;
      return { x: sx / n, y: sy / n };
    })();

    if (avg) {
      const bounds = computeBoundsWorldXY(filtered, avg.x);
      const z = computeFitZoomForBounds(bounds, { padding: 1.22, minZoomZ: 140 }) ?? camera.position.z;
      animateCameraTo({ x: avg.x, y: avg.y, z }, { durationMs: 1400 });
    }
  }

  return filtered;
}

function resolveSearchKeyboardLayout() {
  try {
    const value = new URL(window.location.href).searchParams.get('keyboardLayout');
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'azerty' || normalized === 'qwerty') {
      return normalized;
    }
  } catch {
    // ignore
  }

  return undefined;
}

const searchPanel = createSearchPanel({
  defaultKeyboardLayout: resolveSearchKeyboardLayout(),
  onSelect: (wonder, pt) => {
    // Smooth camera focus only if this entry is actually present on the map.
    try { focusWonderOnMap(wonder); } catch { /* ignore */ }
    lockMapLanguageSelection();
    trackMapProgress(100);
    const x = pt && typeof pt.x === 'number' ? pt.x : window.innerWidth * 0.55;
    const y = pt && typeof pt.y === 'number' ? pt.y : window.innerHeight * 0.42;
    showWonderPanel(wonder, x, y, { anchorWonderId: (wonder && wonder.id != null) ? String(wonder.id) : null });
  },
  onCountryChange: (countryNorm) => {
    if (suppressCountryChange) return;
    lockMapLanguageSelection();
    trackMapProgress(60);
    try { applyCountryFilter(countryNorm); } catch { /* ignore */ }
  }
});

function loadLocalizedWonders() {
  return new Promise((resolve) => {
    fetchWonders((data) => {
      resolve(Array.isArray(data) ? data : []);
    });
  });
}

function captureSearchState() {
  if (!searchPanel || typeof searchPanel.getState !== 'function') {
    return { query: '', country: '', collapsed: false };
  }

  try {
    return searchPanel.getState();
  } catch {
    return { query: '', country: '', collapsed: false };
  }
}

function restoreSearchState(state) {
  const nextState = state || { query: '', country: '', collapsed: false };

  suppressCountryChange = true;
  try {
    if (typeof searchPanel.setCountryFilter === 'function') searchPanel.setCountryFilter(nextState.country || '');
    if (typeof searchPanel.setQuery === 'function') searchPanel.setQuery(nextState.query || '');
    if (typeof searchPanel.setCollapsed === 'function') searchPanel.setCollapsed(!!nextState.collapsed);
    if (typeof searchPanel.refreshTranslations === 'function') searchPanel.refreshTranslations();
  } finally {
    suppressCountryChange = false;
  }
}

function restoreOpenWonderPopups(states) {
  const popups = Array.isArray(states) ? states : [];

  for (const state of popups) {
    const wonderId = state && state.wonderId != null ? String(state.wonderId) : '';
    if (!wonderId) continue;

    const wonder = wonders.find((item) => item && item.id != null && String(item.id) === wonderId);
    if (!wonder) continue;

    const anchorX = Number.isFinite(state.anchorX) ? state.anchorX : window.innerWidth * 0.5;
    const anchorY = Number.isFinite(state.anchorY) ? state.anchorY : window.innerHeight * 0.45;

    showWonderPanel(wonder, anchorX, anchorY, {
      anchorWonderId: state.anchorWonderId || wonderId,
      followAnchor: state.followAnchor,
      initialLeft: state.userMoved && Number.isFinite(state.left) ? state.left : undefined,
      initialTop: state.userMoved && Number.isFinite(state.top) ? state.top : undefined,
      userMoved: state.userMoved === true
    });
  }
}

async function handleLanguageChange() {
  if (languageChangePromise) return languageChangePromise;

  const searchState = captureSearchState();
  const popupStates = captureOpenWonderPopupStates();
  const cameraState = {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z
  };

  languageChangePromise = (async () => {
    const localized = await loadLocalizedWonders();
    const nextWonders = (Array.isArray(localized) && localized.length) ? localized : wonders;

    wonders = nextWonders;
    wondersSettled = true;
    try { searchPanel.setItems(wonders); } catch { /* ignore */ }
    restoreSearchState(searchState);

    if (!markersInitialized || !mapTextureSettled || !worldMapSettled) {
      tryInitMap();
      refreshIdleMessage();
      return;
    }

    refreshWonderMarkers(searchState.country, { clearPanels: false });
    clearWonderPanels();

    stopCameraAnimation();
    camera.position.set(cameraState.x, cameraState.y, cameraState.z);
    clampCameraPosition();
    updateCameraLookAt();

    restoreOpenWonderPopups(popupStates);
    refreshIdleMessage();
  })().catch((error) => {
    console.error('[i18n] Unable to refresh app-maps language:', error);
    refreshIdleMessage();
  }).finally(() => {
    languageChangePromise = null;
  });

  return languageChangePromise;
}

window.addEventListener('i18n:changed', () => {
  void handleLanguageChange();
});

const MAP_GRAY_AMOUNT = 0.58;          // 0 = original, 1 = full grayscale
const MAP_CONTOUR_INTENSITY = 0.32;    // 0 = none
const MAP_CONTOUR_COUNT = 60;          // number of contour bands
const MAP_CONTOUR_WIDTH = 0.03;        // line thickness in band space (0..0.5)
const MAP_HEIGHT_SHADE = 0.14;         // brighten/darken by altitude

// Global lift applied to the map only (keeps UI/theme unchanged)
const MAP_BRIGHTNESS_LIFT = 0.02;

// Keep the same footprint as the original scene.
// (Map geometry + camera clamps are tuned around ~2200x1200 world units.)
const TARGET_MAP_WIDTH = 2200;
const TARGET_MAP_HEIGHT = 1200;

// Geographic mapping (lat/lon degrees) -> map coordinates.
// Pick a preset matching your map model/texture.
const GEO_PRESET = 'world'; // 'world' | 'central-europe'
if (GEO_PRESET === 'central-europe') {
  setGeoBounds({
    lonMin: -10,
    lonMax: 30,
    latMin: 35,
    latMax: 62,
    projection: 'equirect',
    outOfBounds: 'skip'
  });
} else {
  // World bounds.
  // Most 2:1 world textures are equirectangular; use mercator only if needed.
  setGeoBounds({
    lonMin: -180,
    lonMax: 180,
    // Slight horizontal alignment tweak for this texture/model.
    // Positive values move points to the right (east).
    lonOffsetDeg: 2,
    // The 3D map texture includes more southern area than our previous clamp (-60),
    // so southern hemisphere points were pushed too low. Expand the range,
    // but keep it aligned with the texture crop (Antarctica occupies ~10% at the bottom).
    latMin: -75,
    latMax: 76,
    // Projection: the GLB texture is between equirect and Mercator.
    // Use mercator with a blend so Europe and Southern Africa both align.
    projection: 'mercator',
    mercatorMix: 0.2,
    outOfBounds: 'clamp'
  });
}

function createMapShaderMaterial({ texture, minY, maxY }) {
  const uniforms = {
    uMap: { value: texture || null },
    uUseMap: { value: texture ? 1 : 0 },
    uGrayAmount: { value: MAP_GRAY_AMOUNT },
    uContourIntensity: { value: MAP_CONTOUR_INTENSITY },
    uContourCount: { value: MAP_CONTOUR_COUNT },
    uContourWidth: { value: MAP_CONTOUR_WIDTH },
    uHeightShade: { value: MAP_HEIGHT_SHADE },
    uContourColor: { value: new THREE.Color(0xb85a66) },
    uMinY: { value: Number.isFinite(minY) ? minY : 0 },
    uMaxY: { value: Number.isFinite(maxY) ? maxY : 1 },
    // fallback color when no texture yet
    uBaseColor: { value: new THREE.Color(0.62, 0.62, 0.66) },
    uBrightnessLift: { value: MAP_BRIGHTNESS_LIFT }
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      varying float vWorldY;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        // After the map rotation (X = PI/2), relief is along world Z.
        vWorldY = worldPos.z;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform int uUseMap;
      uniform float uGrayAmount;
      uniform float uContourIntensity;
      uniform float uContourCount;
      uniform float uContourWidth;
      uniform float uHeightShade;
      uniform vec3 uContourColor;
      uniform float uMinY;
      uniform float uMaxY;
      uniform vec3 uBaseColor;
      uniform float uBrightnessLift;
      varying vec2 vUv;
      varying float vWorldY;

      vec3 toGray(vec3 c) {
        float g = dot(c, vec3(0.299, 0.587, 0.114));
        return vec3(g);
      }

      // Returns 0..1 where 1 is on the contour line.
      float contourMask(float height01) {
        float bands = max(uContourCount, 1.0);
        float f = fract(height01 * bands);
        float d = min(f, 1.0 - f);
        // Line at band boundaries (f ~ 0). Use smooth falloff.
        float w = clamp(uContourWidth, 0.001, 0.49);
        return 1.0 - smoothstep(0.0, w, d);
      }

      void main() {
        vec3 base = uBaseColor;
        if (uUseMap == 1) {
          base = texture2D(uMap, vUv).rgb;
        }

        // grayscale mix
        vec3 gray = toGray(base);
        vec3 col = mix(base, gray, clamp(uGrayAmount, 0.0, 1.0));

        // height normalization
        float denom = max(uMaxY - uMinY, 0.0001);
        float t = clamp((vWorldY - uMinY) / denom, 0.0, 1.0);

        // altitude shading to help reveal relief
        col += (t - 0.5) * uHeightShade;

        // topographic contour lines (level map)
        float c = contourMask(t);
        // Paint lines in red, but subtly (blend towards red instead of full override)
        vec3 contourTarget = mix(col, uContourColor, 0.65);
        col = mix(col, contourTarget, c * clamp(uContourIntensity, 0.0, 1.0));

        // Lighten the map slightly without changing the UI theme.
        col = mix(col, vec3(1.0), clamp(uBrightnessLift, 0.0, 0.35));
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
    depthTest: true,
    depthWrite: true
  });
}

function ensurePlanarUVs(geometry) {
  if (!geometry || !geometry.isBufferGeometry) return;
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.itemSize !== 3) return;

  const existingUv = geometry.getAttribute('uv');
  // If UVs exist, keep them.
  if (existingUv && existingUv.count === posAttr.count) return;

  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return;

  const min = bbox.min;
  const max = bbox.max;
  const ranges = {
    x: Math.max(1e-6, max.x - min.x),
    y: Math.max(1e-6, max.y - min.y),
    z: Math.max(1e-6, max.z - min.z)
  };

  // Pick the 2 dominant axes to avoid collapsing UVs on nearly-flat dimensions.
  const axes = [
    { axis: 'x', range: ranges.x },
    { axis: 'y', range: ranges.y },
    { axis: 'z', range: ranges.z }
  ].sort((a, b) => b.range - a.range);
  const uAxis = axes[0].axis;
  const vAxis = axes[1].axis;

  const getComp = (i, axis) => {
    if (axis === 'x') return posAttr.getX(i);
    if (axis === 'y') return posAttr.getY(i);
    return posAttr.getZ(i);
  };
  const getMin = (axis) => (axis === 'x' ? min.x : axis === 'y' ? min.y : min.z);
  const getRange = (axis) => (axis === 'x' ? ranges.x : axis === 'y' ? ranges.y : ranges.z);

  const uvs = new Float32Array(posAttr.count * 2);
  for (let i = 0; i < posAttr.count; i++) {
    const u = (getComp(i, uAxis) - getMin(uAxis)) / getRange(uAxis);
    const v = 1.0 - (getComp(i, vAxis) - getMin(vAxis)) / getRange(vAxis);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function extractFirstTextureFromObject(object) {
  let found = null;
  if (!object) return null;
  object.traverse(child => {
    if (found) return;
    if (!child || !child.isMesh) return;
    const mat = child.material;
    const mats = Array.isArray(mat) ? mat : (mat ? [mat] : []);
    for (const m of mats) {
      if (m && m.map && m.map.isTexture) {
        found = m.map;
        return;
      }
    }
  });
  return found;
}

const gltfLoader = new GLTFLoader();

function onWorldMapLoaded(object) {
  mapTex = extractFirstTextureFromObject(object);
  if (mapTex) {
    if ('colorSpace' in mapTex && 'SRGBColorSpace' in THREE) {
      mapTex.colorSpace = THREE.SRGBColorSpace;
    } else if ('encoding' in mapTex && 'sRGBEncoding' in THREE) {
      mapTex.encoding = THREE.sRGBEncoding;
    }
    console.log('[Texture] Using embedded model texture');
  } else {
    console.warn('[Texture] No embedded texture found in model; shader will use fallback color');
  }

  mapTextureSettled = true;
  configureWorldMap(object);
}

const glbPath = getResourcePath('ressource/models/opti-map-compat.glb');
// Use GLB only (single file) for lighter/faster kiosk loads.
loadFileAsArrayBuffer(
  glbPath,
  arrayBuffer => {
    gltfLoader.parse(
      arrayBuffer,
      '',
      gltf => {
        const object = (gltf && gltf.scene) ? gltf.scene : (gltf && gltf.scenes && gltf.scenes[0]);
        if (!object) throw new Error('Invalid GLB: missing scene');
        onWorldMapLoaded(object);
      },
      err => {
        const message = getWorldMapFailureMessage('parse');
        setIdleErrorMessage(message);
        alert(message);
        console.error('Error parsing GLB:', err);
        worldMapSettled = true;
        mapTextureSettled = true;
        maybeUnlockIdleDismiss();
      }
    );
  },
  err => {
    const message = getWorldMapFailureMessage('load');
    setIdleErrorMessage(message);
    alert(message);
    console.error('Error loading GLB:', err);
    worldMapSettled = true;
    mapTextureSettled = true;
    maybeUnlockIdleDismiss();
  }
);

function configureWorldMap(object) {
  object.rotation.x = Math.PI / 2; // stand the map upright for wall display

  // Scale model to match the historical 2D map coordinate system (2200 x 1200).
  // This keeps camera feel and wonders placement consistent.
  {
    const preBox = new THREE.Box3().setFromObject(object);
    const preSize = new THREE.Vector3();
    preBox.getSize(preSize);
    const safeW = Math.max(1e-6, preSize.x);
    const safeH = Math.max(1e-6, preSize.y);
    const scaleX = TARGET_MAP_WIDTH / safeW;
    const scaleY = TARGET_MAP_HEIGHT / safeH;
    const scaleZ = (scaleX + scaleY) * 0.5;
    object.scale.set(scaleX, scaleY, scaleZ);
  }
  const prototypeMeshes = [];
  object.traverse(child => {
    if (child.isMesh) prototypeMeshes.push(child);
  });
  function cloneSharedMap() {
    const clone = object.clone(true);
    let idx = 0;
    clone.traverse(child => {
      if (child.isMesh) {
        const ref = prototypeMeshes[idx] || prototypeMeshes[prototypeMeshes.length - 1];
        if (ref) {
          child.geometry = ref.geometry; // share geometry to save RAM/GPU
          child.material = ref.material; // share material to avoid repeated allocations
        }
        idx++;
      }
    });
    return clone;
  }
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const modelWidth = size.x;
  const modelHeight = size.y;

  // Shader-based look (lighter runtime state: one shared ShaderMaterial).
  // Use Z bounds for contour normalization (relief axis).
  const minY = box.min.z;
  const maxY = box.max.z;
  const sharedShaderMat = createMapShaderMaterial({ texture: mapTex, minY, maxY });
  object.traverse(child => {
    if (child.isMesh) {
      ensurePlanarUVs(child.geometry);
      child.material = sharedShaderMat;
    }
  });
  // Keep scroll size stable (matches the coordinate system used by wonders xy).
  setScrollSize(TARGET_MAP_WIDTH, TARGET_MAP_HEIGHT);

  worldMapObjs.forEach(obj => scene.remove(obj));
  worldMapObjs = [];
  for (let i = -1; i <= 1; i++) {
    const objCopy = cloneSharedMap();
    objCopy.position.set(i * modelWidth, 0, 0);
    objCopy.visible = true;
    scene.add(objCopy);
    worldMapObjs.push(objCopy);
  }

  const home = getUsaHomeWorldXY();
  camera.position.set(home.x, home.y, 500);
  clampCameraPosition();
  updateCameraLookAt();
  console.log('Model duplicated and aligned');
  worldMapSettled = true;
  tryInitMap();
  maybeUnlockIdleDismiss();
}

function clampCameraPosition() {
  camera.position.z = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, camera.position.z));

  // Prevent leaving the map vertically (top/bottom) at any zoom level.
  // Keep the view frustum inside the map's vertical bounds.
  const halfMapY = TARGET_MAP_HEIGHT * 0.5;
  const safetyMargin = 20; // world units; avoids seeing beyond edges due to relief/perspective
  let maxY = halfMapY;
  if (camera && typeof camera.fov === 'number') {
    const fovRad = (camera.fov * Math.PI) / 180;
    const visibleHalfHeight = Math.tan(fovRad * 0.5) * camera.position.z;
    maxY = Math.max(0, halfMapY - visibleHalfHeight - safetyMargin);
  }

  camera.position.y = Math.max(-maxY, Math.min(maxY, camera.position.y));
}

function updateCameraLookAt() {
  camera.lookAt(camera.position.x, camera.position.y, 0);
}

function panCamera(dx, dy, meta = {}) {
  stopCameraAnimation();
  const zoomFactor = camera.position.z / zoomBase;
  const touchBoost = meta.pointerType === 'touch' ? 1.35 : 1;
  const moveFactor = 0.75 * zoomFactor * touchBoost;
  camera.position.x -= dx * moveFactor;
  camera.position.y += dy * moveFactor;
  clampCameraPosition();
  updateCameraLookAt();
}

function tryInitMap() {
  if (!wondersSettled || !mapTextureSettled || !worldMapSettled) return;
  if (markersInitialized) return;
  markersInitialized = true;

  bubbleManager.clear();
  // No 3D markers: only lightweight anchors + bubbles.
  setupInfiniteMap(scene, wonders || [], mapTex, createWonderAnchor, cubeWonderMap);
  // Start focused on the USA (kiosk-friendly default view).
  const home = getUsaHomeWorldXY();
  camera.position.x = home.x;
  camera.position.y = home.y;
  camera.position.z = CAMERA_Z_MAX;
  clampCameraPosition();
  updateCameraLookAt();
  if (!markersSettled) {
    markersSettled = true;
    maybeUnlockIdleDismiss();
  }
}

fetchWonders(data => {
  wonders = data;
  wondersSettled = true;
  // Search panel should always display the full dataset.
  try { searchPanel.setItems(wonders); } catch { /* ignore */ }
  tryInitMap();
  maybeUnlockIdleDismiss();
});

setupControls({
  viewport,
  panCamera,
  zoomBy: delta => {
    stopCameraAnimation();
    camera.position.z = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, camera.position.z + delta));
  },
  clampCameraPosition,
  updateCameraLookAt,
  resetCamera,
  onClick: handleViewportClick,
  createCursor: createTouchCursor,
  removeCursor: removeTouchCursor,
  removeAllCursors: removeAllTouchCursors,
  getPointerColor
});

function handleViewportClick(x, y) {
  ensureMapTrackingStarted();

  try {
    const hitEl = document.elementFromPoint(x, y);
    const bubbleEl = hitEl && hitEl.closest && hitEl.closest('.wonder-bubble');
    if (bubbleEl) {
      const wid = bubbleEl.dataset ? bubbleEl.dataset.wonderId : bubbleEl.getAttribute('data-wonder-id');
      if (wid) {
        const wobj = wonders.find(w => String(w.id) === String(wid));
        if (wobj) {
          const isCross = !!(bubbleEl.classList && bubbleEl.classList.contains('is-marker-x'));
          if (isCross) {
            lockMapLanguageSelection();
            trackMapProgress(60);
            try { focusWonderOnMap(wobj); } catch { /* ignore */ }
          } else {
            lockMapLanguageSelection();
            trackMapProgress(100);
            showWonderPanel(wobj, x, y, { anchorWonderId: String(wid) });
          }
          return;
        }
      }
    }
  } catch (err) {
    /* fallback ignore */
  }

  // Fallback: CSS2D marker layer may not be hit-testable in some runtimes.
  try {
    const hit = bubbleManager && typeof bubbleManager.pickWonderAt === 'function'
      ? bubbleManager.pickWonderAt(x, y)
      : null;
    if (hit && hit.wonder) {
      if (hit.markerIsCross) {
        lockMapLanguageSelection();
        trackMapProgress(60);
        try { focusWonderOnMap(hit.wonder); } catch { /* ignore */ }
      } else {
        const wid = hit.wonderId != null ? String(hit.wonderId) : ((hit.wonder && hit.wonder.id != null) ? String(hit.wonder.id) : null);
        lockMapLanguageSelection();
        trackMapProgress(100);
        showWonderPanel(hit.wonder, x, y, { anchorWonderId: wid });
      }
      return;
    }
  } catch {
    // ignore
  }

  // No 3D marker picking in this project (bubbles only).
  pointerVec.set(
    (x / viewport.clientWidth) * 2 - 1,
    -(y / viewport.clientHeight) * 2 + 1
  );
}

function clearWonderPanels() {
  document.querySelectorAll('.wonder-popup.window-popup').forEach(node => {
    node.remove();
  });
  document.querySelectorAll('#popup-connector-layer path').forEach(node => {
    node.remove();
  });
}

function closeAllMenus() {
  Array.from(menuState.keys()).forEach(group => syncMenuGroup(group, false));
}

function resetToIdleState() {
  closeAllMenus();
  try { searchPanel.setCountryFilter && searchPanel.setCountryFilter(''); } catch { /* ignore */ }
  resetCamera();
  clearWonderPanels();
}

function resetCamera() {
  const home = getUsaHomeWorldXY();
  camera.position.set(home.x, home.y, 500);
  clampCameraPosition();
  updateCameraLookAt();
}

function checkInfiniteScrollModels(cam) {
  if (!worldMapObjs || worldMapObjs.length < 3) return;
  const modelWidth = worldMapObjs[1].position.x - worldMapObjs[0].position.x;
  const baseX = Math.floor(cam.position.x / modelWidth) * modelWidth;
  worldMapObjs[0].position.x = baseX;
  worldMapObjs[1].position.x = baseX + modelWidth;
  worldMapObjs[2].position.x = baseX - modelWidth;
  worldMapObjs[0].visible = true;
  worldMapObjs[1].visible = true;
  worldMapObjs[2].visible = true;
}

function animate() {
  checkInfiniteScroll(camera);
  checkInfiniteScrollModels(camera);
  bubbleManager.update();

  if (ENABLE_3D_WONDER_ANIM && Array.isArray(groupCubes)) {
    groupCubes.forEach(obj => {
      if (obj && obj.userData) {
        obj.visible = false;
        obj.userData.glowPhase = (obj.userData.glowPhase || 0) + 0.05;
        const bob = 2 * Math.sin(obj.userData.glowPhase * 0.8);
        if (typeof obj.userData.baseZ === 'number') obj.position.z = obj.userData.baseZ + bob;
        obj.traverse(child => {
          if (child.isMesh && child.material && child.material.emissive) {
            child.material.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin(obj.userData.glowPhase));
          }
          if (child.userData && child.userData.isHalo && child.material && child.material.transparent) {
            child.material.opacity = 0.10 + 0.08 * Math.abs(Math.sin(obj.userData.glowPhase));
            child.scale.setScalar(1.08 + 0.04 * Math.sin(obj.userData.glowPhase));
          }
        });
      }
    });
  }

  renderer.render(scene, camera);
  css2dRenderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  css2dRenderer.setSize(viewport.clientWidth, viewport.clientHeight);
});
