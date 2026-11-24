const fs = require('fs');
const path = require('path');

const HI3D_REPO_URL = 'https://github.com/hi3d-official/Hi3Dv1.0.git';
const HI3D_ZIP_URL = 'https://github.com/hi3d-official/Hi3Dv1.0/archive/refs/heads/main.zip';
const HUNYUAN_REPO_URL = 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git';
const HUNYUAN_ZIP_URL = 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2/archive/refs/heads/main.zip';
const PYTORCH_CU124_INDEX = 'https://download.pytorch.org/whl/cu124';
const FLASH_ATTN_WIN_WHEEL =
  'https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4+cu124torch2.5.1cxx11abiFALSE-cp310-cp310-win_amd64.whl';
const UV_WIN_ZIP_URL =
  'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip';

const GPU_REQUIREMENTS = {
  minComputeCap: 8.0,
  minVramMb: 7600,
  recommendedVramMb: 15500,
  ultraVramMb: 23500,
  minDiskFreeGb: 25,
};

function getConfigFilePath(userDataDir) {
  return path.join(userDataDir, 'hi3d-config.json');
}

function getDefaultRuntimeDir(userDataDir) {
  return path.join(userDataDir, 'hi3d-runtime');
}

function getDefaultConfig(userDataDir) {
  return {
    runtimeDir: getDefaultRuntimeDir(userDataDir),
    resolution: 512,
    outputFormat: 'stl',
    targetSizeMm: 100,
    removeBackground: true,
    cpuOffload: true,
  };
}

/**
 * Loads persisted Hi3D local configuration from userData.
 * @param {string} userDataDir
 */
function loadHi3dConfig(userDataDir) {
  const defaults = getDefaultConfig(userDataDir);
  const cfgPath = getConfigFilePath(userDataDir);
  if (!fs.existsSync(cfgPath)) return defaults;
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return {
      runtimeDir: typeof raw.runtimeDir === 'string' && raw.runtimeDir.trim()
        ? raw.runtimeDir.trim()
        : defaults.runtimeDir,
      resolution: [512, 1024, 1536].includes(Number(raw.resolution)) ? Number(raw.resolution) : 512,
      outputFormat: raw.outputFormat === 'obj' ? 'obj' : 'stl',
      targetSizeMm: Math.min(300, Math.max(20, Number(raw.targetSizeMm) || 100)),
      removeBackground: raw.removeBackground !== false,
      cpuOffload: raw.cpuOffload !== false,
    };
  } catch {
    return defaults;
  }
}

/**
 * Persists partial Hi3D local configuration to userData.
 * @param {string} userDataDir
 * @param {Record<string, unknown>} patch
 */
function saveHi3dConfig(userDataDir, patch) {
  const merged = { ...loadHi3dConfig(userDataDir), ...patch };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(getConfigFilePath(userDataDir), JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/**
 * Resolves all directories and files inside the configured runtime folder.
 * @param {string} runtimeDir
 */
function getRuntimePaths(runtimeDir) {
  const venvDir = path.join(runtimeDir, 'venv');
  return {
    runtimeDir,
    binDir: path.join(runtimeDir, 'bin'),
    venvDir,
    venvPython: path.join(venvDir, 'Scripts', 'python.exe'),
    hi3dRepoDir: path.join(runtimeDir, 'repos', 'Hi3Dv1.0'),
    hunyuanRepoDir: path.join(runtimeDir, 'repos', 'Hunyuan3D-2'),
    hfCacheDir: path.join(runtimeDir, 'hf-cache'),
    markerFile: path.join(runtimeDir, '.hi3d-installed.json'),
  };
}

/**
 * Checks whether the Hi3D local runtime is installed and ready to run.
 * @param {string} runtimeDir
 */
function readInstallState(runtimeDir) {
  const paths = getRuntimePaths(runtimeDir);
  if (!fs.existsSync(paths.markerFile) || !fs.existsSync(paths.venvPython)) {
    return { isInstalled: false, installedAt: null, details: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.markerFile, 'utf-8'));
    const hasRepos = fs.existsSync(paths.hi3dRepoDir) && fs.existsSync(paths.hunyuanRepoDir);
    return {
      isInstalled: Boolean(parsed.ok && hasRepos),
      installedAt: parsed.installedAt || null,
      details: parsed,
    };
  } catch {
    return { isInstalled: false, installedAt: null, details: null };
  }
}

module.exports = {
  HI3D_REPO_URL,
  HI3D_ZIP_URL,
  HUNYUAN_REPO_URL,
  HUNYUAN_ZIP_URL,
  PYTORCH_CU124_INDEX,
  FLASH_ATTN_WIN_WHEEL,
  UV_WIN_ZIP_URL,
  GPU_REQUIREMENTS,
  loadHi3dConfig,
  saveHi3dConfig,
  getRuntimePaths,
  readInstallState,
};
