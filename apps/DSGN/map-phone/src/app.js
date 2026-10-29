import { loadAppData } from './core/data-loader.js';
import { createInactivityController } from './core/inactivity.js';
import { createInitialState, createInitialWorkflowState } from './core/state.js';

const mapPhoneTracking = window.EHTracking
  ? window.EHTracking.createTracker({
      exhibition: 'DSGN',
      application: 'map-phone',
      getLanguage: () => window.i18n?.lang || '',
    })
  : null;

/* ─────────────────────────────────────────────────────────────
   MAP CONFIGURATION
   imageUrl   – path to the static map image
   zoom/offsetX/offsetY – canvas-level transform (1.0 = full fit)
   bounds     – geographic extent of the PNG (lat/lon)
                Adjust to match the actual image to reposition
                all GPS markers in one step.
   markerGPS  – real GPS coordinates for each location marker
───────────────────────────────────────────────────────────────── */
const MAP_CONFIG = {
  imageUrl: './ressource/images/map-rabat.png',
  zoom: 1.0,
  offsetX: 0,
  offsetY: 0,
  pinZoom: 1.05,
  pinOffsetX: -4,
  pinOffsetY: 23,
  bounds: { north: 34.042, south: 33.985, west: -6.878, east: -6.818 },
  markerGPS: {
    'victim-house':   { lat: 34.0206, lon: -6.8360 },
    'neighbor-house': { lat: 34.0207, lon: -6.8358 },
    'police-station': { lat: 34.0228, lon: -6.8416 },
    'friend-house':   { lat: 34.0009, lon: -6.8554 },
    'karim-location': { lat: 34.0245, lon: -6.8320 },
    'agdal-south':    { lat: 33.9982, lon: -6.8611 },
  },
  markerAdjustments: {
    // VISUAL CHEAT: real GPS for friend's house (Agdal) sits too low for
    // the kiosk framing. Pull it slightly inward so the label and Samir's
    // route remain fully readable inside the visible map.
    'friend-house': { left: 8, top: -20 },
    'agdal-south': { left: 9, top: -20 },
  },
};

// GPS-anchored location markers — used by both production and dev tool
const PINS = [
  { label: 'Victim House',   sel: '[data-marker="victim-house"]',    css: 'map-marker--victim',     left: 79.0, top: 69.0  },
  { label: 'Housekeeper',    sel: '[data-marker="neighbor-house"]',  css: 'map-marker--neighbor',   left: 79.6, top: 68.8  },
  { label: 'Police Station', sel: '[data-marker="police-station"]',  css: 'map-marker--police',     left: 60.4, top: 61.4  },
  { label: 'Friend House',   sel: '[data-marker="friend-house"]',    css: 'map-marker--friend',     left: 14.4, top: 138.2 },
  { label: 'Karim Location', sel: '[data-marker="karim-location"]',  css: 'map-marker--karim',      left: 92.4, top: 55.4  },
];

const MAP_VIEWBOX = { width: 1000, height: 620 };
const REFERENCE_VIEWPORT = { width: 1920, height: 1080 };
const POPUP_BASE_SIZE = { width: 332, height: 560, gap: 24 };
const MAP_ENTRY_SEQUENCE = [
  { src: './ressource/images/map-rabat-step-5.png', hold: 560, scale: 1.42, x: '-3.2%', y: '-2.2%' },
  { src: './ressource/images/map-rabat-step-4.png', hold: 500, scale: 1.31, x: '-2.3%', y: '-1.5%' },
  { src: './ressource/images/map-rabat-step-3.png', hold: 460, scale: 1.22, x: '-1.4%', y: '-0.9%' },
  { src: './ressource/images/map-rabat-step-2.png', hold: 420, scale: 1.14, x: '-0.8%', y: '-0.45%' },
  { src: './ressource/images/map-rabat-step-1.png', hold: 460, scale: 1.08, x: '-0.35%', y: '-0.18%' },
  { src: './ressource/images/map-rabat.png', hold: 760, scale: 1.025, x: '0%', y: '0%' },
];
const MAP_ENTRY_FADE_OUT_MS = 520;
const MAP_VIEW_LIMITS = {
  minScale: 1,
  maxScale: 3.2,
  buttonStep: 0.28,
  wheelSpeed: 0.0018,
};
const MAP_LABEL_LAYOUT = {
  margin: 10,
  gap: 10,
  maxDrift: 58,
  lineInset: 9,
  offscreenThreshold: 40,
  iterations: 10,
};
const CELLULAR_PLOT_STEP_DELAY_MS = 1000;
const MAP_VIEW_ANIMATION_MS = 620;
const isDevToolsEnabled = new URLSearchParams(window.location.search).has('dev');

function updateViewportMetrics() {
  const scale = Math.min(
    window.innerWidth / REFERENCE_VIEWPORT.width,
    window.innerHeight / REFERENCE_VIEWPORT.height,
  );
  const root = document.documentElement;
  root.style.setProperty('--screen-scale', scale.toFixed(4));
  root.style.setProperty('--popup-w', `${POPUP_BASE_SIZE.width * scale}px`);
  root.style.setProperty('--popup-h', `${POPUP_BASE_SIZE.height * scale}px`);
  root.style.setProperty('--popup-gap', `${POPUP_BASE_SIZE.gap * scale}px`);
  syncMapUiScale();
}

function getScreenScaleValue() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--screen-scale')) || 1;
}

function syncMapUiScale() {
  if (!mapCanvas) return;
  const mapScale = Math.max(0.001, (mapView?.scale || 1) * (MAP_CONFIG.zoom || 1));
  mapCanvas.style.setProperty('--map-chip-scale', String(getScreenScaleValue() / mapScale));
}

function gpsToPercent(lat, lon) {
  const { north, south, west, east } = MAP_CONFIG.bounds;
  return {
    left: (lon - west)   / (east  - west)  * 100,
    top:  (north - lat)  / (north - south) * 100,
  };
}

// Apply MAP_CONFIG.pinZoom/pinOffsetX/pinOffsetY to all PINS — used in production
// Returns the actual pixel rect of the map image inside its container (object-fit: contain logic)
function getImageRenderedRect() {
  const img = document.getElementById('map-bg');
  if (!img || !img.naturalWidth) return null;
  const cW = img.clientWidth, cH = img.clientHeight;
  const iW = img.naturalWidth, iH = img.naturalHeight;
  const scale = Math.min(cW / iW, cH / iH);
  const rW = iW * scale, rH = iH * scale;
  return { x: (cW - rW) / 2, y: (cH - rH) / 2, w: rW, h: rH };
}

function applyMapOverlayFrame(rect) {
  document.querySelectorAll('.map-svg, .map-stage__svg').forEach((el) => {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  });
}

function transformPercentPoint(point) {
  const { pinZoom: zoom, pinOffsetX: offsetX, pinOffsetY: offsetY } = MAP_CONFIG;
  return {
    left: 50 + (point.left - 50) * zoom + offsetX,
    top: 50 + (point.top - 50) * zoom + offsetY,
  };
}

function applyMarkerAdjustment(key, point) {
  const adjustment = MAP_CONFIG.markerAdjustments?.[key];
  if (!adjustment) return point;
  return offsetPoint(point, adjustment.left || 0, adjustment.top || 0);
}

function mixPoint(start, end, weight = 0.5) {
  return {
    left: start.left + (end.left - start.left) * weight,
    top: start.top + (end.top - start.top) * weight,
  };
}

function offsetPoint(point, deltaLeft = 0, deltaTop = 0) {
  return {
    left: point.left + deltaLeft,
    top: point.top + deltaTop,
  };
}

function clampPoint(point, minLeft = 6, maxLeft = 94, minTop = 6, maxTop = 94) {
  return {
    left: Math.min(Math.max(point.left, minLeft), maxLeft),
    top: Math.min(Math.max(point.top, minTop), maxTop),
  };
}

function distanceBetweenPoints(a, b) {
  return Math.hypot(a.left - b.left, a.top - b.top);
}

function setElementPosition(element, point, rect) {
  if (!element || !point || !rect) return;
  element.style.left = `${rect.x + (point.left / 100) * rect.w}px`;
  element.style.top = `${rect.y + (point.top / 100) * rect.h}px`;
}

function setStoredMapPointPosition(element, point, rect = getImageRenderedRect()) {
  if (!element || !point) return;
  element.dataset.mapLeft = String(point.left);
  element.dataset.mapTop = String(point.top);

  if (rect) {
    setElementPosition(element, point, rect);
  } else {
    element.style.left = `${point.left}%`;
    element.style.top = `${point.top}%`;
  }
}

function refreshStoredMapPointPositions(rect) {
  if (!rect) return;
  document.querySelectorAll('[data-map-left][data-map-top]').forEach((element) => {
    setElementPosition(element, {
      left: Number(element.dataset.mapLeft),
      top: Number(element.dataset.mapTop),
    }, rect);
  });
}

function ensureMapLabelLayer() {
  if (!mapStage) return null;
  if (!mapLabelLayer || !mapLabelLayer.isConnected) {
    mapLabelLayer = document.createElement('div');
    mapLabelLayer.className = 'map-label-layer';
    mapLabelLayer.setAttribute('aria-hidden', 'true');
    mapStage.appendChild(mapLabelLayer);
    mapStage.classList.add('has-map-label-overlay');
  }
  return mapLabelLayer;
}

function createMapFloatingLabel(target) {
  const label = document.createElement('div');
  label.className = `map-floating-label map-floating-label--${target.type}`;
  label.style.setProperty('--map-label-color', target.color);

  const line = document.createElement('span');
  line.className = 'map-floating-label__line';

  const bubble = document.createElement('div');
  bubble.className = 'map-floating-label__bubble';

  const title = document.createElement('strong');
  title.textContent = target.title;
  bubble.appendChild(title);

  const subtitle = document.createElement('span');
  subtitle.textContent = target.subtitle;
  bubble.appendChild(subtitle);

  label.append(line, bubble);
  return { label, line, bubble };
}

function getMapLabelTargets(stageRect) {
  if (!stageRect) return [];

  const specs = [
    {
      selector: '.map-marker.is-visible[data-marker]',
      type: 'marker',
      keyAttr: 'data-marker',
      labelSelector: '.map-marker__label',
    },
    {
      selector: '.tower-marker.is-visible[data-tower]',
      type: 'tower',
      keyAttr: 'data-tower',
      labelSelector: '.tower-marker__label',
    },
    {
      selector: '.cell-ping.is-on',
      type: 'ping',
      keyAttr: 'data-map-label-key',
      labelSelector: '.cell-ping__label',
    },
  ];

  return specs.flatMap((spec) => {
    return [...document.querySelectorAll(spec.selector)].map((host, index) => {
      const sourceLabel = host.querySelector(spec.labelSelector);
      if (!sourceLabel) return null;

      const hostRect = host.getBoundingClientRect();
      const anchorX = hostRect.left - stageRect.left;
      const anchorY = hostRect.top - stageRect.top;
      if (
        anchorX < -MAP_LABEL_LAYOUT.offscreenThreshold ||
        anchorX > stageRect.width + MAP_LABEL_LAYOUT.offscreenThreshold ||
        anchorY < -MAP_LABEL_LAYOUT.offscreenThreshold ||
        anchorY > stageRect.height + MAP_LABEL_LAYOUT.offscreenThreshold
      ) {
        return null;
      }

      const title = spec.type === 'ping'
        ? (sourceLabel.textContent || '').trim().replace(/\s+/g, ' ')
        : (sourceLabel.querySelector('strong')?.textContent || '').trim().replace(/\s+/g, ' ');
      const subtitle = spec.type === 'ping'
        ? ''
        : (sourceLabel.querySelector('span')?.textContent || '').trim().replace(/\s+/g, ' ');
      const computedHost = getComputedStyle(host);
      const computedLabel = getComputedStyle(sourceLabel);
      const color = (
        computedHost.getPropertyValue('--marker-color') ||
        computedHost.getPropertyValue('--ping-color') ||
        computedLabel.borderColor ||
        computedLabel.color ||
        'rgba(88, 208, 248, 0.78)'
      ).trim();

      return {
        key: host.getAttribute(spec.keyAttr) || `${spec.type}-${index}`,
        type: spec.type,
        title,
        subtitle,
        color,
        anchorX,
        anchorY,
      };
    }).filter(Boolean);
  });
}

function getBaseMapLabelOffset(item, stageRect) {
  const nearLeft = item.anchorX < stageRect.width * 0.24;
  const nearRight = item.anchorX > stageRect.width * 0.76;
  const nearTop = item.anchorY < stageRect.height * 0.2;
  const horizontalGap = item.type === 'tower' ? 20 : 16;
  const verticalGap = item.type === 'ping' ? 12 : 16;

  let dx = -item.width / 2;
  let dy = -item.height - verticalGap;

  if (item.type === 'tower') {
    dx = nearRight ? -item.width - horizontalGap : horizontalGap;
    dy = nearTop ? 12 : -item.height / 2;
  } else if (item.type === 'ping') {
    dx = nearRight ? -item.width - horizontalGap : nearLeft ? horizontalGap : -item.width / 2;
    dy = nearTop ? 10 : -item.height - verticalGap;
  } else {
    if (nearRight) dx = -item.width - horizontalGap;
    else if (nearLeft) dx = horizontalGap;
    if (nearTop) dy = 14;
  }

  const minDx = -item.anchorX + MAP_LABEL_LAYOUT.margin;
  const maxDx = stageRect.width - MAP_LABEL_LAYOUT.margin - item.anchorX - item.width;
  const minDy = -item.anchorY + MAP_LABEL_LAYOUT.margin;
  const maxDy = stageRect.height - MAP_LABEL_LAYOUT.margin - item.anchorY - item.height;

  return {
    dx: clamp(dx, minDx, maxDx),
    dy: clamp(dy, minDy, maxDy),
  };
}

function constrainMapLabelPosition(item, stageRect) {
  const minDx = -item.anchorX + MAP_LABEL_LAYOUT.margin;
  const maxDx = stageRect.width - MAP_LABEL_LAYOUT.margin - item.anchorX - item.width;
  const minDy = -item.anchorY + MAP_LABEL_LAYOUT.margin;
  const maxDy = stageRect.height - MAP_LABEL_LAYOUT.margin - item.anchorY - item.height;

  item.dx = clamp(item.dx, minDx, maxDx);
  item.dy = clamp(item.dy, minDy, maxDy);

  const driftX = item.dx - item.baseDx;
  const driftY = item.dy - item.baseDy;
  const driftDistance = Math.hypot(driftX, driftY);
  if (driftDistance > MAP_LABEL_LAYOUT.maxDrift) {
    const ratio = MAP_LABEL_LAYOUT.maxDrift / driftDistance;
    item.dx = item.baseDx + driftX * ratio;
    item.dy = item.baseDy + driftY * ratio;
    item.dx = clamp(item.dx, minDx, maxDx);
    item.dy = clamp(item.dy, minDy, maxDy);
  }
}

function resolveMapLabelCollisions(items, stageRect) {
  const expandedGap = MAP_LABEL_LAYOUT.gap / 2;

  items.forEach((item) => constrainMapLabelPosition(item, stageRect));

  for (let iteration = 0; iteration < MAP_LABEL_LAYOUT.iterations; iteration += 1) {
    let moved = false;

    for (let leftIndex = 0; leftIndex < items.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < items.length; rightIndex += 1) {
        const leftItem = items[leftIndex];
        const rightItem = items[rightIndex];
        const leftRect = {
          left: leftItem.anchorX + leftItem.dx - expandedGap,
          top: leftItem.anchorY + leftItem.dy - expandedGap,
          right: leftItem.anchorX + leftItem.dx + leftItem.width + expandedGap,
          bottom: leftItem.anchorY + leftItem.dy + leftItem.height + expandedGap,
        };
        const rightRect = {
          left: rightItem.anchorX + rightItem.dx - expandedGap,
          top: rightItem.anchorY + rightItem.dy - expandedGap,
          right: rightItem.anchorX + rightItem.dx + rightItem.width + expandedGap,
          bottom: rightItem.anchorY + rightItem.dy + rightItem.height + expandedGap,
        };

        const overlapX = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
        const overlapY = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const pushAlongY = overlapY <= overlapX;
        if (pushAlongY) {
          const leftCenterY = leftItem.anchorY + leftItem.dy + leftItem.height / 2;
          const rightCenterY = rightItem.anchorY + rightItem.dy + rightItem.height / 2;
          const direction = Math.sign(rightCenterY - leftCenterY) || Math.sign(rightItem.anchorY - leftItem.anchorY) || 1;
          const push = overlapY / 2 + MAP_LABEL_LAYOUT.gap / 2;
          leftItem.dy -= direction * push / 2;
          rightItem.dy += direction * push / 2;
        } else {
          const leftCenterX = leftItem.anchorX + leftItem.dx + leftItem.width / 2;
          const rightCenterX = rightItem.anchorX + rightItem.dx + rightItem.width / 2;
          const direction = Math.sign(rightCenterX - leftCenterX) || Math.sign(rightItem.anchorX - leftItem.anchorX) || 1;
          const push = overlapX / 2 + MAP_LABEL_LAYOUT.gap / 2;
          leftItem.dx -= direction * push / 2;
          rightItem.dx += direction * push / 2;
        }

        constrainMapLabelPosition(leftItem, stageRect);
        constrainMapLabelPosition(rightItem, stageRect);
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function getMapLabelAttachmentPoint(item) {
  const inset = Math.max(2, Math.min(MAP_LABEL_LAYOUT.lineInset, item.width / 2 - 2, item.height / 2 - 2));
  return {
    x: clamp(0, item.dx + inset, item.dx + item.width - inset),
    y: clamp(0, item.dy + inset, item.dy + item.height - inset),
  };
}

function renderMapLabels() {
  const layer = ensureMapLabelLayer();
  const stageRect = getMapStageRect();
  if (!layer || !stageRect) return;

  const targets = getMapLabelTargets(stageRect);
  layer.style.visibility = 'hidden';
  layer.replaceChildren();

  if (!targets.length) {
    layer.style.visibility = '';
    return;
  }

  const items = targets.map((target) => {
    const { label, line, bubble } = createMapFloatingLabel(target);
    layer.appendChild(label);

    const item = {
      ...target,
      element: label,
      line,
      bubble,
      width: bubble.offsetWidth,
      height: bubble.offsetHeight,
      baseDx: 0,
      baseDy: 0,
      dx: 0,
      dy: 0,
    };
    const baseOffset = getBaseMapLabelOffset(item, stageRect);
    item.baseDx = baseOffset.dx;
    item.baseDy = baseOffset.dy;
    item.dx = baseOffset.dx;
    item.dy = baseOffset.dy;
    return item;
  });

  resolveMapLabelCollisions(items, stageRect);

  items.forEach((item) => {
    item.element.style.left = `${item.anchorX}px`;
    item.element.style.top = `${item.anchorY}px`;
    item.bubble.style.transform = `translate3d(${item.dx}px, ${item.dy}px, 0)`;

    const attach = getMapLabelAttachmentPoint(item);
    const lineLength = Math.hypot(attach.x, attach.y);
    item.line.style.width = `${lineLength}px`;
    item.line.style.opacity = lineLength > 4 ? '0.44' : '0';
    item.line.style.transform = `rotate(${Math.atan2(attach.y, attach.x)}rad)`;
  });

  layer.style.visibility = '';
}

function scheduleMapLabelLayout() {
  if (mapLabelLayoutFrame) return;
  mapLabelLayoutFrame = requestAnimationFrame(() => {
    mapLabelLayoutFrame = 0;
    renderMapLabels();
  });
}

function stopMapLabelAnimationSync() {
  if (mapLabelAnimationFrame) {
    cancelAnimationFrame(mapLabelAnimationFrame);
    mapLabelAnimationFrame = 0;
  }
  mapLabelAnimationDeadline = 0;
}

function tickMapLabelAnimationSync() {
  mapLabelAnimationFrame = 0;
  scheduleMapLabelLayout();
  if (performance.now() < mapLabelAnimationDeadline) {
    mapLabelAnimationFrame = requestAnimationFrame(tickMapLabelAnimationSync);
  }
}

function syncMapLabelsDuringAnimation(durationMs = 260) {
  mapLabelAnimationDeadline = performance.now() + durationMs;
  if (!mapLabelAnimationFrame) {
    mapLabelAnimationFrame = requestAnimationFrame(tickMapLabelAnimationSync);
  }
}

function percentPointToSvg(point) {
  return {
    x: (point.left / 100) * MAP_VIEWBOX.width,
    y: (point.top / 100) * MAP_VIEWBOX.height,
  };
}

function percentRadiusToSvg(radius) {
  return (radius / 100) * MAP_VIEWBOX.width;
}

function buildQuadraticPath(start, control, end) {
  const startPoint = percentPointToSvg(start);
  const controlPoint = percentPointToSvg(control);
  const endPoint = percentPointToSvg(end);
  return `M ${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} Q ${controlPoint.x.toFixed(1)} ${controlPoint.y.toFixed(1)} ${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)}`;
}

function buildTwoSegmentQuadraticPath(start, controlA, via, controlB, end) {
  const startPoint = percentPointToSvg(start);
  const controlPointA = percentPointToSvg(controlA);
  const viaPoint = percentPointToSvg(via);
  const controlPointB = percentPointToSvg(controlB);
  const endPoint = percentPointToSvg(end);
  return `M ${startPoint.x.toFixed(1)} ${startPoint.y.toFixed(1)} Q ${controlPointA.x.toFixed(1)} ${controlPointA.y.toFixed(1)} ${viaPoint.x.toFixed(1)} ${viaPoint.y.toFixed(1)} Q ${controlPointB.x.toFixed(1)} ${controlPointB.y.toFixed(1)} ${endPoint.x.toFixed(1)} ${endPoint.y.toFixed(1)}`;
}

// Smooth Catmull-Rom polyline through N waypoints, expressed in % coords.
// Produces an SVG path string in viewBox coordinates.
// Tension ~0.5 gives a natural, slightly relaxed curve good for movement traces.
function buildSmoothPolyline(percentPoints, tension = 0.5) {
  // Drop consecutive duplicates to avoid degenerate segments.
  const pts = [];
  percentPoints.forEach((p) => {
    if (!p) return;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.left - last.left, p.top - last.top) > 0.05) pts.push(p);
  });
  if (pts.length < 2) return '';
  const sv = pts.map(percentPointToSvg);
  if (sv.length === 2) {
    return `M ${sv[0].x.toFixed(1)} ${sv[0].y.toFixed(1)} L ${sv[1].x.toFixed(1)} ${sv[1].y.toFixed(1)}`;
  }
  let d = `M ${sv[0].x.toFixed(1)} ${sv[0].y.toFixed(1)}`;
  for (let i = 0; i < sv.length - 1; i += 1) {
    const p0 = sv[i - 1] || sv[i];
    const p1 = sv[i];
    const p2 = sv[i + 1];
    const p3 = sv[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * (tension / 6);
    const c1y = p1.y + (p2.y - p0.y) * (tension / 6);
    const c2x = p2.x - (p3.x - p1.x) * (tension / 6);
    const c2y = p2.y - (p3.y - p1.y) * (tension / 6);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Each cellular ping references a serving TOWER ID, but the map marker
// represents the estimated handset position inferred from the case chronology.
// The tower remains coverage context only; it is not the plotted location.
//
// Each entry below encodes the leg of the journey, a `t` position along
// that leg, and a small perpendicular offset. The result is a plausible
// chronological handset trace instead of an antenna position.
// as a chronological dot sequence: home → home → victim → home.
const PING_WAYPOINT = {
  // Karim — Hassan (home) → victim → Hassan. Coherent with chronology:
  // 23:22 Youssef invites Karim, 00:30-04:30 both present, 05:00 leaves.
  karim: {
    'gamma-03@22:05': { from: 'karim', to: 'victim', t: 0.04, off: -0.9 }, // Hassan, before departure
    'gamma-03@23:18': { from: 'karim', to: 'victim', t: 0.18, off:  1.1 }, // Hassan edge, after argument
    'alpha-01@23:55': { from: 'karim', to: 'victim', t: 0.88, off: -0.8 }, // Medina approach near victim
    'gamma-03@05:12': { from: 'victim', to: 'karim', t: 0.84, off:  1.0 }, // back in Hassan after leaving
  },
  // Samir — starts from the friend's house in Agdal (canonical narrative),
  // then goes to the victim and later returns to the same area.
  samir: {
    'delta-04@18:30': { from: 'agdal-south', to: 'friend', t: 0.18, off: -0.8 }, // Agdal south, evening out
    'beta-02@20:11':  { from: 'agdal-south', to: 'friend', t: 0.86, off:  0.9 }, // near friend's house
    'alpha-01@00:18': { from: 'friend',      to: 'victim', t: 0.91, off: -1.2 }, // Medina approach after midnight
    'beta-02@06:42':  { from: 'victim',      to: 'friend', t: 0.92, off:  1.0 }, // Agdal return after leaving
  },
};

// Resolve "from"/"to" markers into % points using the live overlay layout.
function resolveItineraryAnchor(name, layout) {
  switch (name) {
    case 'karim':        return layout.markers['karim-location'];
    case 'victim':       return layout.markers['victim-house'];
    case 'friend':       return layout.markers['friend-house'];
    case 'agdal-south':  return layout.markers['agdal-south'];
    case 'police':       return layout.markers['police-station'];
    default:             return null;
  }
}

function resolveSameAnchorOffsetTarget(suspect, anchorName, layout) {
  switch (anchorName) {
    case 'karim':
    case 'friend':
      return layout.markers['victim-house'];
    case 'victim':
      return suspect === 'samir'
        ? layout.markers['friend-house']
        : layout.markers['karim-location'];
    case 'police':
      return layout.markers['victim-house'];
    default:
      return null;
  }
}

// Compute a perpendicular offset in % (rotate the leg vector by 90°,
// normalize, scale by `off`). Used so two consecutive pings on the same
// leg don't sit perfectly on the chord — gives the trail a natural arc.
function perpendicularOffset(start, end, off) {
  if (!off) return { dx: 0, dy: 0 };
  const dx = end.left - start.left;
  const dy = end.top  - start.top;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular: (-dy, dx) normalized.
  return { dx: (-dy / len) * off, dy: (dx / len) * off };
}

// Resolve a ping to a logical walking waypoint on the map.
// Falls back to the raw GPS if no waypoint is configured.
function pingToMapPoint(suspect, tower, time, locStr, layout) {
  const key = `${(tower || '').toLowerCase()}@${time || ''}`;
  const wp  = PING_WAYPOINT[suspect]?.[key];
  if (wp) {
    const start = resolveItineraryAnchor(wp.from, layout);
    const end   = resolveItineraryAnchor(wp.to, layout);
    if (start && end) {
      const base = mixPoint(start, end, wp.t);
      const offsetEnd = Math.hypot(end.left - start.left, end.top - start.top) <= 0.01
        ? resolveSameAnchorOffsetTarget(suspect, wp.from, layout) || end
        : end;
      const off  = perpendicularOffset(start, offsetEnd, wp.off || 0);
      return { left: base.left + off.dx, top: base.top + off.dy };
    }
  }
  return gpsStringToPercent(locStr);
}

// Parse a "lat, lon" string into a transformed % point on the map.
function gpsStringToPercent(s) {
  if (!s) return null;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return transformPercentPoint(gpsToPercent(parseFloat(m[1]), parseFloat(m[2])));
}

// Drop points that are within `minDist` % of any earlier point. Used to
// collapse cellular pings whose GPS coincides with a known marker (e.g.
// ALPHA-01 pings == victim-house) so the trail does not yo-yo.
function dedupePointsByDistance(points, minDist = 0.8) {
  const out = [];
  points.forEach((p) => {
    if (!p) return;
    const tooClose = out.some((q) => Math.hypot(p.left - q.left, p.top - q.top) <= minDist);
    if (!tooClose) out.push(p);
  });
  return out;
}

// Resolve a chronological ping list to its sequence of LOGICAL walking
// waypoints on the map (already deduped by walking position, not by
// tower). Pings whose waypoint sits within `minDist` of an earlier one
// are dropped to keep the trail moving forward.
function pingsToWaypoints(suspect, pings, layout, minDist = 1.2) {
  const out = [];
  pings.forEach((p) => {
    const point = pingToMapPoint(suspect, p.tower, p.time, p.loc, layout);
    if (!point) return;
    const tooClose = out.some((q) => Math.hypot(point.left - q.left, point.top - q.top) <= minDist);
    if (!tooClose) out.push(point);
  });
  return out;
}

// Resolve a chronological ping list into route control points while keeping
// genuine revisits (e.g. friend -> victim -> friend) in the sequence. Only
// immediate near-duplicates are collapsed.
function pingsToRoutePoints(suspect, pings, layout, minDist = 0.35) {
  const out = [];
  pings.forEach((p) => {
    const point = pingToMapPoint(suspect, p.tower, p.time, p.loc, layout);
    if (!point) return;
    const prev = out[out.length - 1];
    const tooCloseToPrevious = prev && Math.hypot(point.left - prev.left, point.top - prev.top) <= minDist;
    if (!tooCloseToPrevious) out.push(point);
  });
  return out;
}

// Real chronological cellular pings shown both in the Cellular evidence
// table AND used by the interactive trail when the user clicks a row.
// Times and tower IDs are aligned with case.json chronology:
//   23:22 Youssef invites Karim → he arrives ~23:55 → leaves 05:00
//   23:55 Samir says "I'm comminn" → arrives ~00:18 → leaves 06:30
const CELL_PINGS = {
  karim: [
    { time: '22:05', tower: 'GAMMA-03', loc: '34.0247, -6.8324', area: 'Hassan home sector', confidence: 'HIGH' },
    { time: '23:18', tower: 'GAMMA-03', loc: '34.0239, -6.8331', area: 'Hassan departure edge', confidence: 'MED' },
    { time: '23:55', tower: 'ALPHA-01', loc: '34.0211, -6.8365', area: 'Medina approach', confidence: 'HIGH' },
    { time: '05:12', tower: 'GAMMA-03', loc: '34.0243, -6.8327', area: 'Hassan return sector', confidence: 'MED' },
  ],
  samir: [
    { time: '18:30', tower: 'DELTA-04', loc: '33.9982, -6.8611', area: 'Agdal south sector', confidence: 'MED' },
    { time: '20:11', tower: 'BETA-02',  loc: '34.0009, -6.8554', area: "Friend's house area", confidence: 'HIGH' },
    { time: '00:18', tower: 'ALPHA-01', loc: '34.0200, -6.8370', area: 'Medina west access', confidence: 'HIGH' },
    { time: '06:42', tower: 'BETA-02',  loc: '34.0012, -6.8560', area: 'Agdal return sector', confidence: 'MED' },
  ],
};

function computeZoneRadius(center, ...points) {
  const furthestPoint = points.reduce((furthest, point) => {
    if (!point) return furthest;
    return Math.max(furthest, distanceBetweenPoints(center, point));
  }, 0);
  return Math.max(11.5, furthestPoint * 0.72 + 2);
}

function buildMapOverlayLayout() {
  const markers = Object.fromEntries(
    Object.entries(MAP_CONFIG.markerGPS).map(([key, gps]) => [key, applyMarkerAdjustment(key, transformPercentPoint(gpsToPercent(gps.lat, gps.lon)))]),
  );

  const victim = markers['victim-house'];
  const neighbor = markers['neighbor-house'];
  const police = markers['police-station'];
  const friend = markers['friend-house'];
  const karim = markers['karim-location'];
  const routeLayout = { markers };

  const remoteHub = clampPoint(offsetPoint(mixPoint(karim, police, 0.48), 4, -13), 16, 86, 10, 78);

  const towers = {
    a: clampPoint(offsetPoint(mixPoint(friend, victim, 0.33), -5, -18), 10, 76, 10, 82),
    b: clampPoint(offsetPoint(mixPoint(police, victim, 0.55), -1, -12), 14, 84, 10, 78),
    c: clampPoint(offsetPoint(mixPoint(victim, karim, 0.82), 3, -14), 18, 90, 10, 74),
  };

  const karimRouteA = offsetPoint(mixPoint(karim, victim, 0.22), 1.2, -2.8);
  const karimRouteB = offsetPoint(mixPoint(karim, victim, 0.52), -1.1, -3.6);
  const karimRouteC = offsetPoint(mixPoint(karim, victim, 0.82), -0.4, -1.2);
  const karimRoutePoints = pingsToRoutePoints('karim', CELL_PINGS.karim, routeLayout);
  const samirRoutePoints = pingsToRoutePoints('samir', CELL_PINGS.samir, routeLayout);

  const googleOrigin = clampPoint(offsetPoint(karim, -2.4, -4.4), 14, 84, 12, 84);
  const events = {
    // Google actions are remote account events from Karim's Hassan sector,
    // not physical movement between the victim and the police station.
    'google-login':     googleOrigin,
    'delete-attempt-1': clampPoint(offsetPoint(googleOrigin, 2.2, 1.4), 14, 84, 12, 84),
    'delete-attempt-2': clampPoint(offsetPoint(googleOrigin, 3.8, 3.4), 14, 84, 12, 84),
    'witness-call':     clampPoint(offsetPoint(neighbor, -11.5, -1.2), 10, 80, 10, 86),
  };

  const routes = {
    // Phone: stays at victim's house, then physically transferred to the
    // police station for Faraday isolation. Direct line, slight curve via
    // a control point biased upward.
    phone: buildQuadraticPath(
      victim,
      offsetPoint(mixPoint(victim, police, 0.5), -2, -8),
      police,
    ),

    // Cellular routes now follow the chronological ping tables directly,
    // including the return leg back home/friend after the night.
    karim: buildSmoothPolyline(
      karimRoutePoints.length >= 2
        ? karimRoutePoints
        : [karim, karimRouteA, karimRouteB, karimRouteC, victim],
      0.22,
    ),

    samir: buildSmoothPolyline(
      samirRoutePoints.length >= 2
        ? samirRoutePoints
        : [friend, victim],
      0.2,
    ),

    // Google: show the temporal sequence directly on the map, from the login
    // origin through both blocked deletions to the police-held phone.
    google: buildSmoothPolyline([
      events['google-login'],
      events['delete-attempt-1'],
      events['delete-attempt-2'],
      police,
    ], 0.26),
  };

  const zones = {
    a: {
      center: towers.a,
      radius: computeZoneRadius(towers.a, victim, friend),
    },
    b: {
      center: towers.b,
      radius: computeZoneRadius(towers.b, victim, neighbor, police),
    },
    c: {
      center: towers.c,
      radius: computeZoneRadius(towers.c, victim, karim, remoteHub),
    },
  };

  return { markers, towers, events, routes, zones };
}

function applyAllMarkersFromConfig(attempt = 0) {
  const rect = getImageRenderedRect();
  if (!rect || !rect.w) {
    // Layout not ready yet — retry up to 30 frames (~500 ms)
    if (attempt < 30) requestAnimationFrame(() => applyAllMarkersFromConfig(attempt + 1));
    return;
  }
  applyMapOverlayFrame(rect);

  const overlayLayout = buildMapOverlayLayout();

  PINS.forEach((pin) => {
    const element = document.querySelector(pin.sel);
    const match = pin.sel.match(/data-marker="([^"]+)"/);
    const key = match?.[1];
    if (!key) return;
    setElementPosition(element, overlayLayout.markers[key], rect);
  });

  Object.entries(overlayLayout.towers).forEach(([key, point]) => {
    setElementPosition(document.querySelector(`[data-tower="${key}"]`), point, rect);
  });

  Object.entries(overlayLayout.events).forEach(([key, point]) => {
    setElementPosition(document.querySelector(`[data-event="${key}"]`), point, rect);
  });

  Object.entries(overlayLayout.routes).forEach(([key, pathData]) => {
    document.getElementById(`route-${key}`)?.setAttribute('d', pathData);
  });

  Object.entries(overlayLayout.zones).forEach(([key, zone]) => {
    const zoneElement = document.getElementById(`tower-zone-${key}`);
    if (!zoneElement) return;
    const center = percentPointToSvg(zone.center);
    zoneElement.setAttribute('cx', center.x.toFixed(1));
    zoneElement.setAttribute('cy', center.y.toFixed(1));
    zoneElement.setAttribute('r', percentRadiusToSvg(zone.radius).toFixed(1));
  });

  refreshStoredMapPointPositions(rect);
  scheduleMapLabelLayout();
}

const inactivityTimeoutMs = Number(document.querySelector('meta[name="kiosk-timeout-ms"]')?.getAttribute('content') || '60000');
const inactivityWarningMs = Number(document.querySelector('meta[name="kiosk-warning-ms"]')?.getAttribute('content') || '10000');

const appShell = document.querySelector('.app-shell');
const sourceList = document.getElementById('source-list');
const suspectList = document.getElementById('suspect-list');
const suspectPanel = document.getElementById('suspect-panel');
const contextCard = document.getElementById('context-card');
const detailPanel = document.getElementById('detail-panel');
const timelineCard = document.getElementById('timeline-card');
const timelineEl = document.getElementById('timeline');
const timelineSummary = document.getElementById('timeline-summary');
const introCaseDescription = document.getElementById('intro-case-description');
const introBriefingCopy = document.getElementById('intro-briefing-copy');
const introBriefingStatus = document.getElementById('intro-briefing-status');
const introOutcome = document.getElementById('intro-outcome');
const introStepGrid = document.getElementById('intro-step-grid');
const mapLegend = document.getElementById('map-legend');
const mapCaption = document.getElementById('map-caption');
const progressRail = document.getElementById('progress-rail');
const conclusionGrid = document.getElementById('conclusion-grid');
const sourceInstruction = document.getElementById('source-instruction');
const timelineButton = document.querySelector('[data-action="build-timeline"]');
const conclusionButton = document.querySelector('[data-action="conclusion"]');
const homeButton = document.getElementById('home-button');
const mapStage = document.getElementById('map-stage');
const mapCanvas = document.getElementById('map-canvas');
const mapZoomValue = document.getElementById('map-zoom-value');
const mapCellularPanel = document.getElementById('map-cellular-panel');
const mapEntryOverlay = document.getElementById('map-entry-overlay');
const mapEntryStack = document.getElementById('map-entry-stack');
const coachOverlay = document.getElementById('coach-overlay');
const inactivityOverlay = document.getElementById('inactivity-overlay');
const inactivityCountdownValue = document.getElementById('inactivity-countdown-value');

const screens = {
  language: document.querySelector('[data-screen-panel="language"]'),
  intro: document.querySelector('[data-screen-panel="intro"]'),
  analysis: document.querySelector('[data-screen-panel="analysis"]'),
  conclusion: document.querySelector('[data-screen-panel="conclusion"]'),
};

const sourceOrder = ['phone', 'conversations', 'cellular', 'google'];
const progressOrder = [...sourceOrder];
const suspectOrder = ['karim', 'samir'];
const suspectContextSources = new Set([]);
const markerKeys = ['victim-house', 'neighbor-house', 'police-station', 'friend-house', 'karim-location'];
const routeKeys = ['phone', 'karim', 'samir', 'google'];
const zoneKeys = ['a', 'b', 'c'];
const towerKeys = ['a', 'b', 'c'];
const eventKeys = ['google-login', 'delete-attempt-1', 'delete-attempt-2', 'witness-call'];
const requiredConversationThreads = ['neighbor', 'karim', 'samir'];
const cellularSuspects = ['karim', 'samir'];
const COACH_STEP_DELAY_MS = 1000;
const COACH_TARGET_RETRY_MS = 140;
const COACH_MAX_TARGET_HEIGHT = 170;
const COACH_MAX_FRAME_WIDTH = 360;
const COACH_MAX_FRAME_HEIGHT = 150;

const coachSteps = {
  'phone.select': {
    selector: '[data-coach-anchor="source-phone"]',
    titleKey: 'analysis.coach.phoneSelect.title',
    bodyKey: 'analysis.coach.phoneSelect.body',
  },
  'conversations.select': {
    selector: '[data-coach-anchor="source-conversations"]',
    titleKey: 'analysis.coach.conversationsSelect.title',
    bodyKey: 'analysis.coach.conversationsSelect.body',
  },
  'conversations.karim': {
    selector: '#evidence-popup-conversations [data-coach-anchor="conversation-karim"]',
    titleKey: 'analysis.coach.conversationsKarim.title',
    bodyKey: 'analysis.coach.conversationsKarim.body',
  },
  'conversations.samir': {
    selector: '#evidence-popup-conversations [data-coach-anchor="conversation-samir"]',
    titleKey: 'analysis.coach.conversationsSamir.title',
    bodyKey: 'analysis.coach.conversationsSamir.body',
  },
  'cellular.select': {
    selector: '[data-coach-anchor="source-cellular"]',
    titleKey: 'analysis.coach.cellularSelect.title',
    bodyKey: 'analysis.coach.cellularSelect.body',
  },
  'cellular.karim.rows': {
    selector: '#map-cellular-panel [data-action="plot-cellular-path"][data-suspect="karim"]',
    titleKey: 'analysis.coach.cellularKarimRows.title',
    bodyKey: 'analysis.coach.cellularKarimRows.body',
  },
  'cellular.samir.tab': {
    selector: '#evidence-popup-cellular [data-coach-anchor="cellular-tab-samir"]',
    titleKey: 'analysis.coach.cellularSamirTab.title',
    bodyKey: 'analysis.coach.cellularSamirTab.body',
  },
  'cellular.samir.rows': {
    selector: '#map-cellular-panel [data-action="plot-cellular-path"][data-suspect="samir"]',
    titleKey: 'analysis.coach.cellularSamirRows.title',
    bodyKey: 'analysis.coach.cellularSamirRows.body',
  },
  'google.select': {
    selector: '[data-coach-anchor="source-google"]',
    titleKey: 'analysis.coach.googleSelect.title',
    bodyKey: 'analysis.coach.googleSelect.body',
  },
  'conclusion.select': {
    selector: '[data-coach-anchor="conclusion"]',
    titleKey: 'analysis.coach.conclusionSelect.title',
    bodyKey: 'analysis.coach.conclusionSelect.body',
  },
};

const defaultSourceEffects = {
  default: {
    markers: ['victim-house'],
    routes: [],
    zones: [],
    towers: [],
    events: [],
    captionKey: 'analysis.mapCaption.intro'
  },
  phone: {
    markers: ['victim-house', 'police-station'],
    routes: ['phone'],
    zones: [],
    towers: [],
    events: [],
    captionKey: 'analysis.mapCaption.phone'
  },
  cellular: {
    markers: ['victim-house', 'friend-house', 'karim-location'],
    routes: ['karim', 'samir'],
    zones: ['a', 'b', 'c'],
    towers: ['a', 'b', 'c'],
    events: [],
    captionKey: 'analysis.mapCaption.cellular'
  },
  google: {
    markers: ['victim-house', 'police-station', 'karim-location'],
    routes: [],
    zones: [],
    towers: [],
    events: ['google-login', 'delete-attempt-1', 'delete-attempt-2'],
    captionKey: 'analysis.mapCaption.google'
  },
  conversations: {
    markers: ['victim-house', 'neighbor-house', 'friend-house', 'karim-location'],
    routes: [],
    zones: [],
    towers: [],
    events: ['witness-call'],
    captionKey: 'analysis.mapCaption.conversations'
  },
  timeline: {
    markers: ['victim-house', 'neighbor-house', 'police-station', 'friend-house', 'karim-location'],
    routes: ['phone', 'karim', 'samir', 'google'],
    zones: ['a', 'b', 'c'],
    towers: ['a', 'b', 'c'],
    events: ['google-login', 'delete-attempt-1', 'delete-attempt-2', 'witness-call'],
    captionKey: 'analysis.mapCaption.timeline'
  }
};

let appData = {};
const state = createInitialState();
const openedPopups = new Set(); // keys of currently visible evidence popups
const loadedEvidenceSources = new Set();
let coachDelayStep = '';
let coachRevealAt = 0;
let coachDelayTimer = 0;
let mapEntryFrames = [];
let mapEntryPreloadPromise = Promise.resolve();
let mapEntryPlaybackToken = 0;
let hasPlayedMapEntry = false;
let mapView = { scale: 1, x: 0, y: 0 };
let activeMapPointers = new Map();
let mapGestureStart = null;
let mapViewAnimationTimer = 0;
let mapLabelLayoutFrame = 0;
let mapLabelLayer = null;
let mapLabelAnimationFrame = 0;
let mapLabelAnimationDeadline = 0;
let cellularPlotToken = 0;
const inactivityCountdownStart = Math.min(
  Math.max(1, Math.ceil(inactivityTimeoutMs / 1000)),
  Math.max(1, Math.ceil(inactivityWarningMs / 1000)),
);
const inactivityController = createInactivityController(state, inactivityTimeoutMs, () => {
  resetExperience('language');
}, {
  onTick: (remainingSeconds) => updateInactivityCountdown(remainingSeconds),
  onClear: () => hideInactivityCountdown(),
});

init();

async function init() {
  updateViewportMetrics();
  initKioskGuards();
  initMapEntryOverlay();
  await window.i18n?.ready;
  appData = await loadAppData(window.i18n?.data || {});
  renderStaticContent();
  bindActions();
  initMapViewInteractions();
  renderSources();
  renderSuspects();
  renderTimeline();
  applyMapConfig();
  applyState();
  startInactivityWatcher();
  initDevTools();
  window.addEventListener('resize', () => {
    updateViewportMetrics();
    applyMapView();
    applyAllMarkersFromConfig();
    document.querySelectorAll('.evidence-popup').forEach((popup) => constrainPopupToContainer(popup));
    renderCoachOverlay();
  });
  window.addEventListener('i18n:changed', () => {
    void handleLanguageChange();
  });
}

async function handleLanguageChange() {
  appData = await loadAppData(window.i18n?.data || {});
  renderStaticContent();
  renderSources();
  renderSuspects();
  renderTimeline();
  applyState();
  renderCoachOverlay();
}

function translate(key, vars, fallback = key) {
  const value = window.i18n?.t?.(key, vars);
  return value && value !== key ? value : fallback;
}

function evidenceText(key, fallback, vars) {
  return translate(`evidenceUi.${key}`, vars, fallback);
}

function evidenceLabel(id) {
  return evidenceText('common.evidenceLabel', `EVIDENCE ${id}`, { id });
}

function getSuspectFirstName(suspect) {
  const fallback = suspect === 'samir' ? 'Samir' : 'Karim';
  return evidenceText(`conversations.tabs.${suspect}`, fallback);
}

async function chooseLanguage(lang) {
  const nextLang = String(lang || '').trim().toLowerCase();
  if (!nextLang) return;

  mapPhoneTracking?.reset();

  if (window.i18n?.setLang) {
    await window.i18n.setLang(nextLang);
  }

  appData = await loadAppData(window.i18n?.data || {});

  state.screen = 'intro';
  state.hasStarted = false;
  renderStaticContent();
  applyState();
}

function updateInactivityCountdown(remainingSeconds) {
  if (!inactivityOverlay || state.screen === 'language') return;
  if (remainingSeconds > inactivityCountdownStart) {
    hideInactivityCountdown();
    return;
  }

  if (inactivityCountdownValue) {
    inactivityCountdownValue.textContent = String(Math.max(0, remainingSeconds));
  }
  inactivityOverlay.classList.add('is-visible');
  inactivityOverlay.setAttribute('aria-hidden', 'false');
}

function hideInactivityCountdown() {
  if (!inactivityOverlay) return;
  inactivityOverlay.classList.remove('is-visible');
  inactivityOverlay.setAttribute('aria-hidden', 'true');
}

function formatCaseTimestampLabel(rawValue = '') {
  const normalized = normalizeCaseTimestampLabel(rawValue);
  const match = normalized.match(/^May\s+(\d{1,2})(?:\s+(\d{2}:\d{2}))?$/i);
  if (!match) return normalized;

  const vars = { day: match[1], time: match[2] || '' };
  return translate(match[2] ? 'time.mayDateTime' : 'time.mayDate', vars, normalized);
}

function getWorkflow() {
  if (!state.workflow) {
    state.workflow = createInitialWorkflowState();
  }
  return state.workflow;
}

function resetWorkflow() {
  state.workflow = createInitialWorkflowState();
  resetCoachDelay();
}

function isWorkflowBusy() {
  const workflow = getWorkflow();
  return Boolean(workflow.loadingEvidenceKey || workflow.plottingCellularPath);
}

function isSourceUnlocked(key) {
  return getWorkflow().unlockedSources.has(key);
}

function unlockSource(key) {
  if (sourceOrder.includes(key)) {
    getWorkflow().unlockedSources.add(key);
  }
}

function revealSource(key) {
  if (!sourceOrder.includes(key)) return;
  state.revealedSources.add(key);
  getWorkflow().revealedFacts.add(`source:${key}`);
}

function isSourceCompleted(key) {
  return getWorkflow().completedSources.has(key);
}

function setCoachStep(stepKey) {
  const workflow = getWorkflow();
  if (workflow.currentStep !== stepKey) {
    resetCoachDelay();
  }
  workflow.currentStep = stepKey;
  requestAnimationFrame(renderCoachOverlay);
}

function completeSource(key) {
  const workflow = getWorkflow();
  const wasCompleted = workflow.completedSources.has(key);
  workflow.completedSources.add(key);
  revealSource(key);

  if (key === 'phone') {
    unlockSource('conversations');
    setCoachStep('conversations.select');
  } else if (key === 'conversations') {
    unlockSource('cellular');
    setCoachStep('cellular.select');
  } else if (key === 'cellular') {
    unlockSource('google');
    setCoachStep('google.select');
  } else if (key === 'google') {
    setCoachStep('conclusion.select');
  }

  if (!wasCompleted) {
    renderTimeline(key);
  }
}

function getViewedConversationThreads() {
  return getWorkflow().viewedConversationThreads;
}

function allConversationThreadsViewed() {
  const viewed = getViewedConversationThreads();
  return requiredConversationThreads.every((key) => viewed.has(key));
}

function markConversationThreadViewed(threadKey) {
  if (!requiredConversationThreads.includes(threadKey)) return;

  const workflow = getWorkflow();
  workflow.viewedConversationThreads.add(threadKey);
  workflow.revealedFacts.add(`conversation:${threadKey}`);
  revealSource('conversations');

  if (allConversationThreadsViewed()) {
    completeSource('conversations');
    return;
  }

  if (!workflow.viewedConversationThreads.has('karim')) {
    setCoachStep('conversations.karim');
  } else if (!workflow.viewedConversationThreads.has('samir')) {
    setCoachStep('conversations.samir');
  }
}

function getPlottedCellPingSet(suspect) {
  const workflow = getWorkflow();
  if (!workflow.plottedCellPings[suspect]) {
    workflow.plottedCellPings[suspect] = new Set();
  }
  return workflow.plottedCellPings[suspect];
}

function isCellularPingPlotted(suspect, pingId) {
  return getPlottedCellPingSet(suspect).has(String(pingId));
}

function isCellularPathComplete(suspect) {
  return getPlottedCellPingSet(suspect).size >= (CELL_PINGS[suspect] || []).length;
}

function allCellularPathsComplete() {
  return cellularSuspects.every((suspect) => isCellularPathComplete(suspect));
}

function markCellularPingPlotted(suspect, pingId) {
  const workflow = getWorkflow();
  getPlottedCellPingSet(suspect).add(String(pingId));
  workflow.revealedFacts.add(`cellular:${suspect}:${pingId}`);
  revealSource('cellular');

  if (isCellularPathComplete(suspect)) {
    workflow.completedCellularPaths.add(suspect);
    workflow.revealedFacts.add(`cellular-path:${suspect}`);
  }

  if (allCellularPathsComplete()) {
    completeSource('cellular');
    return;
  }

  if (isCellularPathComplete('karim') && !isCellularPathComplete('samir')) {
    setCoachStep(state.selectedSuspect === 'samir' ? 'cellular.samir.rows' : 'cellular.samir.tab');
  } else if (!isCellularPathComplete('karim')) {
    setCoachStep('cellular.karim.rows');
  } else {
    setCoachStep('cellular.samir.rows');
  }
}

function shouldShowTimelineItem(item) {
  const workflow = getWorkflow();
  if (state.selectedSource === 'timeline') return true;

  switch (item.id) {
    case 'phone-secured':
      return workflow.completedSources.has('phone');
    case 'neighbor-text':
    case 'neighbor-call':
      return workflow.viewedConversationThreads.has('neighbor');
    case 'samir-message':
      return workflow.viewedConversationThreads.has('samir');
    case 'karim-leaves':
      return workflow.completedCellularPaths.has('karim');
    case 'samir-leaves':
      return workflow.completedCellularPaths.has('samir');
    case 'google-login':
    case 'delete-one':
    case 'delete-two':
      return workflow.completedSources.has('google') || workflow.revealedFacts.has('source:google');
    default:
      return workflow.completedSources.has(item.source);
  }
}

function clearCoachTarget() {
  document.querySelectorAll('.is-coach-target').forEach((element) => {
    element.classList.remove('is-coach-target');
    delete element.dataset.coachCurrentStep;
  });
}

function hideCoachOverlay() {
  if (!coachOverlay) return;
  clearCoachTarget();
  coachOverlay.classList.remove('is-visible');
  coachOverlay.setAttribute('aria-hidden', 'true');
  coachOverlay.innerHTML = '';
}

function resetCoachDelay() {
  coachDelayStep = '';
  coachRevealAt = 0;
  if (coachDelayTimer) {
    clearTimeout(coachDelayTimer);
    coachDelayTimer = 0;
  }
}

function scheduleCoachRender(delayMs) {
  if (coachDelayTimer) clearTimeout(coachDelayTimer);
  coachDelayTimer = setTimeout(() => {
    coachDelayTimer = 0;
    renderCoachOverlay();
  }, Math.max(0, delayMs));
}

function getBaseMapTransform() {
  return `scale(${MAP_CONFIG.zoom}) translate(${MAP_CONFIG.offsetX}%, ${MAP_CONFIG.offsetY}%)`;
}

function getMapStageRect() {
  return mapStage?.getBoundingClientRect() || null;
}

function clampMapView(nextView = mapView) {
  const rect = getMapStageRect();
  const scale = clamp(nextView.scale || 1, MAP_VIEW_LIMITS.minScale, MAP_VIEW_LIMITS.maxScale);
  const limitX = rect ? Math.max(0, (rect.width * (scale - 1)) / 2) : 0;
  const limitY = rect ? Math.max(0, (rect.height * (scale - 1)) / 2) : 0;

  return {
    scale,
    x: clamp(nextView.x || 0, -limitX, limitX),
    y: clamp(nextView.y || 0, -limitY, limitY),
  };
}

function updateMapControls() {
  const zoomed = mapView.scale > MAP_VIEW_LIMITS.minScale + 0.01 ||
    Math.abs(mapView.x) > 0.5 ||
    Math.abs(mapView.y) > 0.5;

  if (mapZoomValue) {
    mapZoomValue.value = `${Math.round(mapView.scale * 100)}%`;
    mapZoomValue.textContent = mapZoomValue.value;
  }

  document.querySelectorAll('[data-map-control]').forEach((button) => {
    const control = button.dataset.mapControl;
    if (control === 'zoom-in') {
      button.disabled = mapView.scale >= MAP_VIEW_LIMITS.maxScale - 0.01;
    } else if (control === 'zoom-out') {
      button.disabled = mapView.scale <= MAP_VIEW_LIMITS.minScale + 0.01;
    } else if (control === 'reset') {
      button.disabled = !zoomed;
    }
  });

  if (appShell) {
    appShell.dataset.mapZoomed = zoomed ? 'true' : 'false';
  }
}

function applyMapView({ animate = false } = {}) {
  if (!mapCanvas) return;

  mapView = clampMapView(mapView);

  if (animate) {
    mapCanvas.classList.add('is-map-view-animating');
    if (mapViewAnimationTimer) clearTimeout(mapViewAnimationTimer);
    syncMapLabelsDuringAnimation(MAP_VIEW_ANIMATION_MS + 80);
    mapViewAnimationTimer = setTimeout(() => {
      mapCanvas.classList.remove('is-map-view-animating');
      mapViewAnimationTimer = 0;
      stopMapLabelAnimationSync();
      scheduleMapLabelLayout();
    }, MAP_VIEW_ANIMATION_MS);
  } else {
    mapCanvas.classList.remove('is-map-view-animating');
    stopMapLabelAnimationSync();
  }

  mapCanvas.style.transformOrigin = 'center center';
  syncMapUiScale();
  mapCanvas.style.transform = `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.scale}) ${getBaseMapTransform()}`;
  updateMapControls();
  scheduleMapLabelLayout();
}

function setMapView(nextView, options) {
  mapView = clampMapView({ ...mapView, ...nextView });
  applyMapView(options);
}

function setMapScaleAt(nextScale, focalPoint, options = {}) {
  const rect = getMapStageRect();
  const current = clampMapView(mapView);
  const scale = clamp(nextScale, MAP_VIEW_LIMITS.minScale, MAP_VIEW_LIMITS.maxScale);
  if (!rect || !focalPoint || current.scale === 0) {
    setMapView({ scale }, options);
    return;
  }

  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const ratio = scale / current.scale;
  const x = (focalPoint.x - originX) - ((focalPoint.x - originX - current.x) * ratio);
  const y = (focalPoint.y - originY) - ((focalPoint.y - originY - current.y) * ratio);

  setMapView({ scale, x, y }, options);
}

function resetMapView(options = {}) {
  activeMapPointers.clear();
  mapGestureStart = null;
  mapStage?.classList.remove('is-panning');
  mapView = { scale: 1, x: 0, y: 0 };
  applyMapView(options);
}

function focusMapOnPercentPoint(point, { scale = 1.72, animate = true } = {}) {
  const stageRect = getMapStageRect();
  const imageRect = getImageRenderedRect();
  if (!stageRect || !imageRect || !point) return;

  const targetX = imageRect.x + (point.left / 100) * imageRect.w;
  const targetY = imageRect.y + (point.top / 100) * imageRect.h;
  const nextScale = clamp(scale, MAP_VIEW_LIMITS.minScale, MAP_VIEW_LIMITS.maxScale);
  const centerX = stageRect.width / 2;
  const centerY = stageRect.height / 2;
  const desiredX = stageRect.width * 0.56;
  const desiredY = stageRect.height * 0.48;

  setMapView({
    scale: nextScale,
    x: desiredX - centerX - ((targetX - centerX) * nextScale),
    y: desiredY - centerY - ((targetY - centerY) * nextScale),
  }, { animate });
}

function shouldIgnoreMapGestureTarget(target) {
  return Boolean(target?.closest?.('.map-controls, button, input, textarea, select, a, [data-action]'));
}

function getPointerPair() {
  const pointers = [...activeMapPointers.values()];
  if (pointers.length < 2) return null;
  const [a, b] = pointers;
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  return { center, distance };
}

function beginMapPan(pointer) {
  mapGestureStart = {
    mode: 'pan',
    pointer,
    view: { ...mapView },
  };
  mapStage?.classList.add('is-panning');
}

function beginMapPinch(pair) {
  if (!pair) return;
  mapGestureStart = {
    mode: 'pinch',
    center: pair.center,
    distance: pair.distance,
    view: { ...mapView },
  };
  mapStage?.classList.add('is-panning');
}

function handleMapPointerDown(event) {
  if (!mapStage || shouldIgnoreMapGestureTarget(event.target)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try {
    mapStage.setPointerCapture?.(event.pointerId);
  } catch {
    // Some kiosk WebViews can deny capture after a cancelled touch sequence.
  }
  mapCanvas?.classList.remove('is-map-view-animating');

  const pair = getPointerPair();
  if (pair) {
    beginMapPinch(pair);
  } else {
    beginMapPan({ id: event.pointerId, x: event.clientX, y: event.clientY });
  }

  resetInactivityTimer();
  event.preventDefault();
}

function handleMapPointerMove(event) {
  if (!activeMapPointers.has(event.pointerId) || !mapGestureStart) return;

  activeMapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (mapGestureStart.mode === 'pinch') {
    const pair = getPointerPair();
    const rect = getMapStageRect();
    if (!pair || !rect) return;

    const nextScale = mapGestureStart.view.scale * (pair.distance / mapGestureStart.distance);
    const scale = clamp(nextScale, MAP_VIEW_LIMITS.minScale, MAP_VIEW_LIMITS.maxScale);
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const ratio = scale / mapGestureStart.view.scale;
    const x = (pair.center.x - originX) - ((mapGestureStart.center.x - originX - mapGestureStart.view.x) * ratio);
    const y = (pair.center.y - originY) - ((mapGestureStart.center.y - originY - mapGestureStart.view.y) * ratio);
    setMapView({ scale, x, y });
  } else {
    const dx = event.clientX - mapGestureStart.pointer.x;
    const dy = event.clientY - mapGestureStart.pointer.y;
    setMapView({
      x: mapGestureStart.view.x + dx,
      y: mapGestureStart.view.y + dy,
    });
  }

  resetInactivityTimer();
  event.preventDefault();
}

function finishMapPointer(event) {
  if (!activeMapPointers.has(event.pointerId)) return;
  activeMapPointers.delete(event.pointerId);
  try {
    if (mapStage?.hasPointerCapture?.(event.pointerId)) {
      mapStage.releasePointerCapture(event.pointerId);
    }
  } catch {
    // Capture can already be cleared by the browser on cancel/lostcapture.
  }

  const pair = getPointerPair();
  if (pair) {
    beginMapPinch(pair);
    return;
  }

  const remaining = [...activeMapPointers.entries()][0];
  if (remaining) {
    const [id, point] = remaining;
    beginMapPan({ id, ...point });
  } else {
    mapGestureStart = null;
    mapStage?.classList.remove('is-panning');
  }
}

function handleMapWheel(event) {
  if (!mapStage || shouldIgnoreMapGestureTarget(event.target)) return;
  const nextScale = mapView.scale * Math.exp(-event.deltaY * MAP_VIEW_LIMITS.wheelSpeed);
  setMapScaleAt(nextScale, { x: event.clientX, y: event.clientY }, { animate: true });
  resetInactivityTimer();
  event.preventDefault();
}

function handleMapDoubleClick(event) {
  if (shouldIgnoreMapGestureTarget(event.target)) return;
  const nextScale = mapView.scale > 1.65 ? MAP_VIEW_LIMITS.minScale : Math.min(mapView.scale + 0.72, MAP_VIEW_LIMITS.maxScale);
  setMapScaleAt(nextScale, { x: event.clientX, y: event.clientY }, { animate: true });
  resetInactivityTimer();
  event.preventDefault();
}

function handleMapControlClick(event) {
  const control = event.currentTarget?.dataset?.mapControl;
  const rect = getMapStageRect();
  const center = rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : null;

  if (control === 'zoom-in') {
    setMapScaleAt(mapView.scale + MAP_VIEW_LIMITS.buttonStep, center, { animate: true });
  } else if (control === 'zoom-out') {
    setMapScaleAt(mapView.scale - MAP_VIEW_LIMITS.buttonStep, center, { animate: true });
  } else if (control === 'reset') {
    resetMapView({ animate: true });
  }

  resetInactivityTimer();
}

function initMapViewInteractions() {
  if (!mapStage || !mapCanvas) return;
  mapStage.addEventListener('pointerdown', handleMapPointerDown);
  mapStage.addEventListener('pointermove', handleMapPointerMove);
  mapStage.addEventListener('pointerup', finishMapPointer);
  mapStage.addEventListener('pointercancel', finishMapPointer);
  mapStage.addEventListener('lostpointercapture', finishMapPointer);
  mapStage.addEventListener('wheel', handleMapWheel, { passive: false });
  mapStage.addEventListener('dblclick', handleMapDoubleClick);
  document.querySelectorAll('[data-map-control]').forEach((button) => {
    button.addEventListener('click', handleMapControlClick);
  });
  applyMapView();
}

function isMapEntryPlaying() {
  return appShell.dataset.mapEntry === 'playing' || mapEntryOverlay?.classList.contains('is-active');
}

function syncCoachMarkers(stepKey, phase) {
  appShell.dataset.workflowStep = stepKey || '';
  appShell.dataset.coachStep = stepKey || '';
  appShell.dataset.coachPhase = phase || 'hidden';
  if (coachOverlay) {
    coachOverlay.dataset.step = stepKey || '';
    coachOverlay.dataset.phase = phase || 'hidden';
  }
}

function getCoachTargetRect(element) {
  if (!element || !element.isConnected) return null;
  if (element.matches?.('.evidence-popup, .evidence-frame, .evidence-popups')) return null;
  if (element.closest?.('[hidden], [aria-hidden="true"]')) return null;

  for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
    const styles = getComputedStyle(current);
    const opacity = Number.parseFloat(styles.opacity);
    if (styles.display === 'none' || styles.visibility === 'hidden') return null;
    if (Number.isFinite(opacity) && opacity <= 0.02) return null;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null;

  const maxTargetHeight = Math.max(96, Math.min(COACH_MAX_TARGET_HEIGHT, window.innerHeight * 0.24));
  if (rect.height > maxTargetHeight) return null;

  return rect;
}

function getCoachTarget(step) {
  if (!step?.selector) return null;
  const candidates = Array.from(document.querySelectorAll(step.selector));
  for (const element of candidates) {
    const rect = getCoachTargetRect(element);
    if (rect) return { element, rect };
  }
  return null;
}

function renderCoachOverlay() {
  if (!coachOverlay) return;

  clearCoachTarget();

  const workflow = getWorkflow();
  const stepKey = workflow.currentStep;
  const step = coachSteps[stepKey];
  syncCoachMarkers(stepKey, 'checking');
  const shouldShow = state.screen === 'analysis' && step && !isWorkflowBusy() && !isMapEntryPlaying();

  if (!shouldShow) {
    syncCoachMarkers(stepKey, 'hidden');
    hideCoachOverlay();
    resetCoachDelay();
    return;
  }

  const now = Date.now();
  if (coachDelayStep !== stepKey) {
    coachDelayStep = stepKey;
    coachRevealAt = now + COACH_STEP_DELAY_MS;
  }

  if (coachRevealAt > now) {
    syncCoachMarkers(stepKey, 'waiting');
    hideCoachOverlay();
    scheduleCoachRender(coachRevealAt - now);
    return;
  }

  const resolvedTarget = getCoachTarget(step);

  if (!resolvedTarget) {
    syncCoachMarkers(stepKey, 'missing-target');
    hideCoachOverlay();
    scheduleCoachRender(COACH_TARGET_RETRY_MS);
    return;
  }

  const { element: target, rect } = resolvedTarget;
  const popup = target.closest?.('.evidence-popup');
  if (popup?.querySelector('.ev-loading:not(.is-done)')) {
    syncCoachMarkers(stepKey, 'blocked-loading');
    hideCoachOverlay();
    resetCoachDelay();
    return;
  }

  target.classList.add('is-coach-target');
  target.dataset.coachCurrentStep = stepKey;

  const framePadding = 12;
  const targetCenterX = rect.left + rect.width / 2;
  const targetCenterY = rect.top + rect.height / 2;
  const frameWidth = Math.min(Math.max(rect.width + framePadding * 2, 42), COACH_MAX_FRAME_WIDTH, window.innerWidth - 24);
  const frameHeight = Math.min(Math.max(rect.height + framePadding * 2, 34), COACH_MAX_FRAME_HEIGHT, window.innerHeight - 24);

  coachOverlay.style.setProperty('--coach-x', `${targetCenterX}px`);
  coachOverlay.style.setProperty('--coach-y', `${targetCenterY}px`);
  coachOverlay.style.setProperty('--coach-w', `${frameWidth}px`);
  coachOverlay.style.setProperty('--coach-h', `${frameHeight}px`);

  coachOverlay.innerHTML = `
    <div class="coach-overlay__sweep" aria-hidden="true"></div>
  `;

  coachOverlay.classList.add('is-visible');
  coachOverlay.setAttribute('aria-hidden', 'false');
  syncCoachMarkers(stepKey, 'visible');
}

function refreshWorkflowUi(newTimelineSource = '') {
  renderSources();
  renderSuspects();
  renderTimeline(newTimelineSource);
  applyProgress();
  applyMapEffects();
  renderMapCellularPanel();
  renderCoachOverlay();
}

function initMapEntryOverlay() {
  if (!mapEntryStack) return;
  const totalEntryDuration = MAP_ENTRY_SEQUENCE.reduce((sum, frame) => sum + (frame.hold || 0), MAP_ENTRY_FADE_OUT_MS);
  mapEntryStack.innerHTML = MAP_ENTRY_SEQUENCE.map((frame, index) => `
    <img
      class="map-entry-frame"
      data-map-entry-index="${index}"
      src="${frame.src}"
      alt=""
      draggable="false"
    >
  `).join('');
  mapEntryOverlay?.style.setProperty('--map-entry-duration', `${totalEntryDuration}ms`);
  mapEntryFrames = Array.from(mapEntryStack.querySelectorAll('.map-entry-frame'));
  mapEntryFrames.forEach((frame, index) => {
    frame.style.setProperty('--entry-start-scale', String(MAP_ENTRY_SEQUENCE[index]?.scale || 1.08));
    frame.style.setProperty('--entry-start-x', MAP_ENTRY_SEQUENCE[index]?.x || '0%');
    frame.style.setProperty('--entry-start-y', MAP_ENTRY_SEQUENCE[index]?.y || '0%');
    frame.style.zIndex = String(index + 1);
  });
  mapEntryPreloadPromise = Promise.all(mapEntryFrames.map((frame) => {
    if (frame.complete && frame.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const finalize = () => resolve();
      frame.addEventListener('load', finalize, { once: true });
      frame.addEventListener('error', finalize, { once: true });
    });
  }));
}

function isReducedMotionPreferred() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldBlockKioskShortcut(event) {
  const key = String(event.key || '').toLowerCase();

  if (event.key === 'F5' || event.key === 'F11' || event.key === 'F12') return true;
  if (event.key === 'ContextMenu' || event.key === 'BrowserBack' || event.key === 'BrowserForward') return true;
  if (event.altKey && (key === 'arrowleft' || key === 'arrowright' || key === 'home')) return true;

  if (event.ctrlKey || event.metaKey) {
    if (['r', 'p', 's', 'u', 'n', 't', 'w', '+', '-', '=', '0'].includes(key)) return true;
  }

  if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key)) return true;

  return false;
}

function initKioskGuards() {
  if (isDevToolsEnabled) return;

  document.documentElement.classList.add('is-kiosk');
  document.body.classList.add('is-kiosk');

  const suppress = (event) => {
    if (event.cancelable) event.preventDefault();
  };

  ['contextmenu', 'selectstart', 'dragstart', 'dragover', 'drop', 'copy', 'cut', 'paste'].forEach((eventName) => {
    document.addEventListener(eventName, suppress);
  });

  document.addEventListener('auxclick', (event) => {
    if (event.button !== 0) suppress(event);
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) suppress(event);
  }, { passive: false });

  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey) suppress(event);
  }, { passive: false });

  ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    window.addEventListener(eventName, suppress, { passive: false });
  });

  window.addEventListener('keydown', (event) => {
    if (!shouldBlockKioskShortcut(event)) return;
    suppress(event);
    event.stopPropagation();
  }, true);
}

function resetMapEntryFrames() {
  mapEntryFrames.forEach((frame) => frame.classList.remove('is-active'));
}

function cancelMapEntryAnimation({ resetPlayed = false } = {}) {
  mapEntryPlaybackToken += 1;
  if (resetPlayed) hasPlayedMapEntry = false;
  resetMapEntryFrames();
  mapEntryOverlay?.classList.remove('is-active', 'is-exiting');
  delete appShell.dataset.mapEntry;
}

async function playMapEntryAnimation() {
  if (!mapEntryOverlay || !mapEntryFrames.length || hasPlayedMapEntry || state.screen !== 'analysis') return;

  hideCoachOverlay();
  resetCoachDelay();

  if (isReducedMotionPreferred()) {
    hasPlayedMapEntry = true;
    cancelMapEntryAnimation();
    renderCoachOverlay();
    return;
  }

  hasPlayedMapEntry = true;
  const playbackToken = ++mapEntryPlaybackToken;
  appShell.dataset.mapEntry = 'playing';
  mapEntryOverlay.classList.remove('is-exiting');
  mapEntryOverlay.classList.add('is-active');
  resetMapEntryFrames();

  await mapEntryPreloadPromise;
  if (playbackToken !== mapEntryPlaybackToken || state.screen !== 'analysis') return;

  for (let index = 0; index < mapEntryFrames.length; index += 1) {
    mapEntryFrames.forEach((frame, frameIndex) => {
      frame.classList.toggle('is-active', frameIndex === index);
    });
    await wait(MAP_ENTRY_SEQUENCE[index]?.hold || 180);
    if (playbackToken !== mapEntryPlaybackToken || state.screen !== 'analysis') return;
  }

  mapEntryOverlay.classList.add('is-exiting');
  await wait(MAP_ENTRY_FADE_OUT_MS);
  if (playbackToken !== mapEntryPlaybackToken) return;

  resetMapEntryFrames();
  mapEntryOverlay.classList.remove('is-active', 'is-exiting');
  delete appShell.dataset.mapEntry;
  renderCoachOverlay();
}

function getData() {
  return appData;
}

function getCharacterName(key, fallback = '') {
  return getData().characters?.[key]?.name || fallback;
}

function normalizeCaseTimestampLabel(rawValue = '') {
  const normalized = String(rawValue || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (/^May\s+\d{1,2}(?:\s+\d{1,2}:\d{2})?$/i.test(normalized)) return normalized;

  const timeMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return normalized;

  const hours = Number(timeMatch[1]);
  const minutes = timeMatch[2];
  const day = hours < 12 ? 18 : 17;
  return `May ${day} ${String(hours).padStart(2, '0')}:${minutes}`;
}

function getCaseDateTimeSortValue(rawValue = '') {
  const normalized = normalizeCaseTimestampLabel(rawValue);
  const match = normalized.match(/^May\s+(\d{1,2})(?:\s+(\d{2}):(\d{2}))?$/i);
  if (!match) return Number.NEGATIVE_INFINITY;

  const day = Number(match[1]);
  const hours = Number(match[2] || '0');
  const minutes = Number(match[3] || '0');
  return Date.UTC(2024, 4, day, hours, minutes);
}

function sortCaseDateTimeEntries(items = [], getValue = (item) => item?.time, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...items].sort((left, right) => {
    const leftValue = getCaseDateTimeSortValue(getValue(left));
    const rightValue = getCaseDateTimeSortValue(getValue(right));
    return (leftValue - rightValue) * factor;
  });
}

function getChronologySortValue(time = '') {
  const match = String(time).match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return (hours * 60) + minutes;
}

function sortChronologyEntries(items = []) {
  return [...items].sort((left, right) => getChronologySortValue(left?.time) - getChronologySortValue(right?.time));
}

function renderStaticContent() {
  const data = getData();
  const caseId = document.querySelector('[data-bind="case-id"]');
  const caseLocation = document.querySelector('[data-bind="case-location"]');

  if (caseId) caseId.textContent = data.case?.id || 'RB-17-042';
  if (caseLocation) caseLocation.textContent = data.case?.location || 'Rabat, Morocco';

  renderIntroContent(data);

  mapLegend.innerHTML = [
    { tone: 'location', label: translate('legend.location') },
    { tone: 'route', label: translate('legend.route') },
    { tone: 'network', label: translate('legend.network') },
    { tone: 'alert', label: translate('legend.alert') },
  ].map((item) => `
      <span class="legend-pill legend-pill--${item.tone}">
        <i></i>
        <span>${escapeHtml(item.label)}</span>
      </span>
    `).join('');

  conclusionGrid.innerHTML = (data.conclusion?.cards || [])
    .map((item) => `
      <article class="conclusion-card">
        <h3>${escapeHtml(item.title || '')}</h3>
        <p>${escapeHtml(item.body || '')}</p>
      </article>
    `).join('');

  if (timelineSummary) {
    const focusLabel = state.currentTimelineFocus
      ? getData().sources?.[state.currentTimelineFocus]?.label || ''
      : '';
    const focusLine = focusLabel ? ` ${translate('timeline.focusSummary', { source: focusLabel }, '')}` : '';
    timelineSummary.textContent = `${translate('timeline.summary')}${focusLine}`.trim();
  }
}

function renderIntroContent(data) {
  const intro = data.intro || {};
  const farady = (intro.description || [])[1] || '';

  // Legacy DOM refs (may be absent in new layout) — still update if present.
  if (introCaseDescription) {
    const briefDescription = (intro.description || []).slice(0, 2);
    introCaseDescription.innerHTML = briefDescription
      .map((item) => `<p>${escapeHtml(item)}</p>`)
      .join('');
  }
  if (introBriefingCopy) {
    const integrityNotes = (intro.secureCard?.paragraphs || []).slice(0, 2);
    introBriefingCopy.innerHTML = integrityNotes
      .map((item) => `<p>${escapeHtml(item)}</p>`)
      .join('');
  }
  if (introBriefingStatus) {
    introBriefingStatus.textContent = intro.secureCard?.status || '';
  }
  if (introOutcome) {
    introOutcome.textContent = intro.description?.[2] || '';
  }

  // New layout — short Faraday brief under the Rabat map preview.
  const faradayBriefEl = document.getElementById('intro-faraday-brief');
  if (faradayBriefEl) {
    faradayBriefEl.textContent = farady;
  }

  if (introStepGrid) {
    const steps = [
      {
        key: '01',
        title: translate('intro.tutorial.step1Title'),
        text: translate('intro.briefing.step1Body', undefined, '')
      },
      {
        key: '02',
        title: translate('intro.tutorial.step2Title'),
        text: translate('intro.briefing.step2Body', undefined, '')
      },
      {
        key: '03',
        title: translate('intro.tutorial.step3Title'),
        text: translate('intro.briefing.step3Body', undefined, '')
      },
      {
        key: '04',
        title: translate('intro.tutorial.step4Title'),
        text: translate('intro.briefing.step4Body', undefined, '')
      }
    ];

    introStepGrid.innerHTML = steps.map((step) => `
      <article class="intro-step-card">
        <p class="intro-step-card__index">${step.key}</p>
        <h3>${escapeHtml(step.title)}</h3>
        <p>${escapeHtml(step.text)}</p>
      </article>
    `).join('');
  }
}

function isSourceReachable(key) {
  return isSourceUnlocked(key);
}

function renderSources() {
  const workflowBusy = isWorkflowBusy();

  sourceList.innerHTML = sourceOrder.map((key, index) => {
    const item = getData().sources?.[key] || {};
    const isSelected = state.selectedSource === key;
    const isCompleted = isSourceCompleted(key);
    const isReachable = isSourceReachable(key);
    const isLocked = !isReachable || workflowBusy;
    const isReady = isReachable && !workflowBusy && !isCompleted && !isSelected;

    return `
      <button
        class="source-button${isSelected ? ' is-active' : ''}${isLocked ? ' is-locked' : ''}${isReady ? ' is-ready' : ''}${isCompleted ? ' is-completed' : ''}${workflowBusy ? ' is-busy' : ''}"
        type="button"
        data-action="select-source"
        data-source="${key}"
        data-coach-anchor="source-${key}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
        ${isLocked ? 'disabled' : ''}
        ${workflowBusy ? 'aria-busy="true"' : ''}
      >
        <span class="source-button__index">0${index + 1}</span>
        <span class="source-button__content">
          <strong>${escapeHtml(item.label || key)}</strong>
          <small>${escapeHtml(item.hint || '')}</small>
        </span>
        <span class="source-button__status${isCompleted ? ' is-revealed' : ''}"></span>
      </button>
    `;
  }).join('');
}

function renderSuspects() {
  suspectList.innerHTML = suspectOrder.map((key) => {
    const item = getData().suspects?.[key] || {};
    const isSelected = state.selectedSuspect === key;

    return `
      <button
        class="suspect-button${isSelected ? ' is-active' : ''}"
        type="button"
        data-action="select-suspect"
        data-suspect="${key}"
        aria-pressed="${isSelected ? 'true' : 'false'}"
      >
        <strong>${escapeHtml(item.label || key)}</strong>
        <small>${escapeHtml(item.hint || '')}</small>
      </button>
    `;
  }).join('');
}

function renderTimeline(newSourceKey = '') {
  const data = getData();
  const items = data.timelineItems || [];
  const isTimelineOpen = state.selectedSource === 'timeline';
  const timelineFocus = isTimelineOpen ? state.currentTimelineFocus : '';

  let enterIdx = 0;

  // Per design: build the sequence as the user discovers each source.
  // Render only items already available.
  const visibleItems = sortChronologyEntries(items.filter((item) => shouldShowTimelineItem(item)));

  if (!visibleItems.length) {
    timelineEl.innerHTML = `
      <div class="timeline-empty">
        <p>${escapeHtml(translate('timeline.labels.locked', undefined, 'Reveal a source to start building the sequence.'))}</p>
      </div>
    `;
    return;
  }

  timelineEl.innerHTML = visibleItems.map((item) => {
    const isNew = Boolean(newSourceKey) && item.source === newSourceKey;
    const tagKey = item.tag || item.source;
    const tagLabel = translate(`timeline.sourceTags.${tagKey}`, undefined, tagKey);
    const isHighlighted = Boolean(timelineFocus) && (
      item.source === timelineFocus ||
      (timelineFocus === 'conversations' && item.tag === 'witness')
    );

    const enterClass = isNew ? ' is-entering' : '';
    const enterDelay = isNew ? ` style="animation-delay:${enterIdx++ * 0.11}s"` : '';
    const evidenceKey = sourceOrder.includes(item.source) ? item.source : '';
    const clickAttrs = evidenceKey
      ? ` data-action="open-evidence" data-evidence="${evidenceKey}"`
      : '';

    return `
      <article class="timeline-item is-available${isHighlighted ? ' is-highlighted' : ''}${enterClass}" data-source="${escapeHtml(item.source || '')}"${enterDelay}${clickAttrs}>
        <span class="timeline-item__time">${escapeHtml(item.time || '')}</span>
        <div class="timeline-item__body">
          <div class="timeline-item__meta">
            <strong>${escapeHtml(item.label || '')}</strong>
          </div>
          <span class="timeline-item__tag">${escapeHtml(tagLabel)}</span>
        </div>
      </article>
    `;
  }).join('');
}

function bindActions() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;

    if (action === 'choose-language') {
      void chooseLanguage(button.dataset.langChoice || 'en');
      return;
    }

    if (action === 'home') {
      resetExperience('language');
      return;
    }

    if (action === 'start') {
      if (mapPhoneTracking && !mapPhoneTracking.hasStarted()) {
        void mapPhoneTracking.start(0, {
          step: 'start-investigation',
          language: window.i18n?.lang || '',
        });
      }

      state.hasStarted = true;
      setScreen('analysis');
      applyState();
      return;
    }

    if (isWorkflowBusy() && action !== 'restart' && action !== 'idle-reset' && action !== 'home') {
      event.preventDefault();
      return;
    }

    if (action === 'select-source') {
      selectSource(button.dataset.source || '');
      return;
    }

    if (action === 'select-suspect') {
      selectSuspect(button.dataset.suspect || '');
      return;
    }

    if (action === 'open-evidence') {
      const ev = button.dataset.evidence || '';
      // Single slot rule — close any prior popup INSTANTLY before opening
      // a new one (prevents visible overlap during the fade-out).
      closeAllEvidencePopups({ immediate: true });
      openEvidencePopup(ev);
      return;
    }

    if (action === 'close-evidence') {
      closeEvidencePopup(button.dataset.evidence || '');
      return;
    }

    if (action === 'plot-cellular-path') {
      void handlePlotCellularPath(button);
      return;
    }

    if (action === 'switch-conversation') {
      const threadKey = button.dataset.thread || 'karim';
      const popup = document.getElementById('evidence-popup-conversations');
      if (!popup) return;
      state.openedConversationThread = threadKey;
      const frame = popup.querySelector('.evidence-frame');
      if (frame) frame.innerHTML = renderEvidenceConversations(threadKey);
      markConversationThreadViewed(threadKey);
      renderDetailPanel();
      refreshWorkflowUi();
      return;
    }

    if (action === 'switch-cellular') {
      const suspectKey = button.dataset.suspect || 'karim';
      syncActiveCellularSuspect(suspectKey);
      return;
    }

    if (action === 'build-timeline') {
      openTimeline();
      return;
    }

    if (action === 'conclusion') {
      if (!isSourceCompleted('google')) return;
      setScreen('conclusion');
      return;
    }

    if (action === 'back-to-analysis') {
      setScreen('analysis');
      return;
    }

    if (action === 'reset') {
      resetExperience(false);
      return;
    }

    if (action === 'restart') {
      returnToLanguageSelection();
      return;
    }

    if (action === 'idle-reset') {
      resetExperience('language');
      return;
    }

    if (action === 'return-home') {
      returnToLanguageSelection();
      return;
    }
  });

  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      resetInactivityTimer();
    }, { passive: eventName === 'pointermove' || eventName === 'touchstart' || eventName === 'wheel' });
  });

  // Escape key closes all open popups
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isWorkflowBusy()) closeAllEvidencePopups();
  });
}

function selectSource(key) {
  if (isWorkflowBusy()) return;
  if (!sourceOrder.includes(key)) return;
  if (!isSourceReachable(key)) return;

  const isNew = !state.revealedSources.has(key);
  state.hasStarted = true;
  state.selectedSource = key;
  state.currentTimelineFocus = '';

  renderSources();
  renderSuspects();
  renderTimeline(isNew ? key : '');
  applyState();

  // Single slot rule — close any previous popup INSTANTLY before opening.
  closeAllEvidencePopups({ immediate: true });
  openEvidencePopup(key);
}

function selectSuspect(key) {
  if (isWorkflowBusy()) return;
  if (!suspectOrder.includes(key)) return;
  state.selectedSuspect = key;
  state.openedConversationThread = key;
  renderSuspects();
  applyState();
}

function openTimeline() {
  if (isWorkflowBusy()) return;
  if (!hasUnlockedTimeline()) return;
  state.currentTimelineFocus = state.selectedSource && state.selectedSource !== 'timeline'
    ? state.selectedSource
    : state.currentTimelineFocus;
  state.selectedSource = 'timeline';
  state.hasVisitedTimeline = true;
  renderStaticContent();
  renderSources();
  renderTimeline('');
  applyState();
}

function hasUnlockedTimeline() {
  return isSourceCompleted('google');
}

function setScreen(screen) {
  state.screen = screen;
  appShell.dataset.screen = screen;
  if (homeButton) homeButton.hidden = screen === 'language';

  Object.entries(screens).forEach(([key, panel]) => {
    if (!panel) return;
    const active = key === screen;
    panel.hidden = !active;
  });

  if (screen === 'analysis') {
    requestAnimationFrame(() => {
      applyAllMarkersFromConfig();
      if (hasPlayedMapEntry || !mapEntryFrames.length) {
        renderCoachOverlay();
      }
    });
    void playMapEntryAnimation();
  } else {
    cancelMapEntryAnimation();
    syncCoachMarkers(getWorkflow().currentStep, 'hidden');
    hideCoachOverlay();
  }

  resetInactivityTimer();
}

function applyState() {
  state.isConclusionUnlocked = isSourceCompleted('google');
  appShell.dataset.source = state.selectedSource || '';
  setScreen(state.screen);
  applySuspectPanel();
  applyMapEffects();
  applyProgress();
  applyContextCard();
  renderDetailPanel();
  renderMapCellularPanel();
  applyTimelinePanel();
  renderTimeline('');
  renderCoachOverlay();
}

function applySuspectPanel() {
  suspectPanel.hidden = !suspectContextSources.has(state.selectedSource);
}

function normalizeMapLayerKey(key) {
  if (!key) return '';
  if (key === 'phone') return 'phone';
  if (key === 'google' || key === 'google-login' || key.startsWith('delete-attempt-')) return 'google';
  if (key === 'witness-call' || key.startsWith('conversations')) return 'conversations';
  if (key.startsWith('cellular')) return 'cellular';
  if (key === 'timeline') return 'timeline';
  return '';
}

function getOpenEvidenceKey() {
  const popup = document.querySelector('#evidence-popups .evidence-popup');
  if (popup?.dataset.evidence) return popup.dataset.evidence;
  return [...openedPopups].at(-1) || '';
}

function getActiveRouteContextKey() {
  const popupKey = normalizeMapLayerKey(getOpenEvidenceKey());
  if (popupKey) return popupKey;
  return normalizeMapLayerKey(state.selectedSource);
}

function getActiveCellularRouteKey() {
  return normalizeCellularSuspectKey(state.selectedSuspect);
}

function normalizeCellularSuspectKey(suspectKey) {
  return suspectKey === 'samir' ? 'samir' : 'karim';
}

function getOpenCellularPopup() {
  return document.querySelector('#evidence-popups .evidence-popup[data-evidence^="cellular"]');
}

function renderOpenCellularPopup(suspectKey) {
  const popup = getOpenCellularPopup();
  if (!popup) return;
  popup.dataset.evidence = 'cellular';
  popup.classList.remove('evidence-popup--cellular-karim', 'evidence-popup--cellular-samir');
  popup.classList.add('evidence-popup--cellular');

  const frame = popup.querySelector('.evidence-frame');
  if (frame) frame.innerHTML = renderEvidenceCellular(suspectKey);
}

function syncActiveCellularSuspect(suspectKey, options = {}) {
  const {
    renderPopup = true,
    renderDetails = true,
    refreshPanels = true,
    updateCoach = true,
  } = options;
  const nextSuspect = normalizeCellularSuspectKey(suspectKey);

  state.selectedSuspect = nextSuspect;
  if (renderPopup) renderOpenCellularPopup(nextSuspect);
  applyMapEffects();
  if (renderDetails) renderDetailPanel();

  if (updateCoach) {
    setCoachStep(isCellularPathComplete(nextSuspect)
      ? (allCellularPathsComplete() ? 'google.select' : 'cellular.samir.tab')
      : `cellular.${nextSuspect}.rows`);
  }

  if (refreshPanels) {
    refreshWorkflowUi();
  } else {
    renderMapCellularPanel();
  }
}

function shouldShowMapCellularPanel() {
  if (state.screen !== 'analysis') return false;
  if (state.selectedSource === 'cellular') return true;
  return normalizeMapLayerKey(getOpenEvidenceKey()) === 'cellular';
}

function renderMapCellularPanel() {
  if (!mapCellularPanel) return;

  if (!shouldShowMapCellularPanel()) {
    mapCellularPanel.hidden = true;
    mapCellularPanel.innerHTML = '';
    return;
  }

  const workflow = getWorkflow();
  const suspectKey = getActiveCellularRouteKey();
  const suspectName = getSuspectFirstName(suspectKey);
  const pings = CELL_PINGS[suspectKey] || [];
  const isComplete = isCellularPathComplete(suspectKey);
  const isPlotting = workflow.plottingCellularPath === suspectKey;
  const isBlocked = isWorkflowBusy() && !isPlotting;
  const buttonLabel = isPlotting
    ? translate('analysis.cellular.plottingButton', undefined, 'Plotting...')
    : isComplete
      ? translate('analysis.cellular.plottedButton', undefined, 'Data plotted')
      : translate('analysis.cellular.plotButton', undefined, 'Plot data');

  mapCellularPanel.hidden = false;
  mapCellularPanel.innerHTML = `
    <div class="map-cellular-panel__header">
      <div>
        <strong>${escapeHtml(translate('analysis.cellular.panelTitle', { suspect: suspectName }, `${suspectName} cell data`))}</strong>
        <span>${escapeHtml(translate('analysis.cellular.panelSubtitle', undefined, 'Four records will plot in chronological order.'))}</span>
      </div>
    </div>
    <ul class="map-cellular-panel__records">
      ${pings.map((ping, index) => {
        const area = evidenceText(`cellular.areas.${suspectKey}.${index}`, ping.area || 'Estimated handset area');
        return `
          <li class="${isCellularPingPlotted(suspectKey, index) ? 'is-plotted' : ''}">
            <time>${escapeHtml(ping.time || '')}</time>
            <span>${escapeHtml(area)}</span>
          </li>
        `;
      }).join('')}
    </ul>
    <button class="cellular-plot-button" type="button" data-action="plot-cellular-path" data-suspect="${escapeHtml(suspectKey)}" ${isComplete || isPlotting || isBlocked ? 'disabled' : ''}>
      ${escapeHtml(buttonLabel)}
    </button>
  `;
}

function applyMapEffects() {
  const sourceEffects = getData().sourceEffects || defaultSourceEffects;

  // Map effects are now driven by REVEALED sources (not by which popup is open),
  // because popups live inside the source panel and closing one shouldn't strip
  // the corresponding map layers.
  const mapKeys = new Set(
    [...state.revealedSources].filter((k) => sourceOrder.includes(k))
  );
  const activeKeys = [...mapKeys];

  const mergedMarkers = new Set(['victim-house']);
  const mergedRoutes  = new Set();
  const mergedZones   = new Set();
  const mergedTowers  = new Set();
  const mergedEvents  = new Set();
  const activeCellularRoute = getActiveCellularRouteKey();
  const activeRouteContext = getActiveRouteContextKey();

  if (activeKeys.length === 0) {
    // Nothing open — show minimal default
    const def = sourceEffects.default || defaultSourceEffects.default;
    (def.markers || []).forEach((m) => mergedMarkers.add(m));
  } else {
    activeKeys.forEach((key) => {
      if (key === 'conversations') {
        mergedMarkers.add('victim-house');
        if (getViewedConversationThreads().has('neighbor')) {
          mergedMarkers.add('neighbor-house');
          mergedEvents.add('witness-call');
        }
        return;
      }

      const fx = sourceEffects[key] || defaultSourceEffects[key] || {};
      (fx.markers || []).forEach((m) => mergedMarkers.add(m));
      if (key !== 'cellular') {
        (fx.routes || []).forEach((r) => mergedRoutes.add(r));
      }
      (fx.zones   || []).forEach((z) => mergedZones.add(z));
      (fx.towers  || []).forEach((t) => mergedTowers.add(t));
      (fx.events  || []).forEach((e) => mergedEvents.add(e));
    });
  }

  if (activeRouteContext && activeRouteContext !== 'cellular') {
    const routeFx = sourceEffects[activeRouteContext] || defaultSourceEffects[activeRouteContext] || {};
    (routeFx.routes || []).forEach((routeKey) => mergedRoutes.add(routeKey));
  }

  markerKeys.forEach((key) => {
    const element = document.querySelector(`[data-marker="${key}"]`);
    if (!element) return;
    element.classList.toggle('is-visible', mergedMarkers.has(key));
    element.classList.toggle('is-dimmed', false);
    element.classList.toggle('is-emphasized', false);
  });

  routeKeys.forEach((key) => {
    const element = document.getElementById(`route-${key}`);
    if (!element) return;
    const isCellularRoute = key === 'karim' || key === 'samir';
    const shouldShow = isCellularRoute
      ? mergedRoutes.has(key) && key === activeCellularRoute
      : mergedRoutes.has(key);
    element.classList.toggle('is-visible', shouldShow);
  });

  zoneKeys.forEach((key) => {
    const element = document.getElementById(`tower-zone-${key}`);
    if (!element) return;
    element.classList.toggle('is-visible', mergedZones.has(key));
  });

  towerKeys.forEach((key) => {
    const element = document.querySelector(`[data-tower="${key}"]`);
    if (!element) return;
    element.classList.toggle('is-visible', mergedTowers.has(key));
  });

  eventKeys.forEach((key) => {
    const element = document.querySelector(`[data-event="${key}"]`);
    if (!element) return;
    element.classList.toggle('is-visible', mergedEvents.has(key));
  });

  const captionContext = activeRouteContext || normalizeMapLayerKey(state.selectedSource) || activeKeys[activeKeys.length - 1];
  const captionFx = (captionContext && (sourceEffects[captionContext] || defaultSourceEffects[captionContext])) ||
                    sourceEffects.default || defaultSourceEffects.default;
  mapCaption.textContent = translate(captionFx.captionKey);
  scheduleMapLabelLayout();
}

function applyProgress() {
  progressRail.innerHTML = progressOrder.map((key, index) => {
    let itemState = 'idle';
    const label = getData().sources?.[key]?.label || key;

    if (state.selectedSource === key) {
      itemState = 'active';
    } else if (isSourceCompleted(key)) {
      itemState = 'done';
    }

    return `
      <div class="progress-node progress-node--${itemState}">
        <span class="progress-node__index">${index + 1}</span>
        <span class="progress-node__label">${escapeHtml(label)}</span>
      </div>
    `;
  }).join('');

  if (conclusionButton) {
    conclusionButton.disabled = !isSourceCompleted('google');
  }

  if (!sourceInstruction) return;

  if (!state.selectedSource) {
    sourceInstruction.textContent = translate('analysis.instruction');
    return;
  }

  if (!hasUnlockedTimeline()) {
    sourceInstruction.textContent = translate('analysis.followupInstruction');
    return;
  }

  sourceInstruction.textContent = translate('analysis.conclusionReady');
}

function applyContextCard() {
  const data = getData();
  const sourceKey = state.selectedSource;

  if (!sourceKey) {
    setContextCard({
      badge: translate('context.defaultBadge'),
      title: translate('context.defaultTitle'),
      body: translate('context.defaultBody'),
      points: data.context?.defaultPoints || []
    });
    return;
  }

  const card = data.cards?.[sourceKey];
  const metaLabel = suspectContextSources.has(sourceKey)
    ? getData().suspects?.[state.selectedSuspect]?.label || ''
    : '';

  setContextCard(card, metaLabel);
}

function setContextCard(card, metaLabel = '') {
  if (!card) {
    contextCard.innerHTML = '';
    return;
  }

  const points = (card.points || []).map((point) => `<li>${escapeHtml(point)}</li>`).join('');

  contextCard.innerHTML = `
    <div class="context-card__header">
      <span class="context-card__badge">${escapeHtml(card.badge || '')}</span>
      ${metaLabel ? `<span class="context-card__meta">${escapeHtml(metaLabel)}</span>` : ''}
    </div>
    <h3>${escapeHtml(card.title || '')}</h3>
    <p>${escapeHtml(card.body || '')}</p>
    ${points ? `<ul>${points}</ul>` : ''}
  `;
}

function renderDetailPanel() {
  const data = getData();
  const details = data.details || {};
  const sourceKey = state.selectedSource;

  if (!detailPanel) return;

  if (!sourceKey) {
    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(translate('context.guideEyebrow'))}</span>
        <h4>${escapeHtml(translate('context.guideTitle'))}</h4>
      </div>
      <div class="detail-step-grid">
        ${sourceOrder.map((key, index) => {
          const item = data.sources?.[key] || {};
          return `
            <article class="detail-step-card">
              <span class="detail-step-card__index">0${index + 1}</span>
              <strong>${escapeHtml(item.label || '')}</strong>
              <p>${escapeHtml(item.hint || '')}</p>
            </article>
          `;
        }).join('')}
      </div>
    `;
    return;
  }

  if (sourceKey === 'phone') {
    const phone = details.phone || {};
    const victim = data.characters?.victim || {};
    const victimHouse = data.locations?.victimHouse || {};
    const policeStation = data.locations?.policeStation || {};
    const policeAnchor = data.policeAnchor || {};

    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(phone.kicker || '')}</span>
        <h4>${escapeHtml(phone.heading || '')}</h4>
        <p>${escapeHtml(phone.summary || '')}</p>
      </div>
      <div class="detail-stat-grid">
        ${(phone.stats || []).map((item) => `
          <article class="detail-stat">
            <span>${escapeHtml(item.label || '')}</span>
            <strong>${escapeHtml(item.value || '')}</strong>
          </article>
        `).join('')}
      </div>
      <div class="split-card-grid">
        <article class="profile-card">
          <span class="detail-badge">${escapeHtml(phone.victimLabel || '')}</span>
          <h5>${escapeHtml(victim.name || '')}</h5>
          ${renderProfileMeta(victim)}
          <ul class="detail-list">
            ${(victim.details || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
        <article class="anchor-card">
          <span class="detail-badge">${escapeHtml(phone.anchorLabel || '')}</span>
          <h5>${escapeHtml(policeAnchor.location || policeStation.name || '')}</h5>
          <div class="fact-stack">
            ${renderFactLine(translate('labels.address'), policeAnchor.address)}
            ${renderFactLine(translate('labels.coordinates'), policeAnchor.coordinates)}
          </div>
        </article>
      </div>
      <div class="location-grid">
        ${renderLocationCard(victimHouse)}
        ${renderLocationCard(policeStation)}
      </div>
      <article class="detail-block">
        <h5>${escapeHtml(phone.evidenceTitle || '')}</h5>
        <ul class="detail-list">
          ${(phone.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </article>
    `;
    return;
  }

  if (sourceKey === 'google') {
    const google = details.google || {};
    const remoteDeletionPath = data.movementPaths?.remoteDeletion || [];

    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(google.kicker || '')}</span>
        <h4>${escapeHtml(google.heading || '')}</h4>
      </div>
      <article class="status-banner status-banner--blocked">
        <span class="status-banner__label">${escapeHtml(google.statusLabel || '')}</span>
        <strong>${escapeHtml(google.statusTitle || '')}</strong>
        <p>${escapeHtml(google.statusBody || '')}</p>
      </article>
      <div class="log-list">
        ${(google.logs || []).map((item) => `
          <article class="log-item${item.tone === 'alert' ? ' log-item--alert' : ''}">
            <span class="log-item__time">${escapeHtml(item.time || '')}</span>
            <div class="log-item__body">
              <strong>${escapeHtml(item.title || '')}</strong>
              <small>${escapeHtml(item.meta || '')}</small>
            </div>
          </article>
        `).join('')}
      </div>
      ${renderPathBlock(google.pathTitle, remoteDeletionPath)}
    `;
    return;
  }

  if (sourceKey === 'conversations') {
    const conversations = details.conversations || {};
    const threadKey = state.openedConversationThread || 'karim';
    const thread = conversations.threads?.[threadKey] || {};
    const suspectCard = data.cards?.[threadKey] || {};
    const suspectCharacter = data.characters?.[threadKey] || {};
    const witnessCharacter = data.characters?.witness || {};
    const chronology = data.chronology || {};

    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(conversations.kicker || '')}</span>
        <h4>${escapeHtml(conversations.heading || '')}</h4>
        <p>${escapeHtml(conversations.summary || '')}</p>
      </div>
      <div class="split-card-grid">
        <article class="profile-card">
          <span class="detail-badge">${escapeHtml(suspectCard.badge || '')}</span>
          <h5>${escapeHtml(suspectCard.title || '')}</h5>
          ${renderProfileMeta(suspectCharacter)}
          <p>${escapeHtml(suspectCard.body || '')}</p>
          <ul class="detail-list">
            ${(suspectCharacter.details || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
        <article class="witness-card">
          <span class="detail-badge detail-badge--warn">${escapeHtml(conversations.witnessLabel || '')}</span>
          <h5>${escapeHtml(conversations.witnessTitle || '')}</h5>
          ${renderProfileMeta(witnessCharacter)}
          <p>${escapeHtml(conversations.witnessBody || '')}</p>
          <ul class="detail-list">
            ${(witnessCharacter.details || conversations.witnessPoints || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
      </div>
      <article class="detail-block detail-block--accent">
        <div class="detail-block__header">
          <span class="detail-badge">${escapeHtml(thread.badge || '')}</span>
          <strong>${escapeHtml(thread.label || '')}</strong>
        </div>
        <p>${escapeHtml(thread.summary || '')}</p>
        <ul class="detail-list">
          ${(thread.insights || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </article>
      <div class="chronology-grid chronology-grid--split">
        ${renderChronologyBlock(conversations.friendHistoryTitle, chronology.friendRelationship || [])}
        ${renderChronologyBlock(conversations.transactionHistoryTitle, chronology.visitorTransaction || [])}
      </div>
      <div class="message-list">
        ${(thread.messages || []).map(renderMessage).join('')}
      </div>
    `;
    return;
  }

  if (sourceKey === 'cellular') {
    const cellular = details.cellular || {};
    const suspectKey = state.selectedSuspect || 'karim';
    const suspectDetails = cellular[suspectKey] || {};
    const suspectCard = data.cards?.[suspectKey] || {};
    const suspectCharacter = data.characters?.[suspectKey] || {};
    const pathItems = data.movementPaths?.[suspectKey] || [];
    const relevantLocations = suspectKey === 'karim'
      ? [data.locations?.karimLocation, data.locations?.victimHouse]
      : [data.locations?.friendHouse, data.locations?.victimHouse];

    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(cellular.kicker || '')}</span>
        <h4>${escapeHtml(cellular.heading || '')}</h4>
        <p>${escapeHtml(cellular.compareBody || '')}</p>
      </div>
      <div class="tower-list">
        ${(cellular.towers || []).map((item) => `<span class="tower-pill">${escapeHtml(item)}</span>`).join('')}
      </div>
      <div class="location-grid">
        ${relevantLocations.map(renderLocationCard).join('')}
      </div>
      <div class="split-card-grid">
        <article class="detail-block detail-block--accent">
          <div class="detail-block__header">
            <span class="detail-badge">${escapeHtml(suspectDetails.badge || '')}</span>
            <strong>${escapeHtml(suspectDetails.title || '')}</strong>
          </div>
          <p>${escapeHtml(suspectDetails.summary || '')}</p>
          <ul class="detail-list">
            ${(suspectDetails.points || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
        <article class="profile-card">
          <span class="detail-badge">${escapeHtml(suspectCard.badge || '')}</span>
          <h5>${escapeHtml(suspectCard.title || '')}</h5>
          ${renderProfileMeta(suspectCharacter)}
          <p>${escapeHtml(suspectCard.body || '')}</p>
          <ul class="detail-list">
            ${(suspectCharacter.details || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>
      </div>
      ${renderPathBlock(cellular.pathTitle, pathItems)}
    `;
    return;
  }

  if (sourceKey === 'timeline') {
    const timeline = details.timeline || {};
    const chronology = data.chronology || {};

    detailPanel.innerHTML = `
      <div class="detail-panel__header">
        <span class="detail-panel__eyebrow">${escapeHtml(timeline.kicker || '')}</span>
        <h4>${escapeHtml(timeline.heading || '')}</h4>
        <p>${escapeHtml(timeline.summary || '')}</p>
      </div>
      <article class="status-banner">
        <span class="status-banner__label">${escapeHtml(timeline.resultLabel || '')}</span>
        <strong>${escapeHtml(timeline.resultTitle || '')}</strong>
        <p>${escapeHtml(timeline.resultBody || '')}</p>
      </article>
      <div class="chronology-grid">
        ${renderChronologyBlock(timeline.earlierWeekTitle, [
          ...(chronology.friendRelationship || []),
          ...(chronology.visitorTransaction || [])
        ])}
        ${renderChronologyBlock(timeline.incidentTitle, sortChronologyEntries(chronology.incident || []))}
        ${renderChronologyBlock(timeline.postIncidentTitle, sortChronologyEntries([
          ...(chronology.postIncident || []),
          ...(chronology.morning || [])
        ]))}
      </div>
    `;
  }
}

function applyTimelinePanel() {
  // Timeline is always visible in the right panel; highlight when timeline mode
  if (timelineCard) timelineCard.hidden = false;
  if (state.selectedSource === 'timeline') {
    renderTimeline('');
  }
}

function renderMessage(message) {
  const toneClass = message.tone === 'alert'
    ? ' message--alert'
    : message.tone === 'muted'
      ? ' message--muted'
      : '';

  return `
    <article class="message${toneClass}">
      <div class="message__meta">
        <strong>${escapeHtml(message.author || '')}</strong>
        <span>${escapeHtml(message.time || '')}</span>
      </div>
      <p>${escapeHtml(message.text || '')}</p>
    </article>
  `;
}

function renderProfileMeta(character) {
  if (!character || (!character.role && !character.age)) return '';

  const items = [];
  if (character.role) {
    items.push(`${translate('labels.role')}: ${character.role}`);
  }
  if (character.age) {
    items.push(`${translate('labels.age')}: ${character.age}`);
  }

  return `
    <div class="profile-card__meta">
      ${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
    </div>
  `;
}

function renderFactLine(label, value) {
  if (!value) return '';
  return `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`;
}

function renderLocationCard(location) {
  if (!location) return '';

  return `
    <article class="location-card">
      <h5>${escapeHtml(location.name || '')}</h5>
      <div class="fact-stack">
        ${renderFactLine(translate('labels.context'), location.context)}
        ${renderFactLine(translate('labels.address'), location.address)}
        ${renderFactLine(translate('labels.coordinates'), location.coordinates)}
      </div>
    </article>
  `;
}

function renderPathBlock(title, items) {
  if (!title || !items?.length) return '';

  return `
    <article class="detail-block">
      <h5>${escapeHtml(title)}</h5>
      <ol class="path-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ol>
    </article>
  `;
}

function renderChronologyBlock(title, items) {
  if (!title || !items?.length) return '';

  return `
    <article class="detail-block chronology-block">
      <h5>${escapeHtml(title)}</h5>
      <ul class="chronology-list">
        ${items.map((item) => `
          <li>
            <span class="chronology-list__time">${escapeHtml(item.time || '')}</span>
            <span class="chronology-list__label">${escapeHtml(item.label || '')}</span>
          </li>
        `).join('')}
      </ul>
    </article>
  `;
}

function resetExperience(goIntro = false) {
  cancelMapEntryAnimation({ resetPlayed: goIntro });
  cellularPlotToken += 1;
  if (goIntro) {
    mapPhoneTracking?.reset();
  }
  state.screen = goIntro === 'language' ? 'language' : goIntro ? 'intro' : 'analysis';
  state.hasStarted = false;
  state.selectedSource = '';
  state.selectedSuspect = 'karim';
  state.openedConversationThread = 'neighbor';
  state.currentTimelineFocus = '';
  state.hasVisitedTimeline = false;
  state.isConclusionUnlocked = false;
  resetMapView();
  clearCellularOverlays();
  resetWorkflow();
  state.revealedSources.clear();
  loadedEvidenceSources.clear();

  closeAllEvidencePopups();

  renderStaticContent();
  renderSources();
  renderSuspects();
  renderTimeline();
  renderMapCellularPanel();
  applyState();
}

function returnToLanguageSelection() {
  resetExperience('language');
}

function startInactivityWatcher() {
  resetInactivityTimer();
}

function resetInactivityTimer() {
  if (state.screen === 'language') {
    inactivityController.clear();
    return;
  }
  inactivityController.reset();
}

function applyMapConfig() {
  const mapBg = document.getElementById('map-bg');
  const mapCanvas = document.getElementById('map-canvas');

  if (mapBg && MAP_CONFIG.imageUrl) {
    mapBg.src = MAP_CONFIG.imageUrl;
    // onload fires for fresh loads; for cached images trigger via rAF
    mapBg.onload = () => applyAllMarkersFromConfig();
    // Always schedule a retry — covers cached images where onload may not fire
    requestAnimationFrame(() => applyAllMarkersFromConfig());
  }

  if (mapCanvas) {
    applyMapView();
  }
}

/* ─────────────────────────────────────────────────────────────
   EVIDENCE POPUPS — single source-panel slot
───────────────────────────────────────────────────────────────── */

// Single canonical slot — every popup opens in the same place.
// Container is .evidence-popups inside .map-area; coordinates are % of that container.
const popupDefaults = {
  phone:                { top: 4, left: 3 },
  conversations:        { top: 4, left: 3 },
  cellular:             { top: 4, left: 3 },
  google:               { top: 4, left: 3 },
  'cellular-karim':     { top: 4, left: 3 },
  'cellular-samir':     { top: 4, left: 3 },
  'conversations-karim':{ top: 4, left: 3 },
  'conversations-samir':{ top: 4, left: 3 },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPopupMetrics() {
  const styles = getComputedStyle(document.documentElement);
  return {
    width: parseFloat(styles.getPropertyValue('--popup-w')) || 332,
    height: parseFloat(styles.getPropertyValue('--popup-h')) || 560,
    gap: parseFloat(styles.getPropertyValue('--popup-gap')) || 24,
  };
}

function positionPopupInContainer(popup, percentPos) {
  // Single-slot in-panel layout: popup is a flex child of .panel--sources
  // and flows below the source list. No absolute positioning needed.
  return;
}

function constrainPopupToContainer(popup) {
  const container = popup.parentElement;
  if (!container) return;
  const { width, height, gap } = getPopupMetrics();
  const maxLeft = Math.max(gap, container.clientWidth - (popup.offsetWidth || width) - gap);
  const maxTop = Math.max(gap, container.clientHeight - (popup.offsetHeight || height) - gap);
  const currentLeft = parseFloat(popup.style.left) || gap;
  const currentTop = parseFloat(popup.style.top) || gap;
  popup.style.left = `${clamp(currentLeft, gap, maxLeft)}px`;
  popup.style.top = `${clamp(currentTop, gap, maxTop)}px`;
}

let popupZCounter = 202;

function openEvidencePopup(key) {
  const container = document.getElementById('evidence-popups');
  if (!container || !key) return;

  // Already open — bring to front
  const existing = document.getElementById(`evidence-popup-${key}`);
  if (existing) {
    bringPopupToFront(existing);
    syncPopupFrameScale(existing);
    return;
  }

  const html = renderEvidenceContent(key);
  if (!html) return;

  const pos = popupDefaults[key] || { top: 10, left: 35 };

  const loadingKey = key.replace(/-(karim|samir|neighbor)$/, '');
  const loadingLabel = translate(`analysis.loading.${loadingKey}`, undefined, '');
  const showLoading = Boolean(loadingLabel) && !loadedEvidenceSources.has(loadingKey);

  const popup = document.createElement('div');
  popup.className = `evidence-popup evidence-popup--${key}`;
  popup.id = `evidence-popup-${key}`;
  popup.dataset.evidence = key;
  popup.innerHTML = `
    <button class="evidence-popup__close" type="button" data-action="close-evidence" data-evidence="${escapeHtml(key)}" aria-label="Close">✕</button>
    <div class="evidence-frame">${html}</div>
    ${showLoading ? `
      <div class="ev-loading" aria-hidden="true">
        <div class="ev-loading__inner">
          <span class="ev-loading__label">${escapeHtml(loadingLabel)}</span>
          <span class="ev-progress-bar"><span class="ev-progress-bar__fill"></span></span>
        </div>
      </div>
    ` : ''}
  `;

  container.appendChild(popup);
  positionPopupInContainer(popup, pos);
  openedPopups.add(key);
  if (showLoading) {
    loadedEvidenceSources.add(loadingKey);
    getWorkflow().loadingEvidenceKey = loadingKey;
  }

  const finishEvidenceOpen = () => {
    if (!popup.isConnected) return;
    if (getWorkflow().loadingEvidenceKey === loadingKey) {
      getWorkflow().loadingEvidenceKey = '';
    }
    handleEvidencePopupOpened(key);
    applyMapEffects();
    refreshWorkflowUi();
  };

  // Sync inner phone-frame scale to popup width (frame is 332px base).
  syncPopupFrameScale(popup);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => syncPopupFrameScale(popup));
    ro.observe(container);
    popup._resizeObserver = ro;
  }

  requestAnimationFrame(() => {
    bringPopupToFront(popup);
    syncPopupFrameScale(popup);
    // Single-slot design: no drag handle.
    // Entrance animation
    requestAnimationFrame(() => popup.classList.add('is-open'));
  });

  if (showLoading) {
    const loadingEl = popup.querySelector('.ev-loading');
    if (loadingEl) {
      // Trigger the bar fill on the next frame, then fade out the overlay.
      requestAnimationFrame(() => loadingEl.classList.add('is-running'));
      setTimeout(() => {
        loadingEl.classList.add('is-done');
        setTimeout(() => {
          loadingEl.remove();
          finishEvidenceOpen();
        }, 320);
      }, 1200);
    } else {
      finishEvidenceOpen();
    }
  }

  // Fly evidence pings from the relevant map markers into the popup,
  // so the user sees the connection between map points and the source.
  flyMapPointsToPopup(key, popup);

  if (showLoading) {
    refreshWorkflowUi();
  } else {
    finishEvidenceOpen();
  }
}

function handleEvidencePopupOpened(key) {
  const sourceKey = normalizeMapLayerKey(key);

  if (sourceKey === 'phone') {
    completeSource('phone');
    return;
  }

  if (sourceKey === 'conversations') {
    state.openedConversationThread = key === 'conversations-karim'
      ? 'karim'
      : key === 'conversations-samir'
        ? 'samir'
        : 'neighbor';
    markConversationThreadViewed(state.openedConversationThread);
    return;
  }

  if (sourceKey === 'cellular') {
    const suspect = key === 'cellular-samir' ? 'samir' : state.selectedSuspect || 'karim';
    syncActiveCellularSuspect(suspect, {
      renderPopup: false,
      refreshPanels: false,
      updateCoach: false,
    });
    revealSource('cellular');
    setCoachStep(isCellularPathComplete(suspect)
      ? (allCellularPathsComplete() ? 'google.select' : 'cellular.samir.tab')
      : `cellular.${suspect}.rows`);
    return;
  }

  if (sourceKey === 'google') {
    getWorkflow().viewedGoogleEvents.add('account-log');
    getWorkflow().revealedFacts.add('google:account-log');
    completeSource('google');
  }
}

function syncPopupFrameScale(popup) {
  const slot = popup.parentElement;
  const availableWidth = slot?.clientWidth || popup.clientWidth;
  const availableHeight = slot?.clientHeight || popup.clientHeight;
  if (!availableWidth || !availableHeight) return;

  const scale = Math.max(0.18, Math.min(
    availableWidth / POPUP_BASE_SIZE.width,
    availableHeight / POPUP_BASE_SIZE.height,
  ));

  popup.style.width = `${POPUP_BASE_SIZE.width * scale}px`;
  popup.style.height = `${POPUP_BASE_SIZE.height * scale}px`;
  popup.style.setProperty('--screen-scale', String(scale));
}

// Draw a smooth, animated arrow from each relevant map point INTO the
// right-side CORRELATION STEP panel. Triggered every time a popup is opened.
function flyMapPointsToPopup(sourceKey, popup) {
  const overlay = document.getElementById('fly-overlay');
  const target  = document.querySelector('.panel--timeline');
  if (!overlay || !target) return;

  const baseKey = sourceKey.replace(/-(karim|samir|neighbor)$/, '');
  const sourceEffects = getData().sourceEffects || defaultSourceEffects;
  const fx = sourceEffects[baseKey] || defaultSourceEffects[baseKey] || {};

  // Collect map-side origin elements (markers / event chips / cell-tower zones).
  const origins = [];
  const push = (sel) => { const el = document.querySelector(sel); if (el) origins.push(el); };
  (fx.markers || []).forEach((m) => push(`[data-marker="${m}"]`));
  (fx.events  || []).forEach((e) => push(`[data-event="${e}"]`));
  (fx.towers  || []).forEach((t) => push(`[data-tower="${t}"]`));
  if (!origins.length) return;

  // Wait for layout (popup just opened, panel--timeline rect must be final).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const tRect = target.getBoundingClientRect();
    if (!tRect.width || !tRect.height) return;

    // Pick the actual timeline rows that match this source — that's where
    // each arrow should land. Fallback to the panel left edge if none.
    const rows = Array.from(
      document.querySelectorAll(`.panel--timeline .timeline-item[data-source="${baseKey}"]`)
    );

    const W = window.innerWidth;
    const H = window.innerHeight;
    const SVGNS = 'http://www.w3.org/2000/svg';

    // Build SVG layer (1:1 with viewport, no aspect ratio surprises).
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', `fly-arrows fly-arrows--${baseKey}`);
    svg.setAttribute('width',  String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    overlay.appendChild(svg);

    // Up to 4 arrows. Pair each origin with a timeline row when available.
    const items = origins.slice(0, 4);

    items.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      // Markers are 0×0 anchors → r.left/r.top IS the GPS point.
      const x1 = r.left + r.width  / 2;
      const y1 = r.top  + r.height / 2;

      // Aim at a specific timeline row if we have one; otherwise stagger
      // along the left edge of the Correlation panel.
      let x2, y2, rowEl = null;
      if (rows.length) {
        rowEl = rows[idx % rows.length];
        const rr = rowEl.getBoundingClientRect();
        x2 = rr.left + 10;
        y2 = rr.top  + rr.height / 2;
      } else {
        x2 = tRect.left + 14;
        y2 = tRect.top + Math.max(60, tRect.height * 0.18) + idx * 24;
      }

      // Quadratic curve, control biased upward for a graceful arc.
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      const arc = Math.min(160, Math.max(60, dist * 0.22));
      const cx = (x1 + x2) / 2 + dx * 0.05;
      const cy = Math.min(y1, y2) - arc;

      // <g> wrapper per arrow
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'fly-arrow-group');
      svg.appendChild(g);

      // ── 1. The curve itself ────────────────────────────────
      const curve = document.createElementNS(SVGNS, 'path');
      curve.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
      curve.setAttribute('class', 'fly-arrow');
      g.appendChild(curve);

      // ── 2. Arrowhead (V shape, rotated to match tangent) ──
      // Compute tangent at end point using a sample slightly before.
      const cLen = curve.getTotalLength();
      const pEnd  = curve.getPointAtLength(cLen);
      const pPrev = curve.getPointAtLength(Math.max(0, cLen - 2));
      const angDeg = Math.atan2(pEnd.y - pPrev.y, pEnd.x - pPrev.x) * 180 / Math.PI;

      const head = document.createElementNS(SVGNS, 'path');
      // Tip at (0,0), wings going back to the left.
      head.setAttribute('d', 'M -12 -7 L 0 0 L -12 7');
      head.setAttribute('class', 'fly-arrow-head');
      head.setAttribute('transform', `translate(${x2} ${y2}) rotate(${angDeg})`);
      g.appendChild(head);

      // ── 3. Origin spark ──────────────────────────────────
      const spark = document.createElementNS(SVGNS, 'circle');
      spark.setAttribute('cx', String(x1));
      spark.setAttribute('cy', String(y1));
      spark.setAttribute('r', '0');
      spark.setAttribute('class', 'fly-arrow-spark');
      g.appendChild(spark);

      // ── Animate ──────────────────────────────────────────
      const drawMs = 820;
      const delay  = idx * 140;

      // Draw the curve via stroke-dashoffset.
      curve.style.strokeDasharray  = `${cLen}`;
      curve.style.strokeDashoffset = `${cLen}`;
      // Arrowhead hidden until line arrives.
      head.style.opacity = '0';
      head.style.transformOrigin = `${x2}px ${y2}px`;

      requestAnimationFrame(() => {
        curve.style.transition = `stroke-dashoffset ${drawMs}ms cubic-bezier(0.22, 0.61, 0.36, 1) ${delay}ms`;
        curve.style.strokeDashoffset = '0';
      });

      // Pop the spark
      requestAnimationFrame(() => {
        spark.style.transition = `r 280ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms, opacity 600ms ease ${delay + 200}ms`;
        spark.setAttribute('r', '7');
        spark.style.opacity = '0';
      });

      // Pop the arrowhead + pulse the panel on arrival.
      setTimeout(() => {
        head.style.transition = 'opacity 180ms ease, transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)';
        head.style.opacity = '1';
        // Brief scale-up effect on the head
        head.animate(
          [
            { transform: `translate(${x2}px, ${y2}px) rotate(${angDeg}deg) scale(0.4)` },
            { transform: `translate(${x2}px, ${y2}px) rotate(${angDeg}deg) scale(1)` },
          ],
          { duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
        );
        target.classList.add('is-pinged');
        setTimeout(() => target.classList.remove('is-pinged'), 520);
        if (rowEl) {
          rowEl.classList.add('is-pulsed');
          setTimeout(() => rowEl.classList.remove('is-pulsed'), 900);
        }
      }, drawMs + delay);
    });

    // Fade & clean up after the last arrow lands.
    const totalMs = 820 + (items.length - 1) * 140 + 700;
    setTimeout(() => {
      svg.classList.add('is-fading');
      setTimeout(() => svg.remove(), 650);
    }, totalMs);
  }));
}

function closeEvidencePopup(key, { immediate = false } = {}) {
  if (!key) return;

  // Closing either paired popup closes both
  let keysToClose;
  if (key === 'conversations' || key.startsWith('conversations-')) {
    keysToClose = ['conversations', 'conversations-neighbor', 'conversations-karim', 'conversations-samir'];
  } else if (key === 'cellular' || key.startsWith('cellular-')) {
    keysToClose = ['cellular', 'cellular-karim', 'cellular-samir'];
  } else {
    keysToClose = [key];
  }

  keysToClose.forEach((k) => {
    const popup = document.getElementById(`evidence-popup-${k}`);
    if (!popup) return;
    if (popup._resizeObserver) {
      popup._resizeObserver.disconnect();
      popup._resizeObserver = null;
    }
    popup.classList.remove('is-open');
    popup.style.opacity = '0';
    const removeNow = () => {
      popup.remove();
      openedPopups.delete(k);
      applyMapEffects();
      renderCoachOverlay();
    };
    if (immediate) removeNow();
    else setTimeout(removeNow, 220);
  });
}

function closeAllEvidencePopups({ immediate = false } = {}) {
  // Scan the DOM (not just openedPopups) so we never leak a stale popup
  // whose key got out of sync with the Set.
  const container = document.getElementById('evidence-popups');
  const domKeys = container
    ? Array.from(container.querySelectorAll('.evidence-popup'))
        .map((el) => el.dataset.evidence || el.id.replace(/^evidence-popup-/, ''))
        .filter(Boolean)
    : [];
  const allKeys = new Set([...openedPopups, ...domKeys]);
  allKeys.forEach((k) => closeEvidencePopup(k, { immediate }));

  // Final hard sweep: if `immediate` was requested, force-remove any DOM
  // node that somehow survived (paranoia against future regressions).
  if (immediate && container) {
    container.querySelectorAll('.evidence-popup').forEach((el) => el.remove());
    openedPopups.clear();
  }
}

// Fly-to-timeline animation: spawn a small "evidence pill" at map center
// and animate it to the corresponding timeline item on the right panel.
// Used when a source is freshly revealed, to visually link map → correlation.
function flyEvidenceToTimeline(sourceKey) {
  const overlay = document.getElementById('fly-overlay');
  const mapStage = document.getElementById('map-stage');
  if (!overlay || !mapStage) return;

  // Wait one frame so the new timeline item is in the DOM.
  requestAnimationFrame(() => {
    const target = document.querySelector(`#timeline .timeline-item[data-source="${sourceKey}"]`);
    if (!target) return;

    const startRect = mapStage.getBoundingClientRect();
    const endRect   = target.getBoundingClientRect();

    const data = getData();
    const label = data.sources?.[sourceKey]?.label || sourceKey;

    const pill = document.createElement('div');
    pill.className = `fly-pill fly-pill--${sourceKey}`;
    pill.textContent = label;

    // Start: roughly map center
    const startX = startRect.left + startRect.width  * 0.55;
    const startY = startRect.top  + startRect.height * 0.45;
    pill.style.left = `${startX}px`;
    pill.style.top  = `${startY}px`;

    overlay.appendChild(pill);

    // End: timeline item center
    const endX = endRect.left + endRect.width / 2;
    const endY = endRect.top  + endRect.height / 2;
    const dx = endX - startX;
    const dy = endY - startY;

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      pill.classList.add('is-flying');
      pill.style.transform = `translate(${dx}px, ${dy}px) scale(0.55)`;
      pill.style.opacity = '0';
    });

    // Pulse the timeline item on arrival
    setTimeout(() => {
      target.classList.add('is-pulsed');
      setTimeout(() => target.classList.remove('is-pulsed'), 700);
    }, 700);

    // Cleanup
    setTimeout(() => pill.remove(), 1000);
  });
}

// Cellular interactivity (§7) — light-touch: highlight rows + tower zones,
// then reveal trajectory caption once the user has plotted ≥ 2 pings.
// Ordered list of plotted points per suspect, used to draw a path-trail
// segment-by-segment between consecutive pings on the map.
const CELL_TRAIL_DRAW_MS = 2600;
const CELL_TRAIL_FLOW_DELAY_MS = 120;
const pingTrail = { karim: [], samir: [] };

function clearCellularOverlays(suspect) {
  const suspects = suspect ? [suspect] : Object.keys(pingTrail);

  suspects.forEach((key) => {
    pingTrail[key] = [];
    getPlottedCellPingSet(key).clear();

    document.querySelectorAll(`.cell-ping--${key}`).forEach((el) => el.remove());
    document.querySelectorAll(`.cell-trail--${key}`).forEach((el) => el.remove());
    document.querySelectorAll(`.cell-trail-anchor--${key}`).forEach((el) => el.remove());
    document.querySelectorAll(`tr[data-cell-ping][data-suspect="${key}"]`).forEach((row) => {
      row.classList.remove('is-plotted');
    });
    document.querySelectorAll(`[data-trajectory="${key}"]`).forEach((caption) => {
      caption.textContent = '';
      caption.setAttribute('hidden', 'hidden');
    });
  });

  document.querySelectorAll('.tower-zone.is-highlighted').forEach((zone) => {
    zone.classList.remove('is-highlighted');
  });

  scheduleMapLabelLayout();
}

function ensureCellTrailGroup(suspect) {
  const svg = document.querySelector('.map-svg');
  if (!svg) return null;
  let g = svg.querySelector(`.cell-trail--${suspect}`);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `cell-trail cell-trail--${suspect}`);
    svg.appendChild(g);
  }
  return g;
}

function locationToPercent(locKey) {
  const loc = getData()?.locations?.[locKey];
  if (!loc?.coordinates) return null;
  const m = loc.coordinates.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return transformPercentPoint(gpsToPercent(parseFloat(m[1]), parseFloat(m[2])));
}

function getInitialTrailAnchor(suspect, layout) {
  const firstPing = CELL_PINGS[suspect]?.[0];
  const waypointKey = firstPing ? `${String(firstPing.tower || '').toLowerCase()}@${firstPing.time || ''}` : '';
  const waypoint = waypointKey ? PING_WAYPOINT[suspect]?.[waypointKey] : null;
  const anchor = waypoint?.from ? resolveItineraryAnchor(waypoint.from, layout) : null;
  if (anchor) return anchor;

  const fallbackKey = suspect === 'karim' ? 'karimLocation' : 'friendHouse';
  return locationToPercent(fallbackKey);
}

function seedCellTrail(suspect, layout) {
  if (pingTrail[suspect].length) return;
  const start = getInitialTrailAnchor(suspect, layout);
  if (start) {
    pingTrail[suspect].push({ left: start.left, top: start.top, anchor: 'start' });
    // Drop a small "home" anchor on the map so the user sees where the trail begins.
    placeTrailAnchor(suspect, start, 'start');
  }
}

function placeTrailAnchor(suspect, pct, type) {
  const overlayHost = mapCanvas || document.getElementById('map-stage');
  if (!overlayHost) return;
  const a = document.createElement('div');
  a.className = `cell-trail-anchor cell-trail-anchor--${type} cell-trail-anchor--${suspect}`;
  setStoredMapPointPosition(a, pct);
  overlayHost.appendChild(a);
  requestAnimationFrame(() => a.classList.add('is-on'));
}

function drawCellTrailSegment(suspect, prev, next) {
  const g = ensureCellTrailGroup(suspect);
  if (!g) return;
  // SVG viewBox is 1000 × 620 with preserveAspectRatio="none" → percent maps 1:1.
  const x1 = prev.left * 10;       // % * 1000 / 100
  const y1 = prev.top  * 6.2;
  const x2 = next.left * 10;
  const y2 = next.top  * 6.2;

  const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  seg.setAttribute('class', `cell-trail__seg cell-trail__seg--${suspect}`);
  seg.setAttribute('d', `M ${x1} ${y1} L ${x2} ${y2}`);
  g.appendChild(seg);
  const length = Math.max(seg.getTotalLength(), 1);
  seg.style.strokeDasharray = String(length);
  seg.style.strokeDashoffset = String(length);

  requestAnimationFrame(() => {
    seg.style.transition = `stroke-dashoffset ${CELL_TRAIL_DRAW_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    seg.style.strokeDashoffset = '0';
  });
  setTimeout(() => {
    seg.style.transition = 'none';
    seg.style.strokeDasharray = '8 9';
    seg.style.strokeDashoffset = '0';
    seg.classList.add('is-flowing');
  }, CELL_TRAIL_DRAW_MS + CELL_TRAIL_FLOW_DELAY_MS);
}

function getTowerZoneKey(tower) {
  const normalized = String(tower || '').trim().toLowerCase();
  if (normalized.startsWith('alpha')) return 'a';
  if (normalized.startsWith('beta')) return 'b';
  if (normalized.startsWith('gamma')) return 'c';
  return '';
}

function findCellPingRow(suspect, pingId) {
  return document.querySelector(`tr[data-cell-ping][data-suspect="${suspect}"][data-ping="${pingId}"]`);
}

function revealCellularTrajectoryCaption(suspect) {
  if (!isCellularPathComplete(suspect)) return;
  const caption = document.querySelector(`[data-trajectory="${suspect}"]`);
  if (!caption || !caption.hasAttribute('hidden')) return;
  const suspectName = getSuspectFirstName(suspect);
  caption.textContent = translate('analysis.cellular.trajectoryComplete', { suspect: suspectName }, `${suspectName} traveled toward the victim's house.`);
  caption.removeAttribute('hidden');
}

function plotCellPing({ suspect, pingId, tower, locStr, timeStr, row }) {
  if (!String(pingId).length) return null;
  if (isCellularPingPlotted(suspect, pingId)) return null;

  const rowEl = row || findCellPingRow(suspect, pingId);
  rowEl?.classList.add('is-plotted');
  markCellularPingPlotted(suspect, pingId);

  const zoneKey = getTowerZoneKey(tower);
  const zone = zoneKey ? document.getElementById(`tower-zone-${zoneKey}`) : null;
  zone?.classList.add('is-highlighted');

  const overlayLayout = buildMapOverlayLayout();
  const pct = pingToMapPoint(suspect, tower, timeStr, locStr, overlayLayout);
  const overlayHost = mapCanvas || document.getElementById('map-stage');
  let plottedPoint = null;
  if (pct && overlayHost) {
    const ping = document.createElement('div');
    ping.className = `cell-ping cell-ping--${suspect}`;
    ping.dataset.mapLabelKey = `${suspect}-${pingId}`;
    setStoredMapPointPosition(ping, pct);
    ping.innerHTML = `
      <span class="cell-ping__dot"></span>
      <span class="cell-ping__ring"></span>
      <span class="cell-ping__ring cell-ping__ring--2"></span>
      <span class="cell-ping__label">${escapeHtml(`${getSuspectFirstName(suspect)} - ${timeStr}`)}</span>
    `;
    overlayHost.appendChild(ping);

    requestAnimationFrame(() => {
      ping.classList.add('is-on');
      scheduleMapLabelLayout();
    });

    seedCellTrail(suspect, overlayLayout);
    const point = { left: pct.left, top: pct.top };
    plottedPoint = point;
    const prev = pingTrail[suspect][pingTrail[suspect].length - 1] || null;
    pingTrail[suspect].push(point);
    if (prev) drawCellTrailSegment(suspect, prev, point);
  }

  revealCellularTrajectoryCaption(suspect);
  return plottedPoint;
}

async function handlePlotCellularPath(button) {
  const suspect = normalizeCellularSuspectKey(button.dataset.suspect || state.selectedSuspect);
  const workflow = getWorkflow();
  if (workflow.plottingCellularPath || isCellularPathComplete(suspect)) return;

  syncActiveCellularSuspect(suspect, {
    updateCoach: false,
    refreshPanels: false,
  });
  workflow.plottingCellularPath = suspect;
  const token = ++cellularPlotToken;
  refreshWorkflowUi();

  try {
    const pings = CELL_PINGS[suspect] || [];
    for (let index = 0; index < pings.length; index += 1) {
      if (token !== cellularPlotToken) return;
      const ping = pings[index];
      const plottedPoint = plotCellPing({
        suspect,
        pingId: index,
        tower: ping.tower,
        locStr: ping.loc,
        timeStr: ping.time,
      });
      refreshWorkflowUi();
      if (plottedPoint) {
        focusMapOnPercentPoint(plottedPoint);
      }
      if (index < pings.length - 1) {
        await wait(CELLULAR_PLOT_STEP_DELAY_MS);
      }
    }
  } finally {
    if (token === cellularPlotToken) {
      workflow.plottingCellularPath = '';
      refreshWorkflowUi(allCellularPathsComplete() ? 'cellular' : '');
    }
  }
}

function bringPopupToFront(popup) {
  popupZCounter += 1;
  popup.style.zIndex = String(popupZCounter);
}

function makeDraggable(el, handle) {
  handle.style.cursor = 'grab';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const container = el.parentElement;
    if (!container) return;
    bringPopupToFront(el);
    handle.style.cursor = 'grabbing';
    const rect  = el.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    const { gap } = getPopupMetrics();
    const offX  = e.clientX - rect.left;
    const offY  = e.clientY - rect.top;

    function onMove(ev) {
      const maxLeft = Math.max(gap, container.clientWidth - el.offsetWidth - gap);
      const maxTop = Math.max(gap, container.clientHeight - el.offsetHeight - gap);
      const nextLeft = clamp(ev.clientX - bounds.left - offX, gap, maxLeft);
      const nextTop = clamp(ev.clientY - bounds.top - offY, gap, maxTop);
      el.style.left   = `${nextLeft}px`;
      el.style.top    = `${nextTop}px`;
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
}

function renderEvidenceContent(key) {
  switch (key) {
    case 'phone':                return renderEvidencePhone();
    case 'cellular':             return renderEvidenceCellular(state.selectedSuspect || 'karim');
    case 'cellular-karim':       return renderEvidenceCellular('karim');
    case 'cellular-samir':       return renderEvidenceCellular('samir');
    case 'google':               return renderEvidenceGoogle();
    case 'conversations':        return renderEvidenceConversations('neighbor');
    case 'conversations-neighbor': return renderEvidenceConversations('neighbor');
    case 'conversations-karim':  return renderEvidenceConversations('karim');
    case 'conversations-samir':  return renderEvidenceConversations('samir');
    case 'google-login':         return renderEvidenceGoogleEvent('login');
    case 'delete-attempt-1':     return renderEvidenceGoogleEvent('delete1');
    case 'delete-attempt-2':     return renderEvidenceGoogleEvent('delete2');
    case 'witness-call':         return renderEvidenceWitnessCall();
    default: return '';
  }
}

function renderEvidencePhone() {
  const karimName = getCharacterName('karim', 'Karim');
  const samirName = getCharacterName('samir', 'Samir');
  const witnessName = getCharacterName('witness', 'Fatima Zahra El Idrissi');
  const calls = sortCaseDateTimeEntries([
    { name: witnessName,      sub: evidenceText('phone.calls.missedTwo', 'Missed · 2 calls'),       time: 'May 18  06:24',    type: 'missed' },
    { name: samirName,        sub: evidenceText('phone.calls.incoming215', 'Incoming · 2 min 15 s'), time: 'May 17  20:14',    type: 'in' },
    { name: karimName,        sub: evidenceText('phone.calls.outgoing108', 'Outgoing · 1 min 08 s'), time: 'May 16  14:22',    type: 'out' },
    { name: karimName,        sub: evidenceText('phone.calls.missedTwo', 'Missed · 2 calls'),       time: 'May 16  18:41',    type: 'missed' },
    { name: samirName,        sub: evidenceText('phone.calls.outgoing045', 'Outgoing · 0 min 45 s'), time: 'May 15  20:33',    type: 'out' },
    { name: evidenceText('phone.unknownNumber', 'Unknown number'), sub: evidenceText('phone.calls.missed', 'Missed'), time: 'May 13  22:08', type: 'missed' },
  ], (call) => call.time, 'desc');

  return `
    <div class="ev-tag" style="--ev-color:var(--c-phone)">
      <span class="ev-tag__num">${escapeHtml(evidenceLabel('01'))}</span>
      <span class="ev-tag__title">${escapeHtml(evidenceText('phone.tagTitle', "Victim's Phone — RB-17-042"))}</span>
      <span class="ev-tag__status ev-tag__status--secured">&#9679; ${escapeHtml(evidenceText('common.status.secured', 'SECURED'))}</span>
    </div>
    <div class="iph">
      <div class="iph-status">
        <span class="iph-status__time">9:41</span>
        <div class="iph-status__right">
          <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true"><rect x="0" y="9" width="3" height="3" rx="0.5" fill="white"/><rect x="4.5" y="6" width="3" height="6" rx="0.5" fill="white"/><rect x="9" y="3" width="3" height="9" rx="0.5" fill="white"/><rect x="13.5" y="0" width="3" height="12" rx="0.5" fill="white"/></svg>
          <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><rect x=".5" y=".5" width="13" height="9" rx="1.5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><rect x="1.8" y="1.8" width="7" height="6.4" rx=".8" fill="#30d158"/><path d="M14 3.5L14 7" stroke="rgba(255,255,255,.4)" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
      </div>
      <div class="iph-nav">
        <button class="iph-nav__back">&#8249; ${escapeHtml(evidenceText('phone.navBack', 'Phone'))}</button>
        <span class="iph-nav__title">${escapeHtml(evidenceText('phone.recents', 'Recents'))}</span>
        <button class="iph-nav__action">${escapeHtml(evidenceText('phone.edit', 'Edit'))}</button>
      </div>
      <div class="iph-seg">
        <button class="iph-seg__btn is-active">${escapeHtml(evidenceText('phone.all', 'All'))}</button>
        <button class="iph-seg__btn">${escapeHtml(evidenceText('phone.missed', 'Missed'))}</button>
      </div>
      <div class="iph-call-list">
        ${calls.map((c) => `
          <div class="iph-call-row${c.type === 'missed' ? ' iph-call-row--missed' : ''}">
            <div class="iph-call-row__avatar">${escapeHtml(c.name[0])}</div>
            <div class="iph-call-row__body">
              <span class="iph-call-row__name">${escapeHtml(c.name)}</span>
              <span class="iph-call-row__sub">&#x${ c.type === 'missed' ? '2198' : c.type === 'out' ? '2197' : '2198'};&#xFE0E; ${escapeHtml(c.sub)}</span>
            </div>
            <span class="iph-call-row__time">${escapeHtml(formatCaseTimestampLabel(c.time))}</span>
            <span class="iph-call-row__info">&#9432;</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderEvidenceCellular(suspectKey = 'karim') {
  const isKarim = suspectKey === 'karim';
  const evNum       = isKarim ? '02-A' : '02-B';
  const suspectName = isKarim
    ? getCharacterName('karim', 'Karim')
    : getCharacterName('samir', 'Samir');
  const karimFirstName = getSuspectFirstName('karim');
  const samirFirstName = getSuspectFirstName('samir');
  const suspectFirstName = getSuspectFirstName(suspectKey);
  const msisdn      = isKarim ? '+212-6-YY-YYY-YYY' : '+212-6-ZZ-ZZZ-ZZZ';
  const imei        = isKarim ? '86741205XXXXXXX' : '35820417XXXXXXX';
  const pings = (CELL_PINGS[suspectKey] || []).map((p, idx) => ({
    ...p,
    displayTime: formatCaseTimestampLabel(p.time),
    signal: p.signal || `-${75 + (idx % 4) * 3} dBm`,
    area: evidenceText(`cellular.areas.${suspectKey}.${idx}`, p.area || 'Estimated handset area'),
    confidence: p.confidence || 'MED',
    // Mark "alert" on incident-window pings (between 23:00 and 03:00).
    alert: (() => {
      const h = parseInt(p.time.slice(0, 2), 10);
      return h >= 23 || h < 3;
    })(),
  }));

  return `
    <div class="ev-tag" style="--ev-color:var(--c-cellular)">
      <span class="ev-tag__num">${escapeHtml(evidenceLabel(evNum))}</span>
      <span class="ev-tag__title">${escapeHtml(translate('evidenceUi.cellular.tagTitle', { suspect: suspectName }, `${suspectName} — Cellular`))}</span>
      <span class="ev-tag__status ev-tag__status--secured">&#9679; ${escapeHtml(evidenceText('common.status.certified', 'CERTIFIED'))}</span>
    </div>
    <div class="conv-tabs" role="tablist">
      <button class="conv-tab${isKarim ? ' is-active' : ''}" type="button"
              data-action="switch-cellular" data-suspect="karim" role="tab"
              data-coach-anchor="cellular-tab-karim"
              aria-selected="${isKarim}">${escapeHtml(karimFirstName)}</button>
      <button class="conv-tab${!isKarim ? ' is-active' : ''}" type="button"
              data-action="switch-cellular" data-suspect="samir" role="tab"
              data-coach-anchor="cellular-tab-samir"
              aria-selected="${!isKarim}">${escapeHtml(samirFirstName)}</button>
    </div>
    <div class="car">
      <div class="car-header">
        <div class="car-header__left">
          <strong>MAROC TELECOM</strong>
          <span>${escapeHtml(evidenceText('cellular.reportTitle', 'TECHNICAL EVIDENCE REPORT'))}</span>
          <span>${escapeHtml(evidenceText('cellular.reportRef', 'REF: RB-17-042 / JUDICIAL REQUEST'))}</span>
        </div>
        <div class="car-header__right">
          <span>${escapeHtml(evidenceText('cellular.dateLine', 'DATE: 2024-05-18'))}</span><br/>
          <span>${escapeHtml(evidenceText('cellular.statusLine', 'STATUS: CERTIFIED'))}</span><br/>
          <span>${escapeHtml(evidenceText('cellular.pagesLine', 'PAGES: 01 / 04'))}</span>
        </div>
      </div>
      <div class="car-body">
        <div>
          <span class="car-section__label">${escapeHtml(evidenceText('cellular.deviceInfo', 'Device Information'))}</span>
          <div class="car-info-grid">
            <div class="car-info-row"><span>MSISDN</span><span>${escapeHtml(msisdn)}</span></div>
            <div class="car-info-row"><span>IMEI</span><span>${escapeHtml(imei)}</span></div>
            <div class="car-info-row"><span>${escapeHtml(evidenceText('cellular.subscriber', 'SUBSCRIBER'))}</span><span>${escapeHtml(suspectName)}</span></div>
            <div class="car-info-row"><span>NETWORK</span><span>GSM / LTE / UMTS</span></div>
          </div>
        </div>
        <div>
          <span class="car-section__label">${escapeHtml(evidenceText('cellular.positions', 'Estimated handset positions'))}</span>
          <table class="car-table">
            <thead><tr><th>${escapeHtml(evidenceText('cellular.table.dateTime', 'DATE / TIME'))}</th><th>${escapeHtml(evidenceText('cellular.table.tower', 'TOWER'))}</th><th>${escapeHtml(evidenceText('cellular.table.position', 'EST. DEVICE POSITION'))}</th><th>${escapeHtml(evidenceText('cellular.table.confidence', 'CONF.'))}</th></tr></thead>
            <tbody>
              ${pings.map((p, idx) => `
                <tr class="${isCellularPingPlotted(suspectKey, idx) ? 'is-plotted' : ''}" data-cell-ping data-suspect="${escapeHtml(suspectKey)}" data-ping="${idx}" data-time="${escapeHtml(p.time)}" data-coord="${escapeHtml(p.loc)}" data-location-label="${escapeHtml(p.area)}" data-tower="${escapeHtml(p.tower)}">
                  <td${p.alert ? ' class="car-alert"' : ''} data-coach-anchor="cellular-row-${escapeHtml(suspectKey)}">${escapeHtml(p.displayTime)}</td>
                  <td>${escapeHtml(p.tower)}</td>
                  <td class="car-location-cell"><strong>${escapeHtml(p.area)}</strong><small>${escapeHtml(p.loc)}</small></td>
                  <td><span class="car-confidence car-confidence--${escapeHtml(p.confidence.toLowerCase())}">${escapeHtml(evidenceText(`cellular.confidence.${p.confidence.toLowerCase()}`, p.confidence))}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p class="cellular-hint">${escapeHtml(translate('analysis.cellular.plotHint', undefined, 'Use Plot data on the map to place the records in order.'))}</p>
          <p class="cellular-trajectory" data-trajectory="${escapeHtml(suspectKey)}" ${isCellularPathComplete(suspectKey) ? '' : 'hidden'}>${isCellularPathComplete(suspectKey) ? escapeHtml(translate('analysis.cellular.trajectoryComplete', { suspect: suspectFirstName }, `${suspectFirstName} traveled toward the victim's house.`)) : ''}</p>
        </div>
        <div>
          <span class="car-section__label">${escapeHtml(evidenceText('cellular.evidenceStatus', 'Evidence Status'))}</span>
          <span class="car-badge car-badge--ok">${escapeHtml(evidenceText('cellular.chainOfCustody', 'CHAIN OF CUSTODY INTACT'))}</span>
        </div>
      </div>
    </div>
  `;
}

function renderEvidenceGoogle() {
  return `
    <div class="ev-tag" style="--ev-color:var(--c-google)">
      <span class="ev-tag__num">${escapeHtml(evidenceLabel('03'))}</span>
      <span class="ev-tag__title">${escapeHtml(evidenceText('google.tagTitle', 'Google Account — Remote Activity Log'))}</span>
      <span class="ev-tag__status ev-tag__status--blocked">&#9679; ${escapeHtml(evidenceText('common.status.blocked', 'BLOCKED'))}</span>
    </div>
    <div class="ggl">
      <div class="ggl-bar">
        <span class="ggl-bar__lock">&#128274;</span>
        <span class="ggl-bar__url">myaccount.google.com/security/activity</span>
        <span class="ggl-bar__dots">&bull;&bull;&bull;</span>
      </div>
      <div class="ggl-header">
        <div class="ggl-logo"><span class="G">G</span><span class="o1">o</span><span class="o2">o</span><span class="g">g</span><span class="l">l</span><span class="e">e</span></div>
        <span class="ggl-acct">youssef.elmansouri@gmail.com</span>
      </div>
      <div class="ggl-body">
        <div class="ggl-alert">
          <div class="ggl-alert__icon ggl-alert__icon--red">!</div>
          <div class="ggl-alert__body">
            <strong>${escapeHtml(evidenceText('google.alertTitle', 'Critical security alert'))}</strong>
            <p>${escapeHtml(evidenceText('google.alertBody', 'Your account was signed in from an unfamiliar location and two deletion attempts were made and blocked. Immediate review recommended.'))}</p>
          </div>
        </div>
        <div class="ggl-section">
          <p class="ggl-section__title">${escapeHtml(evidenceText('google.recentEvents', 'Recent security events'))}</p>
          <div class="ggl-list">
            <div class="ggl-row">
              <div class="ggl-row__icon ggl-row__icon--warn">&#9888;</div>
              <div class="ggl-row__body">
                <strong>${escapeHtml(evidenceText('google.rows.loginTitle', 'New sign-in detected'))}</strong>
                <span>${escapeHtml(evidenceText('google.rows.loginMeta', 'May 18, 07:24 · Hassan district, Rabat · Samsung Galaxy'))}</span>
              </div>
              <span class="ggl-row__badge ggl-row__badge--warn">${escapeHtml(evidenceText('common.status.alert', 'ALERT'))}</span>
            </div>
            <div class="ggl-row">
              <div class="ggl-row__icon ggl-row__icon--block">&#9940;</div>
              <div class="ggl-row__body">
                <strong>${escapeHtml(evidenceText('google.rows.resetTitle', 'Remote factory reset — blocked'))}</strong>
                <span>${escapeHtml(evidenceText('google.rows.resetMeta', 'May 18, 07:26 · Faraday isolation active'))}</span>
              </div>
              <span class="ggl-row__badge ggl-row__badge--block">${escapeHtml(evidenceText('common.status.blocked', 'BLOCKED'))}</span>
            </div>
            <div class="ggl-row">
              <div class="ggl-row__icon ggl-row__icon--block">&#9940;</div>
              <div class="ggl-row__body">
                <strong>${escapeHtml(evidenceText('google.rows.wipeTitle', 'Account data wipe — blocked'))}</strong>
                <span>${escapeHtml(evidenceText('google.rows.wipeMeta', 'May 18, 07:29 · Faraday isolation active'))}</span>
              </div>
              <span class="ggl-row__badge ggl-row__badge--block">${escapeHtml(evidenceText('common.status.blocked', 'BLOCKED'))}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="ggl-actions">
        <button class="ggl-btn ggl-btn--primary">${escapeHtml(evidenceText('google.reviewActivity', 'Review activity'))}</button>
        <button class="ggl-btn ggl-btn--secondary">${escapeHtml(evidenceText('google.secureAccount', 'Secure account'))}</button>
      </div>
      <div class="ggl-footer">
        <span>Google Account</span>
        <span>&middot; ${escapeHtml(evidenceText('google.privacy', 'Privacy Policy'))}</span>
        <span>&middot; ${escapeHtml(evidenceText('google.help', 'Help'))}</span>
      </div>
    </div>
  `;
}

function renderEvidenceConversations(threadKey = 'neighbor') {
  const data = getData();
  const threads = data.details?.conversations?.threads || {};
  const tabs = [
    { key: 'neighbor', label: evidenceText('conversations.tabs.neighbor', 'Housekeeper'), evNum: '04-N' },
    { key: 'karim',    label: evidenceText('conversations.tabs.karim', 'Karim'), evNum: '04-A' },
    { key: 'samir',    label: evidenceText('conversations.tabs.samir', 'Samir'), evNum: '04-B' },
  ].filter((t) => threads[t.key]);

  // Default to first available tab if requested key has no data.
  if (!threads[threadKey] && tabs.length) threadKey = tabs[0].key;

  const active = tabs.find((t) => t.key === threadKey) || tabs[0] || { key: 'karim', label: 'Karim', evNum: '04-A' };
  const thread = threads[active.key] || {};
  const contactName = active.key === 'neighbor'
    ? getCharacterName('witness', 'Fatima Zahra El Idrissi')
    : active.key === 'karim'
      ? getCharacterName('karim', 'Karim')
      : getCharacterName('samir', 'Samir');

  return `
    <div class="ev-tag" style="--ev-color:var(--c-conversations)">
      <span class="ev-tag__num">${escapeHtml(evidenceLabel(active.evNum))}</span>
      <span class="ev-tag__title">${escapeHtml(translate('evidenceUi.conversations.threadTitle', { contact: contactName }, `Thread — ${contactName}`))}</span>
      <span class="ev-tag__status ev-tag__status--secured">&#9679; ${escapeHtml(evidenceText('common.status.extracted', 'EXTRACTED'))}</span>
    </div>
    <div class="conv-tabs" role="tablist">
      ${tabs.map((t) => `
        <button class="conv-tab${t.key === active.key ? ' is-active' : ''}" type="button"
                data-action="switch-conversation" data-thread="${escapeHtml(t.key)}" role="tab"
                data-coach-anchor="conversation-${escapeHtml(t.key)}"
                aria-selected="${t.key === active.key}">${escapeHtml(t.label)}</button>
      `).join('')}
    </div>
    <div class="iph">
      <div class="iph-status">
        <span class="iph-status__time">9:41</span>
        <div class="iph-status__right">
          <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true"><rect x="0" y="9" width="3" height="3" rx="0.5" fill="white"/><rect x="4.5" y="6" width="3" height="6" rx="0.5" fill="white"/><rect x="9" y="3" width="3" height="9" rx="0.5" fill="white"/><rect x="13.5" y="0" width="3" height="12" rx="0.5" fill="white"/></svg>
          <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><rect x=".5" y=".5" width="13" height="9" rx="1.5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><rect x="1.8" y="1.8" width="7" height="6.4" rx=".8" fill="#30d158"/><path d="M14 3.5L14 7" stroke="rgba(255,255,255,.4)" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
      </div>
      <div class="iph-nav">
        <button class="iph-nav__back">&#8249; ${escapeHtml(evidenceText('conversations.messages', 'Messages'))}</button>
        <span class="iph-nav__title">${escapeHtml(contactName)}</span>
        <button class="iph-nav__action">&#9432;</button>
      </div>
      <div class="iph-messages">
        ${(thread.messages || []).map((msg) => {
          const isOut = isVictimMessageAuthor(msg.author);
          const rowClass = isOut ? 'iph-bubble-row--out' : 'iph-bubble-row--in';
          // Per §10: never paint incoming bubbles red \u2014 keep neutral grey.
          const bubbleClass = isOut ? 'iph-bubble--out' : 'iph-bubble--in';
          return `
            <div class="iph-bubble-row ${rowClass}">
              <div class="iph-bubble ${bubbleClass}">${escapeHtml(msg.text || '')}</div>
              <span class="iph-bubble-time">${escapeHtml(msg.time || '')}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="iph-inputbar">
        <div class="iph-inputbar__add">+</div>
        <div class="iph-inputbar__field">${escapeHtml(evidenceText('conversations.inputPlaceholder', 'iMessage'))}</div>
        <div class="iph-inputbar__send">&#9650;</div>
      </div>
    </div>
  `;
}

function isVictimMessageAuthor(author) {
  const normalized = String(author || '').trim().toLowerCase();
  const localizedVictimName = getCharacterName('victim', 'Youssef');
  return [
    'Youssef',
    'Youssef',
    'يوسف',
    'يوسف',
    localizedVictimName,
  ].some((candidate) => String(candidate || '').trim().toLowerCase() === normalized);
}

function renderEvidenceGoogleEvent(type) {
  const events = {
    login: {
      icon: '&#9888;',
      iconClass: 'ggl-alert__icon--warn',
      title: evidenceText('googleEvent.login.title', 'New sign-in to your account'),
      body: evidenceText('googleEvent.login.body', 'Your Google Account was signed in from a new device at an unusual location.'),
      details: [
        { label: evidenceText('googleEvent.labels.time', 'Time'),     value: evidenceText('googleEvent.login.time', 'May 18, 2024 — 07:24') },
        { label: evidenceText('googleEvent.labels.device', 'Device'), value: 'Samsung Galaxy A54' },
        { label: evidenceText('googleEvent.labels.location', 'Location'), value: evidenceText('googleEvent.login.location', 'Hassan district, Rabat, Morocco') },
        { label: 'IP', value: '41.248.XX.XX (Maroc Telecom)' },
      ],
      tag: 'num', tagLabel: evidenceLabel('03-A'),
    },
    delete1: {
      icon: '&#9940;',
      iconClass: 'ggl-alert__icon--red',
      title: evidenceText('googleEvent.delete1.title', 'Remote factory reset — BLOCKED'),
      body: evidenceText('googleEvent.delete1.body', 'An attempt to remotely wipe the victim\'s device was prevented. The Faraday container blocked all wireless signals.'),
      details: [
        { label: evidenceText('googleEvent.labels.time', 'Time'), value: evidenceText('googleEvent.delete1.time', 'May 18, 2024 — 07:26') },
        { label: evidenceText('googleEvent.labels.action', 'Action'), value: evidenceText('googleEvent.delete1.action', 'Factory reset request (Find My Device)') },
        { label: evidenceText('googleEvent.labels.result', 'Result'), value: evidenceText('googleEvent.delete1.result', 'BLOCKED — Faraday isolation active') },
        { label: evidenceText('googleEvent.labels.origin', 'Origin'), value: evidenceText('googleEvent.delete1.origin', 'Hassan district, Rabat') },
      ],
      tag: 'block', tagLabel: evidenceLabel('03-B'),
    },
    delete2: {
      icon: '&#9940;',
      iconClass: 'ggl-alert__icon--red',
      title: evidenceText('googleEvent.delete2.title', 'Account data wipe — BLOCKED'),
      body: evidenceText('googleEvent.delete2.body', 'A second attempt to erase all account data and backup was detected and automatically blocked.'),
      details: [
        { label: evidenceText('googleEvent.labels.time', 'Time'), value: evidenceText('googleEvent.delete2.time', 'May 18, 2024 — 07:29') },
        { label: evidenceText('googleEvent.labels.action', 'Action'), value: evidenceText('googleEvent.delete2.action', 'Account data erasure (Google Dashboard)') },
        { label: evidenceText('googleEvent.labels.result', 'Result'), value: evidenceText('googleEvent.delete2.result', 'BLOCKED — Faraday isolation active') },
        { label: evidenceText('googleEvent.labels.origin', 'Origin'), value: evidenceText('googleEvent.delete2.origin', 'Hassan district, Rabat') },
      ],
      tag: 'block', tagLabel: evidenceLabel('03-C'),
    },
  };
  const ev = events[type] || events.login;

  return `
    <div class="ev-tag" style="--ev-color:var(--c-google)">
      <span class="ev-tag__num">${escapeHtml(ev.tagLabel)}</span>
      <span class="ev-tag__title">${escapeHtml(evidenceText('googleEvent.tagTitle', 'Google Account Security Event'))}</span>
      <span class="ev-tag__status ev-tag__status--blocked">&#9679; ${escapeHtml(ev.tag === 'block' ? evidenceText('common.status.blocked', 'BLOCKED') : evidenceText('common.status.alert', 'ALERT'))}</span>
    </div>
    <div class="ggl">
      <div class="ggl-bar">
        <span class="ggl-bar__lock">&#128274;</span>
        <span class="ggl-bar__url">myaccount.google.com/security/event</span>
        <span class="ggl-bar__dots">&bull;&bull;&bull;</span>
      </div>
      <div class="ggl-header">
        <div class="ggl-logo"><span class="G">G</span><span class="o1">o</span><span class="o2">o</span><span class="g">g</span><span class="l">l</span><span class="e">e</span></div>
        <span class="ggl-acct">youssef.elmansouri@gmail.com</span>
      </div>
      <div class="ggl-body">
        <div class="ggl-alert">
          <div class="ggl-alert__icon ${escapeHtml(ev.iconClass)}">${ev.icon}</div>
          <div class="ggl-alert__body">
            <strong>${escapeHtml(ev.title)}</strong>
            <p>${escapeHtml(ev.body)}</p>
          </div>
        </div>
        <div class="ggl-section">
          <p class="ggl-section__title">${escapeHtml(evidenceText('googleEvent.eventDetails', 'Event details'))}</p>
          <div class="ggl-list">
            ${ev.details.map((d) => `
              <div class="ggl-row">
                <div class="ggl-row__body">
                  <strong>${escapeHtml(d.label)}</strong>
                  <span>${escapeHtml(d.value)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="ggl-actions">
        <button class="ggl-btn ggl-btn--primary">${escapeHtml(evidenceText('googleEvent.reviewEvent', 'Review event'))}</button>
        <button class="ggl-btn ggl-btn--secondary">${escapeHtml(evidenceText('googleEvent.exportLog', 'Export log'))}</button>
      </div>
      <div class="ggl-footer">
        <span>Google Account</span>
        <span>&middot; ${escapeHtml(evidenceText('googleEvent.securityCenter', 'Security Center'))}</span>
      </div>
    </div>
  `;
}

function renderEvidenceWitnessCall() {
  const witnessName = getCharacterName('witness', 'Fatima Zahra El Idrissi');
  return `
    <div class="ev-tag" style="--ev-color:var(--warn)">
      <span class="ev-tag__num">${escapeHtml(evidenceLabel('04-W'))}</span>
      <span class="ev-tag__title">${escapeHtml(evidenceText('witnessCall.tagTitle', 'Housekeeper Call — Emergency Dispatch Record'))}</span>
      <span class="ev-tag__status ev-tag__status--secured">&#9679; ${escapeHtml(evidenceText('common.status.onRecord', 'ON RECORD'))}</span>
    </div>
    <div class="iph">
      <div class="iph-status">
        <span class="iph-status__time">06:30</span>
        <div class="iph-status__right">
          <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true"><rect x="0" y="9" width="3" height="3" rx="0.5" fill="white"/><rect x="4.5" y="6" width="3" height="6" rx="0.5" fill="white"/><rect x="9" y="3" width="3" height="9" rx="0.5" fill="white"/><rect x="13.5" y="0" width="3" height="12" rx="0.5" fill="white"/></svg>
          <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><rect x=".5" y=".5" width="13" height="9" rx="1.5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/><rect x="1.8" y="1.8" width="7" height="6.4" rx=".8" fill="#30d158"/><path d="M14 3.5L14 7" stroke="rgba(255,255,255,.4)" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
      </div>
      <div class="iph-nav">
        <button class="iph-nav__back">&#8249; ${escapeHtml(evidenceText('phone.recents', 'Recents'))}</button>
        <span class="iph-nav__title">${escapeHtml(evidenceText('witnessCall.title', 'Emergency Call'))}</span>
        <button class="iph-nav__action">${escapeHtml(evidenceText('phone.edit', 'Edit'))}</button>
      </div>
      <div class="iph-call-list">
        <div class="iph-call-row">
          <div class="iph-call-row__avatar" style="background:#1c3320;color:#30d158;font-size:22px">&#128222;</div>
          <div class="iph-call-row__body">
            <span class="iph-call-row__name">${escapeHtml(witnessName)}</span>
            <span class="iph-call-row__sub">${escapeHtml(evidenceText('witnessCall.outgoingDuration', 'Outgoing · 4 min 32 s'))}</span>
          </div>
          <span class="iph-call-row__time">${escapeHtml(formatCaseTimestampLabel('May 18  06:30'))}</span>
          <span class="iph-call-row__info">&#9432;</span>
        </div>
        <div class="iph-call-row">
          <div class="iph-call-row__avatar" style="background:#2c1414;color:#ff6b6b;font-size:16px">119</div>
          <div class="iph-call-row__body">
            <span class="iph-call-row__name" style="color:#fff">${escapeHtml(evidenceText('witnessCall.policeName', 'Police nationale (19)'))}</span>
            <span class="iph-call-row__sub">${escapeHtml(evidenceText('witnessCall.outgoingTransferred', 'Outgoing · Transferred'))}</span>
          </div>
          <span class="iph-call-row__time">${escapeHtml(formatCaseTimestampLabel('May 18  06:30'))}</span>
          <span class="iph-call-row__info" style="font-size:13px;color:#8e8e93;text-align:right">&#9432;</span>
        </div>
      </div>
      <div style="padding:14px 16px 8px;flex:1;background:#111;overflow-y:auto">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:8px">${escapeHtml(evidenceText('witnessCall.dispatchRecord', 'Dispatch record'))}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.8);line-height:1.65">
          <div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.08)"><span style="color:#8e8e93;min-width:80px;display:inline-block">06:30</span> ${escapeHtml(evidenceText('witnessCall.dispatch.0', "Call received — housekeeper reports unusual lights and no answer at the victim's house"))}</div>
          <div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.08)"><span style="color:#8e8e93;min-width:80px;display:inline-block">06:34</span> ${escapeHtml(evidenceText('witnessCall.dispatch.1', 'Patrol dispatched — 2 officers'))}</div>
          <div style="padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,0.08)"><span style="color:#8e8e93;min-width:80px;display:inline-block">06:48</span> ${escapeHtml(evidenceText('witnessCall.dispatch.2', 'Officers arrive on scene'))}</div>
          <div style="padding:5px 0"><span style="color:#8e8e93;min-width:80px;display:inline-block">06:56</span> ${escapeHtml(evidenceText('witnessCall.dispatch.3', 'Victim found — scene secured'))}</div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────────────────────────
   DEV TOOLS — marker / map positioning overlay
   Activated by: ?dev in URL (not shown in production)
───────────────────────────────────────────────────────────────── */
function initDevTools() {
  if (!isDevToolsEnabled) return;

  const INP  = 'width:52px;background:#0a1828;color:#e0f0ff;border:1px solid #2a4a6a;border-radius:2px;padding:2px 4px;font-size:10px;font-family:monospace;text-align:right';
  const INPW = 'width:72px;background:#0a1828;color:#e0f0ff;border:1px solid #2a4a6a;border-radius:2px;padding:2px 4px;font-size:10px;font-family:monospace;text-align:right';

  const pins = PINS;

  pins.forEach(({ sel }) => document.querySelector(sel)?.classList.add('is-visible'));

  function getGPS(sel) {
    const m = sel.match(/data-marker="([^"]+)"/);
    return m ? (MAP_CONFIG.markerGPS?.[m[1]] || null) : null;
  }

  function fromGPS(gps, b) {
    return {
      left: Math.round((gps.lon - b.west)  / (b.east  - b.west)  * 1000) / 10,
      top:  Math.round((b.north - gps.lat) / (b.north - b.south) * 1000) / 10,
    };
  }

  const b0 = MAP_CONFIG.bounds;
  const s = {
    zoom: MAP_CONFIG.pinZoom, offsetX: MAP_CONFIG.pinOffsetX, offsetY: MAP_CONFIG.pinOffsetY,
    bounds: { north: b0.north, south: b0.south, west: b0.west, east: b0.east },
    pins: pins.map(p => {
      const gps = getGPS(p.sel);
      return gps ? fromGPS(gps, b0) : { left: p.left, top: p.top };
    }),
  };

  function displayPos(i) {
    return {
      left: 50 + (s.pins[i].left - 50) * s.zoom + s.offsetX,
      top:  50 + (s.pins[i].top  - 50) * s.zoom + s.offsetY,
    };
  }
  function applyPin(i) {
    const el = document.querySelector(pins[i].sel);
    const pos = displayPos(i);
    const rect = getImageRenderedRect();
    if (!el || !rect) return;
    el.style.left = `${rect.x + (pos.left / 100) * rect.w}px`;
    el.style.top  = `${rect.y + (pos.top  / 100) * rect.h}px`;
  }
  function applyAllPins() { s.pins.forEach((_, i) => applyPin(i)); }

  function recomputeGPSPins() {
    pins.forEach((p, i) => {
      const gps = getGPS(p.sel);
      if (!gps) return;
      const pos = fromGPS(gps, s.bounds);
      s.pins[i].left = pos.left;
      s.pins[i].top  = pos.top;
      panel.querySelectorAll(`[data-pin="${i}"]`).forEach(inp => { inp.value = s.pins[i][inp.dataset.axis]; });
    });
    applyAllPins();
  }

  function getOutput() {
    const b = s.bounds;
    return [
      '/* MAP_CONFIG update (app.js) */',
      `  pinZoom: ${s.zoom}, pinOffsetX: ${s.offsetX}, pinOffsetY: ${s.offsetY},`,
      `  bounds: { north: ${b.north}, south: ${b.south}, west: ${b.west}, east: ${b.east} },`,
      '',
      '/* Secondary overlays are derived from the GPS markers in buildMapOverlayLayout(). */',
    ].join('\n');
  }

  let rows = '';
  pins.forEach((p, i) => {
    const hasGPS = !!getGPS(p.sel);
    const tag = hasGPS ? '<span style="font-size:8px;color:#3a9a6a;background:#0a2018;padding:0 3px;border-radius:2px;margin-left:3px">GPS</span>' : '';
    rows += `<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;padding:2px 0;border-bottom:1px solid #0d1e30">
      <span style="font-size:9px;color:#7ab;flex:1;white-space:nowrap">${p.label}${tag}</span>
      <label style="font-size:9px;color:#556;display:flex;align-items:center;gap:2px">L<input type="number" data-pin="${i}" data-axis="left" value="${s.pins[i].left}" step="0.5" min="0" max="100" style="${INP}"></label>
      <label style="font-size:9px;color:#556;display:flex;align-items:center;gap:2px">T<input type="number" data-pin="${i}" data-axis="top"  value="${s.pins[i].top}"  step="0.5" min="0" max="100" style="${INP}"></label>
    </div>`;
  });

  const panel = document.createElement('div');
  panel.innerHTML = `
    <div id="dt-drag" style="cursor:grab;padding:5px 10px;background:#091525;color:#58d0f8;font-size:10px;font-weight:700;letter-spacing:.12em;user-select:none;display:flex;align-items:center;justify-content:space-between">
      <span>&#9881; DEV TOOLS</span><span style="font-size:9px;color:#446;cursor:default">?dev</span>
    </div>
    <div style="padding:6px 8px;max-height:82vh;overflow-y:auto;scrollbar-width:thin">
      <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #0d1e30">
        <div style="font-size:9px;font-weight:700;color:#58d0f8;margin-bottom:3px;letter-spacing:.08em">BOUNDS <span style="font-weight:400;color:#2a7a5a">(recalcule GPS)</span></div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">N (north) <input type="number" id="dt-north" value="${b0.north}" step="0.001" style="${INPW}"></label>
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">S (south) <input type="number" id="dt-south" value="${b0.south}" step="0.001" style="${INPW}"></label>
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">W (west)  <input type="number" id="dt-west"  value="${b0.west}"  step="0.001" style="${INPW}"></label>
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">E (east)  <input type="number" id="dt-east"  value="${b0.east}"  step="0.001" style="${INPW}"></label>
        </div>
      </div>
      <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #0d1e30">
        <div style="font-size:9px;font-weight:700;color:#58d0f8;margin-bottom:3px;letter-spacing:.08em">PIN OFFSET</div>
        <div style="display:flex;flex-direction:column;gap:2px">
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">zoom    <input type="number" id="dt-zoom"    value="${s.zoom}"    step="0.05" min="0.5" max="3"    style="${INP}"></label>
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">offsetX <input type="number" id="dt-offsetX" value="${s.offsetX}" step="1"    min="-100" max="100" style="${INP}"></label>
          <label style="font-size:9px;color:#7ab;display:flex;align-items:center;justify-content:space-between;gap:6px">offsetY <input type="number" id="dt-offsetY" value="${s.offsetY}" step="1"    min="-100" max="100" style="${INP}"></label>
        </div>
      </div>
      <div style="font-size:9px;font-weight:700;color:#58d0f8;margin-bottom:3px;letter-spacing:.08em">PINS</div>
      ${rows}
      <button id="dt-copy" style="margin-top:8px;width:100%;padding:4px;background:#58d0f8;color:#03080f;font-weight:700;font-size:10px;border:none;border-radius:3px;cursor:pointer;letter-spacing:.06em">COPY OUTPUT</button>
      <pre id="dt-out" style="display:none;margin-top:6px;font-size:8.5px;color:#8af;background:#060e1a;padding:6px;border-radius:3px;white-space:pre-wrap;max-height:130px;overflow-y:auto;line-height:1.5"></pre>
    </div>`;

  Object.assign(panel.style, {
    position: 'fixed', top: '58px', right: '12px', width: '250px',
    background: '#040e1c', border: '1px solid #1a3a5a', borderRadius: '4px',
    zIndex: '99999', fontFamily: 'monospace', boxShadow: '0 6px 24px rgba(0,0,0,0.85)', pointerEvents: 'auto',
  });
  document.body.appendChild(panel);

  const handle = panel.querySelector('#dt-drag');
  let dragging = false, dX = 0, dY = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    const r = panel.getBoundingClientRect();
    dX = e.clientX - r.left; dY = e.clientY - r.top;
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    panel.style.left = `${e.clientX - dX}px`; panel.style.top = `${e.clientY - dY}px`; panel.style.right = 'auto';
  });
  document.addEventListener('pointerup', () => { dragging = false; handle.style.cursor = 'grab'; });

  panel.addEventListener('input', e => {
    const inp = e.target;
    const v = parseFloat(inp.value);
    if (isNaN(v)) return;
    if      (inp.id === 'dt-north') { s.bounds.north = v; recomputeGPSPins(); }
    else if (inp.id === 'dt-south') { s.bounds.south = v; recomputeGPSPins(); }
    else if (inp.id === 'dt-west')  { s.bounds.west  = v; recomputeGPSPins(); }
    else if (inp.id === 'dt-east')  { s.bounds.east  = v; recomputeGPSPins(); }
    else if (inp.id === 'dt-zoom')    { s.zoom    = v; applyAllPins(); }
    else if (inp.id === 'dt-offsetX') { s.offsetX = v; applyAllPins(); }
    else if (inp.id === 'dt-offsetY') { s.offsetY = v; applyAllPins(); }
    else if (inp.dataset.pin !== undefined) {
      const i = +inp.dataset.pin;
      s.pins[i][inp.dataset.axis] = v;
      applyPin(i);
    }
  });

  panel.querySelector('#dt-copy').addEventListener('click', () => {
    const out = getOutput();
    navigator.clipboard?.writeText(out).catch(() => {});
    const pre = panel.querySelector('#dt-out');
    pre.textContent = out;
    pre.style.display = 'block';
  });

  applyAllPins();
}
