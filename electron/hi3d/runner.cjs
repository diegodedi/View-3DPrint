const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getRuntimePaths, readInstallState } = require('./config.cjs');

const EVENT_PREFIX = '@@HI3D_EVENT@@';
let activeGenChild = null;
let isGenCancelled = false;

function sanitizeModelName(rawName, imagePath) {
  const fallback = path.basename(imagePath, path.extname(imagePath)) || 'modelo-hi3d';
  const base = String(rawName || fallback).trim() || fallback;
  const cleaned = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return cleaned || 'modelo-hi3d';
}

function createUniqueOutputFolder(libraryPath, baseName) {
  const root = path.join(libraryPath, 'Hi3D');
  fs.mkdirSync(root, { recursive: true });
  let candidate = path.join(root, baseName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${baseName}_${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function resolveWorkerScriptPath() {
  const unpacked = path.join(__dirname, 'hi3d_worker.py').replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'hi3d_worker.py');
}

function killGenTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Runs the unified local Hi3D 1-image generation pipeline and saves the mesh into the user's library.
 */
function runHi3dGeneration(params) {
  const {
    runtimeDir,
    libraryPath,
    imagePath,
    modelName,
    resolution,
    outputFormat,
    targetSizeMm,
    removeBackground,
    cpuOffload,
    seed,
    onProgress,
  } = params;

  const installState = readInstallState(runtimeDir);
  if (!installState.isInstalled) {
    return Promise.reject(new Error('O motor Hi3D Local ainda não está instalado.'));
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    return Promise.reject(new Error('Selecione uma imagem válida antes de gerar.'));
  }
  if (!libraryPath) {
    return Promise.reject(new Error('Nenhuma pasta de biblioteca 3D configurada.'));
  }

  isGenCancelled = false;
  const paths = getRuntimePaths(runtimeDir);
  const safeName = sanitizeModelName(modelName, imagePath);
  const outFolder = createUniqueOutputFolder(libraryPath, safeName);
  const ext = outputFormat === 'obj' ? '.obj' : '.stl';
  const outFile = path.join(outFolder, `${safeName}${ext}`);

  const imgExt = path.extname(imagePath).toLowerCase() || '.png';
  try {
    fs.copyFileSync(imagePath, path.join(outFolder, `referencia${imgExt}`));
  } catch {
    // Copia de referencia opcional
  }

  const workerArgs = [
    resolveWorkerScriptPath(),
    '--image', imagePath,
    '--output', outFile,
    '--hunyuan-repo', paths.hunyuanRepoDir,
    '--hf-cache', paths.hfCacheDir,
    '--resolution', String(resolution || 512),
    '--target-size-mm', String(targetSizeMm || 100),
    '--seed', String(Number(seed) || 0),
  ];
  if (removeBackground !== false) workerArgs.push('--remove-background');
  if (cpuOffload !== false) workerArgs.push('--cpu-offload');

  return new Promise((resolve, reject) => {
    const child = spawn(paths.venvPython, workerArgs, {
      cwd: paths.hi3dRepoDir,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
    activeGenChild = child;

    let finalMeta = { triangles: 0, elapsedMs: 0, resolution: resolution || 512 };
    let lastErrorLine = '';

    const handleLine = (line, isErr) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith(EVENT_PREFIX)) {
        try {
          const evt = JSON.parse(trimmed.slice(EVENT_PREFIX.length));
          if (evt.stage === 'done') {
            finalMeta = {
              triangles: evt.triangles || 0,
              elapsedMs: evt.elapsedMs || 0,
              resolution: evt.resolution || resolution || 512,
            };
          }
          onProgress(evt);
          return;
        } catch {
          // Linha JSON parcial
        }
      }
      if (isErr) lastErrorLine = trimmed;
      onProgress({ log: trimmed });
    };

    const bindStream = (stream, isErr) => {
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += String(chunk || '').replace(/\r/g, '\n');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line, isErr);
      });
      stream.on('end', () => {
        if (buffer.trim()) handleLine(buffer, isErr);
      });
    };

    bindStream(child.stdout, false);
    bindStream(child.stderr, true);

    child.on('error', (err) => {
      activeGenChild = null;
      reject(err);
    });

    child.on('close', (code) => {
      activeGenChild = null;
      if (isGenCancelled) {
        reject(new Error('Geração cancelada pelo usuário.'));
        return;
      }
      if (code === 0 && fs.existsSync(outFile)) {
        resolve({
          success: true,
          modelPath: outFile,
          folderPath: outFolder,
          modelName: safeName,
          ...finalMeta,
        });
        return;
      }
      reject(new Error(lastErrorLine || `Falha na geração Hi3D (código ${code}).`));
    });
  });
}

/**
 * Cancels the active local Hi3D generation process.
 */
function cancelHi3dGeneration() {
  isGenCancelled = true;
  killGenTree(activeGenChild);
  activeGenChild = null;
}

module.exports = {
  runHi3dGeneration,
  cancelHi3dGeneration,
};
