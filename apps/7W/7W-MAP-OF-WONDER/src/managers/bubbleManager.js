// bubbleManager.js
// Manages the CSS3D bubbles linked to wonders.

import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { cubeWonderMap, showWonderPanel } from '../data/wonders.js?v=20261026a'; // same URL as main.js: one shared module
import { getResourcePath } from '../utils/fileLoader.js';
import { groupCubes } from '../core/map.js';

const BUBBLE_SCREEN_SIZE = 42; // target diameter in CSS pixels
const BUBBLE_BORDER_RATIO = 0.022222; // 0.12 / 5.4
const BUBBLE_SHADOW_OFFSET_RATIO = 0.041667; // 0.225 / 5.4
const BUBBLE_SHADOW_BLUR_RATIO = 0.166667; // 0.9 / 5.4
const SNAP_DISTANCE_RATIO = 0.35; // anchor jump, as a share of the viewport width, from which an icon is placed directly
export function createBubbleManager({ scene, camera, viewport }) {
  const wonderBubbles = [];

  const tmpVecA = new THREE.Vector3();
  const tmpVecB = new THREE.Vector3();
  const tmpVecC = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  let lastViewportWidth = Math.max(viewport.clientWidth, 1);
  let lastViewportHeight = Math.max(viewport.clientHeight, 1);
  let warnedEmptyWonderMap = false;
  let lastFrameTime = null;
  let fpsAverage = 0;
  let debugElement = null;
  const debugEnabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

  function pxToVw(px) {
    return `${(px / Math.max(viewport.clientWidth, 1)) * 100}vw`;
  }

  function applyBubbleSizing(element) {
    if (!element || !element.style) return;
    const size = pxToVw(BUBBLE_SCREEN_SIZE);
    const shadowOffset = pxToVw(BUBBLE_SCREEN_SIZE * BUBBLE_SHADOW_OFFSET_RATIO);
    const shadowBlur = pxToVw(BUBBLE_SCREEN_SIZE * BUBBLE_SHADOW_BLUR_RATIO);
    const border = pxToVw(BUBBLE_SCREEN_SIZE * BUBBLE_BORDER_RATIO);
    element.style.width = size;
    element.style.height = size;
    element.style.boxShadow = `0 ${shadowOffset} ${shadowBlur} #0008`;
    element.style.border = `${border} solid #ffc107`;
  }

  function refreshBubbleStyles() {
    wonderBubbles.forEach(bubble => {
      const element = bubble.element || bubble.object;
      applyBubbleSizing(element);
    });
  }

  function removeExistingEntries(wonderId) {
    for (let i = wonderBubbles.length - 1; i >= 0; i--) {
      const bubble = wonderBubbles[i];
      if (bubble && bubble.userData && bubble.userData.wonderId === wonderId) {
        if (bubble.parent) bubble.parent.remove(bubble);
        wonderBubbles.splice(i, 1);
      }
    }
  }

  function resolveImageSource(wonder) {
    if (wonder.img) {
      return wonder.img;
    }
    if (wonder.model && typeof wonder.model === 'string') {
      const base = wonder.model.replace(/^.*\/(.*?)\.obj$/i, '$1');
      const pngPath = getResourcePath(`Ressource/${base}.png`);
      return pngPath;
    }
    return getResourcePath('Ressource/Background.png');
  }

  function buildBubbleElement(wonder, imgSrc) {
    const div = document.createElement('div');
    div.className = 'wonder-bubble';
    applyBubbleSizing(div);
    div.style.borderRadius = '50%';
    div.style.overflow = 'hidden';
    div.style.background = '#fff';
    div.style.cursor = 'pointer';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.style.transition = '';
    div.style.pointerEvents = 'auto';
    div.style.userSelect = 'none';
    div.setAttribute('unselectable', 'on');
    div.onselectstart = () => false;
    div.onclick = (e) => {
      const rect = div.getBoundingClientRect();
      showWonderPanel(wonder, rect.left + rect.width / 2, rect.top + rect.height / 2);
      e.stopPropagation();
    };
    const img = document.createElement('img');
    img.src = imgSrc;
    const fallbackSrc = getResourcePath('Ressource/Background.png');
    img.onerror = () => {
      if (img.src !== fallbackSrc) img.src = fallbackSrc;
    };
    img.alt = wonder.name || '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.userSelect = 'none';
    img.setAttribute('unselectable', 'on');
    div.appendChild(img);
    try {
      div.dataset.wonderId = String(wonder.id);
    } catch (err) {
      div.setAttribute('data-wonder-id', String(wonder.id));
    }
    return div;
  }

  function createBubble(wonder, mesh3d) {
    removeExistingEntries(wonder.id);
    const imgSrc = resolveImageSource(wonder);
    const element = buildBubbleElement(wonder, imgSrc);

    const cssObj = new CSS3DObject(element);
    cssObj.userData.wonderId = wonder.id;
    cssObj.userData.isBubble = true;
    cssObj.userData.targetMesh = mesh3d;
    cssObj.position.set(0, 0, 0);
    cssObj.visible = true;
    scene.add(cssObj);
    wonderBubbles.push(cssObj);

    return cssObj;
  }

  function clear() {
    wonderBubbles.forEach(bubble => {
      if (bubble && bubble.parent) bubble.parent.remove(bubble);
    });
    wonderBubbles.length = 0;
  }

  function selectClosestMeshInstance(wonderId) {
    if (!Array.isArray(groupCubes) || groupCubes.length === 0 || typeof cubeWonderMap !== 'object') {
      return null;
    }
    let best = null;
    let bestDist = Infinity;
    tmpVecA.copy(camera.position);
    groupCubes.forEach(obj => {
      const wonder = cubeWonderMap.get(obj);
      if (wonder && String(wonder.id) === String(wonderId)) {
        obj.getWorldPosition(tmpVecB);
        const dist = tmpVecB.distanceToSquared(tmpVecA);
        if (dist < bestDist) {
          bestDist = dist;
          best = obj;
        }
      }
    });
    return best;
  }

  function collectBubbleEntries() {
    const zoomBase = 500;
    const camDir = new THREE.Vector3();
    const entries = [];
    wonderBubbles.forEach(bubble => {
      let mesh = bubble.userData && bubble.userData.targetMesh;
      const wonderId = bubble.userData && bubble.userData.wonderId;
      if (wonderId) {
        const closest = selectClosestMeshInstance(wonderId);
        if (closest) mesh = closest;
      }
      if (!mesh || !mesh.parent) return;
      mesh.updateMatrixWorld(true);
      tmpBox.setFromObject(mesh);
      tmpBox.getSize(tmpSize);
      tmpBox.getCenter(tmpCenter);
      tmpVecC.set(tmpCenter.x, tmpCenter.y + tmpSize.y * 0.1, tmpCenter.z - 50);
      camera.getWorldDirection(camDir);
      tmpVecC.addScaledVector(camDir, -24);
      if (!bubble.userData.anchorPos) {
        bubble.userData.anchorPos = tmpVecC.clone();
      } else {
        bubble.userData.anchorPos.copy(tmpVecC);
      }
      const distanceToCamera = camera.position.distanceTo(tmpVecC);
      const scaleFactor = distanceToCamera / zoomBase;
      bubble.scale.set(scaleFactor, scaleFactor, scaleFactor);

      const clipPos = bubble.userData.anchorPos.clone().project(camera);
      const anchorScreenX = (clipPos.x + 1) * 0.5 * viewport.clientWidth;
      const anchorScreenY = (-clipPos.y + 1) * 0.5 * viewport.clientHeight;

      // The nearest copy of the map changed (or the camera jumped): move the icon there directly instead of flying across the screen.
      const lastAnchor = bubble.userData.lastAnchor;
      if (lastAnchor && Math.hypot(anchorScreenX - lastAnchor.x, anchorScreenY - lastAnchor.y) > viewport.clientWidth * SNAP_DISTANCE_RATIO) {
        bubble.userData.screenPos = { x: anchorScreenX, y: anchorScreenY };
        bubble.userData.snap = true;
      }
      bubble.userData.lastAnchor = { x: anchorScreenX, y: anchorScreenY };

      if (!bubble.userData.screenPos) {
        bubble.userData.screenPos = { x: anchorScreenX, y: anchorScreenY };
      } else {
        bubble.userData.screenPos.x += (anchorScreenX - bubble.userData.screenPos.x) * 0.25;
        bubble.userData.screenPos.y += (anchorScreenY - bubble.userData.screenPos.y) * 0.25;
      }

      entries.push({
        bubble,
        clipZ: clipPos.z,
        anchorScreen: { x: anchorScreenX, y: anchorScreenY },
        screenPos: bubble.userData.screenPos
      });
    });
    return entries;
  }

  function resolveScreenCollisions(entries) {
    const minDistance = BUBBLE_SCREEN_SIZE * 1.4;
    const maxOffset = BUBBLE_SCREEN_SIZE * 7;
    for (let iteration = 0; iteration < 8; iteration++) {
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i];
        for (let j = i + 1; j < entries.length; j++) {
          const b = entries[j];
          const dx = a.screenPos.x - b.screenPos.x;
          const dy = a.screenPos.y - b.screenPos.y;
          const distSq = dx * dx + dy * dy;
          if (distSq === 0) {
            const jitter = (Math.random() - 0.5) * 0.01;
            a.screenPos.x += jitter;
            a.screenPos.y += jitter;
            continue;
          }
          const dist = Math.sqrt(distSq);
          if (dist < minDistance) {
            const overlap = (minDistance - dist) / dist * 0.5;
            const moveX = dx * overlap;
            const moveY = dy * overlap;
            a.screenPos.x += moveX;
            a.screenPos.y += moveY;
            b.screenPos.x -= moveX;
            b.screenPos.y -= moveY;
          }
        }
      }
      entries.forEach(entry => {
        entry.screenPos.x += (entry.anchorScreen.x - entry.screenPos.x) * 0.05;
        entry.screenPos.y += (entry.anchorScreen.y - entry.screenPos.y) * 0.05;
        const offsetX = entry.screenPos.x - entry.anchorScreen.x;
        const offsetY = entry.screenPos.y - entry.anchorScreen.y;
        const offsetDist = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
        if (offsetDist > maxOffset) {
          const scale = maxOffset / offsetDist;
          entry.screenPos.x = entry.anchorScreen.x + offsetX * scale;
          entry.screenPos.y = entry.anchorScreen.y + offsetY * scale;
        }
      });
    }
  }

  function applyScreenTargets(entries) {
    entries.forEach(entry => {
      const { bubble, screenPos, clipZ } = entry;
      const ndcX = (screenPos.x / Math.max(viewport.clientWidth, 1)) * 2 - 1;
      const ndcY = -(screenPos.y / Math.max(viewport.clientHeight, 1)) * 2 + 1;
      const worldPos = tmpVecA.set(ndcX, ndcY, clipZ).unproject(camera);
      if (!bubble.userData.targetPos) {
        bubble.userData.targetPos = worldPos.clone();
      } else {
        bubble.userData.targetPos.copy(worldPos);
      }
      const htmlEl = bubble.element || bubble.object;
      if (htmlEl && htmlEl.style) {
        htmlEl.style.transform = '';
      }
    });
  }

  function applyBubbleLerp() {
    const lerpFactor = 0.15;
    wonderBubbles.forEach(bubble => {
      if (bubble.userData && bubble.userData.targetPos) {
        if (bubble.userData.snap) {
          bubble.position.copy(bubble.userData.targetPos);
          bubble.userData.snap = false;
        } else {
          bubble.position.lerp(bubble.userData.targetPos, lerpFactor);
        }
      }
    });
  }

  // Safety net: icons are matched to the nearest copy of the map through cubeWonderMap.
  function warnIfWonderMapIsEmpty() {
    if (warnedEmptyWonderMap || !Array.isArray(groupCubes) || groupCubes.length === 0 || cubeWonderMap.size > 0) return;
    warnedEmptyWonderMap = true;
    console.error('[bubbles] cubeWonderMap is empty: data/wonders.js is probably loaded twice (every import must use the same ?v=)');
  }

  // ?debug=1 shows the frame rate and how many icons are on screen (for field diagnosis).
  function updateDebug(entries) {
    if (!debugEnabled) return;
    if (!debugElement) {
      debugElement = document.createElement('div');
      debugElement.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;padding:4px 8px;'
        + 'font:12px/1.4 monospace;color:#fff;background:rgba(0,0,0,.65);pointer-events:none';
      document.body.appendChild(debugElement);
    }
    const now = performance.now();
    if (lastFrameTime !== null && now > lastFrameTime) {
      const fps = 1000 / (now - lastFrameTime);
      fpsAverage = fpsAverage ? fpsAverage * 0.9 + fps * 0.1 : fps;
    }
    lastFrameTime = now;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const onScreen = entries.filter(entry => entry.anchorScreen.x > 0 && entry.anchorScreen.x < width
      && entry.anchorScreen.y > 0 && entry.anchorScreen.y < height).length;
    debugElement.textContent = `fps ${fpsAverage.toFixed(0)} | icons ${onScreen}/${wonderBubbles.length} on screen`
      + ` | camera x=${camera.position.x.toFixed(0)} z=${camera.position.z.toFixed(0)} | ${width}x${height}`;
  }

  function update() {
    const currentWidth = Math.max(viewport.clientWidth, 1);
    const currentHeight = Math.max(viewport.clientHeight, 1);
    if (currentWidth !== lastViewportWidth || currentHeight !== lastViewportHeight) {
      lastViewportWidth = currentWidth;
      lastViewportHeight = currentHeight;
      refreshBubbleStyles();
    }
    warnIfWonderMapIsEmpty();
    const entries = collectBubbleEntries();
    resolveScreenCollisions(entries);
    applyScreenTargets(entries);
    applyBubbleLerp();
    updateDebug(entries);
  }

  return {
    createBubble,
    clear,
    update,
    refreshStyles: refreshBubbleStyles
  };
}
