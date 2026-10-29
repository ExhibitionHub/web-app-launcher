// textureLoader.js
// Loads a texture while trying multiple extensions (png, jpeg, jpg, webp).

import * as THREE from '../../lib/three/build/three.module.js';

export function loadTextureWithFallback(basePath, onSuccess, onError) {
  const originalExtMatch = String(basePath || '').match(/\.([a-zA-Z0-9]+)$/);
  const originalExt = originalExtMatch ? originalExtMatch[1].toLowerCase() : null;
  const extsAll = ['png', 'jpeg', 'jpg', 'webp'];
  const exts = originalExt && extsAll.includes(originalExt)
    ? [originalExt, ...extsAll.filter(e => e !== originalExt)]
    : extsAll;
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

      const cleanPath = candidatePath.replace(/^\./, '').replace(/^\/+/, '');
      const prefixes = [
        '',
        'app',
        'app-maps',
        pathModule.join('app', 'app-maps'),
        'app.asar',
        pathModule.join('app.asar', 'app-maps'),
        'app.asar.unpacked',
        pathModule.join('app.asar.unpacked', 'app-maps')
      ];
      const candidates = [];
      for (const prefix of prefixes) {
        if (String(prefix).endsWith('app-maps') && cleanPath.startsWith('app-maps/')) {
          candidates.push(pathModule.join(baseDir, String(prefix).replace(/app-maps$/, ''), cleanPath));
        } else {
          candidates.push(pathModule.join(baseDir, prefix, cleanPath));
        }
      }

      let fullPath = candidates.find(p => {
        try { return fs.existsSync(p); } catch { return false; }
      });

      if (!fullPath) {
        tryNext();
        return;
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
