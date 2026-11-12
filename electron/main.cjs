const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { scanLibraryFolder, saveFolderMetadata } = require('./scanner.cjs');
const {
  loadAppSettings,
  saveAppSettings,
  openModelInSlicer,
  openConfiguredModelInSlicer,
  getCrealityCatalogForSlicer,
} = require('./slicerService.cjs');
const {
  saveMultiPart3mfFile,
  openMultiPartProjectInSlicer,
} = require('./multiPart3mfService.cjs');
const {
  executeCatpinCutForUi,
  suggestCatpinPinForUi,
  diagnoseCatpinModelForUi,
} = require('./catpin/index.cjs');
const { initAutoUpdater, checkForUpdates } = require('./updater.cjs');

let mainWindow = null;

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
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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

  ipcMain.handle('app:get-initial-state', () => {
    const settings = loadAppSettings(sampleLib);
    const items = scanLibraryFolder(settings.libraryPath);
    return { settings, items };
  });

  ipcMain.handle('app:select-library-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecione a Pasta de Objetos 3D',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const chosenPath = result.filePaths[0];
    const settings = saveAppSettings({ libraryPath: chosenPath }, sampleLib);
    const items = scanLibraryFolder(chosenPath);
    return { settings, items };
  });

  ipcMain.handle('app:rescan-library', (_event, folderPath) => {
    const settings = loadAppSettings(sampleLib);
    const target = folderPath || settings.libraryPath;
    const items = scanLibraryFolder(target);
    return { settings, items };
  });

  ipcMain.handle('app:read-model-buffer', (_event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Arquivo 3D não encontrado.');
    }
    const buffer = fs.readFileSync(filePath);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  });

  ipcMain.handle('app:read-image-data-url', (_event, imagePath) => {
    if (!imagePath) return null;
    if (imagePath.startsWith('data:image/')) return imagePath;
    if (!fs.existsSync(imagePath)) return null;
    const ext = path.extname(imagePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = fs.readFileSync(imagePath).toString('base64');
    return `data:${mime};base64,${base64}`;
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
    return saveFolderMetadata(folderPath, metadata);
  });

  ipcMain.handle('app:save-catpin-files', async (_event, { targetFolder, defaultPath, files, openFolderAfter = true }) => {
    let outDir = targetFolder;
    if (!outDir) {
      const dialogOptions = {
        title: 'Selecione a Pasta para Salvar as Peças Cortadas',
        properties: ['openDirectory', 'createDirectory'],
      };

      if (defaultPath && typeof defaultPath === 'string') {
        try {
          let candidateDir = defaultPath.trim();
          if (fs.existsSync(candidateDir)) {
            const stat = fs.statSync(candidateDir);
            if (!stat.isDirectory()) {
              candidateDir = path.dirname(candidateDir);
            }
            if (fs.existsSync(candidateDir)) {
              dialogOptions.defaultPath = candidateDir;
            }
          } else {
            const parentDir = path.dirname(candidateDir);
            if (fs.existsSync(parentDir)) {
              dialogOptions.defaultPath = parentDir;
            }
          }
        } catch {
          // Fallback silencioso se o caminho não for acessível
        }
      }

      const res = await dialog.showOpenDialog(mainWindow, dialogOptions);
      if (res.canceled || res.filePaths.length === 0) {
        return { success: false, savedPaths: [], folder: '' };
      }
      outDir = res.filePaths[0];
    }

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const savedPaths = [];
    for (const file of files) {
      const filename = file.name.toLowerCase().endsWith('.stl') ? file.name : `${file.name}.stl`;
      const fullPath = path.join(outDir, filename);
      fs.writeFileSync(fullPath, Buffer.from(file.buffer));
      savedPaths.push(fullPath);
    }

    if (openFolderAfter) {
      shell.openPath(outDir);
    }

    return { success: true, savedPaths, folder: outDir };
  });

  ipcMain.handle('app:execute-catpin-cut', (_event, payload) => executeCatpinCutForUi(payload));
  ipcMain.handle('app:suggest-catpin-pin', (_event, payload) => suggestCatpinPinForUi(payload));
  ipcMain.handle('app:diagnose-catpin-model', (_event, payload) => diagnoseCatpinModelForUi(payload));

  ipcMain.handle('app:save-multi-part-3mf', async (_event, { projectName, parts, defaultPath }) => {
    const cleanName = (projectName || 'Projeto').replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultFileName = `${cleanName}_MesaCompleta.3mf`;
    const saveOptions = {
      title: 'Salvar Projeto Completo da Mesa (.3MF)',
      defaultPath: defaultPath ? path.join(defaultPath, defaultFileName) : defaultFileName,
      filters: [{ name: 'Projeto 3D Manufacturing Format (.3mf)', extensions: ['3mf'] }],
    };
    const res = await dialog.showSaveDialog(mainWindow, saveOptions);
    if (res.canceled || !res.filePath) {
      return { success: false, savedPath: '' };
    }
    saveMultiPart3mfFile(res.filePath, projectName, parts);
    shell.showItemInFolder(res.filePath);
    return { success: true, savedPath: res.filePath };
  });

  ipcMain.handle('app:open-multi-part-in-slicer', async (_event, { projectName, parts, slicerExecutablePath }) => {
    return openMultiPartProjectInSlicer(projectName, parts, slicerExecutablePath);
  });

  ipcMain.handle('app:check-for-updates', () => {
    checkForUpdates(mainWindow, true);
    return true;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  initAutoUpdater(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

