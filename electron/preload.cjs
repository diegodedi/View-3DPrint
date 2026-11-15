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
});
