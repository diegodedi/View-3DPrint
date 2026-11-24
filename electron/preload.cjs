const { contextBridge, ipcRenderer } = require('electron');

const MAX_CACHE_ITEMS = 2;
const MAX_CACHE_BYTES = 80 * 1024 * 1024;
const modelBufferCache = new Map();
let cachedTotalBytes = 0;

function clearModelBufferCache() {
  modelBufferCache.clear();
  cachedTotalBytes = 0;
}

async function readModelBufferCached(filePath) {
  if (modelBufferCache.has(filePath)) {
    const hit = modelBufferCache.get(filePath);
    modelBufferCache.delete(filePath);
    modelBufferCache.set(filePath, hit);
    return hit.slice(0);
  }

  const raw = await ipcRenderer.invoke('app:read-model-buffer', filePath);
  const view = raw instanceof Uint8Array
    ? raw
    : raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length || 0);

  if (view.byteLength > 0 && view.byteLength <= MAX_CACHE_BYTES) {
    while (
      modelBufferCache.size >= MAX_CACHE_ITEMS ||
      cachedTotalBytes + view.byteLength > MAX_CACHE_BYTES
    ) {
      const oldestKey = modelBufferCache.keys().next().value;
      if (!oldestKey) break;
      const oldest = modelBufferCache.get(oldestKey);
      cachedTotalBytes -= oldest ? oldest.byteLength : 0;
      modelBufferCache.delete(oldestKey);
    }
    const stored = view.slice(0);
    modelBufferCache.set(filePath, stored);
    cachedTotalBytes += stored.byteLength;
    return stored.slice(0);
  }

  return view;
}

/**
 * Exposes a strict, secure API to the renderer process via contextBridge.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  selectLibraryFolder: async () => {
    clearModelBufferCache();
    return ipcRenderer.invoke('app:select-library-folder');
  },
  rescanLibrary: async (folderPath) => {
    clearModelBufferCache();
    return ipcRenderer.invoke('app:rescan-library', folderPath);
  },
  readModelBuffer: readModelBufferCached,
  readImageDataUrl: (imagePath) => ipcRenderer.invoke('app:read-image-data-url', imagePath),
  openInSlicer: (modelPath, slicerExecutablePath) =>
    ipcRenderer.invoke('app:open-in-slicer', { modelPath, slicerExecutablePath }),
  openConfiguredInSlicer: (payload) => ipcRenderer.invoke('app:open-configured-in-slicer', payload),
  getCrealityCatalog: (slicerExecutablePath, selectedPrinter) =>
    ipcRenderer.invoke('app:get-creality-catalog', { slicerExecutablePath, selectedPrinter }),
  openFolderInExplorer: (folderPath) => ipcRenderer.invoke('app:open-in-explorer', folderPath),
  selectSlicerExecutable: () => ipcRenderer.invoke('app:select-slicer-exe'),
  saveSettings: (settings) => ipcRenderer.invoke('app:save-settings', settings),
  saveObjectMetadata: (folderPath, metadata) =>
    ipcRenderer.invoke('app:save-object-metadata', { folderPath, metadata }),
  thumbCache: {
    saveAutoWebp: (cacheKey, bytes, ext = '.webp') =>
      ipcRenderer.invoke('thumbcache:save-auto', { cacheKey, bytes, ext }),
    extract3mfThumb: (modelPath, cacheKey) =>
      ipcRenderer.invoke('thumbcache:extract-3mf', { modelPath, cacheKey }),
  },
  executeCatpinCut: (payload) => ipcRenderer.invoke('app:execute-catpin-cut', payload),
  suggestCatpinPin: (payload) => ipcRenderer.invoke('app:suggest-catpin-pin', payload),
  diagnoseCatpinModel: (payload) => ipcRenderer.invoke('app:diagnose-catpin-model', payload),
  saveCatpinFiles: async (payload) => {
    clearModelBufferCache();
    return ipcRenderer.invoke('app:save-catpin-files', payload);
  },
  saveMultiPart3mf: async (payload) => {
    clearModelBufferCache();
    return ipcRenderer.invoke('app:save-multi-part-3mf', payload);
  },
  openMultiPartInSlicer: (payload) => ipcRenderer.invoke('app:open-multi-part-in-slicer', payload),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  webTabs: {
    getConfig: () => ipcRenderer.invoke('webtabs:get-config'),
    activate: (tabId, bounds) => ipcRenderer.invoke('webtabs:activate', { tabId, bounds }),
    setBounds: (bounds) => ipcRenderer.invoke('webtabs:set-bounds', { bounds }),
    setSuspended: (suspended) => ipcRenderer.invoke('webtabs:set-suspended', { suspended }),
    setUrl: (tabId, url, bounds) => ipcRenderer.invoke('webtabs:set-url', { tabId, url, bounds }),
    resetGen3d: (bounds) => ipcRenderer.invoke('webtabs:reset-gen3d', { bounds }),
    logoutChat: (clearSession) => ipcRenderer.invoke('webtabs:logout-chat', { clearSession }),
    reload: (tabId) => ipcRenderer.invoke('webtabs:reload', { tabId }),
    navigateHistory: (tabId, direction) =>
      ipcRenderer.invoke('webtabs:navigate-history', { tabId, direction }),
    closeView: (tabId) => ipcRenderer.invoke('webtabs:close-view', { tabId }),
    onStateChanged: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on('webtabs:state-changed', handler);
      return () => ipcRenderer.removeListener('webtabs:state-changed', handler);
    },
  },
  hi3d: {
    getStatus: () => ipcRenderer.invoke('hi3d:get-status'),
    updateConfig: (patch) => ipcRenderer.invoke('hi3d:update-config', patch),
    selectRuntimeDir: () => ipcRenderer.invoke('hi3d:select-runtime-dir'),
    selectImage: () => ipcRenderer.invoke('hi3d:select-image'),
    install: () => ipcRenderer.invoke('hi3d:install'),
    cancelInstall: () => ipcRenderer.invoke('hi3d:cancel-install'),
    generate: (request) => ipcRenderer.invoke('hi3d:generate', request),
    cancelGenerate: () => ipcRenderer.invoke('hi3d:cancel-generate'),
    onInstallProgress: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on('hi3d:install-progress', handler);
      return () => ipcRenderer.removeListener('hi3d:install-progress', handler);
    },
    onGenerateProgress: (listener) => {
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on('hi3d:generate-progress', handler);
      return () => ipcRenderer.removeListener('hi3d:generate-progress', handler);
    },
  },
});
