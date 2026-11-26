import * as THREE from 'three';
import type { ViewportShadingConfig, ViewportShadingPresetKey } from '../types/models';

export type ResinPresetKey = ViewportShadingPresetKey;

export interface ResinMaterialPreset {
  label: string;
  baseColor: number;
  cavityColor: number;
  ridgeColor: number;
}

const STORAGE_KEY = 'view3d_viewport_shading_v2';

export const DEFAULT_SHADING_CONFIG: ViewportShadingConfig = {
  preset: 'clay',
  cavityDistance: 0.45,
  cavityIntensity: 0.55,
  roughness: 0.78,
  specularIntensity: 0.12,
};

export const RESIN_PRESETS: Record<ResinPresetKey, ResinMaterialPreset> = {
  clay: {
    label: 'Cinza Padrão',
    baseColor: 0x8f959e,
    cavityColor: 0x26292e,
    ridgeColor: 0xdce2ea,
  },
  jade: {
    label: 'Verde Jade',
    baseColor: 0x46b888,
    cavityColor: 0x113d2b,
    ridgeColor: 0xa6f5d2,
  },
  knight: {
    label: 'Azul Armadura',
    baseColor: 0x5278c2,
    cavityColor: 0x15264d,
    ridgeColor: 0xadc9fc,
  },
  ochre: {
    label: 'Amarelo Ocre',
    baseColor: 0xc4a348,
    cavityColor: 0x45350f,
    ridgeColor: 0xf7e4a6,
  },
  wax: {
    label: 'Terracota',
    baseColor: 0xb8654b,
    cavityColor: 0x421b10,
    ridgeColor: 0xf5b39d,
  },
};

const RESIN_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aCavity;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vCavity;

  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPos.xyz;
    vCavity = aCavity;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const RESIN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uCavityColor;
  uniform vec3 uRidgeColor;
  uniform float uCavityDistance;
  uniform float uCavityIntensity;
  uniform float uRoughness;
  uniform float uSpecularIntensity;
  uniform float uSelectBoost;
  uniform float uOpacity;

  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vCavity;

  void main() {
    vec3 N = normalize(vViewNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(-vViewPosition);
    float facing = max(dot(N, V), 0.0);

    // 1. Curvatura Screen-Space protegida contra arestas vivas e triângulos estreitos + vCavity por grupo suave
    vec3 dPdx = dFdx(vViewPosition);
    vec3 dPdy = dFdy(vViewPosition);
    vec3 dNdx = dFdx(N);
    vec3 dNdy = dFdy(N);

    float lenX = max(length(dPdx), 1e-4);
    float lenY = max(length(dPdy), 1e-4);

    float guardX = (1.0 - smoothstep(0.18, 0.62, abs(dPdx.z) / lenX)) * (1.0 - smoothstep(0.18, 0.50, length(dNdx)));
    float guardY = (1.0 - smoothstep(0.18, 0.62, abs(dPdy.z) / lenY)) * (1.0 - smoothstep(0.18, 0.50, length(dNdy)));
    float grazingGuard = smoothstep(0.12, 0.45, facing);

    float curv = ((dot(dNdx, dPdx) / lenX) * guardX + (dot(dNdy, dPdy) / lenY) * guardY) * grazingGuard;
    float ssValley = smoothstep(0.018, 0.14, -curv);
    float ssRidge  = smoothstep(0.025, 0.16,  curv);

    // vCavity.x = vinco estreito, vCavity.y = cavidade larga localizada (isolada por grupo suave)
    float tightVal = max(vCavity.x, ssValley * 0.45);
    float wideVal  = max(vCavity.y, tightVal);

    float narrowCavity = pow(clamp(tightVal, 0.0, 1.0), 1.60);
    float broadCavity  = pow(clamp(wideVal, 0.0, 1.0), mix(1.35, 0.78, uCavityDistance));
    float valleyField  = mix(narrowCavity, broadCavity, smoothstep(0.05, 1.0, uCavityDistance));

    // 2. Iluminação Difusa Studio MatCap com Roughness
    vec3 L1 = normalize(vec3(-0.30, 0.56, 0.77));
    vec3 L2 = normalize(vec3( 0.44, 0.22, 0.87));
    vec3 L3 = normalize(vec3( 0.00, -0.82, 0.57));

    float wrap = mix(0.24, 0.65, uRoughness);
    float diff1 = clamp((dot(N, L1) + wrap) / (1.0 + wrap), 0.0, 1.0);
    float diff2 = clamp((dot(N, L2) + wrap) / (1.0 + wrap), 0.0, 1.0);
    float bounce = clamp((dot(N, L3) + 0.40) / 1.40, 0.0, 1.0);

    float clayFlatness = mix(0.92, 1.02, facing) * 0.22 * uRoughness;
    float totalDiffuse = 0.42 + diff1 * 0.42 + diff2 * 0.14 + bounce * 0.08 + clayFlatness;
    totalDiffuse = clamp(totalDiffuse, 0.60, 1.06);

    // 3. Cavity Intensity calibrado (evita saturar ruído de triangulação em preto absoluto)
    float intensityBoost = mix(0.85, 1.45, uCavityIntensity);
    float valleyMix = clamp(valleyField * uCavityIntensity * intensityBoost, 0.0, 0.88);
    vec3 darkTarget = mix(uCavityColor * totalDiffuse, uCavityColor * 0.25, smoothstep(0.55, 1.0, uCavityIntensity));

    // 4. Baixa Specular (lóbulo acetinado largo, suprimido nos vincos)
    vec3 H1 = normalize(L1 + V);
    float NdotH = max(dot(N, H1), 0.0);
    float shininess = mix(40.0, 9.0, uRoughness);
    float spec = pow(NdotH, shininess) * uSpecularIntensity * (1.0 - valleyMix * 0.90);
    vec3 specContrib = mix(uRidgeColor, vec3(1.0), 0.35) * spec;

    // 5. Composição Tonal Blender Workbench (Valley + Ridge highlight sutil)
    vec3 baseLit = uBaseColor * totalDiffuse;
    vec3 withValley = mix(baseLit, darkTarget, valleyMix);

    float ridgeField = max(vCavity.z, ssRidge * 0.35);
    float ridgeSpread = pow(clamp(ridgeField, 0.0, 1.0), mix(1.50, 0.95, uCavityDistance));
    float ridgeMix = clamp(ridgeSpread * uCavityIntensity * 0.45, 0.0, 0.32);
    vec3 ridgeHighlight = mix(uRidgeColor, vec3(1.0), 0.20);
    vec3 withRidge = mix(withValley, ridgeHighlight, ridgeMix * (1.0 - valleyMix * 0.85));

    vec3 finalColor = withRidge + specContrib + (uBaseColor * uSelectBoost);
    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), uOpacity);
  }
`;

function loadInitialShadingConfig(): ViewportShadingConfig {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_SHADING_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ViewportShadingConfig>;
    const preset: ResinPresetKey =
      parsed.preset && parsed.preset in RESIN_PRESETS ? parsed.preset : DEFAULT_SHADING_CONFIG.preset;
    return {
      preset,
      cavityDistance: typeof parsed.cavityDistance === 'number' ? parsed.cavityDistance : DEFAULT_SHADING_CONFIG.cavityDistance,
      cavityIntensity: typeof parsed.cavityIntensity === 'number' ? parsed.cavityIntensity : DEFAULT_SHADING_CONFIG.cavityIntensity,
      roughness: typeof parsed.roughness === 'number' ? parsed.roughness : DEFAULT_SHADING_CONFIG.roughness,
      specularIntensity: typeof parsed.specularIntensity === 'number' ? parsed.specularIntensity : DEFAULT_SHADING_CONFIG.specularIntensity,
    };
  } catch {
    return { ...DEFAULT_SHADING_CONFIG };
  }
}

let globalConfig: ViewportShadingConfig = loadInitialShadingConfig();
let sharedGlobalMaterial: THREE.ShaderMaterial | null = null;
const activePartMaterials = new Set<{ mat: THREE.ShaderMaterial; isPrimary: boolean }>();
const listeners = new Set<(cfg: ViewportShadingConfig) => void>();

function syncMaterialUniforms(mat: THREE.ShaderMaterial, cfg: ViewportShadingConfig, usePresetColors: boolean): void {
  const preset = RESIN_PRESETS[cfg.preset] || RESIN_PRESETS.clay;
  if (usePresetColors) {
    mat.uniforms.uBaseColor.value.setHex(preset.baseColor);
    mat.uniforms.uCavityColor.value.setHex(preset.cavityColor);
    mat.uniforms.uRidgeColor.value.setHex(preset.ridgeColor);
  }
  mat.uniforms.uCavityDistance.value = cfg.cavityDistance;
  mat.uniforms.uCavityIntensity.value = cfg.cavityIntensity;
  mat.uniforms.uRoughness.value = cfg.roughness;
  mat.uniforms.uSpecularIntensity.value = cfg.specularIntensity;
}

export function getGlobalShadingConfig(): ViewportShadingConfig {
  return { ...globalConfig };
}

export function setGlobalShadingConfig(partial: Partial<ViewportShadingConfig>): ViewportShadingConfig {
  globalConfig = { ...globalConfig, ...partial };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(globalConfig));
    }
  } catch { /* ignore */ }

  if (sharedGlobalMaterial) {
    syncMaterialUniforms(sharedGlobalMaterial, globalConfig, true);
  }
  activePartMaterials.forEach(({ mat, isPrimary }) => {
    syncMaterialUniforms(mat, globalConfig, isPrimary);
  });
  listeners.forEach((fn) => fn(globalConfig));
  return { ...globalConfig };
}

export function subscribeGlobalShading(listener: (cfg: ViewportShadingConfig) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function createStudioResinMaterial(_presetOverride?: ResinPresetKey): THREE.ShaderMaterial {
  if (!sharedGlobalMaterial) {
    const preset = RESIN_PRESETS[globalConfig.preset] || RESIN_PRESETS.clay;
    sharedGlobalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uBaseColor: { value: new THREE.Color(preset.baseColor) },
        uCavityColor: { value: new THREE.Color(preset.cavityColor) },
        uRidgeColor: { value: new THREE.Color(preset.ridgeColor) },
        uCavityDistance: { value: globalConfig.cavityDistance },
        uCavityIntensity: { value: globalConfig.cavityIntensity },
        uRoughness: { value: globalConfig.roughness },
        uSpecularIntensity: { value: globalConfig.specularIntensity },
        uSelectBoost: { value: 0.0 },
        uOpacity: { value: 1.0 },
      },
      vertexShader: RESIN_VERTEX_SHADER,
      fragmentShader: RESIN_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
    });
  }
  return sharedGlobalMaterial;
}

export function createPartStudioMaterial(
  partColorHex: string,
  options: { isPrimaryPart?: boolean; isSelected?: boolean; opacity?: number } = {}
): THREE.ShaderMaterial {
  const isPrimary = Boolean(options.isPrimaryPart);
  const preset = RESIN_PRESETS[globalConfig.preset] || RESIN_PRESETS.clay;

  const baseCol = isPrimary ? new THREE.Color(preset.baseColor) : new THREE.Color(partColorHex);
  const cavityCol = isPrimary
    ? new THREE.Color(preset.cavityColor)
    : baseCol.clone().multiplyScalar(0.35);
  const ridgeCol = isPrimary
    ? new THREE.Color(preset.ridgeColor)
    : baseCol.clone().lerp(new THREE.Color(0xffffff), 0.42);
  const opacity = options.opacity ?? 1.0;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: baseCol },
      uCavityColor: { value: cavityCol },
      uRidgeColor: { value: ridgeCol },
      uCavityDistance: { value: globalConfig.cavityDistance },
      uCavityIntensity: { value: globalConfig.cavityIntensity },
      uRoughness: { value: globalConfig.roughness },
      uSpecularIntensity: { value: globalConfig.specularIntensity },
      uSelectBoost: { value: options.isSelected ? 0.12 : 0.0 },
      uOpacity: { value: opacity },
    },
    vertexShader: RESIN_VERTEX_SHADER,
    fragmentShader: RESIN_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: opacity < 1.0,
    depthWrite: opacity >= 1.0,
  });

  const entry = { mat, isPrimary };
  activePartMaterials.add(entry);
  mat.addEventListener('dispose', () => activePartMaterials.delete(entry));
  return mat;
}
