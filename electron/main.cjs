const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { registerLocalAssetScheme, registerLocalAssetProtocol } = require('./localAssetProtocol.cjs');
const { scanLibraryFolderAsync, saveFolderMetadata, readCachedLibraryItems } = require('./scanner.cjs');
const {
  loadAppSettings,
  saveAppSettings,
  openModelInSlicer,
  openConfiguredModelInSlicer,
  getCrealityCatalogForSlicer,
} = require('./slicerService.cjs');
const { registerExportIpc } = require('./exportIpc.cjs');
const {
  executeCatpinCutForUi,
  suggestCatpinPinForUi,
  diagnoseCatpinModelForUi,
} = require('./catpin/index.cjs');
const { initAutoUpdater, checkForUpdates } = require('./updater.cjs');
const { registerWebTabsIpc } = require('./webTabsService.cjs');
const { registerThumbCacheIpc } = require('./thumbCache.cjs');
const { registerHi3dIpc } = require('./hi3d/index.cjs');
let mainWindow = null;

registerLocalAssetScheme();

function getDefaultLibraryPath() {
  return path.join(app.getAppPath(), 'sample-library');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'View 3DPrint — Asset Browser 3D',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'), show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const isDev = !app.isPackaged && process.env.VITE_DEV_SERVER === 'true';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function registerIpcHandlers() {
  const sampleLib = getDefaultLibraryPath();
  const cacheDir = app.getPath('userData');

  ipcMain.handle('app:get-initial-state', async () => {
    const settings = loadAppSettings(sampleLib);
    const activeSlicer = settings.slicers.find((s) => s.id === settings.activeSlicerId);
    const crealityCatalog = getCrealityCatalogForSlicer(
      activeSlicer ? activeSlicer.executablePath : null,
      settings.crealityPrinter
    );
    const cachedItems = await readCachedLibraryItems(settings.libraryPath, cacheDir);
    if (cachedItems.length > 0) {
      setImmediate(() => {
        scanLibraryFolderAsync(settings.libraryPath, { cacheDir }).catch(() => {});
      });
      return { settings, items: cachedItems, crealityCatalog };
    }
    const items = await scanLibraryFolderAsync(settings.libraryPath, { cacheDir });
    return { settings, items, crealityCatalog };
  });

  ipcMain.handle('app:select-library-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a Pasta de Objetos 3D',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const chosenPath = result.filePaths[0];
    const settings = saveAppSettings({ libraryPath: chosenPath }, sampleLib);
    const items = await scanLibraryFolderAsync(chosenPath, { cacheDir });
    return { settings, items };
  });

  ipcMain.handle('app:rescan-library', async (_event, folderPath) => {
    const settings = loadAppSettings(sampleLib);
    const target = folderPath || settings.libraryPath;
    const items = await scanLibraryFolderAsync(target, { cacheDir });
    return { settings, items };
  });

  ipcMain.handle('app:read-model-buffer', async (_event, filePath) => {
    if (!filePath) throw new Error('Arquivo 3D não encontrado.');
    try {
      const buffer = await fs.promises.readFile(filePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch {
      throw new Error('Arquivo 3D não encontrado.');
    }
  });

  ipcMain.handle('app:read-image-data-url', async (_event, imagePath) => {
    if (!imagePath) return null;
    if (imagePath.startsWith('data:image/')) return imagePath;
    try {
      const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const raw = await fs.promises.readFile(imagePath);
      return `data:${mime};base64,${raw.toString('base64')}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:open-in-slicer', async (_event, { modelPath, slicerExecutablePath }) => {
    return openModelInSlicer(modelPath, slicerExecutablePath);
  });

  ipcMain.handle('app:open-configured-in-slicer', async (_event, payload) => {
    return openConfiguredModelInSlicer(payload);
  });

  ipcMain.handle('app:get-creality-catalog', (_event, { slicerExecutablePath, selectedPrinter }) => {
    return getCrealityCatalogForSlicer(slicerExecutablePath, selectedPrinter);
  });

  ipcMain.handle('app:open-in-explorer', (_event, folderPath) => {
    if (folderPath && fs.existsSync(folderPath)) {
      shell.openPath(folderPath);
      return true;
    }
    return false;
  });

  ipcMain.handle('app:select-slicer-exe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Executável do Fatiador (.exe)',
      filters: [{ name: 'Executáveis', extensions: ['exe', 'bat', 'cmd'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const exePath = result.filePaths[0];
    const name = path.basename(exePath, path.extname(exePath));
    return {
      id: `custom-${Date.now()}`,
      name,
      executablePath: exePath,
    };
  });

  ipcMain.handle('app:save-settings', (_event, newSettings) => {
    return saveAppSettings(newSettings, sampleLib);
  });

  ipcMain.handle('app:save-object-metadata', (_event, { folderPath, metadata }) => {
    return saveFolderMetadata(folderPath, metadata, cacheDir);
  });

  ipcMain.handle('app:execute-catpin-cut', (_event, payload) => executeCatpinCutForUi(payload));
  ipcMain.handle('app:suggest-catpin-pin', (_event, payload) => suggestCatpinPinForUi(payload));
  ipcMain.handle('app:diagnose-catpin-model', (_event, payload) => diagnoseCatpinModelForUi(payload));

  ipcMain.handle('app:check-for-updates', () => {
    checkForUpdates(mainWindow, true);
    return true;
  });
}

app.whenReady().then(() => {
  registerLocalAssetProtocol();
  registerIpcHandlers();
  registerExportIpc(() => mainWindow);
  registerThumbCacheIpc(app.getPath('userData'));
  registerWebTabsIpc(() => mainWindow);
  registerHi3dIpc(() => mainWindow, () => loadAppSettings(getDefaultLibraryPath()).libraryPath);
  createMainWindow();
  initAutoUpdater(mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
