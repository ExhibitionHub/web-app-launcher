// fileLoader.js - Custom file loader for Electron
const hasWindow = typeof window !== 'undefined';
const hasWindowRequire = hasWindow && typeof window.require !== 'undefined';
const fs = hasWindowRequire ? window.require('fs') : null;
const path = hasWindowRequire ? window.require('path') : null;
const DEFAULT_APP_FOLDER = 'DINO-MAP';

function getAppPathSegments() {
  if (!hasWindow) return [DEFAULT_APP_FOLDER];

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

function buildPackagePrefixes(pathApi) {
  const appPath = appPathSegments.length ? pathApi.join(...appPathSegments) : appFolderName;
  const appFolders = unique([appFolderName, appPath]);
  const packageRoots = ['', 'app', 'app.asar', 'app.asar.unpacked'];
  const prefixes = [];

  for (const root of packageRoots) {
    prefixes.push(root);
    for (const folder of appFolders) {
      prefixes.push(root ? pathApi.join(root, folder) : folder);
      prefixes.push(root ? pathApi.join(root, 'apps', folder) : pathApi.join('apps', folder));
    }
  }

  return unique(prefixes);
}

function joinCandidate(basePath, prefix, normalizedPath) {
  if (!prefix) return path.join(basePath, normalizedPath);

  const normalizedPrefix = String(prefix).replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    return path.join(basePath, normalizedPath);
  }

  return path.join(basePath, prefix, normalizedPath);
}

function buildFileCandidates(basePath, filePath) {
  const normalized = String(filePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
  const candidates = buildPackagePrefixes(path).map(prefix => joinCandidate(basePath, prefix, normalized));
  candidates.push(path.join(basePath, normalized));
  return unique(candidates);
}

console.log('[FileLoader] Initialized - fs available:', !!fs, 'path available:', !!path);
console.log('[FileLoader] window.require available:', hasWindowRequire);

export function getResourcePath(relativePath) {
  const cleanPath = relativePath.replace(/^\.\//, '');
  if (hasWindowRequire) {
    return cleanPath;
  }
  if (hasWindow) {
    const basePath = window.location.href.replace(/\/[^\/]*$/, '/');
    return basePath + cleanPath;
  }
  return cleanPath;
}

export function loadFileAsText(filePath, onSuccess, onError) {
  console.log('[FileLoader] loadFileAsText called for:', filePath);
  
  if (!fs || !path) {
    console.log('[FileLoader] fs or path not available, using fetch fallback');
    // Fallback to fetch for web
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutMs = 15000;
    const timer = window.setTimeout(() => {
      try { controller && controller.abort(); } catch { /* ignore */ }
    }, timeoutMs);

    fetch(filePath, controller ? { signal: controller.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' while fetching ' + filePath);
        return r.text();
      })
      .then(onSuccess)
      .catch(err => {
        if (typeof onError === 'function') onError(err);
      })
      .finally(() => {
        try { window.clearTimeout(timer); } catch { /* ignore */ }
      });
    return;
  }

  try {
    // Determine the base path
    let basePath;
    
    // In packaged Electron, use process.resourcesPath which points to the resources folder
    if (typeof process !== 'undefined' && process.resourcesPath) {
      basePath = process.resourcesPath;
      console.log('[FileLoader] Using process.resourcesPath as base:', basePath);
    } else if (typeof __dirname !== 'undefined') {
      basePath = __dirname;
      console.log('[FileLoader] Using __dirname as base:', basePath);
      
      // If we are in resources/app, climb back up to resources
      if (basePath.includes('resources\\app') || basePath.includes('resources/app')) {
        basePath = path.dirname(basePath); // Move up to resources
        console.log('[FileLoader] Adjusted basePath to resources:', basePath);
      }
    } else {
      basePath = path.dirname(window.location.pathname);
      console.log('[FileLoader] Using window.location.pathname as base:', basePath);
    }

    // Clean the file path
    const cleanPath = filePath.replace(/^\.\//, '').replace(/^file:\/\/\//, '');

    const candidates = buildFileCandidates(basePath, cleanPath);
    let fullPath = candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });

    if (!fullPath) {
      fullPath = candidates[0];
    }

    console.log('[FileLoader] Attempting to load:', fullPath);
    try {
      console.log('[FileLoader] File exists:', fs.existsSync(fullPath));
    } catch {
      console.log('[FileLoader] File exists: <error checking>');
    }
    
    // DEBUG: List the contents of the Ressource folder if we are looking for a file inside it
    if (cleanPath.startsWith('Ressource')) {
      const ressourceDir = path.join(basePath, 'Ressource');
      console.log('[FileLoader] DEBUG - Checking Ressource directory:', ressourceDir);
      if (fs.existsSync(ressourceDir)) {
        const files = fs.readdirSync(ressourceDir);
        console.log('[FileLoader] DEBUG - Files in Ressource:', files);
      } else {
        console.log('[FileLoader] DEBUG - Ressource directory does not exist at:', ressourceDir);
      }
    }
    
    // If still not found, log a short candidate list for troubleshooting.
    try {
      if (!fs.existsSync(fullPath)) {
        console.warn('[FileLoader] File not found. First candidates tried:', candidates.slice(0, 6));
      }
    } catch {
      // ignore
    }

    // Read file synchronously for simplicity
    const data = fs.readFileSync(fullPath, 'utf8');
    console.log('[FileLoader] Successfully loaded file, length:', data.length);
    onSuccess(data);
  } catch (err) {
    console.error('[FileLoader] Error loading file:', err);
    if (onError) onError(err);
  }
}

export function loadFileAsArrayBuffer(filePath, onSuccess, onError) {
  console.log('[FileLoader] loadFileAsArrayBuffer called for:', filePath);

  if (!fs || !path) {
    console.log('[FileLoader] fs or path not available, using fetch fallback');
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeoutMs = 20000;
    const timer = window.setTimeout(() => {
      try { controller && controller.abort(); } catch { /* ignore */ }
    }, timeoutMs);

    fetch(filePath, controller ? { signal: controller.signal } : undefined)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' while fetching ' + filePath);
        return r.arrayBuffer();
      })
      .then(onSuccess)
      .catch(err => {
        if (typeof onError === 'function') onError(err);
      })
      .finally(() => {
        try { window.clearTimeout(timer); } catch { /* ignore */ }
      });
    return;
  }

  try {
    let basePath;

    if (typeof process !== 'undefined' && process.resourcesPath) {
      basePath = process.resourcesPath;
      console.log('[FileLoader] Using process.resourcesPath as base:', basePath);
    } else if (typeof __dirname !== 'undefined') {
      basePath = __dirname;
      console.log('[FileLoader] Using __dirname as base:', basePath);

      if (basePath.includes('resources\\app') || basePath.includes('resources/app')) {
        basePath = path.dirname(basePath);
        console.log('[FileLoader] Adjusted basePath to resources:', basePath);
      }
    } else {
      basePath = path.dirname(window.location.pathname);
      console.log('[FileLoader] Using window.location.pathname as base:', basePath);
    }

    const cleanPath = String(filePath || '').replace(/^\.\//, '').replace(/^file:\/\/\//, '');

    const candidates = buildFileCandidates(basePath, cleanPath);
    let fullPath = candidates.find(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });

    if (!fullPath) {
      fullPath = candidates[0];
    }

    console.log('[FileLoader] Attempting to load:', fullPath);
    try {
      console.log('[FileLoader] File exists:', fs.existsSync(fullPath));
    } catch {
      console.log('[FileLoader] File exists: <error checking>');
    }

    if (cleanPath.startsWith('Ressource')) {
      const ressourceDir = path.join(basePath, 'Ressource');
      console.log('[FileLoader] DEBUG - Checking Ressource directory:', ressourceDir);
      if (fs.existsSync(ressourceDir)) {
        const files = fs.readdirSync(ressourceDir);
        console.log('[FileLoader] DEBUG - Files in Ressource:', files);
      } else {
        console.log('[FileLoader] DEBUG - Ressource directory does not exist at:', ressourceDir);
      }
    }

    try {
      if (!fs.existsSync(fullPath)) {
        console.warn('[FileLoader] File not found. First candidates tried:', candidates.slice(0, 6));
      }
    } catch {
      // ignore
    }

    const data = fs.readFileSync(fullPath);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    console.log('[FileLoader] Successfully loaded file, bytes:', data.byteLength);
    onSuccess(arrayBuffer);
  } catch (err) {
    console.error('[FileLoader] Error loading file:', err);
    if (onError) onError(err);
  }
}
