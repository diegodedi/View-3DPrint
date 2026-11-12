const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a strict, secure API to the renderer process via contextBridge.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  selectLibraryFolder: () => ipcRenderer.invoke('app:select-library-folder'),
  rescanLibrary: (folderPath) => ipcRenderer.invoke('app:rescan-library', folderPath),
  readModelBuffer: (filePath) => ipcRenderer.invoke('app:read-model-buffer', filePath),
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
  saveCatpinFiles: (payload) => ipcRenderer.invoke('app:save-catpin-files', payload),
  saveMultiPart3mf: (payload) => ipcRenderer.invoke('app:save-multi-part-3mf', payload),
  openMultiPartInSlicer: (payload) => ipcRenderer.invoke('app:open-multi-part-in-slicer', payload),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
});
