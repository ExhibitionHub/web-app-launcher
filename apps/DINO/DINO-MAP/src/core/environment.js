// environment.js
// Prepares the Three.js scene, renderers, and applies required DOM styles.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export function initEnvironment() {
  const viewport = document.getElementById('viewport');
  if (!viewport) {
    throw new Error('viewport element required for environment initialization');
  }

  const DEFAULT_VIEWPORT_BG = '#000';
  const DEFAULT_SCENE_LIGHT = '#ffffff';

  const rootStyles = getComputedStyle(document.documentElement);
  const viewportBg = (rootStyles.getPropertyValue('--viewport-bg') || '').trim() || DEFAULT_VIEWPORT_BG;
  const sceneLight = (rootStyles.getPropertyValue('--scene-light') || '').trim() || DEFAULT_SCENE_LIGHT;

  viewport.style.position = 'fixed';
  viewport.style.top = '0';
  viewport.style.left = '0';
  viewport.style.width = '100vw';
  viewport.style.height = '100vh';
  viewport.style.zIndex = '1';
  viewport.style.background = viewportBg;
  viewport.style.pointerEvents = 'auto';

  // Disable text selection on the page.
  document.body.style.userSelect = 'none';
  document.body.setAttribute('unselectable', 'on');
  document.body.onselectstart = () => false;
  viewport.style.userSelect = 'none';
  viewport.setAttribute('unselectable', 'on');
  viewport.onselectstart = () => false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    viewport.clientWidth / viewport.clientHeight,
    0.1,
    10000
  );
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const applyRendererSizing = () => {
    const width = Math.max(1, viewport.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, viewport.clientHeight || window.innerHeight || 1);
    const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    // Render at full device pixel ratio for maximum sharpness.
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return { width, height };
  };
  applyRendererSizing();
  renderer.setClearColor(viewportBg, 1);
  viewport.appendChild(renderer.domElement);

  const css2dRenderer = new CSS2DRenderer();
  const applyCss2dSizing = () => {
    const width = Math.max(1, viewport.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, viewport.clientHeight || window.innerHeight || 1);
    css2dRenderer.setSize(width, height);
  };
  applyCss2dSizing();
  css2dRenderer.domElement.style.background = 'transparent';
  css2dRenderer.domElement.style.position = 'fixed';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.left = '0';
  css2dRenderer.domElement.style.width = '100vw';
  css2dRenderer.domElement.style.height = '100vh';
  css2dRenderer.domElement.style.zIndex = '2';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(css2dRenderer.domElement);

  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyRendererSizing();
      applyCss2dSizing();
    });
  };
  window.addEventListener('resize', onResize, { passive: true });

  scene.add(new THREE.AmbientLight(new THREE.Color(sceneLight), 0.4));
  const light = new THREE.DirectionalLight(new THREE.Color(sceneLight), 1.15);
  light.position.set(1000, 1000, 1000);
  scene.add(light);

  return { viewport, scene, camera, renderer, css2dRenderer };
}
