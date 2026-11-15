const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');
const { listCrealityCatalog } = require('./crealityPresets.cjs');
const { generateConfigured3mfPackageAsync } = require('./creality3mfBuilder.cjs');

let cachedDetectedSlicers = null;
let cachedCrealityInstallations = null;
const cachedCrealityCatalogs = new Map();
let cachedLoadedSettings = null;

const STATIC_SLICERS = [
  {
    id: 'orcaslicer',
    name: 'OrcaSlicer',
    candidates: [
      'C:\\Program Files\\OrcaSlicer\\orca-slicer.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OrcaSlicer', 'orca-slicer.exe'),
    ],
  },
  {
    id: 'bambu-studio',
    name: 'Bambu Studio',
    candidates: [
      'C:\\Program Files\\Bambu Studio\\bambu-studio.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Bambu Studio', 'bambu-studio.exe'),
    ],
  },
  {
    id: 'prusaslicer',
    name: 'PrusaSlicer',
    candidates: [
      'C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe',
      'C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe',
    ],
  },
  {
    id: 'cura',
    name: 'UltiMaker Cura',
    candidates: [
      'C:\\Program Files\\UltiMaker Cura 5.8.0\\UltiMaker-Cura.exe',
      'C:\\Program Files\\UltiMaker Cura 5.7.0\\UltiMaker-Cura.exe',
      'C:\\Program Files\\Ultimaker Cura\\Cura.exe',
    ],
  },
];

function getConfigPath() {
  const baseDir = app && typeof app.getPath === 'function'
    ? app.getPath('userData')
    : path.join(process.env.APPDATA || process.env.HOME || '.', '.view3dprint');
  return path.join(baseDir, 'view3dprint-config.json');
}

function scanCrealityInstallations() {
  if (cachedCrealityInstallations) return cachedCrealityInstallations;
  const roots = [
    'C:\\Program Files\\Creality',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Creality'),
  ];
  const found = [];

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const dirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /creality\s*print/i.test(d.name))
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

      for (const dir of dirs) {
        const exe = path.join(root, dir.name, 'CrealityPrint.exe');
        if (fs.existsSync(exe)) {
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          found.push({ id: `creality-${slug}`, name: dir.name, executablePath: exe });
        }
      }
    } catch (scanErr) {
      // Ignora pasta sem permissão de leitura e prossegue para próxima raiz de instalação
    }
  }

  const legacyExe = 'C:\\Program Files\\Creality Print\\CrealityPrint.exe';
  if (found.length === 0 && fs.existsSync(legacyExe)) {
    found.push({ id: 'creality-print', name: 'Creality Print', executablePath: legacyExe });
  }
  cachedCrealityInstallations = found;
  return found;
}

/**
 * Auto-detects installed slicers on Windows, prioritizing the newest Creality Print version.
 * @returns {Array<{id: string, name: string, executablePath: string}>}
 */
function detectInstalledSlicers() {
  if (cachedDetectedSlicers) return cachedDetectedSlicers;
  const detected = [...scanCrealityInstallations()];
  for (const slicer of STATIC_SLICERS) {
    const foundPath = slicer.candidates.find((c) => c && fs.existsSync(c));
    if (foundPath) {
      detected.push({ id: slicer.id, name: slicer.name, executablePath: foundPath });
    }
  }
  cachedDetectedSlicers = detected;
  return detected;
}

function getCachedCrealityCatalog(slicerExePath, selectedPrinter) {
  const key = `${slicerExePath || ''}::${selectedPrinter || ''}`;
  if (cachedCrealityCatalogs.has(key)) {
    return cachedCrealityCatalogs.get(key);
  }
  const catalog = listCrealityCatalog(slicerExePath, selectedPrinter);
  cachedCrealityCatalogs.set(key, catalog);
  return catalog;
}

function mergeSlicerLists(detected, savedList) {
  const map = new Map();
  for (const item of detected) {
    map.set(item.executablePath.toLowerCase(), item);
  }
  if (Array.isArray(savedList)) {
    for (const item of savedList) {
      if (item?.executablePath && fs.existsSync(item.executablePath)) {
        const key = item.executablePath.toLowerCase();
        if (!map.has(key)) map.set(key, item);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Loads app settings (library path, slicers, active slicer, Creality printer & filament).
 * @param {string} defaultSampleLibrary
 */
function loadAppSettings(defaultSampleLibrary) {
  if (cachedLoadedSettings) return cachedLoadedSettings;
  const configPath = getConfigPath();
  const detected = detectInstalledSlicers();
  const topCreality = detected.find((s) => s.id.startsWith('creality'));
  const initialCatalog = getCachedCrealityCatalog(topCreality?.executablePath || null);

  const defaultConfig = {
    libraryPath: defaultSampleLibrary,
    slicers: detected,
    activeSlicerId: topCreality?.id || detected[0]?.id || 'system-default',
    crealityPrinter: initialCatalog.defaultPrinter,
    crealityFilament: initialCatalog.defaultFilament,
  };

  if (!fs.existsSync(configPath)) {
    cachedLoadedSettings = defaultConfig;
    return defaultConfig;
  }

  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const mergedSlicers = mergeSlicerLists(detected, saved.slicers);
    const hadCrealityBefore =
      Array.isArray(saved.slicers) && saved.slicers.some((s) => String(s.id).startsWith('creality'));

    const activeId =
      !hadCrealityBefore && topCreality
        ? topCreality.id
        : mergedSlicers.some((s) => s.id === saved.activeSlicerId) || saved.activeSlicerId === 'system-default'
          ? saved.activeSlicerId
          : mergedSlicers[0]?.id || 'system-default';

    cachedLoadedSettings = {
      libraryPath: saved.libraryPath || defaultSampleLibrary,
      slicers: mergedSlicers,
      activeSlicerId: activeId,
      crealityPrinter: saved.crealityPrinter || initialCatalog.defaultPrinter,
      crealityFilament: saved.crealityFilament || initialCatalog.defaultFilament,
    };
    return cachedLoadedSettings;
  } catch {
    cachedLoadedSettings = defaultConfig;
    return defaultConfig;
  }
}

/**
 * Saves app settings to disk.
 * @param {object} newSettings
 * @param {string} defaultSampleLibrary
 */
function saveAppSettings(newSettings, defaultSampleLibrary) {
  const current = cachedLoadedSettings || loadAppSettings(defaultSampleLibrary);
  const updated = { ...current, ...newSettings };
  cachedLoadedSettings = updated;
  fs.writeFileSync(getConfigPath(), JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

/**
 * Launches one or more 3D model files in the selected slicer or OS default handler.
 * @param {string | string[]} modelFilePathOrPaths
 * @param {string | null} slicerExecutablePath
 */
async function openModelInSlicer(modelFilePathOrPaths, slicerExecutablePath) {
  const paths = Array.isArray(modelFilePathOrPaths) ? modelFilePathOrPaths : [modelFilePathOrPaths];
  for (const p of paths) {
    if (!p || !fs.existsSync(p)) {
      throw new Error(`Arquivo 3D não encontrado no disco: ${p}`);
    }
  }
  if (!slicerExecutablePath || slicerExecutablePath === 'system-default') {
    for (const p of paths) {
      const errorMsg = await shell.openPath(p);
      if (errorMsg) throw new Error(errorMsg);
    }
    return { mode: 'system-default', paths };
  }
  if (!fs.existsSync(slicerExecutablePath)) {
    throw new Error(`Executável do fatiador não encontrado em: ${slicerExecutablePath}`);
  }
  const child = spawn(slicerExecutablePath, paths, { detached: true, stdio: 'ignore' });
  child.unref();
  return { mode: 'custom-slicer', slicer: slicerExecutablePath, paths };
}

/**
 * Builds a pre-configured .3mf project and opens it directly in Creality Print / active slicer.
 * @param {object} payload
 */
async function openConfiguredModelInSlicer(payload) {
  const { modelPath, slicerExecutablePath, meshPayload, sliceConfig, printerName, filamentName } = payload;
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error('Arquivo 3D original não encontrado.');
  }
  const tempBase = app && typeof app.getPath === 'function'
    ? app.getPath('temp')
    : process.env.TEMP || process.env.TMP || '.';
  const tempDir = path.join(tempBase, 'view3dprint-creality');
  const { output3mfPath, hasFullProjectProfile } = await generateConfigured3mfPackageAsync({
    tempDir,
    modelPath,
    meshPayload,
    sliceConfig,
    slicerExePath: slicerExecutablePath,
    printerName,
    filamentName,
  });

  await openModelInSlicer(output3mfPath, slicerExecutablePath);
  return { mode: hasFullProjectProfile ? 'creality-project' : 'object-overrides', path: output3mfPath };
}

/**
 * Returns installed Creality printers and compatible filaments for the given slicer path.
 * @param {string | null} slicerExecutablePath
 * @param {string | undefined} selectedPrinter
 */
function getCrealityCatalogForSlicer(slicerExecutablePath, selectedPrinter) {
  const detectedCreality = scanCrealityInstallations()[0]?.executablePath || null;
  const effectiveExe =
    slicerExecutablePath && /creality/i.test(slicerExecutablePath)
      ? slicerExecutablePath
      : detectedCreality;
  return getCachedCrealityCatalog(effectiveExe, selectedPrinter);
}

module.exports = {
  loadAppSettings,
  saveAppSettings,
  openModelInSlicer,
  openConfiguredModelInSlicer,
  getCrealityCatalogForSlicer,
  detectInstalledSlicers,
};
