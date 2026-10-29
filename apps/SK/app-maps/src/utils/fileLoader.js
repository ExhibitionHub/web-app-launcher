// fileLoader.js - Custom file loader for Electron
const hasWindow = typeof window !== 'undefined';
const hasWindowRequire = hasWindow && typeof window.require !== 'undefined';
const fs = hasWindowRequire ? window.require('fs') : null;
const path = hasWindowRequire ? window.require('path') : null;

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

    const makeCandidates = (p) => {
      const normalized = String(p || '').replace(/^\/+/, '');
      const candidates = [];

      // Most common layouts:
      // - dev/unpacked: <resources>/app/<project>/...
      // - packed: <resources>/app.asar/<project>/...
      // - unpacked binaries: <resources>/app.asar.unpacked/<project>/...
      const prefixes = [
        '',
        'app',
        'app-maps',
        path.join('app', 'app-maps'),
        'app.asar',
        path.join('app.asar', 'app-maps'),
        'app.asar.unpacked',
        path.join('app.asar.unpacked', 'app-maps')
      ];

      for (const prefix of prefixes) {
        // Avoid duplicating app-maps if the caller already passed it.
        if (prefix.endsWith('app-maps') && normalized.startsWith('app-maps/')) {
          candidates.push(path.join(basePath, prefix.replace(/app-maps$/, ''), normalized));
          continue;
        }
        candidates.push(path.join(basePath, prefix, normalized));
      }

      // Also try the raw basePath join (covers odd absolute-ish inputs).
      candidates.push(path.join(basePath, normalized));

      // Deduplicate while preserving order.
      return Array.from(new Set(candidates));
    };

    const candidates = makeCandidates(cleanPath);
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
    
    // DEBUG: List the contents of the ressource folder if we are looking for a file inside it
    if (cleanPath.startsWith('ressource')) {
      const ressourceDir = path.join(basePath, 'ressource');
      console.log('[FileLoader] DEBUG - Checking ressource directory:', ressourceDir);
      if (fs.existsSync(ressourceDir)) {
        const files = fs.readdirSync(ressourceDir);
        console.log('[FileLoader] DEBUG - Files in ressource:', files);
      } else {
        console.log('[FileLoader] DEBUG - ressource directory does not exist at:', ressourceDir);
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

    const makeCandidates = (p) => {
      const normalized = String(p || '').replace(/^\/+/, '');
      const candidates = [];

      const prefixes = [
        '',
        'app',
        'app-maps',
        path.join('app', 'app-maps'),
        'app.asar',
        path.join('app.asar', 'app-maps'),
        'app.asar.unpacked',
        path.join('app.asar.unpacked', 'app-maps')
      ];

      for (const prefix of prefixes) {
        if (prefix.endsWith('app-maps') && normalized.startsWith('app-maps/')) {
          candidates.push(path.join(basePath, prefix.replace(/app-maps$/, ''), normalized));
          continue;
        }
        candidates.push(path.join(basePath, prefix, normalized));
      }

      candidates.push(path.join(basePath, normalized));

      return Array.from(new Set(candidates));
    };

    const candidates = makeCandidates(cleanPath);
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

    if (cleanPath.startsWith('ressource')) {
      const ressourceDir = path.join(basePath, 'ressource');
      console.log('[FileLoader] DEBUG - Checking ressource directory:', ressourceDir);
      if (fs.existsSync(ressourceDir)) {
        const files = fs.readdirSync(ressourceDir);
        console.log('[FileLoader] DEBUG - Files in ressource:', files);
      } else {
        console.log('[FileLoader] DEBUG - ressource directory does not exist at:', ressourceDir);
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
