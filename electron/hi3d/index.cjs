const { app, dialog, ipcMain } = require('electron');
const { loadHi3dConfig, saveHi3dConfig, readInstallState } = require('./config.cjs');
const { detectHi3dEnvironment } = require('./gpuDetector.cjs');
const { installHi3dRuntime, cancelHi3dInstall } = require('./installer.cjs');
const { runHi3dGeneration, cancelHi3dGeneration } = require('./runner.cjs');

let isInstalling = false;
let isGenerating = false;

function sendToRenderer(getMainWindow, channel, payload) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * Registers IPC handlers for the isolated Hi3D Local module.
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 * @param {() => string} getLibraryPath
 */
function registerHi3dIpc(getMainWindow, getLibraryPath) {
  const userDataDir = app.getPath('userData');

  const buildStatus = async () => {
    const config = loadHi3dConfig(userDataDir);
    const environment = await detectHi3dEnvironment(config.runtimeDir);
    const installState = readInstallState(config.runtimeDir);
    return {
      config,
      environment,
      installState,
      isInstalling,
      isGenerating,
    };
  };

  ipcMain.handle('hi3d:get-status', async () => buildStatus());

  ipcMain.handle('hi3d:update-config', async (_event, patch) => {
    saveHi3dConfig(userDataDir, patch || {});
    return buildStatus();
  });

  ipcMain.handle('hi3d:select-runtime-dir', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Escolher pasta do motor e modelos Hi3D (~25 GB)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    saveHi3dConfig(userDataDir, { runtimeDir: res.filePaths[0] });
    return buildStatus();
  });

  ipcMain.handle('hi3d:select-image', async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Selecionar imagem de referência para gerar 3D',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('hi3d:install', async () => {
    if (isInstalling) throw new Error('Uma instalação do Hi3D já está em andamento.');
    const config = loadHi3dConfig(userDataDir);
    const env = await detectHi3dEnvironment(config.runtimeDir);
    if (!env.compatibility.isCompatible) {
      throw new Error(env.compatibility.summary);
    }
    isInstalling = true;
    try {
      await installHi3dRuntime({
        runtimeDir: config.runtimeDir,
        hasGit: env.hasGit,
        onProgress: (payload) => sendToRenderer(getMainWindow, 'hi3d:install-progress', payload),
      });
      return buildStatus();
    } finally {
      isInstalling = false;
    }
  });

  ipcMain.handle('hi3d:cancel-install', () => {
    cancelHi3dInstall();
    isInstalling = false;
    return true;
  });

  ipcMain.handle('hi3d:generate', async (_event, request) => {
    if (isGenerating) throw new Error('Já existe uma geração Hi3D em andamento.');
    if (isInstalling) throw new Error('Aguarde a conclusão da instalação do motor Hi3D.');
    const config = loadHi3dConfig(userDataDir);
    isGenerating = true;
    try {
      return await runHi3dGeneration({
        runtimeDir: config.runtimeDir,
        libraryPath: getLibraryPath(),
        imagePath: request.imagePath,
        modelName: request.modelName,
        resolution: request.resolution ?? config.resolution,
        outputFormat: request.outputFormat ?? config.outputFormat,
        targetSizeMm: request.targetSizeMm ?? config.targetSizeMm,
        removeBackground: request.removeBackground ?? config.removeBackground,
        cpuOffload: request.cpuOffload ?? config.cpuOffload,
        seed: request.seed ?? 0,
        onProgress: (payload) => sendToRenderer(getMainWindow, 'hi3d:generate-progress', payload),
      });
    } finally {
      isGenerating = false;
    }
  });

  ipcMain.handle('hi3d:cancel-generate', () => {
    cancelHi3dGeneration();
    isGenerating = false;
    return true;
  });
}

module.exports = { registerHi3dIpc };
