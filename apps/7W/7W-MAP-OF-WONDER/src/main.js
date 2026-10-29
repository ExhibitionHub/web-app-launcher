import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { setupInfiniteMap, checkInfiniteScroll, groupCubes, setScrollSize } from './core/map.js';
import { cubeWonderMap, showWonderPanel, fetchWonders } from './data/wonders.js?v=20261026a';
import { setupControls } from './managers/controls.js';
import { loadFileAsText, loadFileAsArrayBuffer, getResourcePath } from './utils/fileLoader.js';
import { initEnvironment } from './core/environment.js';
import { loadTextureWithFallback } from './core/textureLoader.js?v=20260730a';
import { createBubbleManager } from './managers/bubbleManager.js?v=20261026a';
import { createWonderObjectFactory } from './core/wonderObjects.js?v=20260730b';
import { createTouchCursor, removeTouchCursor, removeAllTouchCursors, getPointerColor } from './managers/cursorManager.js';

try { window.__MAP_APP_STARTED = true; } catch { /* ignore */ }

const translate = (key, vars, fallback = '') => {
  try {
    const i18n = window.i18n;
    const t = i18n && typeof i18n.t === 'function' ? i18n.t : null;
    if (!t) return String(fallback || key || '');
    const translated = t(String(key), vars);
    if (translated && translated !== key) return translated;
  } catch {
  }

  return String(fallback || key || '');
};

const { viewport, scene, camera, renderer, css3dRenderer } = initEnvironment();
const bubbleManager = createBubbleManager({ scene, camera, viewport });
const { createWonderObject, preloadWonderModels } = createWonderObjectFactory({ bubbleManager });

const idleOverlay = document.getElementById('idleOverlay');
const idleMessageEl = document.getElementById('idleMessage');
const mapTracking = window.EHTracking
  ? window.EHTracking.createTracker({
      exhibition: '7W',
      application: '7W-MAP-OF-WONDER',
      getLanguage: () => window.i18n?.lang || document.documentElement.lang || 'en',
    })
  : null;
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
const idleTimeoutMs = Number(meta('map-idle-timeout-ms') || '120000');
let bootUnlocked = false;
let idleActive = !!idleOverlay;
let idleTimer = null;

let mapTextureSettled = false;
let worldMapSettled = false;
let wondersSettled = false;
let idleMessageState = {
  mode: 'key',
  key: 'mapApp.idle.loading',
  vars: null,
  fallback: 'Loading...'
};

function setIdleMessage(text) {
  if (!idleMessageEl) return;
  try {
    idleMessageEl.textContent = String(text || '');
  } catch {
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

  return translate(idleMessageState.key, idleMessageState.vars, idleMessageState.fallback);
}

function refreshIdleMessage() {
  setIdleMessage(resolveIdleMessage());
}

function setIdleMessageKey(key, fallback, vars = null) {
  idleMessageState = { mode: 'key', key, vars, fallback };
  refreshIdleMessage();
}

function setIdleErrorMessage(errorText) {
  idleMessageState = {
    mode: 'error',
    errorText: String(errorText || '')
  };
  refreshIdleMessage();
}

function setIdleStuckMessage(missingStages) {
  idleMessageState = {
    mode: 'stuck',
    missingStages: Array.isArray(missingStages) ? missingStages.slice() : []
  };
  refreshIdleMessage();
}

function maybeUnlockBoot() {
  if (bootUnlocked || !mapTextureSettled || !worldMapSettled || !wondersSettled) {
    return;
  }

  bootUnlocked = true;
  hideIdleOverlay();
  resetIdleTimer();
  if (mapTracking) {
    void mapTracking.restart(0, { step: 'explore' });
  }
}

function removeIdleOverlay() {
  if (!idleOverlay || !idleOverlay.parentElement) return;
  idleOverlay.parentElement.removeChild(idleOverlay);
}

function hideIdleOverlay() {
  if (!idleActive || !idleOverlay) return;
  idleActive = false;
  idleOverlay.classList.add('is-hidden');
  window.setTimeout(removeIdleOverlay, 350);
}

function showIdleOverlay() {
  if (!idleOverlay) return;
  if (!idleOverlay.parentElement) {
    document.body.appendChild(idleOverlay);
  }
  try {
    window.i18n?.apply?.(idleOverlay);
  } catch {
  }
  try {
    idleOverlay.setAttribute('data-overlay-state', 'idle');
  } catch {
  }
  idleOverlay.classList.remove('is-hidden');
  idleActive = true;
  resetToIdleState();
}

function resetIdleTimer() {
  if (!idleOverlay) return;
  if (idleTimer) {
    window.clearTimeout(idleTimer);
  }
  idleTimer = window.setTimeout(() => {
    showIdleOverlay();
  }, idleTimeoutMs);
}

if (idleOverlay) {
  idleOverlay.addEventListener('click', () => {
    hideIdleOverlay();
    resetIdleTimer();
  });
}

['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, () => {
    if (!bootUnlocked) return;
    hideIdleOverlay();
    resetIdleTimer();
  }, { passive: evt === 'wheel' || evt === 'touchstart' });
});

window.setTimeout(() => {
  if (bootUnlocked) return;
  const missing = [];
  if (!mapTextureSettled) missing.push('texture');
  if (!worldMapSettled) missing.push('model');
  if (!wondersSettled) missing.push('data');
  setIdleStuckMessage(missing);
}, 20000);

try {
  if (idleOverlay) {
    idleOverlay.setAttribute('data-overlay-state', 'loading');
  }
  refreshIdleMessage();
  const syncUi = () => {
    try {
      document.title = translate('meta.pageTitle', null, 'Map of Wonder');
    } catch {
    }
    refreshIdleMessage();
  };
  window.addEventListener('i18n:ready', syncUi);
  window.addEventListener('i18n:changed', syncUi);
} catch {
}

// Disable context menu to prevent saving images or other default actions
window.addEventListener('contextmenu', e => {
  e.preventDefault();
}, { capture: true });

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
const raycaster = new THREE.Raycaster();
const pointerVec = new THREE.Vector2();

let wonders = [];
let filterMode = 'all';
let mapTex = null;
let worldMapObjs = [];

loadTextureWithFallback(
  getResourcePath('Ressource/MapTexture.webp'),
  tex => {
    mapTex = tex;
    mapTextureSettled = true;
    console.log('[Texture] MapTexture loaded successfully');
    worldMapObjs.forEach(obj => {
      obj.traverse(child => {
        if (child.isMesh && child.material) {
          child.material.map = mapTex;
          child.material.needsUpdate = true;
        }
      });
    });
    tryInitMap();
    maybeUnlockBoot();
  },
  err => {
    mapTextureSettled = true;
    setIdleErrorMessage(err && err.message ? err.message : 'Texture load failed');
    console.error('[Texture] Error loading map texture:', err);
    maybeUnlockBoot();
  }
);

const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
const glbPath = getResourcePath('Ressource/7wWorldMap.glb');
const objPath = getResourcePath('Ressource/7wWorldMap.obj');

function finishWorldMapLoad(object) {
  worldMapSettled = true;
  configureWorldMap(object);
  maybeUnlockBoot();
}

function failWorldMapLoad(error) {
  worldMapSettled = true;
  setIdleErrorMessage(error && error.message ? error.message : error);
  console.error('Error loading map model:', error);
  maybeUnlockBoot();
}

function loadWorldMapFromObj() {
  loadFileAsText(
    objPath,
    objText => {
      const object = objLoader.parse(objText);
      finishWorldMapLoad(object);
    },
    failWorldMapLoad
  );
}

loadFileAsArrayBuffer(
  glbPath,
  glbBuffer => {
    gltfLoader.parse(
      glbBuffer,
      getResourcePath('Ressource/'),
      gltf => {
        const object = gltf?.scene || gltf?.scenes?.[0] || null;
        if (!object) {
          throw new Error('GLB scene is missing.');
        }

        finishWorldMapLoad(object);
      },
      error => {
        console.warn('[Model] GLB parse failed, falling back to OBJ:', error);
        loadWorldMapFromObj();
      }
    );
  },
  error => {
    console.warn('[Model] GLB read failed, falling back to OBJ:', error);
    loadWorldMapFromObj();
  }
);

function configureWorldMap(object) {
  object.scale.set(500, 500, 500);
  object.rotation.x = Math.PI / 2; // stand the map upright for wall display
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
  object.traverse(child => {
    if (child.isMesh) {
      child.material = new THREE.MeshBasicMaterial(
        mapTex ? { map: mapTex } : { color: 0xffffff }
      );
    }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const modelWidth = size.x;
  const modelHeight = size.y;
  setScrollSize(modelWidth, modelHeight);

  worldMapObjs.forEach(obj => scene.remove(obj));
  worldMapObjs = [];
  for (let i = -1; i <= 1; i++) {
    const objCopy = cloneSharedMap();
    objCopy.position.set(i * modelWidth, 0, 0);
    objCopy.visible = true;
    scene.add(objCopy);
    worldMapObjs.push(objCopy);
  }

  setupInfiniteMap(scene, wonders || [], mapTex, createWonderObject, cubeWonderMap);

  camera.position.set(0, 0, 500);
  clampCameraPosition();
  updateCameraLookAt();
  console.log('OBJ duplicated and aligned');
}

function clampCameraPosition() {
  const zoomRatio = zoomBase / camera.position.z;
  const maxY = 200 * zoomRatio * 0.8;
  camera.position.y = Math.max(-maxY, Math.min(maxY, camera.position.y));
  camera.position.z = Math.max(150, Math.min(650, camera.position.z));
}

function updateCameraLookAt() {
  camera.lookAt(camera.position.x, camera.position.y, 0);
}

function panCamera(dx, dy, meta = {}) {
  const zoomFactor = camera.position.z / zoomBase;
  const touchBoost = meta.pointerType === 'touch' ? 1.35 : 1;
  const moveFactor = 0.75 * zoomFactor * touchBoost;
  camera.position.x -= dx * moveFactor;
  camera.position.y += dy * moveFactor;
  clampCameraPosition();
  updateCameraLookAt();
}

function tryInitMap() {
  if (!mapTex) return;
  preloadWonderModels(wonders || [], () => {
    bubbleManager.clear();
    setupInfiniteMap(scene, wonders || [], mapTex, createWonderObject, cubeWonderMap);
    camera.position.z = 650;
    clampCameraPosition();
    updateCameraLookAt();
  });
}

fetchWonders(data => {
  wonders = data;
  wondersSettled = true;
  tryInitMap();
  maybeUnlockBoot();
});

setupControls({
  viewport,
  panCamera,
  zoomBy: delta => {
    camera.position.z = Math.max(150, Math.min(650, camera.position.z + delta));
  },
  clampCameraPosition,
  updateCameraLookAt,
  setFilter,
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
          showWonderPanel(wobj, x, y);
          return;
        }
      }
    }
  } catch (err) {
    /* fallback ignore */
  }

  pointerVec.set(
    (x / viewport.clientWidth) * 2 - 1,
    -(y / viewport.clientHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointerVec, camera);
  if (Array.isArray(groupCubes) && groupCubes.length > 0) {
    const intersects = raycaster.intersectObjects(groupCubes, true);
    if (intersects.length > 0) {
      let hit = intersects[0].object;
      while (hit) {
        const wonder = cubeWonderMap.get(hit);
        if (wonder) {
          camera.position.z = 650;
          clampCameraPosition();
          updateCameraLookAt();
          showWonderPanel(wonder, x, y);
          break;
        }
        hit = hit.parent;
      }
    }
  }
}

function clearWonderPanels() {
  document.querySelectorAll('.wonder-popup.window-popup').forEach(node => {
    node.remove();
  });
}

function setFilter(mode) {
  filterMode = mode;
  document.querySelectorAll('.filter').forEach(btn => {
    const btnMode = btn.getAttribute('data-filter');
    btn.classList.toggle('selected', btnMode === mode);
  });
  if (!mapTex) return;
  const filtered = wonders.filter(w => mode === 'all' || w.cat.toLowerCase() === mode);
  bubbleManager.clear();
  setupInfiniteMap(scene, filtered, mapTex, createWonderObject, cubeWonderMap);
  clearWonderPanels();
}

function closeAllMenus() {
  Array.from(menuState.keys()).forEach(group => syncMenuGroup(group, false));
}

function resetToIdleState() {
  closeAllMenus();
  setFilter('all');
  resetCamera();
  clearWonderPanels();
}

function resetCamera() {
  camera.position.set(0, 0, 500);
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

  if (Array.isArray(groupCubes)) {
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
  css3dRenderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  css3dRenderer.setSize(viewport.clientWidth, viewport.clientHeight);
});
