// map.js
import * as THREE from '../../lib/three/build/three.module.js';
// Reference map coordinate system (same as your source map pixels).
// Used for `xy` coordinates and for geo->xy mapping.
export const MAP_WIDTH = 15360;
export const MAP_HEIGHT = 7680;
export let SCROLL_WIDTH = MAP_WIDTH; // width used for the repeat
export let SCROLL_HEIGHT = MAP_HEIGHT;     // reference height (e.g. plane 1200)

// Geographic placement support (lat/lon in degrees).
// Configure bounds to match the map texture/model you're using.
// Default is World bounds; main.js can override for Central Europe.
export let GEO_BOUNDS = {
  lonMin: -180,
  lonMax: 180,
  // Positive = shift points to the right (east) on the texture.
  lonOffsetDeg: 0,
  latMin: -85,
  latMax: 85,
  // Positive = shift points upward (north) on the texture.
  latOffsetDeg: 0,
  projection: 'equirect', // 'equirect' | 'mercator'
  // When projection === 'mercator', blend with equirect (0..1).
  // 0 => pure equirect, 1 => pure mercator.
  mercatorMix: 1,
  outOfBounds: 'skip' // 'skip' | 'clamp'
};

export function setGeoBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return;
  const next = { ...GEO_BOUNDS, ...bounds };
  // Basic sanity.
  if (!Number.isFinite(next.lonMin) || !Number.isFinite(next.lonMax) || next.lonMax === next.lonMin) return;
  if (!Number.isFinite(next.latMin) || !Number.isFinite(next.latMax) || next.latMax === next.latMin) return;
  GEO_BOUNDS = next;
}

function readLatLon(w) {
  if (!w || typeof w !== 'object') return null;
  const toNumber = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^-?\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  };

  const lat = toNumber(w.lat) ?? toNumber(w.latitude) ?? toNumber(w.Latitude)
    ?? (w.geo ? (toNumber(w.geo.lat) ?? toNumber(w.geo.latitude)) : null);
  const lon = toNumber(w.lon) ?? toNumber(w.lng) ?? toNumber(w.longitude) ?? toNumber(w.Longitude)
    ?? (w.geo ? (toNumber(w.geo.lon) ?? toNumber(w.geo.lng) ?? toNumber(w.geo.longitude)) : null);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function geoToMapXY(lat, lon) {
  const b = GEO_BOUNDS;
  const lonOffset = (typeof b.lonOffsetDeg === 'number' && Number.isFinite(b.lonOffsetDeg)) ? b.lonOffsetDeg : 0;
  const latOffset = (typeof b.latOffsetDeg === 'number' && Number.isFinite(b.latOffsetDeg)) ? b.latOffsetDeg : 0;

  // Apply offsets for bounds checks too, so "skip" behaves predictably.
  const testLon = lon + lonOffset;
  const testLat = lat + latOffset;
  const inBounds = (testLon >= b.lonMin && testLon <= b.lonMax && testLat >= b.latMin && testLat <= b.latMax);
  if (!inBounds && b.outOfBounds === 'skip') return null;

  const lonRange = (b.lonMax - b.lonMin) || 1;
  const safeLonRaw = (b.outOfBounds === 'clamp') ? clamp(lon, b.lonMin, b.lonMax) : lon;
  let safeLon = safeLonRaw + lonOffset;
  if (lonOffset) {
    // If we're mapping (almost) the full world, wrap horizontally (periodic texture).
    const isWorldWrap = Math.abs(Math.abs(lonRange) - 360) < 1e-3 || Math.abs(lonRange) > 300;
    if (isWorldWrap) {
      const n = ((safeLon - b.lonMin) % lonRange + lonRange) % lonRange;
      safeLon = b.lonMin + n;
    } else if (b.outOfBounds === 'clamp') {
      safeLon = clamp(safeLon, b.lonMin, b.lonMax);
    }
  }

  const safeLatRaw = (b.outOfBounds === 'clamp') ? clamp(lat, b.latMin, b.latMax) : lat;
  let safeLat = safeLatRaw + latOffset;
  if (latOffset && b.outOfBounds === 'clamp') {
    safeLat = clamp(safeLat, b.latMin, b.latMax);
  }

  const x01 = (safeLon - b.lonMin) / lonRange;

  // Equirectangular baseline (linear latitude).
  const y01Equirect = (b.latMax - safeLat) / (b.latMax - b.latMin);

  let y01;
  if ((b.projection || 'equirect') === 'mercator') {
    // Web Mercator-like mapping.
    // yMerc = ln(tan(pi/4 + lat/2)), normalized between bounds.
    const clampLat = (v) => clamp(v, -85, 85);
    const toY = (deg) => {
      const r = clampLat(deg) * Math.PI / 180;
      return Math.log(Math.tan(Math.PI / 4 + r / 2));
    };
    const yMax = toY(b.latMax);
    const yMin = toY(b.latMin);
    const yVal = toY(safeLat);
    const denom = (yMax - yMin) || 1;
    const y01Merc = (yMax - yVal) / denom;

    // Blend mercator with equirect to match the 3D texture crop/projection.
    const mixRaw = (typeof b.mercatorMix === 'number') ? b.mercatorMix : 1;
    const mix = clamp(mixRaw, 0, 1);
    y01 = y01Equirect * (1 - mix) + y01Merc * mix;
  } else {
    y01 = y01Equirect;
  }

  if (!Number.isFinite(x01) || !Number.isFinite(y01)) return null;
  const x = x01 * MAP_WIDTH;
  const y = y01 * MAP_HEIGHT;
  return [x, y];
}

function fnv1a32(str) {
  const s = String(str ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableSeedFromWonder(w) {
  if (!w || typeof w !== 'object') return '';
  if (w.id != null) return String(w.id);
  const name = String(w.Name ?? w.name ?? '').trim();
  const position = String(w.position ?? w.Position ?? '').trim();
  return (name || position) ? `${name}|${position}` : JSON.stringify(w);
}

function isValidXY(xy) {
  return Array.isArray(xy)
    && xy.length >= 2
    && Number.isFinite(Number(xy[0]))
    && Number.isFinite(Number(xy[1]));
}

function ensureBaseXY(w) {
  if (!w || typeof w !== 'object') return null;

  if (isValidXY(w.__xyBase)) {
    return [Number(w.__xyBase[0]), Number(w.__xyBase[1])];
  }

  if (isValidXY(w.xy)) {
    const base = [Number(w.xy[0]), Number(w.xy[1])];
    w.__xyBase = base;
    return base;
  }

  const ll = readLatLon(w);
  if (!ll) return null;

  const mapped = geoToMapXY(ll.lat, ll.lon);
  if (!mapped) return null;

  const base = [Number(mapped[0]), Number(mapped[1])];
  w.__xyBase = base;
  // Also set xy so downstream code (and clustering) always has a coordinate.
  w.xy = base;
  return base;
}

function locationKeyForWonder(w, baseXY) {
  const ll = readLatLon(w);
  if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lon)) {
    return `ll:${ll.lat.toFixed(4)},${ll.lon.toFixed(4)}`;
  }
  if (baseXY && baseXY.length >= 2) {
    return `xy:${Number(baseXY[0]).toFixed(2)},${Number(baseXY[1]).toFixed(2)}`;
  }
  return '';
}

function toNumberOrZero(v) {
  const n = (typeof v === 'number') ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function applyGlobalMinDistanceXY(wonders, { minDistPx = 72, iterations = 4, anchorPull = 0.08 } = {}) {
  const list = (Array.isArray(wonders) ? wonders : [])
    .filter(w => w && typeof w === 'object' && isValidXY(w.xy) && isValidXY(w.__xyPreferred));
  if (list.length < 2) return;

  const minDist = Math.max(1, Number(minDistPx) || 1);
  const minDistSq = minDist * minDist;
  const passes = Math.max(1, Math.min(10, Math.floor(Number(iterations) || 1)));
  const pull = Math.max(0, Math.min(0.25, Number(anchorPull) || 0));

  // Deterministic order for stable results.
  list.sort((a, b) => {
    const ia = toNumberOrZero(a && a.id);
    const ib = toNumberOrZero(b && b.id);
    if (ia !== ib) return ia - ib;
    return stableSeedFromWonder(a).localeCompare(stableSeedFromWonder(b));
  });

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const ax = Number(a.xy[0]);
        const ay = Number(a.xy[1]);
        const bx = Number(b.xy[0]);
        const by = Number(b.xy[1]);
        let dx = ax - bx;
        let dy = ay - by;
        let distSq = dx * dx + dy * dy;
        if (distSq >= minDistSq) continue;

        // Avoid NaNs and zero-distance instabilities with deterministic jitter direction.
        if (!Number.isFinite(distSq) || distSq < 1e-6) {
          const seed = `${stableSeedFromWonder(a)}|${stableSeedFromWonder(b)}|${pass}`;
          const angle = (fnv1a32(`pair|${seed}`) / 2 ** 32) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distSq = dx * dx + dy * dy;
        }

        const dist = Math.sqrt(distSq);
        if (!Number.isFinite(dist) || dist <= 1e-6) continue;
        const overlap = (minDist - dist) / dist;
        // Split the push equally.
        const push = overlap * 0.5;
        a.xy[0] = clamp(ax + dx * push, 0, MAP_WIDTH);
        a.xy[1] = clamp(ay + dy * push, 0, MAP_HEIGHT);
        b.xy[0] = clamp(bx - dx * push, 0, MAP_WIDTH);
        b.xy[1] = clamp(by - dy * push, 0, MAP_HEIGHT);
      }
    }

    if (pull > 0) {
      // Softly pull points back toward their preferred dispersed position.
      for (const w of list) {
        const px = Number(w.__xyPreferred[0]);
        const py = Number(w.__xyPreferred[1]);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        w.xy[0] = clamp(Number(w.xy[0]) + (px - Number(w.xy[0])) * pull, 0, MAP_WIDTH);
        w.xy[1] = clamp(Number(w.xy[1]) + (py - Number(w.xy[1])) * pull, 0, MAP_HEIGHT);
      }
    }
  }
}

function applyStableLocationDispersion(wonders) {
  const list = Array.isArray(wonders) ? wonders : [];
  // Only run once per dataset load; keep stable positions across filter toggles.
  const needs = list.some(w => w && typeof w === 'object' && w.__xyDispersionApplied !== true);
  if (!needs) return;

  // IMPORTANT: keep the 3D anchors at the *true* geo location.
  // Bubble separation is handled in screen-space in bubbleManager.js so offsets
  // don't scale up with zoom (which caused points drifting into the sea).
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    if (w.__xyDispersionApplied === true) continue;
    const base = ensureBaseXY(w);
    w.__xyDispersionApplied = true;
    if (!base) continue;
    w.__xyJitter = [0, 0];
    w.xy = [base[0], base[1]];
    w.__xyPreferred = [base[0], base[1]];
  }
}
export function setScrollWidth(w) {
  if (Number.isFinite(w) && w > 0) SCROLL_WIDTH = w;
}
export function setScrollSize(w, h) {
  if (Number.isFinite(w) && w > 0) SCROLL_WIDTH = w;
  if (Number.isFinite(h) && h > 0) SCROLL_HEIGHT = h;
}
export let mapGroups = [];
export let groupCubes = [];

const HALO_MAX_WONDERS = 450;

const HALO_GEOMETRY = new THREE.BoxGeometry(1.2, 1.2, 2.4);
HALO_GEOMETRY.scale(28, 60, 28);
const HALO_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xE3D000,
  transparent: true,
  opacity: 0.12,
  blending: THREE.AdditiveBlending
});

const DEFAULT_CUBE_GEOMETRY = new THREE.BoxGeometry(1, 1, 2);
DEFAULT_CUBE_GEOMETRY.scale(28, 60, 28);
const DEFAULT_CUBE_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xDA291C,
  metalness: 0.08,
  roughness: 0.85,
  emissive: 0x3D0A07,
  emissiveIntensity: 0.85
});

function makeHalo() {
  const halo = new THREE.Mesh(HALO_GEOMETRY, HALO_MATERIAL);
  halo.position.set(0, 0, 0);
  halo.userData.isHalo = true;
  // Avoid expensive raycasting against halo geometry.
  halo.raycast = () => null;
  return halo;
}

function buildDefaultCube(withHalo = true) {
  const cube = new THREE.Mesh(DEFAULT_CUBE_GEOMETRY, DEFAULT_CUBE_MATERIAL);
  if (withHalo) cube.add(makeHalo());
  cube.userData.glowPhase = Math.random() * Math.PI * 2;
  return cube;
}

function addWondersToGroup(groupObj, offsetX, wonders, objectFactory, objectMap) {
  const list = Array.isArray(wonders) ? wonders : [];
  applyStableLocationDispersion(list);
  const withHalo = list.length <= HALO_MAX_WONDERS;
  const scaleX = SCROLL_WIDTH / MAP_WIDTH;
  const baseH = MAP_HEIGHT;
  const scaleY = SCROLL_HEIGHT / baseH;
  list.forEach(w => {
    // Fallback: if `xy` is missing/invalid, derive it from lat/lon.
    if (!w.xy || !Array.isArray(w.xy) || w.xy.length < 2) {
      const ll = readLatLon(w);
      if (ll) {
        const mapped = geoToMapXY(ll.lat, ll.lon);
        if (mapped) w.xy = mapped;
      }
    }
    if (!w.xy || !Array.isArray(w.xy) || w.xy.length < 2) return;

    const x = (w.xy[0] - MAP_WIDTH / 2) * scaleX + offsetX;
    const y = (baseH / 2 - w.xy[1]) * scaleY;
    const z = 30;
    let obj = (typeof objectFactory === 'function') ? objectFactory(w) : null;
    if (!obj || !(obj instanceof THREE.Object3D)) {
      obj = buildDefaultCube(withHalo);
    }
    obj.position.set(x, y, z + 15);
    obj.userData.baseZ = obj.position.z; // used for idle bobbing
    groupObj.group.add(obj);
    groupObj.cubes.push(obj);
    if (objectMap && typeof objectMap.set === 'function') objectMap.set(obj, w);
  });
}

export function createMapGroup(offsetX, wonders, mapTexture, objectFactory, objectMap) {
  const group = new THREE.Group();
  // Remove the textured plane creation: keep only the wonders
  // const mapMat = mapTexture
  //   ? new THREE.MeshBasicMaterial({ map: mapTexture, side: THREE.DoubleSide })
  //   : new THREE.MeshBasicMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide });
  // const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_WIDTH, 1200), mapMat);
  // mapMesh.position.set(offsetX, 0, 0.1);
  // mapMesh.rotation.x = 0;
  // group.add(mapMesh);

  const groupObj = { group, cubes: [] };
  addWondersToGroup(groupObj, offsetX, wonders, objectFactory, objectMap);
  return groupObj;
}

export function setupInfiniteMap(scene, wonders, mapTexture, arg4, arg5) {
  const objectFactory = (typeof arg4 === 'function') ? arg4 : undefined;
  const objectMap = (typeof arg4 === 'object' && arg4 && typeof arg4.set === 'function') ? arg4
                    : (typeof arg5 === 'object' && arg5 && typeof arg5.set === 'function') ? arg5
                    : undefined;
  if (objectMap && typeof objectMap.clear === 'function') objectMap.clear();

  if (mapGroups.length === 3) {
    for (let i = -1; i <= 1; i++) {
      const idx = i + 1;
      const groupObj = mapGroups[idx];
      // Fully clear the group before reinjecting the wonders
      while (groupObj.group.children.length > 0) {
        groupObj.group.remove(groupObj.group.children[0]);
      }
      groupObj.cubes = [];
      const offsetX = i * SCROLL_WIDTH;
      addWondersToGroup(groupObj, offsetX, wonders, objectFactory, objectMap);
    }
    groupCubes = [];
    mapGroups.forEach(g => { if (Array.isArray(g.cubes)) groupCubes = groupCubes.concat(g.cubes); });
    return;
  }

  mapGroups.forEach(g => scene.remove(g.group));
  mapGroups = [];
  groupCubes = [];
  for (let i = -1; i <= 1; i++) {
    const groupObj = createMapGroup(i * SCROLL_WIDTH, wonders, mapTexture, objectFactory, objectMap);
    mapGroups.push(groupObj);
    scene.add(groupObj.group);
  }
  groupCubes = [];
  mapGroups.forEach(g => { if (Array.isArray(g.cubes)) groupCubes = groupCubes.concat(g.cubes); });
}

export function checkInfiniteScroll(camera) {
  // Move only the groups (wonders) as before
  if (!mapGroups || mapGroups.length < 3) return;
  const baseX = Math.floor(camera.position.x / SCROLL_WIDTH) * SCROLL_WIDTH;
  // Restore original behavior: center, center+SCROLL_WIDTH, center-SCROLL_WIDTH
  mapGroups[0].group.position.x = baseX;
  mapGroups[1].group.position.x = baseX + SCROLL_WIDTH;
  mapGroups[2].group.position.x = baseX - SCROLL_WIDTH;
  mapGroups[0].group.visible = true;
  mapGroups[1].group.visible = true;
  mapGroups[2].group.visible = true;
}
