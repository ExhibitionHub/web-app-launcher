// textureLoader.js
// Loads a texture while trying multiple extensions (png, jpeg, jpg, webp).

import * as THREE from 'three';

const DEFAULT_APP_FOLDER = 'DINO-MAP';

function getAppPathSegments() {
  if (typeof window === 'undefined') return [DEFAULT_APP_FOLDER];

  try {
    const pathname = String(window.location && window.location.pathname ? window.location.pathname : '')
      .replace(/\\/g, '/');
    const segments = pathname.split('/').filter(Boolean);
    const appsIndex = segments.map(s => s.toLowerCase()).lastIndexOf('apps');
    if (appsIndex >= 0) {
      const appSegments = segments.slice(appsIndex + 1);
      if (appSegments.length && /\.[a-z0-9]+$/i.test(appSegments[appSegments.length - 1])) {
        appSegments.pop();
      }
      if (appSegments.length) return appSegments;
    }

    const withoutFile = segments.filter((segment, index) => {
      return index < segments.length - 1 || !/\.[a-z0-9]+$/i.test(segment);
    });
    const leaf = withoutFile[withoutFile.length - 1];
    return leaf ? [leaf] : [DEFAULT_APP_FOLDER];
  } catch {
    return [DEFAULT_APP_FOLDER];
  }
}

const appPathSegments = getAppPathSegments();
const appFolderName = appPathSegments[appPathSegments.length - 1] || DEFAULT_APP_FOLDER;

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildPackagePrefixes(pathModule) {
  const appPath = appPathSegments.length ? pathModule.join(...appPathSegments) : appFolderName;
  const appFolders = unique([appFolderName, appPath]);
  const packageRoots = ['', 'app', 'app.asar', 'app.asar.unpacked'];
  const prefixes = [];

  for (const root of packageRoots) {
    prefixes.push(root);
    for (const folder of appFolders) {
      prefixes.push(root ? pathModule.join(root, folder) : folder);
      prefixes.push(root ? pathModule.join(root, 'apps', folder) : pathModule.join('apps', folder));
    }
  }

  return unique(prefixes);
}

function joinCandidate(pathModule, baseDir, prefix, cleanPath) {
  if (!prefix) return pathModule.join(baseDir, cleanPath);

  const normalizedPrefix = String(prefix).replace(/\\/g, '/').replace(/\/+$/, '');
  if (cleanPath === normalizedPrefix || cleanPath.startsWith(`${normalizedPrefix}/`)) {
    return pathModule.join(baseDir, cleanPath);
  }

  return pathModule.join(baseDir, prefix, cleanPath);
}

function buildTextureCandidates(pathModule, baseDir, candidatePath) {
  const cleanPath = String(candidatePath || '').replace(/^\./, '').replace(/^\/+/, '').replace(/\\/g, '/');
  const candidates = buildPackagePrefixes(pathModule).map(prefix => joinCandidate(pathModule, baseDir, prefix, cleanPath));
  candidates.push(pathModule.join(baseDir, cleanPath));
  return unique(candidates);
}

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

      const candidates = buildTextureCandidates(pathModule, baseDir, candidatePath);

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
