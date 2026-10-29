// textureLoader.js
// Loads a texture while trying multiple extensions (png, jpeg, jpg, webp).

import * as THREE from 'three';

export function loadTextureWithFallback(basePath, onSuccess, onError) {
  const requestedExtMatch = String(basePath || '').match(/\.([a-zA-Z0-9]+)$/);
  const requestedExt = requestedExtMatch ? requestedExtMatch[1].toLowerCase() : '';
  const exts = [requestedExt, 'png', 'jpeg', 'jpg', 'webp']
    .filter(Boolean)
    .filter((ext, index, values) => values.indexOf(ext) === index);
  let tried = 0;

  function tryNext() {
    if (tried >= exts.length) {
      if (typeof onError === 'function') {
        onError(new Error('Texture not found: ' + basePath));
      }
      return;
    }
    const ext = exts[tried++];
    const candidatePath = basePath.replace(/\.[a-zA-Z0-9]+$/, '.' + ext);

    if (typeof window !== 'undefined' && typeof window.require === 'function') {
      const fs = window.require('fs');
      const pathModule = window.require('path');
      let baseDir;
      if (typeof process !== 'undefined' && process.resourcesPath) {
        baseDir = process.resourcesPath;
      } else if (typeof __dirname !== 'undefined') {
        baseDir = __dirname;
        if (baseDir.includes('resources\\app') || baseDir.includes('resources/app')) {
          baseDir = pathModule.dirname(baseDir);
        }
      }
      const cleanPath = candidatePath.replace(/^\./, '');
      let fullPath = pathModule.join(baseDir, cleanPath);
      if (!fs.existsSync(fullPath)) {
        fullPath = pathModule.join(baseDir, 'app', cleanPath);
      }
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath);
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
          url,
          texture => {
            if (typeof onSuccess === 'function') onSuccess(texture);
            URL.revokeObjectURL(url);
          },
          undefined,
          () => {
            URL.revokeObjectURL(url);
            tryNext();
          }
        );
      } else {
        tryNext();
      }
    } else {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(candidatePath, onSuccess, undefined, () => tryNext());
    }
  }

  tryNext();
}
