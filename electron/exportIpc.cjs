const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const {
  saveMultiPart3mfFileAsync,
  openMultiPartProjectInSlicer,
} = require('./multiPart3mfService.cjs');

function resolveDialogDefaultDir(defaultPath) {
  if (!defaultPath || typeof defaultPath !== 'string') return undefined;
  try {
    let candidateDir = defaultPath.trim();
    if (fs.existsSync(candidateDir)) {
      const stat = fs.statSync(candidateDir);
      if (!stat.isDirectory()) {
        candidateDir = path.dirname(candidateDir);
      }
      if (fs.existsSync(candidateDir)) return candidateDir;
    } else {
      const parentDir = path.dirname(candidateDir);
      if (fs.existsSync(parentDir)) return parentDir;
    }
  } catch {
    // Fallback silencioso se o caminho não for acessível
  }
  return undefined;
}

async function resolveCatpinOutputDir(mainWindow, targetFolder, defaultPath) {
  if (targetFolder) return targetFolder;
  const dialogOptions = {
    title: 'Selecione a Pasta para Salvar as Peças Cortadas',
    properties: ['openDirectory', 'createDirectory'],
  };
  const resolvedDefault = resolveDialogDefaultDir(defaultPath);
  if (resolvedDefault) dialogOptions.defaultPath = resolvedDefault;

  const res = await dialog.showOpenDialog(mainWindow, dialogOptions);
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
}

/**
 * Registers IPC handlers for exporting CatPin STL parts and Multi-Part 3MF projects.
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function registerExportIpc(getMainWindow) {
  ipcMain.handle('app:save-catpin-files', async (_event, { targetFolder, defaultPath, files, openFolderAfter = true }) => {
    const outDir = await resolveCatpinOutputDir(getMainWindow(), targetFolder, defaultPath);
    if (!outDir) {
      return { success: false, savedPaths: [], folder: '' };
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

  ipcMain.handle('app:save-multi-part-3mf', async (_event, payload) => {
    const { projectName, parts, targetFolder, defaultPath, bedWidthMm, bedDepthMm } = payload || {};
    const cleanBase = String(projectName || 'Projeto').replace(/\.[^/.]+$/, '');
    const cleanName = cleanBase.replace(/[^a-zA-Z0-9_-]/g, '_');
    const defaultFileName = `${cleanName}_MesaCompleta.3mf`;
    const options = { bedWidthMm, bedDepthMm };

    if (targetFolder && typeof targetFolder === 'string') {
      const outFile = path.join(targetFolder, defaultFileName);
      await saveMultiPart3mfFileAsync({ filePath: outFile, projectName: cleanBase, parts, options });
      return { success: true, savedPath: outFile, folder: targetFolder };
    }

    const saveOptions = {
      title: 'Salvar Projeto Completo da Mesa (.3MF)',
      defaultPath: defaultPath ? path.join(defaultPath, defaultFileName) : defaultFileName,
      filters: [{ name: 'Projeto 3D Manufacturing Format (.3mf)', extensions: ['3mf'] }],
    };
    const res = await dialog.showSaveDialog(getMainWindow(), saveOptions);
    if (res.canceled || !res.filePath) {
      return { success: false, savedPath: '' };
    }
    await saveMultiPart3mfFileAsync({ filePath: res.filePath, projectName: cleanBase, parts, options });
    shell.showItemInFolder(res.filePath);
    return { success: true, savedPath: res.filePath, folder: path.dirname(res.filePath) };
  });

  ipcMain.handle('app:open-multi-part-in-slicer', async (_event, payload) => {
    const { projectName, parts, slicerExecutablePath, bedWidthMm, bedDepthMm } = payload || {};
    return openMultiPartProjectInSlicer({
      projectName,
      parts,
      slicerExecutablePath,
      options: { bedWidthMm, bedDepthMm },
    });
  });
}

module.exports = { registerExportIpc };
