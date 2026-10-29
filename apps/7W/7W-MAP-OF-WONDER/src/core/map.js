// map.js
import * as THREE from 'three';
export const MAP_WIDTH = 2200;
export let SCROLL_WIDTH = MAP_WIDTH; // width used for the repeat
export let SCROLL_HEIGHT = 1200;     // reference height (e.g. plane 1200)
export function setScrollWidth(w) {
  if (Number.isFinite(w) && w > 0) SCROLL_WIDTH = w;
}
export function setScrollSize(w, h) {
  if (Number.isFinite(w) && w > 0) SCROLL_WIDTH = w;
  if (Number.isFinite(h) && h > 0) SCROLL_HEIGHT = h;
}
export let mapGroups = [];
export let groupCubes = [];

function makeHalo() {
  const haloGeo = new THREE.BoxGeometry(1.2, 1.2, 2.4);
  haloGeo.scale(28, 60, 28);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffe082,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, 0, 0);
  halo.userData.isHalo = true;
  return halo;
}

function buildDefaultCube() {
  const geometry = new THREE.BoxGeometry(1, 1, 2);
  geometry.scale(28, 60, 28);
  const bronzeColor = 0xcd7f32;
  const material = new THREE.MeshStandardMaterial({
    color: bronzeColor,
    metalness: 0.7,
    roughness: 0.3,
    emissive: bronzeColor,
    emissiveIntensity: 0.7
  });
  const cube = new THREE.Mesh(geometry, material);
  cube.add(makeHalo());
  cube.userData.glowPhase = Math.random() * Math.PI * 2;
  return cube;
}

function addWondersToGroup(groupObj, offsetX, wonders, objectFactory, objectMap) {
  const list = Array.isArray(wonders) ? wonders : [];
  const scaleX = SCROLL_WIDTH / MAP_WIDTH;
  const baseH = 1200;
  const scaleY = SCROLL_HEIGHT / baseH;
  list.forEach(w => {
    const x = (w.xy[0] - MAP_WIDTH / 2) * scaleX + offsetX;
    const y = (baseH / 2 - w.xy[1]) * scaleY;
    const z = 30;
    let obj = (typeof objectFactory === 'function') ? objectFactory(w) : null;
    if (!obj || !(obj instanceof THREE.Object3D)) {
      obj = buildDefaultCube();
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
