// wonderObjects.js
// Preloading and instantiation of wonder .obj models.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { loadFileAsText, getResourcePath } from '../utils/fileLoader.js';

export function createWonderObjectFactory({ bubbleManager }) {
  const objLoader = new OBJLoader();
  const textureLoader = new THREE.TextureLoader();
  const wonderModels = new Map();

  function applyTextures(obj, texBase) {
    const defaultMat = new THREE.MeshStandardMaterial({
      color: 0x9c4652,
      metalness: 0.4,
      roughness: 0.6,
      emissive: 0x17070b
    });

    function tryTexture(ext, onDone) {
      if (!texBase) return onDone();
      const candidates = [
        `Ressource/models/${texBase}.${ext}`,
        `Ressource/textures/${texBase}.${ext}`,
        `Ressource/${texBase}.${ext}`
      ];
      let idx = 0;
      const tryNext = () => {
        if (idx >= candidates.length) return onDone();
        const p = getResourcePath(candidates[idx++]);
        textureLoader.load(
          p,
          texture => onDone(texture),
          undefined,
          () => tryNext()
        );
      };
      tryNext();
    }

    obj.traverse(child => {
      if (!child.isMesh) return;
      tryTexture('png', tex => {
        if (tex) {
          child.material = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.7 });
        } else {
          tryTexture('jpg', tex2 => {
            if (tex2) {
              child.material = new THREE.MeshStandardMaterial({ map: tex2, metalness: 0.3, roughness: 0.7 });
            } else {
              tryTexture('jpeg', tex3 => {
                if (tex3) {
                  child.material = new THREE.MeshStandardMaterial({ map: tex3, metalness: 0.3, roughness: 0.7 });
                } else if (!child.material) {
                  child.material = defaultMat;
                }
              });
            }
          });
        }
      });
      if (!child.material) child.material = defaultMat;
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  function buildHalo(obj) {
    const haloObj = obj.clone(true);
    haloObj.traverse(child => {
      if (child.isMesh) {
        child.material = new THREE.MeshBasicMaterial({
          color: 0xc05a66,
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending
        });
      }
    });
    haloObj.scale.multiplyScalar(1.1);
    haloObj.position.copy(obj.position);
    haloObj.raycast = () => null;
    haloObj.userData.isHalo = true;
    return haloObj;
  }

  function normalizeModel(obj, wonder) {
    obj.traverse(c => { if (c.isObject3D) c.visible = true; });
    obj.rotation.x = Math.PI / 2;
    const texBase = wonder.model && typeof wonder.model === 'string'
      ? wonder.model.replace(/^.*\/(.*?)\.obj$/i, '$1')
      : null;
    applyTextures(obj, texBase);

    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x || 0, size.y || 0, size.z || 0) || 1;
    const target = 60;
    const scale = target / maxDim;
    obj.scale.multiplyScalar(scale);

    const boxScaled = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    boxScaled.getCenter(center);
    obj.position.sub(center);

    const baseZ = typeof wonder.z === 'number' ? wonder.z : 0;
    obj.position.z = baseZ - 40;
    return baseZ - 40;
  }

  function createWonderObject(wonder) {
    if (wonder.model && typeof wonder.model === 'string' && wonder.model.endsWith('.obj')) {
      const modelObj = wonderModels.get(wonder.id);
      if (modelObj) {
        const container = new THREE.Group();
        const obj = modelObj.clone(true);
        const baseZ = normalizeModel(obj, wonder);
        container.userData.baseZ = baseZ;
        const haloObj = buildHalo(obj);
        container.add(haloObj);
        container.add(obj);
        container.userData.glowPhase = Math.random() * Math.PI * 2;
        container.visible = true;
        bubbleManager.createBubble(wonder, obj);
        return container;
      }
    }

    const geometry = new THREE.BoxGeometry(20, 20, 20);
    const material = new THREE.MeshStandardMaterial({ color: 0x9c4652, emissive: 0x17070b });
    const cube = new THREE.Mesh(geometry, material);
    const baseZ = typeof wonder.z === 'number' ? wonder.z : 0;
    cube.position.z = baseZ;
    cube.userData.baseZ = baseZ;
    bubbleManager.createBubble(wonder, cube);
    return cube;
  }

  function preloadWonderModels(wonders, cb) {
    let toLoad = 0;
    let loaded = 0;
    wonders.forEach(w => {
      if (w.model && typeof w.model === 'string' && w.model.endsWith('.obj')) {
        if (!wonderModels.has(w.id)) toLoad++;
      }
    });
    if (toLoad === 0) {
      if (typeof cb === 'function') cb();
      return;
    }
    wonders.forEach(w => {
      if (w.model && typeof w.model === 'string' && w.model.endsWith('.obj')) {
        if (!wonderModels.has(w.id)) {
          const modelPath = getResourcePath(w.model.replace(/^\.\//, ''));
          loadFileAsText(
            modelPath,
            objText => {
              const obj = objLoader.parse(objText);
              wonderModels.set(w.id, obj);
              loaded++;
              if (loaded === toLoad && typeof cb === 'function') cb();
            },
            () => {
              console.error('Failed to load model:', modelPath);
              loaded++;
              if (loaded === toLoad && typeof cb === 'function') cb();
            }
          );
        }
      }
    });
  }

  return {
    createWonderObject,
    preloadWonderModels
  };
}
