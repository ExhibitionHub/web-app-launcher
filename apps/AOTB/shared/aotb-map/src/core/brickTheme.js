import * as THREE from '../../lib/three/build/three.module.js';

function readCssVar(name) {
  if (typeof document === 'undefined') return '';
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (value || '').trim();
}

function parseCssColor(value) {
  const v = (value || '').trim();
  if (!v) return null;

  // THREE.Color reliably supports hex and rgb(). rgba() support is inconsistent,
  // so parse rgba() ourselves.
  const rgbaMatch = v.match(/^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i);
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbaMatch[1]))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbaMatch[2]))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbaMatch[3]))) / 255;
    return new THREE.Color(r, g, b);
  }

  const rgbMatch = v.match(/^rgb\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/i);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, Number(rgbMatch[1]))) / 255;
    const g = Math.max(0, Math.min(255, Number(rgbMatch[2]))) / 255;
    const b = Math.max(0, Math.min(255, Number(rgbMatch[3]))) / 255;
    return new THREE.Color(r, g, b);
  }

  try {
    return new THREE.Color(v);
  } catch {
    return null;
  }
}

export function getCssVarColor(name, fallbackHex = 0xffffff) {
  const css = readCssVar(name);
  return parseCssColor(css) || new THREE.Color(fallbackHex);
}

export function pastelizeColor(color, { minLightness = 0.62, maxSaturation = 0.75 } = {}) {
  const base = (color && color.isColor) ? color : new THREE.Color(0xffffff);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);

  const out = new THREE.Color();
  out.setHSL(hsl.h, Math.min(hsl.s, maxSaturation), Math.max(hsl.l, minLightness));
  return out;
}

export function brightenMaterials(object3d, amount = 0.08) {
  if (!object3d) return;
  const t = Math.max(0, Math.min(1, Number(amount)));
  if (!Number.isFinite(t) || t <= 0) return;
  const white = new THREE.Color(1, 1, 1);

  object3d.traverse(child => {
    if (!child || !child.isMesh || !child.material) return;

    const applyToMat = mat => {
      if (!mat || !mat.color || !mat.color.isColor) return;
      mat.color.lerp(white, t);
      mat.needsUpdate = true;
    };

    if (Array.isArray(child.material)) {
      child.material.forEach(applyToMat);
    } else {
      applyToMat(child.material);
    }
  });
}

function toBrickMaterial(material, fallbackColor) {
  const baseColor = material && material.color && material.color.isColor
    ? material.color
    : fallbackColor;

  const pastel = pastelizeColor(baseColor);

  const brickMat = new THREE.MeshStandardMaterial({
    color: pastel,
    metalness: 0.05,
    roughness: 0.88,
    flatShading: true
  });

  brickMat.emissive = pastel.clone().multiplyScalar(0.06);
  brickMat.emissiveIntensity = 0.7;

  return brickMat;
}

export function applyBrickTheme(object3d, { fallbackColor } = {}) {
  if (!object3d) return;
  const fallback = fallbackColor && fallbackColor.isColor ? fallbackColor : new THREE.Color(0xffffff);

  object3d.traverse(child => {
    if (!child || !child.isMesh) return;

    const prev = child.material;
    if (Array.isArray(prev)) {
      child.material = prev.map(m => toBrickMaterial(m, fallback));
    } else {
      child.material = toBrickMaterial(prev, fallback);
    }

    child.castShadow = true;
    child.receiveShadow = true;
  });
}
