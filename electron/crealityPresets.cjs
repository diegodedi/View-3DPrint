const fs = require('fs');
const path = require('path');

const MACHINE_ARRAY_KEYS = new Set([
  'bed_exclude_area', 'default_filament_profile', 'deretraction_speed', 'extruder_colour',
  'extruder_offset', 'head_wrap_detect_zone', 'long_retractions_when_cut',
  'machine_max_acceleration_e', 'machine_max_acceleration_extruding',
  'machine_max_acceleration_retracting', 'machine_max_acceleration_travel',
  'machine_max_acceleration_x', 'machine_max_acceleration_y', 'machine_max_acceleration_z',
  'machine_max_jerk_e', 'machine_max_jerk_x', 'machine_max_jerk_y', 'machine_max_jerk_z',
  'machine_max_speed_e', 'machine_max_speed_x', 'machine_max_speed_y', 'machine_max_speed_z',
  'machine_min_extruding_rate', 'machine_min_travel_rate', 'max_layer_height', 'min_layer_height',
  'nozzle_diameter', 'printable_area', 'retract_before_wipe', 'retract_length_toolchange',
  'retract_lift_above', 'retract_lift_below', 'retract_lift_enforce', 'retract_restart_extra',
  'retract_restart_extra_toolchange', 'retract_when_changing_layer',
  'retraction_distances_when_cut', 'retraction_length', 'retraction_minimum_travel',
  'retraction_speed', 'travel_slope', 'upward_compatible_machine', 'wipe', 'wipe_distance',
  'z_hop', 'z_hop_types',
]);

const COMMA_SPLIT_KEYS = new Set([
  'printable_area', 'bed_exclude_area', 'machine_min_extruding_rate',
  'machine_min_travel_rate', 'wiping_volumes_extruders',
]);

const FILAMENT_SCALAR_KEYS = new Set([
  'from', 'inherits', 'name', 'version', 'filament_id',
  'compatible_printers_condition', 'compatible_prints_condition',
]);

const INTERNAL_STRIP_KEYS = new Set(['type', 'instantiation', 'setting_id', 'description']);

function resolveProfilesRoot(slicerExePath) {
  if (!slicerExePath || slicerExePath === 'system-default') return null;
  const candidate = path.join(path.dirname(slicerExePath), 'resources', 'profiles', 'Creality');
  return fs.existsSync(candidate) ? candidate : null;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function mergeInheritedProfile(subDir, nameOrFile, visited = new Set()) {
  const fileName = nameOrFile.endsWith('.json') ? nameOrFile : `${nameOrFile}.json`;
  if (visited.has(fileName)) return {};
  visited.add(fileName);

  const fullPath = path.join(subDir, fileName);
  const data = fs.existsSync(fullPath) ? readJsonSafe(fullPath) : null;
  if (!data) return {};

  const parent = data.inherits ? mergeInheritedProfile(subDir, data.inherits, visited) : {};
  return { ...parent, ...data };
}

function inferDimensionsFromName(printerName) {
  const n = String(printerName || '').toLowerCase();
  if (n.includes('k2 plus')) return { widthMm: 350, depthMm: 350, heightMm: 350 };
  if (n.includes('k1 max') || n.includes('v3 plus') || n.includes('s1 plus') || n.includes('cr-10')) {
    return { widthMm: 300, depthMm: 300, heightMm: 300 };
  }
  if (n.includes('ender-5 plus')) return { widthMm: 350, depthMm: 350, heightMm: 400 };
  if (n.includes('a1 mini')) return { widthMm: 180, depthMm: 180, heightMm: 180 };
  if (n.includes('bambu') || n.includes('x1') || n.includes('p1')) {
    return { widthMm: 256, depthMm: 256, heightMm: 256 };
  }
  return { widthMm: 220, depthMm: 220, heightMm: 250 };
}

function extractBedDimensions(printableArea, printableHeight, printerName) {
  const fallback = inferDimensionsFromName(printerName);
  const rawCoords = typeof printableArea === 'string'
    ? printableArea.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(printableArea) ? printableArea : [];
  const xs = rawCoords.map((p) => parseFloat(String(p).split('x')[0])).filter(Number.isFinite);
  const ys = rawCoords.map((p) => parseFloat(String(p).split('x')[1])).filter(Number.isFinite);
  const widthMm = xs.length > 0 ? Math.max(...xs) : fallback.widthMm;
  const depthMm = ys.length > 0 ? Math.max(...ys) : fallback.depthMm;
  const parsedH = parseFloat(Array.isArray(printableHeight) ? printableHeight[0] : printableHeight);
  const heightMm = Number.isFinite(parsedH) && parsedH > 0 ? parsedH : fallback.heightMm;
  return { widthMm: Math.round(widthMm), depthMm: Math.round(depthMm), heightMm: Math.round(heightMm) };
}

function computeBedCenter(printableArea, printerName) {
  const { widthMm, depthMm } = extractBedDimensions(printableArea, null, printerName);
  return { bedCenterX: Math.round(widthMm / 2), bedCenterY: Math.round(depthMm / 2) };
}

function normalizeMachineMap(raw, printerName) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (INTERNAL_STRIP_KEYS.has(key) || val === 'nil' || val === undefined) continue;
    if (COMMA_SPLIT_KEYS.has(key) && typeof val === 'string') {
      out[key] = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (MACHINE_ARRAY_KEYS.has(key)) {
      out[key] = Array.isArray(val) ? val.map(String) : [String(val)];
    } else {
      out[key] = Array.isArray(val) ? val.map(String) : String(val);
    }
  }
  out.from = 'project';
  out.inherits = '';
  out.printer_settings_id = printerName;
  return out;
}

function normalizeFilamentMap(raw, filamentName) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (INTERNAL_STRIP_KEYS.has(key) || val === 'nil' || val === undefined) continue;
    if (FILAMENT_SCALAR_KEYS.has(key)) {
      out[key] = String(val);
    } else {
      const cleaned = typeof val === 'string' ? val.replace(/^"|"$/g, '') : val;
      out[key] = Array.isArray(cleaned) ? cleaned.map(String) : [String(cleaned)];
    }
  }
  out.from = 'project';
  out.inherits = '';
  out.filament_settings_id = [filamentName];
  return out;
}

function normalizeProcessMap(raw, printerName, overrides) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (INTERNAL_STRIP_KEYS.has(key) || val === 'nil' || val === undefined) continue;
    if (key === 'small_area_infill_flow_compensation_model' && typeof val === 'string') {
      out[key] = val.split(';').map((s) => s.replace(/^"|"$/g, '').replace(/\\n/g, '\n'));
    } else if (COMMA_SPLIT_KEYS.has(key) && typeof val === 'string') {
      out[key] = val.split(',').map((s) => s.trim());
    } else if (key === 'compatible_printers' || key === 'post_process') {
      out[key] = Array.isArray(val) ? val.map(String) : [String(val)].filter(Boolean);
    } else {
      out[key] = Array.isArray(val) ? String(val[0] ?? '') : String(val);
    }
  }
  Object.assign(out, overrides, {
    from: 'project',
    inherits: '',
    compatible_printers: [printerName],
    print_settings_id: `${overrides.layer_height}mm Smart @${printerName}`,
    name: `${overrides.layer_height}mm Smart @${printerName}`,
  });
  return out;
}

/**
 * Lists installed Creality Print nozzle/printer profiles and compatible filaments.
 * @param {string | null} slicerExePath
 * @param {string | undefined} selectedPrinter
 */
function listCrealityCatalog(slicerExePath, selectedPrinter) {
  const root = resolveProfilesRoot(slicerExePath);
  if (!root) {
    return {
      printers: [],
      filaments: [],
      defaultPrinter: 'keep-current',
      defaultFilament: '',
      bedDimensions: inferDimensionsFromName(selectedPrinter),
    };
  }

  const machineDir = path.join(root, 'machine');
  const filamentDir = path.join(root, 'filament');
  const printers = fs
    .readdirSync(machineDir)
    .filter((f) => f.endsWith('nozzle.json') && !f.startsWith('fdm_'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const preferred =
    printers.find((p) => p === selectedPrinter) ||
    printers.find((p) => p.includes('K1C 0.4')) ||
    printers.find((p) => p.includes('Ender-3 V3 KE 0.4')) ||
    printers[0] ||
    'keep-current';

  const suffix = `@${preferred}.json`;
  const filaments = fs.existsSync(filamentDir)
    ? fs
        .readdirSync(filamentDir)
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.replace(/\.json$/, ''))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    : [];

  const defaultFilament =
    filaments.find((f) => f.startsWith('Hyper PLA')) ||
    filaments.find((f) => f.includes('PLA')) ||
    filaments[0] ||
    '';

  const machineRaw = preferred && preferred !== 'keep-current'
    ? mergeInheritedProfile(machineDir, preferred)
    : {};
  const bedDimensions = extractBedDimensions(
    machineRaw.printable_area,
    machineRaw.printable_height,
    preferred
  );

  return { printers, filaments, defaultPrinter: preferred, defaultFilament, bedDimensions };
}

function findMatchingProcessFile(processDir, printerName, layerHeightStr) {
  if (!fs.existsSync(processDir)) return 'fdm_process_creality_common.json';
  const files = fs.readdirSync(processDir).filter((f) => f.endsWith(`@${printerName}.json`));
  return (
    files.find((f) => f.startsWith(`${layerHeightStr}mm Standard`)) ||
    files.find((f) => f.includes('0.20mm Standard')) ||
    files[0] ||
    'fdm_process_creality_common.json'
  );
}

/**
 * Resolves full Creality Print 7.2 project/machine/filament/process configs with smart overrides.
 * @param {{ slicerExePath: string, printerName?: string, filamentName?: string, processOverrides: Record<string, string> }} opts
 */
function buildCrealityProjectConfigs(opts) {
  const root = resolveProfilesRoot(opts.slicerExePath);
  if (!root || !opts.printerName || opts.printerName === 'keep-current') {
    return { bedCenterX: 110, bedCenterY: 110, configs: null };
  }

  const machineRaw = mergeInheritedProfile(path.join(root, 'machine'), opts.printerName);
  if (Object.keys(machineRaw).length === 0) {
    return { bedCenterX: 110, bedCenterY: 110, configs: null };
  }

  const catalog = listCrealityCatalog(opts.slicerExePath, opts.printerName);
  const chosenFilament =
    opts.filamentName && catalog.filaments.includes(opts.filamentName)
      ? opts.filamentName
      : catalog.defaultFilament;

  const filamentRaw = chosenFilament
    ? mergeInheritedProfile(path.join(root, 'filament'), chosenFilament)
    : mergeInheritedProfile(path.join(root, 'filament'), 'fdm_filament_pla');

  const procFile = findMatchingProcessFile(
    path.join(root, 'process'),
    opts.printerName,
    Number(opts.processOverrides.layer_height || 0.2).toFixed(2)
  );
  const processRaw = mergeInheritedProfile(path.join(root, 'process'), procFile);

  const machineCfg = normalizeMachineMap(machineRaw, opts.printerName);
  const filamentCfg = normalizeFilamentMap(filamentRaw, chosenFilament || 'Generic PLA');
  const processCfg = normalizeProcessMap(processRaw, opts.printerName, opts.processOverrides);
  const { bedCenterX, bedCenterY } = computeBedCenter(machineCfg.printable_area);

  const projectCfg = {
    ...machineCfg,
    ...filamentCfg,
    ...processCfg,
    printer_settings_id: opts.printerName,
    print_settings_id: processCfg.print_settings_id,
    filament_settings_id: filamentCfg.filament_settings_id,
    from: 'project',
  };

  return {
    bedCenterX,
    bedCenterY,
    configs: {
      project: projectCfg,
      process: processCfg,
      machine: machineCfg,
      filament: filamentCfg,
    },
  };
}

module.exports = { listCrealityCatalog, buildCrealityProjectConfigs };

