// environment.js
// Prepares the Three.js scene, renderers, and applies required DOM styles.

import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

export function initEnvironment() {
  const viewport = document.getElementById('viewport');
  if (!viewport) {
    throw new Error('viewport element required for environment initialization');
  }

  viewport.style.position = 'fixed';
  viewport.style.top = '0';
  viewport.style.left = '0';
  viewport.style.width = '100vw';
  viewport.style.height = '100vh';
  viewport.style.zIndex = '1';
  viewport.style.background = '#000';
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
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.setClearColor(0x000000, 1);
  viewport.appendChild(renderer.domElement);

  const css3dRenderer = new CSS3DRenderer();
  css3dRenderer.setSize(viewport.clientWidth, viewport.clientHeight);
  css3dRenderer.domElement.style.background = 'transparent';
  css3dRenderer.domElement.style.position = 'fixed';
  css3dRenderer.domElement.style.top = '0';
  css3dRenderer.domElement.style.left = '0';
  css3dRenderer.domElement.style.width = '100vw';
  css3dRenderer.domElement.style.height = '100vh';
  css3dRenderer.domElement.style.zIndex = '2';
  css3dRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(css3dRenderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1000, 1000, 1000);
  scene.add(light);

  return { viewport, scene, camera, renderer, css3dRenderer };
}
