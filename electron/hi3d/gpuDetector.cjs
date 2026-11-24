const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { GPU_REQUIREMENTS, getRuntimePaths } = require('./config.cjs');

function execText(command, args, timeoutMs = 6000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function parseNvidiaSmiOutput(rawOutput) {
  if (!rawOutput) return null;
  const lines = rawOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let best = null;
  for (const line of lines) {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 4) continue;
    const vramMb = Math.round(Number(parts[1]) || 0);
    const computeCap = Number(parts[2]) || 0;
    const gpu = {
      name: parts[0],
      vramMb,
      vramGb: Number((vramMb / 1024).toFixed(1)),
      computeCap,
      driverVersion: parts[3],
    };
    if (!best || gpu.vramMb > best.vramMb) best = gpu;
  }
  return best;
}

function findExistingParent(targetPath) {
  let current = path.resolve(targetPath);
  while (current && !fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function getFreeDiskGb(targetPath) {
  try {
    const existing = findExistingParent(targetPath);
    const stats = fs.statfsSync(existing);
    return Number(((stats.bavail * stats.bsize) / (1024 ** 3)).toFixed(1));
  } catch {
    return null;
  }
}

/**
 * Resolves an available `uv` binary path on the system or inside the local runtime folder.
 * @param {string} runtimeDir
 * @returns {Promise<string | null>}
 */
async function resolveUvBinary(runtimeDir) {
  const runtimePaths = getRuntimePaths(runtimeDir);
  const candidates = [
    path.join(runtimePaths.binDir, 'uv.exe'),
    path.join(os.homedir(), '.local', 'bin', 'uv.exe'),
    path.join(os.homedir(), '.cargo', 'bin', 'uv.exe'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const fromPath = await execText('where', ['uv']);
  if (!fromPath) return null;
  return fromPath.split(/\r?\n/)[0].trim() || null;
}

function evaluateCompatibility(gpu, freeDiskGb) {
  const warnings = [];
  if (!gpu) {
    return {
      isCompatible: false,
      level: 'unsupported',
      summary: 'Nenhuma placa NVIDIA compatível foi detectada (nvidia-smi não encontrou GPU).',
      recommendedResolution: 512,
      warnings: ['O Hi3D Local exige placa NVIDIA RTX série 30, 40 ou 50 (Compute ≥ 8.0) com mínimo de 8 GB de VRAM.'],
    };
  }
  if (gpu.computeCap < GPU_REQUIREMENTS.minComputeCap) {
    return {
      isCompatible: false,
      level: 'unsupported',
      summary: `${gpu.name} (Compute ${gpu.computeCap}) não suporta FlashAttention-2 (mínimo 8.0 — RTX 30xx+).`,
      recommendedResolution: 512,
      warnings: ['Placas GTX e RTX série 20 não suportam os kernels CUDA do Hi3D v1.0.'],
    };
  }
  if (gpu.vramMb < GPU_REQUIREMENTS.minVramMb) {
    return {
      isCompatible: false,
      level: 'unsupported',
      summary: `${gpu.name} possui ${gpu.vramGb} GB de VRAM (mínimo exigido: 8 GB).`,
      recommendedResolution: 512,
      warnings: ['A geração local requer pelo menos 8 GB de VRAM dedicados.'],
    };
  }
  if (freeDiskGb !== null && freeDiskGb < GPU_REQUIREMENTS.minDiskFreeGb) {
    warnings.push(`Espaço livre atual (${freeDiskGb} GB) abaixo dos ${GPU_REQUIREMENTS.minDiskFreeGb} GB recomendados — escolha outra unidade.`);
  }
  if (gpu.vramMb < GPU_REQUIREMENTS.recommendedVramMb) {
    warnings.push('Com 8–12 GB de VRAM, use 512³ com CPU Offload ativado. Resoluções 1024³ e 1536³ podem exceder a memória da GPU.');
    return {
      isCompatible: true,
      level: 'minimum',
      summary: `${gpu.name} (${gpu.vramGb} GB VRAM · Compute ${gpu.computeCap}) — Compatível no modo 512³ com CPU Offload.`,
      recommendedResolution: 512,
      warnings,
    };
  }
  if (gpu.vramMb < GPU_REQUIREMENTS.ultraVramMb) {
    warnings.push('1024³ suportado com CPU Offload. A resolução 1536³ pode exigir 24 GB+ de VRAM.');
  }
  return {
    isCompatible: true,
    level: 'recommended',
    summary: `${gpu.name} (${gpu.vramGb} GB VRAM · Compute ${gpu.computeCap}) — Compatível com Hi3D Local.`,
    recommendedResolution: 1024,
    warnings,
  };
}

/**
 * Detects NVIDIA GPU hardware, disk space, git, and uv availability for Hi3D Local.
 * @param {string} runtimeDir
 */
async function detectHi3dEnvironment(runtimeDir) {
  const [smiOut, gitVersion, uvPath] = await Promise.all([
    execText('nvidia-smi', ['--query-gpu=name,memory.total,compute_cap,driver_version', '--format=csv,noheader,nounits']),
    execText('git', ['--version']),
    resolveUvBinary(runtimeDir),
  ]);
  const gpu = parseNvidiaSmiOutput(smiOut);
  const freeDiskGb = getFreeDiskGb(runtimeDir);
  const compatibility = evaluateCompatibility(gpu, freeDiskGb);
  return {
    platform: process.platform,
    gpu,
    freeDiskGb,
    hasGit: Boolean(gitVersion),
    uvPath,
    compatibility,
    requirements: GPU_REQUIREMENTS,
  };
}

module.exports = {
  detectHi3dEnvironment,
  resolveUvBinary,
  getFreeDiskGb,
};
