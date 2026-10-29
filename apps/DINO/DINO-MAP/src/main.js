import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupInfiniteMap, checkInfiniteScroll, groupCubes, setScrollSize, setGeoBounds, geoToMapXY, MAP_WIDTH, MAP_HEIGHT } from './core/map.js';
import { cubeWonderMap, showWonderPanel, fetchWonders } from './data/wonders.js';
import { DATASET } from './data/datasetConfig.js';
import { setupControls } from './managers/controls.js';
import { loadFileAsArrayBuffer, getResourcePath } from './utils/fileLoader.js';
import { initEnvironment } from './core/environment.js';
import { createBubbleManager } from './managers/bubbleManager.js';
import { createTouchCursor, removeTouchCursor, removeAllTouchCursors, getPointerColor } from './managers/cursorManager.js';
import { createSearchPanel } from './ui/searchPanel.js';
import { COUNTRY_CENTROIDS, normalizeCountryName } from './data/countryCentroids.js';

// Used by index.html bootstrap to detect failures before this module runs.
try { window.__MAP_APP_STARTED = true; } catch { /* ignore */ }

function t(key, vars, fallback) {
  const fn = (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t : null;
  let out = null;
  if (fn) {
    try { out = fn(key, vars); } catch { /* ignore */ }
  }
  if (!out || out === key) out = (fallback != null) ? fallback : key;
  if (vars && out && typeof out === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return out;
}

// Apply UI title text (i18n-driven)
try {
  document.title = t('mapApp.pageTitle', null, 'Dinosaurs — Interactive Map');
  const idleTitleEl = document.getElementById('idleTitle');
  if (idleTitleEl) {
    const idleTitle = t('mapApp.idle.title', null, 'Dinosaurs');
    const tag = String(idleTitleEl.tagName || '').toLowerCase();
    if (tag === 'img') {
      try { idleTitleEl.setAttribute('alt', idleTitle); } catch { /* ignore */ }
      try { idleTitleEl.setAttribute('aria-label', idleTitle); } catch { /* ignore */ }
    } else {
      idleTitleEl.textContent = idleTitle;
    }
  }
} catch { /* ignore */ }

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
const langSwitcher = document.getElementById('langSwitcher');
const dinoTracking = window.EHTracking
  ? window.EHTracking.createTracker({
      exhibition: 'DINO',
      application: 'DINO-MAP',
      getLanguage: () => getCurrentLang(),
    })
  : null;

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
const idleTimeoutMs = Number(meta('map-idle-timeout-ms') || '90000');

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return (url.searchParams.get(name) || '').trim();
  } catch {
    return '';
  }
}

let idleActive = !!idleOverlay;
let idleTimer = null;
let canDismissIdleOverlay = false;
let idleMode = idleActive ? 'loading' : 'hidden'; // 'loading' | 'idle' | 'hidden'

if (idleOverlay) {
  try { idleOverlay.setAttribute('data-overlay-state', 'loading'); } catch { /* ignore */ }
}

const SUPPORTED_LANGS = ['fr', 'en', 'es'];
const DEFAULT_IDLE_RESET_LANG = 'fr';

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const base = raw.split(/[-_]/)[0];
  return SUPPORTED_LANGS.includes(base) ? base : '';
}

function normalizeHomeRegion(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  if (v === 'eu' || v === 'europe') return 'europe';
  if (v === 'us' || v === 'usa' || v === 'america' || v === 'amerique') return 'america';
  return v;
}

// Language configuration:
// - i18n-force-lang: forces the app language on boot AND on every idle entry
// - i18n-idle-lang: overrides the idle-reset language (if force is not set)
// Query overrides for debugging: ?forceLang=fr / ?idleLang=en
const FORCED_LANG = normalizeLang(getQueryParam('forceLang') || meta('i18n-force-lang'));
const LAUNCH_PRIMARY_LANG = normalizeLang(getQueryParam('primaryLang') || getQueryParam('lang'));
const IDLE_RESET_LANG = FORCED_LANG || normalizeLang(getQueryParam('idleLang') || meta('i18n-idle-lang')) || LAUNCH_PRIMARY_LANG || DEFAULT_IDLE_RESET_LANG;

// Map start/home configuration: meta map-home-region (europe|america) or query ?home=europe
const HOME_REGION = normalizeHomeRegion(getQueryParam('home') || meta('map-home-region'));

function getHomeLatLon() {
  if (HOME_REGION === 'europe') return { lat: 50, lon: 10 };
  if (HOME_REGION === 'america') return { lat: 40, lon: -100 };
  return DATASET.homeLatLon || { lat: 20, lon: 0 };
}

function getCurrentLang() {
  if (FORCED_LANG) return FORCED_LANG;

  if (LAUNCH_PRIMARY_LANG) return LAUNCH_PRIMARY_LANG;

  const fromI18n = (() => {
    try {
      const v = window.i18n && typeof window.i18n.lang === 'string' ? window.i18n.lang : '';
      return normalizeLang(v);
    } catch {
      return '';
    }
  })();
  if (fromI18n) return fromI18n;

  const fromMeta = normalizeLang(meta('i18n-default-lang'));
  return fromMeta || IDLE_RESET_LANG;
}

function isEventFromLangSwitcher(evt) {
  if (!langSwitcher) return false;
  const t = evt && evt.target;
  if (!t || !t.closest) return false;
  return !!t.closest('#langSwitcher');
}

function setActiveLangUi(lang) {
  const normalized = normalizeLang(lang) || IDLE_RESET_LANG;

  try { document.documentElement.lang = normalized; } catch { /* ignore */ }

  if (!langSwitcher) return;
  langSwitcher.querySelectorAll('[data-lang]').forEach(btn => {
    const l = normalizeLang(btn.getAttribute('data-lang'));
    const active = l === normalized;
    btn.classList.toggle('is-active', active);
    try { btn.setAttribute('aria-pressed', active ? 'true' : 'false'); } catch { /* ignore */ }
  });
}

function setAppLanguage(lang) {
  const normalized = normalizeLang(lang);
  if (!normalized) return;

  setActiveLangUi(normalized);
  try {
    window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: normalized } }));
  } catch { /* ignore */ }

  const api = window.i18n;
  if (!api || typeof api.setLang !== 'function') return;

  try {
    const p = api.setLang(normalized);
    if (p && typeof p.then === 'function') {
      p.then(() => {
        const finalLang = normalizeLang(api.lang) || normalized;
        setActiveLangUi(finalLang);
        try {
          window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: finalLang } }));
        } catch { /* ignore */ }
      }).catch(() => {
        /* ignore */
      });
    }
  } catch {
    /* ignore */
  }
}

// Init language UI
setActiveLangUi(getCurrentLang());
if (FORCED_LANG) {
  // Force language as early as possible (even before i18n finishes loading).
  setAppLanguage(FORCED_LANG);
}
if (langSwitcher) {
  langSwitcher.querySelectorAll('[data-lang]').forEach(btn => {
    const lang = normalizeLang(btn.getAttribute('data-lang'));
    btn.addEventListener('pointerdown', (e) => {
      // Keep the idle overlay visible while selecting a language.
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch { /* ignore */ }
      setAppLanguage(lang);
    }, { passive: false });
    btn.addEventListener('keydown', (e) => {
      // Avoid the global idle handler dismissing the overlay on keydown.
      try { e.stopPropagation(); } catch { /* ignore */ }
    });
  });
}
if (window.i18n && window.i18n.ready && typeof window.i18n.ready.then === 'function') {
  window.i18n.ready.then(() => {
    if (FORCED_LANG) setAppLanguage(FORCED_LANG);
    else setActiveLangUi(getCurrentLang());
  }).catch(() => {
    /* ignore */
  });
}

let mapTextureSettled = false;
let worldMapSettled = false;
let wondersSettled = false;
let markersSettled = false;

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
  const missingText = missing.join(', ');
  setIdleMessageCustom(t(
    'mapApp.idle.stuck',
    { missing: missingText },
    `Loading is stuck (${missingText}). Check the resources.`
  ));
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
  // Initial load complete: switch from "loading" to the idle menu (tap-to-start).
  // The idle timer will start once the user dismisses the overlay.
  try { enterIdleMode(); } catch { /* ignore */ }
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

function setIdleMessageCustom(text) {
  if (!idleMessageEl) return;
  try {
    idleMessageEl.removeAttribute('data-i18n');
    idleMessageEl.textContent = String(text || '');
  } catch {
    // ignore
  }
}

function setIdleMessageKey(key, fallbackText) {
  if (!idleMessageEl) return;
  try {
    idleMessageEl.setAttribute('data-i18n', String(key || ''));
  } catch {
    /* ignore */
  }
  // Render immediately (i18n.apply will also update on language change).
  try {
    const text = t(String(key || ''), null, fallbackText);
    idleMessageEl.textContent = String(text || '');
  } catch {
    /* ignore */
  }
}

function showOverlay({ state = 'loading', messageKey = '', messageFallback = '' } = {}) {
  if (!idleOverlay) return;
  if (!idleOverlay.parentElement) document.body.appendChild(idleOverlay);
  try { idleOverlay.setAttribute('data-overlay-state', String(state || 'loading')); } catch { /* ignore */ }
  if (messageKey) setIdleMessageKey(messageKey, messageFallback);
  idleOverlay.classList.remove('is-hidden');
  idleActive = true;
}

function enterIdleMode() {
  if (!idleOverlay) return;
  if (!canDismissIdleOverlay) return;
  if (idleMode === 'idle') return;

  idleMode = 'idle';
  if (idleTimer) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }

  // Kiosk-friendly: return to a known "home" state (camera centered, no popups).
  try { resetToIdleState(); } catch { /* ignore */ }
  dinoTracking?.reset();

  // Each idle screen resets language to a known value (configurable).
  setAppLanguage(IDLE_RESET_LANG);

  showOverlay({ state: 'idle', messageKey: 'mapApp.idle.tapToStart', messageFallback: 'Touch to start' });
}

function exitIdleMode() {
  if (idleMode !== 'idle') return;
  idleMode = 'hidden';
  hideIdleOverlay(true);
  resetIdleTimer();
}

// When the idle overlay is visible, consume the first interaction so it doesn't
// "click through" to the map underneath.
if (idleOverlay) {
  idleOverlay.addEventListener('pointerdown', (e) => {
    if (idleMode !== 'idle') return;
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch { /* ignore */ }
    exitIdleMode();
  }, { passive: false });
}

function resetIdleTimer() {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return;
  if (!canDismissIdleOverlay) return;
  if (idleMode === 'idle') return;
  if (idleTimer) {
    window.clearTimeout(idleTimer);
  }
  idleTimer = window.setTimeout(() => {
    enterIdleMode();
  }, idleTimeoutMs);
}

function handleIdleActivity(evt) {
  // Allow language selection without dismissing idle.
  if (isEventFromLangSwitcher(evt)) {
    if (idleMode !== 'idle') resetIdleTimer();
    return;
  }

  if (idleMode === 'idle') {
    const type = evt && evt.type ? String(evt.type) : '';
    if (type === 'pointerdown' || type === 'touchstart' || type === 'keydown') {
      exitIdleMode();
    }
    return;
  }
  resetIdleTimer();
}

// While running: activity resets the idle timer (and dismisses the idle overlay).
['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'].forEach(evt => {
  window.addEventListener(evt, handleIdleActivity, { passive: evt === 'wheel' || evt === 'touchstart' || evt === 'pointermove' });
});

// Kiosk-safe: block browser/page zoom shortcuts and pinch-zoom gestures.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = String(e.key || '').toLowerCase();
  if (key === '+' || key === '-' || key === '=' || key === '0') {
    e.preventDefault();
    e.stopPropagation();
  }
}, { passive: false });

window.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { passive: false });

['gesturestart', 'gesturechange', 'gestureend'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
});

// Kiosk-safe: disable browser smart-zoom (double click / double-tap) and right-click menus.
window.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, { passive: false, capture: true });

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();
}, { passive: false, capture: true });

window.addEventListener('auxclick', (e) => {
  if (e.button === 1 || e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { passive: false, capture: true });

// On some touch kiosks/browsers, double-tap or pinch on UI overlays (div/img)
// can still trigger page zoom even with viewport restrictions.
// Keep zoom gestures only on the map viewport.
const __isInMapViewport = (target) => {
  if (!target || !target.closest) return false;
  return !!target.closest('#viewport');
};

let __lastUiTouchEndTs = 0;
document.addEventListener('touchend', (e) => {
  if (__isInMapViewport(e.target)) return;
  const now = Date.now();
  if (now - __lastUiTouchEndTs < 320) {
    e.preventDefault();
    e.stopPropagation();
  }
  __lastUiTouchEndTs = now;
}, { passive: false, capture: true });

document.addEventListener('touchstart', (e) => {
  if (__isInMapViewport(e.target)) return;
  // Block pinch-zoom on non-map UI (images/div overlays, menus, popups).
  if (e.touches && e.touches.length > 1) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { passive: false, capture: true });

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
const CAMERA_Z_MIN = 500;
const CAMERA_Z_MAX = 850;
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
  const raw = (w.Country != null) ? w.Country : (w.country != null) ? w.country : '';
  return normalizeForKey(raw);
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

function getHomeWorldXY() {
  const home = getHomeLatLon();
  const mapped = geoToMapXY(home.lat, home.lon);
  const pt = mapXYToWorldXY(mapped, 0);
  return pt || { x: 0, y: 0 };
}

function applyCountryFilter(countryNorm) {
  const norm = String(countryNorm || '');
  const filtered = (norm && norm !== '__unknown__')
    ? wonders.filter(w => getWonderCountryNorm(w) === norm)
    : (norm === '__unknown__')
      ? wonders.filter(w => !getWonderCountryNorm(w))
      : wonders;

  bubbleManager.clear();
  setupInfiniteMap(scene, filtered, mapTex, createWonderAnchor, cubeWonderMap);
  clearWonderPanels();

  if (norm) {
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
      const z = computeFitZoomForBounds(bounds, { padding: 1.22, minZoomZ: CAMERA_Z_MIN }) ?? camera.position.z;
      animateCameraTo({ x: avg.x, y: avg.y, z }, { durationMs: 1400 });
    }
  }
}

const ENABLE_SEARCH_PANEL = false;

let searchPanel = {
  setItems: () => {},
  setQuery: () => {},
  focus: () => {},
  setCollapsed: () => {},
  setCountryFilter: () => {}
};

if (ENABLE_SEARCH_PANEL) {
  searchPanel = createSearchPanel({
    onSelect: (wonder, pt) => {
      // Smooth camera focus only if this entry is actually present on the map.
      try { focusWonderOnMap(wonder); } catch { /* ignore */ }
      const x = pt && typeof pt.x === 'number' ? pt.x : window.innerWidth * 0.55;
      const y = pt && typeof pt.y === 'number' ? pt.y : window.innerHeight * 0.42;
      showWonderPanel(wonder, x, y, { anchorWonderId: (wonder && wonder.id != null) ? String(wonder.id) : null });
    },
    onCountryChange: (countryNorm) => {
      try { applyCountryFilter(countryNorm); } catch { /* ignore */ }
    }
  });
} else {
  // Ensure it stays hidden even if something toggles attributes.
  try {
    const el = document.getElementById('mapSearch');
    if (el) {
      el.hidden = true;
      el.setAttribute('hidden', '');
    }
  } catch {
    // ignore
  }
}

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
    lonOffsetDeg: 1,
    // Vertical alignment tweak for this texture/model.
    // Negative values move points downward (south) on the texture.
    // If points look globally "too low", increase this value (toward positive).
    latOffsetDeg: 3,
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
    uContourColor: { value: new THREE.Color(DATASET.contourColor || 0x2962FF) },
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

const glbPath = getResourcePath('Ressource/models/opti-map.glb');
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
        alert('Error parsing GLB: ' + err);
        console.error('Error parsing GLB:', err);
        worldMapSettled = true;
        mapTextureSettled = true;
        maybeUnlockIdleDismiss();
      }
    );
  },
  err => {
    alert('Error loading GLB: ' + err);
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

  // Keep the original GLB materials and textures (no shader replacement).
  // Nothing to do — the model already has its own materials.
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

  const home = getHomeWorldXY();
  // Start fully zoomed out (kiosk-friendly).
  camera.position.set(home.x, home.y, CAMERA_Z_MAX);
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
  // Start focused on the configured home view (kiosk-friendly default).
  const home = getHomeWorldXY();
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
            try { focusWonderOnMap(wobj); } catch { /* ignore */ }
          } else {
            if (dinoTracking && !dinoTracking.hasStarted()) {
              void dinoTracking.start(0, {
                step: 'open-wonder',
                language: getCurrentLang(),
              });
            }
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
        try { focusWonderOnMap(hit.wonder); } catch { /* ignore */ }
      } else {
        const wid = hit.wonderId != null ? String(hit.wonderId) : ((hit.wonder && hit.wonder.id != null) ? String(hit.wonder.id) : null);
        if (dinoTracking && !dinoTracking.hasStarted()) {
          void dinoTracking.start(0, {
            step: 'open-wonder',
            language: getCurrentLang(),
          });
        }
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
  const home = getHomeWorldXY();
  // Reset to the most zoomed-out view.
  camera.position.set(home.x, home.y, CAMERA_Z_MAX);
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
