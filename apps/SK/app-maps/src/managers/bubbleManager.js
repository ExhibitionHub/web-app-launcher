// bubbleManager.js
// Manages the screen-space bubbles linked to wonders.

import * as THREE from '../../lib/three/build/three.module.js';
import { CSS2DObject } from '../../lib/three/examples/jsm/renderers/CSS2DRenderer.js';
import { cubeWonderMap, showWonderPanel } from '../data/wonders.js?v=20260326b';
import { getResourcePath } from '../utils/fileLoader.js';
import { groupCubes, mapGroups, MAP_WIDTH, MAP_HEIGHT, SCROLL_WIDTH, SCROLL_HEIGHT, geoToMapXY, GEO_BOUNDS, clamp } from '../core/map.js?v=20260205h';

const normalizeKey = (key) => String(key || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

function readField(obj, ...aliases) {
  if (!obj || typeof obj !== 'object') return null;
  const normMap = new Map();
  Object.keys(obj).forEach((k) => normMap.set(normalizeKey(k), obj[k]));
  for (const alias of aliases) {
    if (alias in obj) return obj[alias];
    const norm = normalizeKey(alias);
    if (normMap.has(norm)) return normMap.get(norm);
  }
  return null;
}

function resolveAssetPath(maybePath) {
  if (!maybePath) return null;
  if (typeof maybePath !== 'string') return null;
  if (/^https?:/i.test(maybePath) || maybePath.startsWith('data:')) {
    return maybePath;
  }
  return getResourcePath(maybePath);
}

function isLegacyPlaceholderImage(src) {
  if (!src || typeof src !== 'string') return false;
  const s = src.toLowerCase();
  return (
    s.includes('ressource/background.webp') ||
    s.includes('ressource/background.png') ||
    s.includes('ressource/images/placeholders/background.webp') ||
    s.includes('ressource/images/placeholders/background.png')
  );
}

function resolveProfileImagePath(wonder) {
  const primaryImage = (wonder && wonder.primaryImage) || {};
  const candidate =
    readField(wonder, 'img', 'image', 'profileImage', 'photo') ||
    primaryImage.asset ||
    readField(wonder, 'Primary image', 'PrimaryImage');
  return candidate;
}

const BUBBLE_LOGO_SCREEN_SIZE = 54; // target diameter in CSS pixels (zoomed-in)
const BUBBLE_DOT_SCREEN_SIZE = 10; // target size in CSS pixels (zoomed-out)
const BUBBLE_BORDER_RATIO = 0.022222; // 0.12 / 5.4
const BUBBLE_SHADOW_OFFSET_RATIO = 0.041667; // 0.225 / 5.4
const BUBBLE_SHADOW_BLUR_RATIO = 0.166667; // 0.9 / 5.4

// Camera Z is clamped in main.js (55..750).
// Progressive LOD: cross grows while zooming in; portrait fades in during closer zoom.
const BUBBLE_LOGO_Z_IN = 55;    // fully "logo" when camera.z <= this
const BUBBLE_LOGO_Z_OUT = 750;  // fully "dot" when camera.z >= this
const BUBBLE_LOGO_FADE_IN_AT = 0.55; // lod threshold where image starts appearing

// Anchor tuning
const BUBBLE_ANCHOR_Y_FROM_BASE_RATIO = 0.0; // deprecated (kept for quick tuning)
const BUBBLE_ANCHOR_Y_OFFSET = 10; // world units
// Depth/relief axis (same as map contour shader): Z.
// Negative offset pulls bubbles toward the map surface (away from camera).
const BUBBLE_ANCHOR_Z_OFFSET = -50;
const BUBBLE_CAMERA_PUSH = 0; // keep stable; avoid pushing toward camera
// Final screen-space tweak (kept at 0; height is handled in world Z).
const BUBBLE_SCREEN_Y_OFFSET_PX = 0;
// Visual offset inside the CSS3D element.
const BUBBLE_VISUAL_Y_OFFSET_FACTOR = 0.0;
const BUBBLE_VISUAL_Y_OFFSET_PX = 0;

// Performance: when zoomed-out, there can be far too many markers.
// We cull offscreen bubbles and cap the number of visible markers on screen.
const BUBBLE_FRUSTUM_MARGIN_NDC = 0.08; // allow a small margin so markers don't pop at edges
// NOTE: These are *caps* used by the merge system. The actual number of visible points
// also depends on zoom (cell size in world units grows when zoomed-out).
// Goal: when zoomed-out we should not look "empty" (show more), and when zoomed-in we
// should not get overwhelmed (show fewer).
const MAX_VISIBLE_BUBBLES_FAR = 360;    // camera far (lod ~ 0)
const MAX_VISIBLE_BUBBLES_MID = 300;
const MAX_VISIBLE_BUBBLES_NEAR = 240;   // camera near (lod ~ 1)

// When enabled, points that are too close on screen are regrouped (clustering),
// so the map stays readable when zoomed out.
const DISABLE_MARKER_CLUSTERING = false;

// Geo-based separation (deterministic, list-based).
// If two points are closer than this threshold in degrees, the later one is displaced.
// This runs asynchronously when the camera is settled.
const GEO_MIN_SEP_DEG = 0.01;
const GEO_SPREAD_MAX_ATTEMPTS = 72;

// Old approach (world-grid preselection) can feel like "aggressive merge" because it
// doesn't consider what's currently visible on screen. Keep it available, but off by default.
// We now cluster dynamically based on the *visible* markers (screen-space bucketing).
const USE_WORLD_PRECLUSTERING = false;

// Zoom-time clustering: compute one representative per world/map cell.
// IMPORTANT: To keep grouping stable while zooming, we use *fixed* world-space grids
// in a few zoom bands (far/mid), instead of continuously changing cell sizes.
const CLUSTER_CELL_WORLD_FAR = 170; // world units
const CLUSTER_CELL_WORLD_MID = 105; // world units

const CLUSTER_BAND_NEAR_AT = 0.92; // lod threshold: show all (no clustering/cap)
// Switch far->mid earlier so the first zoom-in already reveals more points.
const CLUSTER_BAND_MID_AT = 0.05;  // lod threshold: switch far->mid band

// Hysteresis to prevent band flapping near thresholds (improves merge coherence).
const CLUSTER_BAND_NEAR_ENTER = 0.94;
const CLUSTER_BAND_NEAR_EXIT = 0.90;
const CLUSTER_BAND_MID_ENTER = 0.05;
const CLUSTER_BAND_MID_EXIT = 0.045;

function getMaxVisibleBubbles(lod, viewport) {
  if (DISABLE_MARKER_CLUSTERING) return Number.MAX_SAFE_INTEGER;
  // lod: 0 (far) .. 1 (near)
  const safeLod = Number.isFinite(lod) ? Math.max(0, Math.min(1, lod)) : 0;
  // Continuous cap: avoid sudden jumps (\"not enough\" -> \"too many\").
  // IMPORTANT: cap decreases when zooming in (bubbles are bigger).
  const base = Math.round(MAX_VISIBLE_BUBBLES_FAR + (MAX_VISIBLE_BUBBLES_NEAR - MAX_VISIBLE_BUBBLES_FAR) * safeLod);

  // Scale marker budget with screen area (so 4K can show more without arbitrary hiding).
  const vw = Math.max(1, viewport?.clientWidth || 1);
  const vh = Math.max(1, viewport?.clientHeight || 1);
  const areaScale = Math.sqrt((vw * vh) / (1920 * 1080));
  const scaled = Math.round(base * areaScale);

  return Math.max(50, Math.min(720, scaled));
}

function getMaxVisibleBubblesForBand(band, viewport) {
  if (DISABLE_MARKER_CLUSTERING) return Number.MAX_SAFE_INTEGER;
  if (band === 'near') return Number.MAX_SAFE_INTEGER;
  const base = (band === 'mid') ? MAX_VISIBLE_BUBBLES_MID : MAX_VISIBLE_BUBBLES_FAR;

  const vw = Math.max(1, viewport?.clientWidth || 1);
  const vh = Math.max(1, viewport?.clientHeight || 1);
  const areaScale = Math.sqrt((vw * vh) / (1920 * 1080));
  const scaled = Math.round(base * areaScale);

  return Math.max(50, Math.min(720, scaled));
}

function resolveClusterBandFromLod(lod) {
  const safe = Number.isFinite(lod) ? Math.max(0, Math.min(1, lod)) : 0;
  if (safe >= CLUSTER_BAND_NEAR_AT) return 'near';
  if (safe >= CLUSTER_BAND_MID_AT) return 'mid';
  return 'far';
}

function bandRank(band) {
  if (band === 'near') return 2;
  if (band === 'mid') return 1;
  return 0;
}

function resolveClusterBandFromLodHysteresis(lod, lastBand) {
  const safe = Number.isFinite(lod) ? Math.max(0, Math.min(1, lod)) : 0;
  const prev = lastBand || resolveClusterBandFromLod(safe);

  // Keep current band unless we clearly cross thresholds.
  if (prev === 'near') {
    if (safe < CLUSTER_BAND_NEAR_EXIT) {
      return (safe >= CLUSTER_BAND_MID_ENTER) ? 'mid' : 'far';
    }
    return 'near';
  }

  if (prev === 'mid') {
    if (safe >= CLUSTER_BAND_NEAR_ENTER) return 'near';
    if (safe < CLUSTER_BAND_MID_EXIT) return 'far';
    return 'mid';
  }

  // prev === 'far'
  if (safe >= CLUSTER_BAND_NEAR_ENTER) return 'near';
  if (safe >= CLUSTER_BAND_MID_ENTER) return 'mid';
  return 'far';
}

function worldUnitsPerPixel(camera, viewportHeight) {
  if (!camera || typeof camera.fov !== 'number' || !camera.position) return 1;
  const z = Math.max(1e-6, camera.position.z);
  const fovRad = (camera.fov * Math.PI) / 180;
  const visibleHeightWorld = 2 * Math.tan(fovRad * 0.5) * z;
  return visibleHeightWorld / Math.max(1, viewportHeight);
}

function wonderLocalXY(wonder) {
  // Mirror the placement math in core/map.js, but without the infinite-scroll offset.
  const baseH = MAP_HEIGHT;
  const scaleX = (SCROLL_WIDTH || MAP_WIDTH) / MAP_WIDTH;
  const scaleY = (SCROLL_HEIGHT || baseH) / baseH;
  const xy = wonder && wonder.xy;
  if (!xy || !Array.isArray(xy) || xy.length < 2) return null;
  const x = (xy[0] - MAP_WIDTH / 2) * scaleX;
  const y = (baseH / 2 - xy[1]) * scaleY;
  return { x, y };
}

function mapXYToWorldXY(xy) {
  const baseH = MAP_HEIGHT;
  const scaleX = (SCROLL_WIDTH || MAP_WIDTH) / MAP_WIDTH;
  const scaleY = (SCROLL_HEIGHT || baseH) / baseH;
  if (!xy || !Array.isArray(xy) || xy.length < 2) return null;
  const x = (Number(xy[0]) - MAP_WIDTH / 2) * scaleX;
  const y = (baseH / 2 - Number(xy[1])) * scaleY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function readLatLonFromWonder(wonder) {
  if (!wonder || typeof wonder !== 'object') return null;
  const toNumber = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const lat = toNumber(wonder.lat) ?? toNumber(wonder.latitude) ?? (wonder.geo ? toNumber(wonder.geo.lat) : null);
  const lon = toNumber(wonder.lon) ?? toNumber(wonder.lng) ?? toNumber(wonder.longitude) ?? (wonder.geo ? toNumber(wonder.geo.lon) : null);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function normalizeLonToBounds(lon) {
  const b = GEO_BOUNDS || { lonMin: -180, lonMax: 180, lonOffsetDeg: 0 };
  const lonMin = Number(b.lonMin);
  const lonMax = Number(b.lonMax);
  const range = (lonMax - lonMin) || 360;
  const offset = (typeof b.lonOffsetDeg === 'number' && Number.isFinite(b.lonOffsetDeg)) ? b.lonOffsetDeg : 0;
  let out = Number(lon) + offset;
  const isWrap = Math.abs(Math.abs(range) - 360) < 1e-3 || Math.abs(range) > 300;
  if (isWrap) {
    const n = ((out - lonMin) % range + range) % range;
    out = lonMin + n;
  } else {
    out = clamp(out, lonMin, lonMax);
  }
  return out;
}

function normalizeLatToBounds(lat) {
  const b = GEO_BOUNDS || { latMin: -85, latMax: 85 };
  return clamp(Number(lat), Number(b.latMin), Number(b.latMax));
}

function lonDeltaDeg(a, b) {
  const bds = GEO_BOUNDS || { lonMin: -180, lonMax: 180 };
  const range = (Number(bds.lonMax) - Number(bds.lonMin)) || 360;
  const isWrap = Math.abs(Math.abs(range) - 360) < 1e-3 || Math.abs(range) > 300;
  const d = Number(a) - Number(b);
  if (!isWrap) return d;
  // Wrap-aware delta in [-range/2..range/2]
  const half = range * 0.5;
  let dd = ((d + half) % range + range) % range - half;
  if (!Number.isFinite(dd)) dd = d;
  return dd;
}

function isClipVisible(clipVec3) {
  if (!clipVec3) return false;
  const m = BUBBLE_FRUSTUM_MARGIN_NDC;
  // NDC: x,y within [-1..1], z within [-1..1] (WebGL clip space after projection).
  if (clipVec3.x < -1 - m || clipVec3.x > 1 + m) return false;
  if (clipVec3.y < -1 - m || clipVec3.y > 1 + m) return false;
  if (clipVec3.z < -1 || clipVec3.z > 1) return false;
  return true;
}

function capEntriesDistributed(entries, maxVisible, viewport, camera) {
  const list = Array.isArray(entries) ? entries : [];
  const cap = Math.max(0, Math.floor(Number(maxVisible) || 0));
  if (cap <= 0) return [];
  if (list.length <= cap) return list;
  const vw = Math.max(1, viewport?.clientWidth || 1);
  const vh = Math.max(1, viewport?.clientHeight || 1);

  const toNumber = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v ?? '').trim();
    if (!s) return 0;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  const entryInterestScore = (e) => {
    const w = e && e.bubble && e.bubble.userData ? e.bubble.userData.wonder : null;
    return toNumber(w && (w.interest_score ?? w.interestScore));
  };

  const entryStableKey = (e) => {
    const k = e && e.bubble && e.bubble.userData ? e.bubble.userData.stableSortKey : null;
    return (k == null) ? Number.MAX_SAFE_INTEGER : (k >>> 0);
  };

  // Cluster in WORLD space, but cell size is tuned in SCREEN pixels so it feels consistent.
  // This keeps grouping stable while panning (grid is in world coords), and avoids bad calibration
  // where we would sometimes show too few points and then suddenly too many.
  const wpp = worldUnitsPerPixel(camera, vh);

  // Start from a cell size based on the current marker size (in px), not from the screen area.
  // This prevents over-aggressive merging when `cap` is low.
  const sizes = [];
  let lodSum = 0;
  let lodCount = 0;
  for (const e of list) {
    const s = Number(e && e.screenSizePx);
    if (Number.isFinite(s) && s > 0) sizes.push(s);
    const l = Number(e && e.lod);
    if (Number.isFinite(l)) {
      lodSum += Math.max(0, Math.min(1, l));
      lodCount++;
    }
  }
  sizes.sort((a, b) => a - b);
  const medianSizePx = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 24;
  const avgLod = lodCount ? (lodSum / lodCount) : 0;
  const paddingFactor = 0.55 + 0.85 * avgLod; // far: show more points, near: merge more
  const paddingPx = 2;
  let cellPx = Math.max(8, Math.round(medianSizePx * paddingFactor + paddingPx));
  // Avoid absurdly small/large values (and keep deterministic behavior).
  cellPx = Math.max(8, Math.min(260, cellPx));

  for (let pass = 0; pass < 10; pass++) {
    const cellWorld = Math.max(1e-6, cellPx * wpp);
    const buckets = new Map();

    for (const e of list) {
      const ap = e && e.bubble && e.bubble.userData ? e.bubble.userData.anchorPos : null;
      const wx = ap && typeof ap.x === 'number' ? ap.x : NaN;
      const wy = ap && typeof ap.y === 'number' ? ap.y : NaN;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const cx = Math.floor(wx / cellWorld);
      const cy = Math.floor(wy / cellWorld);
      const key = `${cx}|${cy}`;
      const prev = buckets.get(key);
      if (!prev) {
        buckets.set(key, e);
        continue;
      }

      // Prefer the most "interesting" marker in the same bucket.
      // Tie-break deterministically (stableSortKey) so the set doesn't reshuffle.
      const ei = entryInterestScore(e);
      const pi = entryInterestScore(prev);
      if (ei !== pi) {
        if (ei > pi) buckets.set(key, e);
        continue;
      }
      const es = entryStableKey(e);
      const ps = entryStableKey(prev);
      if (es !== ps) {
        if (es < ps) buckets.set(key, e);
        continue;
      }
      // Final tie-break: closer to camera (slightly more clickable).
      if ((e.distSq ?? Infinity) < (prev.distSq ?? Infinity)) buckets.set(key, e);
    }

    const picked = Array.from(buckets.values());
    if (picked.length <= cap) return picked;

    // Too many buckets: increase the cell size and retry (still deterministic).
    cellPx = Math.round(cellPx * 1.22);
    cellPx = Math.min(cellPx, Math.max(260, vw + vh)); // hard safety clamp
  }

  // Fallback: still too many, keep a stable subset using distributed pick.
  const stable = list.slice();
  stable.sort((a, b) => {
    const da = (a && a.distSq != null) ? a.distSq : Infinity;
    const db = (b && b.distSq != null) ? b.distSq : Infinity;
    // Prefer interesting + stable key first (distance only as a last tie-break).
    const ia = entryInterestScore(a);
    const ib = entryInterestScore(b);
    if (ib !== ia) return ib - ia;
    const sa = entryStableKey(a);
    const sb = entryStableKey(b);
    if (sa !== sb) return sa - sb;
    return da - db;
  });

  const stride = Math.ceil(stable.length / cap);
  const out = [];
  for (let i = 0; i < stable.length && out.length < cap; i += stride) out.push(stable[i]);
  return out;
}

function fnv1a32(str) {
  const s = String(str ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit
  return hash >>> 0;
}

function stableSeedFromWonder(wonder) {
  const w = wonder || {};
  if (w.id != null) return String(w.id);
  const name = String(readField(w, 'Name', 'name') || w.name || '').trim();
  const country = String(readField(w, 'Country', 'country') || '').trim();
  const extra = String(readField(w, 'Year', 'year') || '').trim();
  // Keep it deterministic, but avoid empty string when possible.
  return (name || country || extra) ? `${name}|${country}|${extra}` : JSON.stringify(w);
}

function stableSortKeyForWonder(wonder) {
  return fnv1a32(stableSeedFromWonder(wonder));
}

export function createBubbleManager({ scene, camera, viewport }) {
  console.log('[bubbleManager] loaded 2026-02-05 (anchor + overlap + stableZ)');
  const wonderBubbles = [];
  const bubbleById = new Map();

  let frameNo = 0;

  let lastCamZ = null;
  let zoomActive = false;
  let zoomOnlyActive = false;

  // Interaction detection: while camera moves, we avoid expensive per-frame selection work.
  // When interaction stops, we recompute and refresh.
  let interactionUntilMs = 0;
  let interactionActive = false;
  let settledStyleLod = null;
  const lastCamPos = new THREE.Vector3();
  const lastCamQuat = new THREE.Quaternion();
  let haveLastCamSample = false;

  function nowMs() {
    // Use rAF-compatible timer when available.
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  }

  function updateInteractionFromCamera() {
    if (!camera || !camera.position || !camera.quaternion) return;
    const t = nowMs();

    if (!haveLastCamSample) {
      lastCamPos.copy(camera.position);
      lastCamQuat.copy(camera.quaternion);
      haveLastCamSample = true;
      return;
    }

    const dx = camera.position.x - lastCamPos.x;
    const dy = camera.position.y - lastCamPos.y;
    const dz = camera.position.z - lastCamPos.z;
    const posDeltaSq = dx * dx + dy * dy + dz * dz;
    const xyDeltaSq = dx * dx + dy * dy;
    const zDelta = Math.abs((camera.position && typeof camera.position.z === 'number') ? (camera.position.z - (lastCamZ ?? camera.position.z)) : 0);
    zoomActive = zDelta > 0.25;
    // Quaternion delta proxy: 0 when equal, larger when rotating.
    const dot = Math.abs(lastCamQuat.dot(camera.quaternion));
    const rotDelta = 1 - Math.max(0, Math.min(1, dot));

    // Small thresholds: controls apply damping so movement can be subtle.
    const moved = posDeltaSq > 1e-3;
    const rotated = rotDelta > 1e-6;

    // Zoom-only = changing Z without panning/rotation.
    // This is the worst case on BrightSign because LOD changes can cause heavy DOM churn.
    zoomOnlyActive = zoomActive && (xyDeltaSq <= 1e-3) && !rotated;
    if (moved || rotated) {
      // Keep interaction active briefly after the last detected motion.
      interactionUntilMs = t + 220;
      // Ensure we recompute merge/visibility once the camera settles.
      recomputeQueued = true;
    }

    lastCamPos.copy(camera.position);
    lastCamQuat.copy(camera.quaternion);
    lastCamZ = camera.position.z;
  }

  // Precomputed clustering: selection recalculated only when zoom band changes
  // (or when bubble list changes).
  let lastClusterBand = null;
  let clusterDirty = true;
  let cachedSelectedBubbles = null; // Set<CSS2DObject>

  // Overlap-spread cache (used for small filtered datasets).
  let spreadCacheKey = null;
  let spreadOffsetsByStableKey = new Map();

  // Geo spread cache: world offsets computed from lat/lon with a deterministic
  // sequential placement algorithm.
  let geoSpreadCacheKey = null;
  let geoSpreadOffsetsByWonderId = new Map();

  // Cache: while interacting, reuse the last computed visible set so we don't redo
  // collision/cap selection every frame.
  let cachedVisibleSet = null; // Set<CSS2DObject>
  let cachedVisibleList = null; // CSS2DObject[] (derived from cachedVisibleSet)

  // Async recompute of cachedVisibleSet (chunked to avoid blocking).
  let recomputeToken = 0;
  let recomputeInFlight = false;
  let recomputeQueued = false;

  function scheduleRecompute() {
    if (recomputeInFlight) {
      recomputeQueued = true;
      return;
    }
    if (interactionActive) {
      recomputeQueued = true;
      return;
    }
    startAsyncRecompute();
  }

  function startAsyncRecompute() {
    recomputeQueued = false;
    recomputeInFlight = true;
    const token = ++recomputeToken;

    const bubbles = Array.isArray(wonderBubbles) ? wonderBubbles.slice() : [];
    const entries = [];

    const rawLod = resolveBubbleLod();
    const styleSteps = 12;
    const lod = Math.round(rawLod * styleSteps) / styleSteps;
    settledStyleLod = lod;
    const maxVisible = DISABLE_MARKER_CLUSTERING ? Number.MAX_SAFE_INTEGER : getMaxVisibleBubbles(rawLod, viewport);

    let idx = 0;

    const ensureGeoSpreadComputedAsync = (done) => {
      // Spread depends on zoom (world-units-per-pixel), but only updates when settled.
      const lodBucket = Math.round(rawLod * 8) / 8;
      const key = `v2|n:${bubbles.length}|lod:${lodBucket}`;
      if (geoSpreadCacheKey === key && geoSpreadOffsetsByWonderId instanceof Map && geoSpreadOffsetsByWonderId.size) {
        // Fast-path: reuse cached offsets.
        for (const b of bubbles) {
          if (!b || !b.userData) continue;
          const wid = b.userData.wonderId;
          if (!wid) continue;
          const off = geoSpreadOffsetsByWonderId.get(String(wid)) || null;
          b.userData.geoOffsetWorld = off;
        }
        done();
        return;
      }

      geoSpreadCacheKey = key;
      geoSpreadOffsetsByWonderId = new Map();

      // Only spread when zoomed-in enough that overlaps are actually a UX problem.
      // Far zoom: overlaps are OK (and we avoid doing this work).
      // Spread only at the closest zooms.
      const spreadT = Math.max(0, Math.min(1, (lod - 0.82) / 0.14));
      if (spreadT <= 0.001) {
        for (const b of bubbles) {
          if (!b || !b.userData) continue;
          b.userData.geoOffsetWorld = null;
          const wid = b.userData.wonderId;
          if (wid != null) geoSpreadOffsetsByWonderId.set(String(wid), null);
        }
        done();
        return;
      }

      const sorted = bubbles.slice().filter(b => b && b.userData && b.userData.wonder).sort((a, b) => {
        const ak = (a.userData.stableSortKey == null) ? Number.MAX_SAFE_INTEGER : (a.userData.stableSortKey >>> 0);
        const bk = (b.userData.stableSortKey == null) ? Number.MAX_SAFE_INTEGER : (b.userData.stableSortKey >>> 0);
        return ak - bk;
      });

      // Compute a minimum separation in WORLD units so it is visually effective.
      const vh = Math.max(1, viewport?.clientHeight || 1);
      const wpp = worldUnitsPerPixel(camera, vh);
      const baseBubblePx = BUBBLE_DOT_SCREEN_SIZE + (BUBBLE_LOGO_SCREEN_SIZE - BUBBLE_DOT_SCREEN_SIZE) * lod;
      // Softer near-zoom separation: allow dots to be a bit closer.
      // `spreadT` fades it in so the transition is smooth.
      const minSepPx = Math.max(6, (3 + baseBubblePx * 0.16) * spreadT);
      const minSepWorld = Math.max(4, minSepPx * wpp);
      const minSepWorldSq = minSepWorld * minSepWorld;

      const cell = minSepWorld;
      const placed = new Map();
      const cellKey = (cx, cy) => `${cx}|${cy}`;
      const addPlaced = (x, y) => {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        const k = cellKey(cx, cy);
        const arr = placed.get(k);
        if (arr) arr.push({ x, y });
        else placed.set(k, [{ x, y }]);
      };
      const isTooClose = (x, y) => {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = placed.get(cellKey(cx + dx, cy + dy));
            if (!arr) continue;
            for (const p of arr) {
              const ddx = Number(x) - Number(p.x);
              const ddy = Number(y) - Number(p.y);
              const dSq = ddx * ddx + ddy * ddy;
              if (dSq < minSepWorldSq) return true;
            }
          }
        }
        return false;
      };

      const stepWorld = minSepWorld * 0.52;
      const slots = 14;
      const twoPi = Math.PI * 2;

      let sIdx = 0;
      const spreadStep = () => {
        if (token !== recomputeToken) return; // canceled
        if (interactionActive) {
          recomputeInFlight = false;
          recomputeQueued = true;
          return;
        }

        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const budgetMs = 6.0;

        while (sIdx < sorted.length) {
          const bubble = sorted[sIdx++];
          if (!bubble || !bubble.userData) continue;
          const wonder = bubble.userData.wonder;
          const wid = bubble.userData.wonderId;

          let offWorld = null;

          // Base world location: prefer lat/lon -> mapXY, else use existing xy.
          const ll = readLatLonFromWonder(wonder);
          const baseXY = (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lon))
            ? geoToMapXY(normalizeLatToBounds(ll.lat), normalizeLonToBounds(ll.lon))
            : (wonder && Array.isArray(wonder.xy) && wonder.xy.length >= 2 ? [Number(wonder.xy[0]), Number(wonder.xy[1])] : null);
          const baseWorld = baseXY ? mapXYToWorldXY(baseXY) : null;

          if (baseWorld) {
            let candX = baseWorld.x;
            let candY = baseWorld.y;

            if (isTooClose(candX, candY)) {
              let found = false;
              const stableKey = (bubble.userData.stableSortKey == null) ? 0 : (bubble.userData.stableSortKey >>> 0);
              const baseAngle = ((stableKey / 2 ** 32) * twoPi);
              for (let attempt = 1; attempt <= GEO_SPREAD_MAX_ATTEMPTS; attempt++) {
                const ring = Math.floor((attempt - 1) / slots) + 1;
                const slot = (attempt - 1) % slots;
                const ang = baseAngle + (slot / slots) * twoPi;
                const r = ring * stepWorld;
                const x2 = candX + Math.cos(ang) * r;
                const y2 = candY + Math.sin(ang) * r;
                if (!isTooClose(x2, y2)) {
                  candX = x2;
                  candY = y2;
                  found = true;
                  break;
                }
              }

              if (!found) {
                const ring = Math.floor((GEO_SPREAD_MAX_ATTEMPTS - 1) / slots) + 1;
                const slot = (GEO_SPREAD_MAX_ATTEMPTS - 1) % slots;
                const stableKey = (bubble.userData.stableSortKey == null) ? 0 : (bubble.userData.stableSortKey >>> 0);
                const baseAngle = ((stableKey / 2 ** 32) * twoPi);
                const ang = baseAngle + (slot / slots) * twoPi;
                const r = ring * stepWorld;
                candX = candX + Math.cos(ang) * r;
                candY = candY + Math.sin(ang) * r;
              }
            }

            addPlaced(candX, candY);

            const dx = candX - baseWorld.x;
            const dy = candY - baseWorld.y;
            const maxShift = 120;
            offWorld = { x: clamp(dx, -maxShift, maxShift), y: clamp(dy, -maxShift, maxShift) };
          }

          bubble.userData.geoOffsetWorld = offWorld;
          if (wid != null) geoSpreadOffsetsByWonderId.set(String(wid), offWorld);

          const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if ((tNow - t0) >= budgetMs) break;
        }

        if (sIdx < sorted.length) {
          setTimeout(spreadStep, 0);
          return;
        }

        done();
      };

      setTimeout(spreadStep, 0);
    };

    const step = () => {
      if (token !== recomputeToken) return; // canceled
      if (interactionActive) {
        // User started moving again: abort; we'll reschedule later.
        recomputeInFlight = false;
        recomputeQueued = true;
        return;
      }

      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const budgetMs = 6.0;
      while (idx < bubbles.length) {
        const bubble = bubbles[idx++];
        if (!bubble || !bubble.userData) continue;

        let mesh = bubble.userData.targetMesh;
        const wonderId = bubble.userData.wonderId;
        if (wonderId) {
          const closest = selectClosestMeshInstance(wonderId, mesh);
          if (closest) {
            mesh = closest;
            bubble.userData.targetMesh = closest;
          }
        }
        if (!mesh || !mesh.parent) {
          bubble.visible = false;
          continue;
        }

        mesh.getWorldPosition(tmpVecC);
        const anchorY = tmpVecC.y + BUBBLE_ANCHOR_Y_OFFSET;
        const baseZ = (mesh.userData && typeof mesh.userData.baseZ === 'number')
          ? mesh.userData.baseZ
          : tmpVecC.z;
        const anchorZ = baseZ + BUBBLE_ANCHOR_Z_OFFSET;
        tmpVecC.set(tmpVecC.x, anchorY, anchorZ);
        // Apply deterministic geo spread offset (world XY) so close points separate.
        const geoOff = bubble.userData.geoOffsetWorld;
        if (geoOff && Number.isFinite(geoOff.x) && Number.isFinite(geoOff.y)) {
          tmpVecC.x += geoOff.x;
          tmpVecC.y += geoOff.y;
        }
        camera.getWorldDirection(tmpCamDir);
        tmpVecC.addScaledVector(tmpCamDir, -BUBBLE_CAMERA_PUSH);
        if (!bubble.userData.anchorPos) bubble.userData.anchorPos = tmpVecC.clone();
        else bubble.userData.anchorPos.copy(tmpVecC);

        const distanceScaleFactor = 1;
        bubble.userData.distanceScaleFactor = distanceScaleFactor;
        bubble.scale.set(1, 1, 1);

        if (bubble.userData.bubbleLod !== lod || bubble.userData._lastDistanceScaleFactor !== distanceScaleFactor) {
          bubble.userData._lastDistanceScaleFactor = distanceScaleFactor;
          applyBubbleVisualLod(bubble, lod, distanceScaleFactor);
        }

        tmpVecD.copy(bubble.userData.anchorPos).project(camera);
        if (!isClipVisible(tmpVecD)) {
          bubble.visible = false;
          continue;
        }

        const anchorScreenX = (tmpVecD.x + 1) * 0.5 * viewport.clientWidth;
        const anchorScreenY = (-tmpVecD.y + 1) * 0.5 * viewport.clientHeight + BUBBLE_SCREEN_Y_OFFSET_PX;
        if (!bubble.userData.screenPos) bubble.userData.screenPos = { x: anchorScreenX, y: anchorScreenY };
        else {
          bubble.userData.screenPos.x = anchorScreenX;
          bubble.userData.screenPos.y = anchorScreenY;
        }

        const distSq = bubble.userData.anchorPos.distanceToSquared(camera.position);
        entries.push({
          bubble,
          lod,
          clipZ: tmpVecD.z,
          distSq,
          anchorScreen: { x: anchorScreenX, y: anchorScreenY },
          screenPos: bubble.userData.screenPos,
          screenSizePx: (bubble.userData && bubble.userData.screenSizePx) ? bubble.userData.screenSizePx : BUBBLE_LOGO_SCREEN_SIZE
        });

        const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if ((tNow - t0) >= budgetMs) break;
      }

      if (idx < bubbles.length) {
        setTimeout(step, 0);
        return;
      }

      // Final selection (runs only when user stopped interacting).
      const visible = finalizeVisibilitySelection(entries, { rawLod, lod, maxVisible });
      cachedVisibleSet = visible.keepSet;
      cachedVisibleList = (cachedVisibleSet instanceof Set) ? Array.from(cachedVisibleSet) : null;

      // Apply the settled visibility once, so interaction frames can avoid scanning everything.
      if (cachedVisibleSet instanceof Set) {
        for (const bubble of bubbles) {
          if (!bubble) continue;
          bubble.visible = cachedVisibleSet.has(bubble);
        }
      }

      recomputeInFlight = false;
      if (recomputeQueued) setTimeout(() => scheduleRecompute(), 0);
    };

    // Phase 1: geo spread offsets; Phase 2: build entries + merge selection.
    ensureGeoSpreadComputedAsync(() => {
      if (token !== recomputeToken) return;
      if (interactionActive) {
        recomputeInFlight = false;
        recomputeQueued = true;
        return;
      }
      setTimeout(step, 0);
    });
  }

  function finalizeVisibilitySelection(entries, { rawLod, lod, maxVisible }) {
    const list = Array.isArray(entries) ? entries : [];
    if (DISABLE_MARKER_CLUSTERING) {
      const keepSet = new Set(list.map(e => e && e.bubble).filter(Boolean));
      return { keepSet, entries: list };
    }

    const stableKeyOf = (e) => {
      const k = e && e.bubble && e.bubble.userData ? e.bubble.userData.stableSortKey : null;
      return (k == null) ? Number.MAX_SAFE_INTEGER : (k >>> 0);
    };

    // Post-spread merge for very close zoom: if points still overlap after spread,
    // deterministically hide the overlapping ones.
    const mergeOverlapsNear = (itemsEntries) => {
      const vw = Math.max(1, viewport?.clientWidth || 1);
      const vh = Math.max(1, viewport?.clientHeight || 1);
      const sizeScale = vw / VW_REF;
      const wpp = worldUnitsPerPixel(camera, vh);

      const items = [];
      for (const e of itemsEntries) {
        const bubble = e && e.bubble;
        if (!bubble || !bubble.userData) continue;
        const ap = bubble.userData.anchorPos;
        const x = Number(ap && ap.x);
        const y = Number(ap && ap.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const screenSizeRef = Number.isFinite(e.screenSizePx) ? e.screenSizePx : BUBBLE_LOGO_SCREEN_SIZE;
        const screenSizePx = Math.max(1, screenSizeRef * sizeScale);
        // Allow closer packing than before.
        const rPx = Math.max(4, (screenSizePx * 0.5) * 0.42);
        const r = Math.max(1e-6, rPx * wpp);
        items.push({ e, bubble, x, y, r, k: stableKeyOf(e) });
      }

      if (items.length <= 1) {
        return new Set(items.map(it => it.bubble));
      }

      items.sort((a, b) => a.k - b.k);
      const maxR = items.reduce((m, it) => Math.max(m, it.r), 0);
      const cellSize = Math.max(1e-6, maxR * 2);
      const grid = new Map();
      const kept = new Set();

      const key = (cx, cy) => `${cx}|${cy}`;
      const overlaps = (it) => {
        const cx = Math.floor(it.x / cellSize);
        const cy = Math.floor(it.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const arr = grid.get(key(cx + dx, cy + dy));
            if (!arr) continue;
            for (const other of arr) {
              const ddx = it.x - other.x;
              const ddy = it.y - other.y;
              const rr = it.r + other.r;
              if ((ddx * ddx + ddy * ddy) < (rr * rr)) return true;
            }
          }
        }
        return false;
      };
      const add = (it) => {
        kept.add(it.bubble);
        const cx = Math.floor(it.x / cellSize);
        const cy = Math.floor(it.y / cellSize);
        const k = key(cx, cy);
        const arr = grid.get(k);
        if (arr) arr.push(it);
        else grid.set(k, [it]);
      };

      for (const it of items) {
        if (!overlaps(it)) add(it);
      }
      return kept;
    };

    // Geo merge (lat/lon grid). Deterministic, zoom-driven only.
    const safeLod = Number.isFinite(rawLod) ? Math.max(0, Math.min(1, rawLod)) : 0;
    // Near zoom: show all (no merge). Keep previous behavior where fully zoomed-in never hides points.
    if (safeLod >= 0.94) {
      // Still allow merging only if points overlap even after spread.
      const keepSet = mergeOverlapsNear(list);
      return { keepSet, entries: list };
    }

    const cap = Math.max(1, Math.floor(Number(maxVisible) || 1));
    if (list.length <= cap) {
      const keepSet = new Set(list.map(e => e && e.bubble).filter(Boolean));
      return { keepSet, entries: list };
    }

    const b = GEO_BOUNDS || { lonMin: -180, lonMax: 180, latMin: -85, latMax: 85 };
    const lonRange = (Number(b.lonMax) - Number(b.lonMin)) || 360;
    const latRange = (Number(b.latMax) - Number(b.latMin)) || 170;

    // Base cell sizes in degrees when far zoomed-out.
    // We scale down as we zoom-in, so merges progressively split.
    const lonCellFar = 6.0;
    const lonCellNear = 0.55;
    const t = safeLod;
    let cellLon = lonCellFar + (lonCellNear - lonCellFar) * t;
    let cellLat = cellLon * Math.max(0.35, Math.min(0.9, latRange / Math.max(1e-6, lonRange)));
    cellLon = Math.max(0.08, cellLon);
    cellLat = Math.max(0.06, cellLat);

    const getCellKey = (lat, lon, lonSize, latSize) => {
      const ix = Math.floor((lon - Number(b.lonMin)) / lonSize);
      const iy = Math.floor((lat - Number(b.latMin)) / latSize);
      return `${ix}|${iy}`;
    };

    for (let pass = 0; pass < 10; pass++) {
      const reps = new Map();
      for (const e of list) {
        const bubble = e && e.bubble;
        if (!bubble || !bubble.userData) continue;
        const wonder = bubble.userData.wonder;
        const ll = readLatLonFromWonder(wonder);
        if (!ll) continue;
        const lat = normalizeLatToBounds(ll.lat);
        const lon = normalizeLonToBounds(ll.lon);
        const key = getCellKey(lat, lon, cellLon, cellLat);
        const k = stableKeyOf(e);
        const prev = reps.get(key);
        if (!prev || k < prev.k) reps.set(key, { e, k });
      }

      const picked = Array.from(reps.values()).map(v => v && v.e).filter(Boolean);
      if (picked.length <= cap) {
        const keepSet = new Set(picked.map(e => e && e.bubble).filter(Boolean));
        // Ensure any bubbles without lat/lon are still visible (rare), but keep cap safety.
        for (const e of list) {
          if (!e || !e.bubble || !e.bubble.userData) continue;
          const ll = readLatLonFromWonder(e.bubble.userData.wonder);
          if (!ll) keepSet.add(e.bubble);
        }
        return { keepSet, entries: list };
      }

      // Too many: merge more by enlarging the geo cell.
      cellLon = cellLon * 1.22;
      cellLat = cellLat * 1.22;
    }

    // Fallback: stable subset.
    const stable = list.slice();
    stable.sort((a, b) => stableKeyOf(a) - stableKeyOf(b));
    const keepSet = new Set(stable.slice(0, cap).map(e => e && e.bubble).filter(Boolean));
    return { keepSet, entries: list };
  }

  function precomputeClustersForZoom({ lod, band, mustInclude, maxVisibleOverride } = {}) {
    // If the dataset is already small (e.g. country filter), never hide points.
    // Instead, rely on the overlap-spreading logic in the per-frame selection.
    if (wonderBubbles.length <= 80) {
      cachedSelectedBubbles = null;
      return;
    }
    if (DISABLE_MARKER_CLUSTERING) {
      cachedSelectedBubbles = null;
      return;
    }
    const resolvedLod = Number.isFinite(lod) ? Math.max(0, Math.min(1, lod)) : resolveBubbleLod();
    const resolvedBand = band || resolveClusterBandFromLod(resolvedLod);

    // At max zoom, show all bubbles (only cull offscreen). No clustering/cap.
    if (resolvedBand === 'near') {
      cachedSelectedBubbles = null;
      return;
    }
    const maxVisible = Number.isFinite(maxVisibleOverride)
      ? Math.max(0, Math.floor(maxVisibleOverride))
      : getMaxVisibleBubblesForBand(resolvedBand, viewport);
    // Cluster in WORLD space but tuned to SCREEN space:
    // pick a base cell size in pixels and convert to world units using camera FOV/Z.
    const vw = Math.max(1, viewport?.clientWidth || 1);
    const vh = Math.max(1, viewport?.clientHeight || 1);
    const area = vw * vh;
    const baseCellPx = Math.max(18, Math.floor(Math.sqrt(area / Math.max(1, maxVisible))));
    let cellWorld = Math.max(1e-6, baseCellPx * worldUnitsPerPixel(camera, vh));

    const required = (mustInclude instanceof Set) ? mustInclude : new Set();
    const targetAdditional = Math.max(0, maxVisible - required.size);

    // Deterministic clustering & capping in WORLD space.
    // Monotone when zooming-in: we can carry required reps from the coarser band.
    // Then deterministically add more reps for the current band.
    for (let pass = 0; pass < 8; pass++) {
      if (targetAdditional <= 0) {
        cachedSelectedBubbles = required;
        return;
      }

      const cellToRep = new Map();

      for (const bubble of wonderBubbles) {
        if (!bubble || !bubble.userData) continue;
        if (required.has(bubble)) continue;
        const w = bubble.userData.wonder;
        if (!w) continue;
        const loc = wonderLocalXY(w);
        if (!loc) continue;

        const ix = Math.floor(loc.x / cellWorld);
        const iy = Math.floor(loc.y / cellWorld);
        const key = `${ix}|${iy}`;

        let sortKey = bubble.userData.stableSortKey;
        if (sortKey == null) {
          sortKey = stableSortKeyForWonder(w);
          bubble.userData.stableSortKey = sortKey;
        }

        const prev = cellToRep.get(key);
        if (!prev || sortKey < prev.sortKey) {
          cellToRep.set(key, { bubble, sortKey });
        }
      }

      const reps = Array.from(cellToRep.values()).filter(v => v && v.bubble);
      if (reps.length <= targetAdditional) {
        const out = new Set(required);
        for (const r of reps) out.add(r.bubble);
        cachedSelectedBubbles = out;
        return;
      }

      // Too many: increase cell size and retry (still deterministic).
      cellWorld = cellWorld * 1.25;
    }

    // Fallback: deterministic subset by stableSortKey for the remaining bubbles.
    const remaining = Array.from(wonderBubbles).filter(b => b && b.userData && b.userData.wonder && !required.has(b));
    remaining.forEach(b => {
      if (b.userData.stableSortKey == null) b.userData.stableSortKey = stableSortKeyForWonder(b.userData.wonder);
    });
    remaining.sort((a, b) => (a.userData.stableSortKey >>> 0) - (b.userData.stableSortKey >>> 0));
    const out = new Set(required);
    for (const b of remaining.slice(0, targetAdditional)) out.add(b);
    cachedSelectedBubbles = out;
  }

  // Index of the 3 duplicated mesh instances per wonder.
  // Rebuilt only when groupCubes changes (filter / init), not every frame.
  let instancesById = new Map();
  let lastGroupCubesRef = null;
  let lastGroupCubesLen = -1;

  const tmpVecA = new THREE.Vector3();
  const tmpVecB = new THREE.Vector3();
  const tmpVecC = new THREE.Vector3();
  const tmpVecD = new THREE.Vector3();
  const tmpCamDir = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  let lastViewportWidth = Math.max(viewport.clientWidth, 1);
  let lastViewportHeight = Math.max(viewport.clientHeight, 1);

  // Design reference: sizes below are tuned for a 1920x1080 kiosk.
  // We convert to vw/vh so the markers keep the same *relative* size on 1080p/2K/4K.
  const VW_REF = 1920;
  const VH_REF = 1080;

  function pxToVwRef(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return '0vw';
    const v = (n / VW_REF) * 100;
    return `${v.toFixed(6)}vw`;
  }

  function pxToVhRef(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return '0vh';
    const v = (n / VH_REF) * 100;
    return `${v.toFixed(6)}vh`;
  }

  function applyBubbleSizing(element, screenSizePx, { withFrame } = {}) {
    if (!element || !element.style) return;
    // Use vw/vh so marker size tracks the screen size.
    // We base conversion on the reference kiosk resolution so results are consistent.
    const size = pxToVwRef(screenSizePx);
    const shadowOffset = pxToVwRef(screenSizePx * BUBBLE_SHADOW_OFFSET_RATIO);
    const shadowBlur = pxToVwRef(screenSizePx * BUBBLE_SHADOW_BLUR_RATIO);
    const border = pxToVwRef(screenSizePx * BUBBLE_BORDER_RATIO);
    element.style.width = size;
    element.style.height = size;
    if (withFrame === false) {
      element.style.boxShadow = 'none';
      element.style.border = 'none';
    } else {
      element.style.boxShadow = `0 ${shadowOffset} ${shadowBlur} var(--bubble-shadow-color)`;
      element.style.border = `${border} solid var(--accent)`;
    }
  }

  function smoothstep01(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
  }

  function resolveBubbleLod() {
    const z = camera && camera.position ? camera.position.z : BUBBLE_LOGO_Z_OUT;
    const denom = (BUBBLE_LOGO_Z_OUT - BUBBLE_LOGO_Z_IN) || 1;
    // z close => lod=1, z far => lod=0
    const raw = (BUBBLE_LOGO_Z_OUT - z) / denom;
    return smoothstep01(raw);
  }

  function applyBubbleVisualLod(bubble, lod, distanceScaleFactor = 1) {
    if (!bubble || !bubble.userData) return;
    const element = bubble.userData.visualEl || bubble.element || bubble.object;
    if (!element || !element.style) return;

    bubble.userData.bubbleLod = lod;
    // Dots grow slightly as you zoom-in, then transition to full logo size.
    const baseScreenSizePx = BUBBLE_DOT_SCREEN_SIZE + (BUBBLE_LOGO_SCREEN_SIZE - BUBBLE_DOT_SCREEN_SIZE) * lod;
    const safeFactor = Number.isFinite(distanceScaleFactor) ? Math.max(0.35, Math.min(3.0, distanceScaleFactor)) : 1;
    const screenSizePx = baseScreenSizePx * safeFactor;
    bubble.userData.screenSizePx = screenSizePx;

    // Keep visuals stable: frame depends on zoom only (not on perf mode),
    // otherwise borders/shadows "pop" during interaction.
    const withFrame = lod > 0.55;
    // Prevent pixelation: when perspective would upscale a small element, rasterize it
    // at least at the "base" size and scale down inside the element.
    const rasterBoost = safeFactor < 1 ? (1 / safeFactor) : 1;
    const rasterSizePx = screenSizePx * rasterBoost;
    applyBubbleSizing(element, rasterSizePx, { withFrame });
    element.style.borderRadius = '50%';
    element.style.overflow = 'hidden';

    // Renderer centers the root element with translate(-50%,-50%).
    // We compensate by translating the inner bubble down so it sits closer to the ground.
    const visualYOffsetPx = screenSizePx * BUBBLE_VISUAL_Y_OFFSET_FACTOR + BUBBLE_VISUAL_Y_OFFSET_PX;
    const transforms = [];
    const offset = bubble.userData.overlapOffsetPx;
    const ox = offset && Number.isFinite(offset.x) ? offset.x : 0;
    const oy = offset && Number.isFinite(offset.y) ? offset.y : 0;
    if (ox || oy) transforms.push(`translate(${ox}px, ${oy}px)`);
    // Translate in vh so it scales with screen height.
    if (visualYOffsetPx) transforms.push(`translateY(${pxToVhRef(visualYOffsetPx)})`);
    if (rasterBoost !== 1) transforms.push(`scale(${1 / rasterBoost})`);
    element.style.transform = transforms.join(' ');

    const img = element.querySelector ? element.querySelector('img') : null;
    const showFactor = smoothstep01((lod - BUBBLE_LOGO_FADE_IN_AT) / (1 - BUBBLE_LOGO_FADE_IN_AT));
    // Dot/cross mode is zoom-driven (stable while panning).
    const isLowDot = showFactor <= 0.01;
    // Keep portrait visibility stable (zoom-driven).
    const imgShow = showFactor;
    // Keep markers clickable (including the cross marker when zoomed-out).
    // Pan/zoom gestures remain smooth because controls.js only treats it as a click
    // if the pointer didn't move.
    element.style.pointerEvents = 'auto';

    try {
      if (isLowDot) {
        element.classList.add('is-marker-x');
        element.style.setProperty('--marker-x-opacity', '1');
      } else {
        element.classList.remove('is-marker-x');
        element.style.setProperty('--marker-x-opacity', '0');
      }
      // Dots: always show low version (X only), no dark bubble background.
      element.style.background = isLowDot ? 'transparent' : '';
    } catch (err) {
      // ignore
    }
    if (img && img.style) {
      if (isLowDot || imgShow <= 0.01) {
        img.style.display = 'none';
        img.style.opacity = '0';
        img.style.transition = '';
      } else {
        img.style.display = 'block';
        img.style.opacity = String(imgShow);
        img.style.transition = 'opacity 120ms linear';
      }
    }
  }

  function refreshBubbleStyles() {
    wonderBubbles.forEach(bubble => {
      const lod = (bubble.userData && typeof bubble.userData.bubbleLod === 'number') ? bubble.userData.bubbleLod : resolveBubbleLod();
      const factor = (bubble.userData && typeof bubble.userData.distanceScaleFactor === 'number') ? bubble.userData.distanceScaleFactor : 1;
      applyBubbleVisualLod(bubble, lod, factor);
    });
  }

  function removeExistingEntries(wonderId) {
    bubbleById.delete(String(wonderId));
    for (let i = wonderBubbles.length - 1; i >= 0; i--) {
      const bubble = wonderBubbles[i];
      if (bubble && bubble.userData && bubble.userData.wonderId === wonderId) {
        if (bubble.parent) bubble.parent.remove(bubble);
        wonderBubbles.splice(i, 1);
      }
    }
  }

  function rebuildInstancesIndexIfNeeded() {
    const cubes = groupCubes;
    const len = Array.isArray(cubes) ? cubes.length : 0;
    if (cubes === lastGroupCubesRef && len === lastGroupCubesLen) return;

    lastGroupCubesRef = cubes;
    lastGroupCubesLen = len;
    instancesById = new Map();
    if (!Array.isArray(cubes) || len === 0 || typeof cubeWonderMap !== 'object') return;

    for (const obj of cubes) {
      const w = cubeWonderMap.get(obj);
      if (!w || w.id == null) continue;
      const id = String(w.id);
      let arr = instancesById.get(id);
      if (!arr) {
        arr = [];
        instancesById.set(id, arr);
      }
      arr.push(obj);
    }
  }

function resolveImageSource(wonder) {
  const profilePath = resolveProfileImagePath(wonder);
  const resolvedProfile = resolveAssetPath(profilePath);
  // Treat old placeholder portrait as "missing".
  if (resolvedProfile && !isLegacyPlaceholderImage(resolvedProfile)) return resolvedProfile;

  // No placeholder: if there is no profile image, leave it empty.
  return null;
}

function buildBubbleElement(wonder, imgSrc) {
    // Wrapper: the renderer-managed root element (centered by the renderer).
    const wrapper = document.createElement('div');
    wrapper.className = 'wonder-bubble-wrapper';
    wrapper.style.position = 'absolute';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.userSelect = 'none';
    wrapper.setAttribute('unselectable', 'on');
    wrapper.onselectstart = () => false;

    // Inner element: actual visible bubble.
    const div = document.createElement('div');
    div.className = 'wonder-bubble';
    // Actual sizing is applied by applyBubbleVisualLod() based on zoom.
    div.style.borderRadius = '50%';
    div.style.overflow = 'hidden';
    div.style.cursor = 'pointer';
    div.style.display = 'flex';
    div.style.position = 'relative';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.transition = '';
    div.style.pointerEvents = 'auto';
    div.style.userSelect = 'none';
    div.setAttribute('unselectable', 'on');
    div.onselectstart = () => false;
    div.onclick = (e) => {
      const rect = div.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const isCross = !!(div.classList && div.classList.contains('is-marker-x'));
      if (isCross) {
        // Cross: zoom only.
        try {
          const handler = (typeof window !== 'undefined') ? window.__MAP_ON_WONDER_CLICK : null;
          if (typeof handler === 'function') handler(wonder, cx, cy);
        } catch {
          // ignore
        }
      } else {
        // Image marker: popup only.
        showWonderPanel(
          wonder,
          cx,
          cy,
          { anchorWonderId: (wonder && wonder.id != null) ? String(wonder.id) : null }
        );
      }
      e.stopPropagation();
    };
    const img = document.createElement('img');
    if (imgSrc) {
      img.src = imgSrc;
      img.onerror = () => {
        // No fallback image: just remove the <img> so the bubble stays clean.
        img.onerror = null;
        try { img.remove(); } catch { /* ignore */ }
      };
      const displayName = String(readField(wonder, 'Name', 'name') || wonder.name || '').trim();
      img.alt = displayName;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.userSelect = 'none';
      img.setAttribute('unselectable', 'on');
      div.appendChild(img);
    }
    try {
      div.dataset.wonderId = String(wonder.id);
    } catch (err) {
      div.setAttribute('data-wonder-id', String(wonder.id));
    }
    wrapper.appendChild(div);
    return wrapper;
  }

  function createBubble(wonder, mesh3d) {
    const wonderId = (wonder && wonder.id != null) ? String(wonder.id) : null;
    if (wonderId && bubbleById.has(wonderId)) {
      const existing = bubbleById.get(wonderId);
      if (existing && existing.userData) {
        existing.userData.targetMesh = mesh3d;
        existing.userData.wonderId = wonderId;
        if (existing.userData.stableSortKey == null) {
          existing.userData.stableSortKey = stableSortKeyForWonder(existing.userData.wonder || wonder);
        }
        // Ensure legacy screen-space offsets never linger.
        existing.userData.overlapOffsetPx = null;
        // New deterministic geo spread offset (world XY).
        if (existing.userData.geoOffsetWorld == null) existing.userData.geoOffsetWorld = null;
      }
      return existing;
    }

    const imgSrc = resolveImageSource(wonder);
    const element = buildBubbleElement(wonder, imgSrc);

    const cssObj = new CSS2DObject(element);
    cssObj.userData.wonderId = wonderId;
    cssObj.userData.isBubble = true;
    cssObj.userData.targetMesh = mesh3d;
    cssObj.userData.wonder = wonder;
    cssObj.userData.stableSortKey = stableSortKeyForWonder(wonder);
    cssObj.userData.overlapOffsetPx = null;
    cssObj.userData.geoOffsetWorld = null;
    cssObj.userData.visualEl = element.querySelector ? element.querySelector('.wonder-bubble') : null;
    applyBubbleVisualLod(cssObj, resolveBubbleLod());
    cssObj.position.set(0, 0, 0);
    cssObj.visible = true;
    scene.add(cssObj);
    wonderBubbles.push(cssObj);
    if (wonderId) bubbleById.set(wonderId, cssObj);

    // New bubble can affect clustering selection.
    clusterDirty = true;
    cachedVisibleSet = null;

    return cssObj;
  }

  function clear() {
    wonderBubbles.forEach(bubble => {
      if (bubble && bubble.parent) bubble.parent.remove(bubble);
    });
    wonderBubbles.length = 0;
    bubbleById.clear();
    instancesById = new Map();
    lastGroupCubesRef = null;
    lastGroupCubesLen = -1;

    lastClusterBand = null;
    clusterDirty = true;
    cachedSelectedBubbles = null;
    cachedVisibleSet = null;
    cachedVisibleList = null;

    geoSpreadCacheKey = null;
    geoSpreadOffsetsByWonderId = new Map();
  }

  function selectClosestMeshInstance(wonderId, currentMesh) {
    rebuildInstancesIndexIfNeeded();
    const id = String(wonderId);
    const candidates = instancesById.get(id);
    if (!candidates || candidates.length === 0) return null;

    let best = candidates[0];
    let bestDist = Infinity;
    tmpVecA.copy(camera.position);
    for (const obj of candidates) {
      if (!obj) continue;
      obj.getWorldPosition(tmpVecB);
      const dist = tmpVecB.distanceToSquared(tmpVecA);
      if (dist < bestDist) {
        bestDist = dist;
        best = obj;
      }
    }

    // Hysteresis: avoid flickering between duplicated instances when distances are similar.
    // Keep current mesh unless the new best is clearly closer.
    if (currentMesh && currentMesh.parent) {
      currentMesh.getWorldPosition(tmpVecB);
      const currentDist = tmpVecB.distanceToSquared(tmpVecA);
      if (Number.isFinite(currentDist)) {
        const switchRatio = 0.85; // require ~15% improvement
        const switchEpsilon = 2500; // world^2, guard near-equal distances
        const isClearlyCloser = (bestDist + switchEpsilon) < (currentDist * switchRatio);
        if (!isClearlyCloser) return currentMesh;
      }
    }
    return best;
  }

  function collectBubbleEntries(sourceList = null) {
    rebuildInstancesIndexIfNeeded();
    const rawLod = resolveBubbleLod();
    const styleSteps = 12;
    const computedLod = Math.round(rawLod * styleSteps) / styleSteps;
    // During interaction we freeze the style LOD to the last settled value.
    // This avoids per-frame DOM updates while zooming.
    const lod = (interactionActive && Number.isFinite(settledStyleLod)) ? settledStyleLod : computedLod;
    const maxVisible = DISABLE_MARKER_CLUSTERING ? Number.MAX_SAFE_INTEGER : getMaxVisibleBubbles(rawLod, viewport);
    const entries = [];
    const list = Array.isArray(sourceList) ? sourceList : wonderBubbles;
    list.forEach(bubble => {
      // Keep bubbles in screen-space: avoid perspective scaling artifacts and keep UI crisp.

      // During interaction we only call collectBubbleEntries with cachedVisibleList.

      // Major perf win: if clustering already selected a subset, skip everything else.
      if (USE_WORLD_PRECLUSTERING && cachedSelectedBubbles && !cachedSelectedBubbles.has(bubble)) {
        bubble.visible = false;
        return;
      }

      let mesh = bubble.userData && bubble.userData.targetMesh;
      const wonderId = bubble.userData && bubble.userData.wonderId;
      if (wonderId) {
        // Throttle instance switching checks; hysteresis handles the rest.
        if (!interactionActive) {
          const lastSel = bubble.userData._lastInstanceSelectFrame || 0;
          const interval = 12;
          const shouldRecheck = (frameNo - lastSel) >= interval;
          if (shouldRecheck) {
            bubble.userData._lastInstanceSelectFrame = frameNo;
            const closest = selectClosestMeshInstance(wonderId, mesh);
            if (closest) {
              mesh = closest;
              bubble.userData.targetMesh = closest;
            }
          }
        }
      }
      if (!mesh || !mesh.parent) {
        bubble.visible = false;
        return;
      }
      // Matrix worlds are updated once per map group in update().
      // Anchor directly to the object's world position (correct map location).
      // This avoids bbox-based anchoring which can drift and can push points too low/high in Y.
      mesh.getWorldPosition(tmpVecC);
      const anchorY = tmpVecC.y + BUBBLE_ANCHOR_Y_OFFSET;
      // Use Z (relief axis) to pull the bubble back toward the map surface.
      // IMPORTANT: ignore idle bobbing (z animation) from the 3D anchor, otherwise
      // perspective causes bubbles to "sparkle" (tiny radial jitter) even when the
      // camera is still.
      const baseZ = (mesh.userData && typeof mesh.userData.baseZ === 'number')
        ? mesh.userData.baseZ
        : tmpVecC.z;
      const anchorZ = baseZ + BUBBLE_ANCHOR_Z_OFFSET;
      tmpVecC.set(tmpVecC.x, anchorY, anchorZ);
      // Apply deterministic geo spread offset (world XY).
      const geoOff = bubble.userData.geoOffsetWorld;
      if (geoOff && Number.isFinite(geoOff.x) && Number.isFinite(geoOff.y)) {
        tmpVecC.x += geoOff.x;
        tmpVecC.y += geoOff.y;
      }
      camera.getWorldDirection(tmpCamDir);
      tmpVecC.addScaledVector(tmpCamDir, -BUBBLE_CAMERA_PUSH);
      if (!bubble.userData.anchorPos) {
        bubble.userData.anchorPos = tmpVecC.clone();
      } else {
        bubble.userData.anchorPos.copy(tmpVecC);
      }
      const distanceScaleFactor = 1;
      bubble.userData.distanceScaleFactor = distanceScaleFactor;
      bubble.scale.set(1, 1, 1);

      if (!interactionActive) {
        if (!bubble.userData || bubble.userData.bubbleLod !== lod || bubble.userData._lastDistanceScaleFactor !== distanceScaleFactor) {
          bubble.userData._lastDistanceScaleFactor = distanceScaleFactor;
          applyBubbleVisualLod(bubble, lod, distanceScaleFactor);
        }
      }

      tmpVecD.copy(bubble.userData.anchorPos).project(camera);
      const clipVisible = isClipVisible(tmpVecD);
      if (!clipVisible) {
        bubble.visible = false;
        return;
      }

      bubble.visible = true;
      const anchorScreenX = (tmpVecD.x + 1) * 0.5 * viewport.clientWidth;
      const anchorScreenY = (-tmpVecD.y + 1) * 0.5 * viewport.clientHeight + BUBBLE_SCREEN_Y_OFFSET_PX;

      if (!bubble.userData.screenPos) {
        bubble.userData.screenPos = { x: anchorScreenX, y: anchorScreenY };
      } else {
        bubble.userData.screenPos.x += (anchorScreenX - bubble.userData.screenPos.x) * 0.25;
        bubble.userData.screenPos.y += (anchorScreenY - bubble.userData.screenPos.y) * 0.25;
      }

      const distSq = bubble.userData.anchorPos.distanceToSquared(camera.position);
      entries.push({
        bubble,
        lod,
        clipZ: tmpVecD.z,
        distSq,
        anchorScreen: { x: anchorScreenX, y: anchorScreenY },
        screenPos: bubble.userData.screenPos,
        screenSizePx: (bubble.userData && bubble.userData.screenSizePx) ? bubble.userData.screenSizePx : BUBBLE_LOGO_SCREEN_SIZE
      });
    });

    // While moving (pan/zoom), don't redo the expensive visibility selection logic.
    // Keep last settled visible set stable for smooth interaction.
      // Interaction path is handled by calling this function with cachedVisibleList.

    // If we don't have a settled cache yet, start one asynchronously.
    if (!(cachedVisibleSet instanceof Set) && !recomputeInFlight) {
      scheduleRecompute();
      return entries;
    }

    // When settled, recompute only if something changed (camera moved, dataset changed).
    if (!interactionActive && recomputeQueued && !recomputeInFlight) {
      scheduleRecompute();
    }
    if (cachedVisibleSet instanceof Set) {
      for (const e of entries) {
        if (!e || !e.bubble) continue;
        e.bubble.visible = cachedVisibleSet.has(e.bubble);
      }
      return entries.filter(e => e && e.bubble && e.bubble.visible);
    }

    if (DISABLE_MARKER_CLUSTERING) return entries;

    const toNumber = (v) => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const s = String(v ?? '').trim();
      if (!s) return 0;
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    };

    const entryInterestScore = (e) => {
      const w = e && e.bubble && e.bubble.userData ? e.bubble.userData.wonder : null;
      return toNumber(w && (w.interest_score ?? w.interestScore));
    };

    const entryStableKey = (e) => {
      const k = e && e.bubble && e.bubble.userData ? e.bubble.userData.stableSortKey : null;
      return (k == null) ? Number.MAX_SAFE_INTEGER : (k >>> 0);
    };

    // Prevent points from overlapping ("surplomber"): keep a non-overlapping subset.
    // IMPORTANT: bubbles stay fixed relative to the map (we hide/merge, we never offset positions).
    // Use WORLD distances so selection stays stable while panning (screen-space overlap can flicker).
    const vw = Math.max(1, viewport?.clientWidth || 1);
    const vh = Math.max(1, viewport?.clientHeight || 1);
    const sizeScale = vw / VW_REF; // bubble sizing uses vw based on VW_REF
    const wpp = worldUnitsPerPixel(camera, vh);

    const buildCollisionItem = (e) => {
      if (!e || !e.bubble) return null;
      const ap = e.bubble && e.bubble.userData ? e.bubble.userData.anchorPos : null;
      const x = Number(ap && ap.x);
      const y = Number(ap && ap.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const safeLod = Number.isFinite(e.lod) ? Math.max(0, Math.min(1, e.lod)) : 0;
      const screenSizeRef = Number.isFinite(e.screenSizePx) ? e.screenSizePx : BUBBLE_LOGO_SCREEN_SIZE;
      const screenSizePx = Math.max(1, screenSizeRef * sizeScale);
      // Far zoom: allow tighter packing (dots), Near zoom: enforce full no-overlap.
      const radiusFactor = 0.35 + 0.65 * safeLod; // 0.35..1.0
      const rPx = Math.max(1, (screenSizePx * 0.5) * radiusFactor);
      const r = Math.max(1e-6, rPx * wpp);
      return {
        entry: e,
        bubble: e.bubble,
        x,
        y,
        r,
        rPx,
        interest: entryInterestScore(e),
        stableKey: entryStableKey(e),
        distSq: (e.distSq ?? Infinity)
      };
    };

    const itemSort = (a, b) => {
      // Highest interest first, then deterministic stable key, then closer to camera.
      if (b.interest !== a.interest) return b.interest - a.interest;
      if (a.stableKey !== b.stableKey) return a.stableKey - b.stableKey;
      return a.distSq - b.distSq;
    };

    const items = entries.map(buildCollisionItem).filter(Boolean);

    // NOTE: heavy selection is now done asynchronously (finalizeVisibilitySelection).
    // collectBubbleEntries only handles positioning for the currently visible set.
    return entries.filter(e => e && e.bubble && e.bubble.visible);
  }

  function resolveScreenCollisions(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return;

    // Lock bubbles to their true anchor (fixed relative to the map, no gliding).
    for (const entry of list) {
      entry.screenPos.x = entry.anchorScreen.x;
      entry.screenPos.y = entry.anchorScreen.y;
    }
  }

  function applyScreenTargets(entries) {
    entries.forEach(entry => {
      const { bubble } = entry;
      const anchorPos = bubble && bubble.userData ? bubble.userData.anchorPos : null;
      if (!bubble || !bubble.userData || !anchorPos) return;
      // Keep points fixed relative to the map: anchorPos is the true world location.
      if (!bubble.userData.targetPos) {
        bubble.userData.targetPos = anchorPos.clone();
      } else {
        bubble.userData.targetPos.copy(anchorPos);
      }
      const htmlEl = bubble.element || bubble.object;
      if (htmlEl && htmlEl.style) {
        htmlEl.style.transform = '';
      }
    });
  }

  function applyBubbleLerp(entries) {
    const lerpFactor = 1;
    (entries || []).forEach(entry => {
      const bubble = entry && entry.bubble;
      if (bubble && bubble.visible && bubble.userData && bubble.userData.targetPos) {
        bubble.position.lerp(bubble.userData.targetPos, lerpFactor);
      }
    });
  }

  function update() {
    frameNo++;
    updateInteractionFromCamera();
    interactionActive = nowMs() < interactionUntilMs;

    // Fast path: during pure zoom (no pan/rotation), keep markers fully frozen.
    // CSS2DRenderer will reposition them automatically based on the camera.
    if (interactionActive && zoomOnlyActive && Array.isArray(cachedVisibleList)) {
      return;
    }

    // When interaction stops, compute a new visible set asynchronously.
    if (!interactionActive && (clusterDirty || cachedVisibleSet == null || recomputeQueued) && !recomputeInFlight) {
      scheduleRecompute();
    }

    const currentWidth = Math.max(viewport.clientWidth, 1);
    const currentHeight = Math.max(viewport.clientHeight, 1);
    if (currentWidth !== lastViewportWidth || currentHeight !== lastViewportHeight) {
      lastViewportWidth = currentWidth;
      lastViewportHeight = currentHeight;
      refreshBubbleStyles();
    }

    // Update map group matrices once per frame (much cheaper than per-bubble).
    try {
      const groups = Array.isArray(mapGroups) ? mapGroups : [];
      for (const g of groups) {
        if (g && g.group && typeof g.group.updateMatrixWorld === 'function') {
          g.group.updateMatrixWorld(true);
        }
      }
    } catch {
      // ignore
    }

    if (!USE_WORLD_PRECLUSTERING || DISABLE_MARKER_CLUSTERING) {
      // Ensure we never select a clustered subset.
      lastClusterBand = 'near';
      clusterDirty = false;
      cachedSelectedBubbles = null;
    } else {
      const rawLod = resolveBubbleLod();
      const prevBand = lastClusterBand;
      const band = resolveClusterBandFromLodHysteresis(rawLod, lastClusterBand);
      const bandChanged = (band !== prevBand);
      const allowRecluster = clusterDirty || bandChanged;
      if (allowRecluster) {
        const prevSelected = cachedSelectedBubbles;
        // When zooming-in into a more detailed band, keep previously selected reps
        // and only add more (never remove). Zooming-out is allowed to reduce.
        const shouldBeMonotone = bandRank(band) > bandRank(prevBand);
        const mustInclude = (shouldBeMonotone && prevSelected instanceof Set) ? prevSelected : null;

        lastClusterBand = band;
        clusterDirty = false;
        precomputeClustersForZoom({ lod: rawLod, band, mustInclude });
      }
    }

    // Critical perf: while panning/zooming, only update the already-visible bubbles.
    // No full scan of all wonders during interaction.
    const entries = (interactionActive && Array.isArray(cachedVisibleList))
      ? collectBubbleEntries(cachedVisibleList)
      : collectBubbleEntries();
    resolveScreenCollisions(entries);
    applyScreenTargets(entries);
    applyBubbleLerp(entries);
  }

  function pickWonderAt(screenX, screenY) {
    const x = Number(screenX);
    const y = Number(screenY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    let best = null;
    let bestDistSq = Infinity;

    for (const bubble of wonderBubbles) {
      if (!bubble || !bubble.visible || !bubble.userData) continue;
      const sp = bubble.userData.screenPos;
      if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
      const dx = sp.x - x;
      const dy = sp.y - y;
      const distSq = dx * dx + dy * dy;
      const size = Number(bubble.userData.screenSizePx) || 18;
      const r = Math.max(10, size * 0.62);
      if (distSq > r * r) continue;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = bubble;
      }
    }

    if (!best || !best.userData) return null;
    const wonder = best.userData.wonder || null;
    if (!wonder) return null;
    const visualEl = best.userData.visualEl;
    const markerIsCross = !!(visualEl && visualEl.classList && visualEl.classList.contains('is-marker-x'));
    return {
      wonder,
      wonderId: best.userData.wonderId != null ? String(best.userData.wonderId) : (wonder.id != null ? String(wonder.id) : null),
      markerIsCross
    };
  }

  return {
    createBubble,
    clear,
    update,
    refreshStyles: refreshBubbleStyles,
    pickWonderAt
  };
}
