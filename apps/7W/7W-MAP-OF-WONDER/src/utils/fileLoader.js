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
    fetch(filePath)
      .then(r => r.text())
      .then(onSuccess)
      .catch(onError);
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
    let fullPath = path.join(basePath, cleanPath);
    
    console.log('[FileLoader] Attempting to load:', fullPath);
    console.log('[FileLoader] File exists:', fs.existsSync(fullPath));
    
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
    
    // Try multiple possible paths
    if (!fs.existsSync(fullPath)) {
      // Try app/ (non-asar mode)
      const appPath = path.join(basePath, 'app', cleanPath);
      console.log('[FileLoader] Trying app path:', appPath);
      if (fs.existsSync(appPath)) {
        fullPath = appPath;
        console.log('[FileLoader] Found at app path');
      }
    }
    
    // If still not found and it is in Ressource/, try directly from basePath
    if (!fs.existsSync(fullPath) && cleanPath.startsWith('Ressource')) {
      const directPath = path.join(basePath, cleanPath);
      console.log('[FileLoader] Trying direct resources path:', directPath);
      if (fs.existsSync(directPath)) {
        fullPath = directPath;
        console.log('[FileLoader] Found at direct resources path');
      }
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
    fetch(filePath)
      .then(r => r.arrayBuffer())
      .then(onSuccess)
      .catch(onError);
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

    const cleanPath = filePath.replace(/^\.\//, '').replace(/^file:\/\/\//, '');
    let fullPath = path.join(basePath, cleanPath);

    console.log('[FileLoader] Attempting to load array buffer:', fullPath);
    console.log('[FileLoader] File exists:', fs.existsSync(fullPath));

    if (!fs.existsSync(fullPath)) {
      const appPath = path.join(basePath, 'app', cleanPath);
      console.log('[FileLoader] Trying app path:', appPath);
      if (fs.existsSync(appPath)) {
        fullPath = appPath;
        console.log('[FileLoader] Found at app path');
      }
    }

    if (!fs.existsSync(fullPath) && cleanPath.startsWith('Ressource')) {
      const directPath = path.join(basePath, cleanPath);
      console.log('[FileLoader] Trying direct resources path:', directPath);
      if (fs.existsSync(directPath)) {
        fullPath = directPath;
        console.log('[FileLoader] Found at direct resources path');
      }
    }

    const data = fs.readFileSync(fullPath);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    console.log('[FileLoader] Successfully loaded binary file, length:', data.byteLength);
    onSuccess(arrayBuffer);
  } catch (err) {
    console.error('[FileLoader] Error loading binary file:', err);
    if (onError) onError(err);
  }
}
