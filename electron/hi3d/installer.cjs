const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  HI3D_REPO_URL,
  HI3D_ZIP_URL,
  HUNYUAN_REPO_URL,
  HUNYUAN_ZIP_URL,
  PYTORCH_CU124_INDEX,
  FLASH_ATTN_WIN_WHEEL,
  UV_WIN_ZIP_URL,
  getRuntimePaths,
} = require('./config.cjs');
const { resolveUvBinary } = require('./gpuDetector.cjs');

let activeChild = null;
let isCancelled = false;

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function runSubprocess(params) {
  const { command, args, cwd, env, onLog } = params;
  return new Promise((resolve, reject) => {
    if (isCancelled) {
      reject(new Error('Instalação cancelada pelo usuário.'));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      windowsHide: true,
    });
    activeChild = child;

    const handleChunk = (chunk) => {
      const text = String(chunk || '').replace(/\r/g, '\n');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) onLog(trimmed);
      }
    };
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
    child.on('error', (err) => {
      activeChild = null;
      reject(err);
    });
    child.on('close', (code) => {
      activeChild = null;
      if (isCancelled) reject(new Error('Instalação cancelada pelo usuário.'));
      else if (code === 0) resolve();
      else reject(new Error(`Comando falhou (código ${code}): ${path.basename(command)} ${args.slice(0, 3).join(' ')}`));
    });
  });
}

async function downloadZipArchive(url, zipPath, onLog) {
  const script = `Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}' -UseBasicParsing`;
  await runSubprocess({ command: 'powershell.exe', args: ['-NoProfile', '-Command', script], onLog });
}

async function extractZipArchive(zipPath, targetDir, onLog) {
  const script = `Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force; Remove-Item '${zipPath}' -Force`;
  await runSubprocess({ command: 'powershell.exe', args: ['-NoProfile', '-Command', script], onLog });
}

async function unpackRemoteZip(url, targetDir, onLog) {
  fs.mkdirSync(targetDir, { recursive: true });
  const zipPath = path.join(targetDir, `_dl_${Date.now()}.zip`);
  await downloadZipArchive(url, zipPath, onLog);
  await extractZipArchive(zipPath, targetDir, onLog);
}

async function ensureUvBinary(runtimeDir, onLog) {
  const existing = await resolveUvBinary(runtimeDir);
  if (existing) {
    onLog(`uv encontrado: ${existing}`);
    return existing;
  }
  const paths = getRuntimePaths(runtimeDir);
  onLog('Baixando gerenciador portátil uv (Python 3.10 isolado)...');
  await unpackRemoteZip(UV_WIN_ZIP_URL, paths.binDir, onLog);
  const uvExe = path.join(paths.binDir, 'uv.exe');
  if (!fs.existsSync(uvExe)) throw new Error('Falha ao obter uv.exe portátil.');
  return uvExe;
}

async function ensureGitRepo(params) {
  const { repoUrl, zipUrl, targetDir, hasGit, onLog } = params;
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    onLog(`Repositório já presente em ${targetDir}`);
    return;
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  if (hasGit) {
    await runSubprocess({ command: 'git', args: ['clone', '--depth', '1', repoUrl, targetDir], onLog });
    return;
  }
  const tempDir = `${targetDir}_extract`;
  await unpackRemoteZip(zipUrl, tempDir, onLog);
  const extracted = fs.readdirSync(tempDir).map((name) => path.join(tempDir, name));
  const innerDir = extracted.find((entry) => fs.statSync(entry).isDirectory());
  if (!innerDir) throw new Error(`Falha ao extrair ${repoUrl}`);
  fs.renameSync(innerDir, targetDir);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function buildUvPipArgs(venvPython, packages, extraFlags = []) {
  return ['pip', 'install', '--python', venvPython, ...extraFlags, ...packages];
}

/**
 * Installs isolated Python 3.10 runtime, Hi3Dv1.0, Hunyuan3D-2, and verified Windows CUDA 12.4 wheels.
 * @param {{ runtimeDir: string, hasGit: boolean, onProgress: (evt: object) => void }} params
 */
async function installHi3dRuntime({ runtimeDir, hasGit, onProgress }) {
  isCancelled = false;
  const paths = getRuntimePaths(runtimeDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.mkdirSync(paths.hfCacheDir, { recursive: true });

  const emit = (step, percent, message) => onProgress({ step, percent, message });
  const log = (line) => onProgress({ log: line });
  const pipEnv = { UV_CACHE_DIR: path.join(paths.runtimeDir, 'uv-cache') };

  emit('uv', 5, 'Preparando gerenciador Python isolado (uv)...');
  const uvBin = await ensureUvBinary(runtimeDir, log);

  emit('venv', 14, 'Criando ambiente isolado Python 3.10...');
  if (!fs.existsSync(paths.venvPython)) {
    await runSubprocess({ command: uvBin, args: ['venv', '--python', '3.10', '--seed', paths.venvDir], env: pipEnv, onLog: log });
  }

  emit('repos', 24, 'Baixando repositórios Hi3Dv1.0 e Hunyuan3D-2...');
  await ensureGitRepo({ repoUrl: HI3D_REPO_URL, zipUrl: HI3D_ZIP_URL, targetDir: paths.hi3dRepoDir, hasGit, onLog: log });
  await ensureGitRepo({ repoUrl: HUNYUAN_REPO_URL, zipUrl: HUNYUAN_ZIP_URL, targetDir: paths.hunyuanRepoDir, hasGit, onLog: log });

  emit('torch', 38, 'Instalando PyTorch 2.5.1 + CUDA 12.4 (pode levar alguns minutos)...');
  await runSubprocess({
    command: uvBin,
    args: buildUvPipArgs(paths.venvPython, ['torch==2.5.1+cu124', 'torchvision==0.20.1+cu124'], ['--index-url', PYTORCH_CU124_INDEX]),
    env: pipEnv,
    onLog: log,
  });

  emit('kernels', 58, 'Instalando kernels GPU Windows (Triton, spconv, FlashAttention-2)...');
  await runSubprocess({
    command: uvBin,
    args: buildUvPipArgs(paths.venvPython, ['triton-windows==3.1.0.post17', 'spconv-cu120==2.3.6', FLASH_ATTN_WIN_WHEEL]),
    env: pipEnv,
    onLog: log,
  });

  emit('deps', 76, 'Instalando dependências de malha, IA e remoção de fundo...');
  await runSubprocess({
    command: uvBin,
    args: buildUvPipArgs(paths.venvPython, [
      'numpy==1.26.4',
      'transformers==4.46.3',
      'safetensors>=0.4.3',
      'huggingface-hub>=0.28.0,<1',
      'pillow>=10.3.0',
      'trimesh>=4.4.0,<5',
      'pyfqmr==0.5.0',
      'accelerate>=0.31.0,<2',
      'rembg>=2.0.57',
      'onnxruntime>=1.18.0',
      'einops',
      'diffusers>=0.30.0,<1',
      'opencv-python-headless',
      'pymeshlab',
      'scikit-image',
      'tqdm',
      'pyyaml',
      'omegaconf',
    ]),
    env: pipEnv,
    onLog: log,
  });

  emit('sparc3d', 88, 'Registrando pacote sparc3d (Hi3D v1.0)...');
  await runSubprocess({
    command: uvBin,
    args: buildUvPipArgs(paths.venvPython, ['-e', paths.hi3dRepoDir], ['--no-deps']),
    env: pipEnv,
    onLog: log,
  });

  emit('verify', 95, 'Validando CUDA, FlashAttention, Triton, spconv e pacotes...');
  const checkCode = [
    'import torch, triton, spconv, flash_attn, sparc3d, trimesh, rembg, sys',
    `sys.path.insert(0, r"${paths.hunyuanRepoDir}")`,
    'from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline',
    'assert torch.cuda.is_available(), "CUDA indisponivel no PyTorch"',
    'print("CHECK_OK", torch.__version__, torch.cuda.get_device_name(0))',
  ].join('; ');
  await runSubprocess({ command: paths.venvPython, args: ['-c', checkCode], env: pipEnv, onLog: log });

  const marker = { ok: true, installedAt: new Date().toISOString(), runtimeDir };
  fs.writeFileSync(paths.markerFile, JSON.stringify(marker, null, 2), 'utf-8');
  emit('done', 100, 'Motor Hi3D Local instalado e validado com sucesso!');
  return marker;
}

/**
 * Cancels an active installation subprocess tree.
 */
function cancelHi3dInstall() {
  isCancelled = true;
  killProcessTree(activeChild);
  activeChild = null;
}

module.exports = {
  installHi3dRuntime,
  cancelHi3dInstall,
};
