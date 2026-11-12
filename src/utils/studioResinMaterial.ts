import * as THREE from 'three';

export type ResinPresetKey = 'jade' | 'knight' | 'clay' | 'wax';

export interface ResinMaterialPreset {
  baseColor: number;
  cavityColor: number;
  ridgeColor: number;
  cavityStrength: number;
  ridgeStrength: number;
  roughness: number;
  specularIntensity: number;
}

export interface ResinMaterialOptions extends Partial<ResinMaterialPreset> {
  preset?: ResinPresetKey;
  wireframe?: boolean;
}

export const RESIN_PRESETS: Record<ResinPresetKey, ResinMaterialPreset> = {
  // Verde Jade / CatPin (Imagens 1 e 3: escultura anatômica e mechas com cavidade profunda)
  jade: {
    baseColor: 0x248866,
    cavityColor: 0x092a1f,
    ridgeColor: 0x7ae8b8,
    cavityStrength: 0.85,
    ridgeStrength: 0.35,
    roughness: 0.42,
    specularIntensity: 0.45,
  },
  // Azul Cavaleiro (Imagem 2: armadura com encaixes e reflexo acetinado)
  knight: {
    baseColor: 0x325898,
    cavityColor: 0x0e1b38,
    ridgeColor: 0x82b2f5,
    cavityStrength: 0.85,
    ridgeStrength: 0.32,
    roughness: 0.40,
    specularIntensity: 0.45,
  },
  // Cinza Studio Prime (Resina cinza clássica SLA de fatiador)
  clay: {
    baseColor: 0x767d86,
    cavityColor: 0x22262a,
    ridgeColor: 0xc8ced4,
    cavityStrength: 0.82,
    ridgeStrength: 0.30,
    roughness: 0.44,
    specularIntensity: 0.42,
  },
  // Terracota / Wax (Argila tradicional de escultura ZBrush)
  wax: {
    baseColor: 0xaa5842,
    cavityColor: 0x381710,
    ridgeColor: 0xf59a85,
    cavityStrength: 0.88,
    ridgeStrength: 0.36,
    roughness: 0.42,
    specularIntensity: 0.45,
  },
};

const RESIN_VERTEX_SHADER = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const RESIN_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uCavityColor;
  uniform vec3 uRidgeColor;
  uniform float uCavityStrength;
  uniform float uRidgeStrength;
  uniform float uRoughness;
  uniform float uSpecularIntensity;
  uniform vec3 uLightDir1;
  uniform vec3 uLightDir2;

  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 N = normalize(vViewNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(-vViewPosition);

    // 1. Curvatura de tela por Divergência de Normais (Screen-Space Normal Divergence)
    float normalDiv = dFdx(N.x) + dFdy(N.y);

    // Vales côncavos (cavidade) e Cristas convexas (bordas)
    float rawCavity = clamp(-normalDiv * 3.2, 0.0, 1.0);
    float rawRidge  = clamp(normalDiv * 2.5, 0.0, 1.0);

    float facing = max(dot(N, V), 0.0);
    float facingAtten = smoothstep(0.06, 0.45, facing);

    // Oclusão de contato adicional para reentrâncias anatômicas e fendas
    float depthOcclusion = pow(1.0 - facing, 2.0) * 0.40;

    float cavity = clamp(rawCavity * facingAtten * 1.5 + depthOcclusion * (rawCavity > 0.04 ? 1.0 : 0.25), 0.0, 1.0);
    cavity = pow(cavity, 0.85) * uCavityStrength;

    float ridge = clamp(rawRidge * facingAtten, 0.0, 1.0);
    ridge = pow(ridge, 0.90) * uRidgeStrength;

    // 2. Iluminação de estúdio multi-fonte no espaço da visão
    vec3 L1 = normalize(uLightDir1);
    vec3 L2 = normalize(uLightDir2);
    vec3 L3 = vec3(0.0, -1.0, 0.3);

    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0) * 0.35;
    float bounce = max(dot(N, L3), 0.0) * 0.18;
    float ambient = 0.36;
    float totalDiffuse = ambient + diff1 * 0.55 + diff2 + bounce;

    // 3. Especular acetinado com atenuação total em cavidades
    vec3 H1 = normalize(L1 + V);
    float NdotH1 = max(dot(N, H1), 0.0);
    float shininess = mix(18.0, 65.0, 1.0 - uRoughness);
    float spec1 = pow(NdotH1, shininess) * uSpecularIntensity;
    spec1 *= max(0.0, 1.0 - cavity * 1.8);

    // Specular suave matizado na cor da crista (evita brilho branco estourado)
    vec3 specColor = mix(uRidgeColor, vec3(1.0), 0.35) * spec1;

    // 4. Fresnel suave de contorno (Rim Light)
    float rim = pow(1.0 - facing, 3.2) * 0.25 * (1.0 - cavity);
    vec3 rimColor = uRidgeColor * rim;

    // 5. Composição tonal equilibrada
    vec3 baseTone = uBaseColor * totalDiffuse;
    vec3 shaded = mix(baseTone, uCavityColor, cavity);
    shaded = mix(shaded, uRidgeColor, ridge);
    shaded += specColor + rimColor;

    gl_FragColor = vec4(shaded, 1.0);
  }
`;

const cachedMaterials = new Map<string, THREE.ShaderMaterial>();

/**
 * Cria ou retorna material compartilhado Studio Resin com Cavity e Especular nativo.
 */
export function createStudioResinMaterial(
  optionsOrPreset: ResinPresetKey | ResinMaterialOptions = 'jade'
): THREE.ShaderMaterial {
  const options: ResinMaterialOptions =
    typeof optionsOrPreset === 'string' ? { preset: optionsOrPreset } : optionsOrPreset;

  const presetKey = options.preset || 'jade';
  const preset = RESIN_PRESETS[presetKey];
  const isWireframe = Boolean(options.wireframe);

  const cacheKey = `${presetKey}_w${isWireframe ? 1 : 0}`;
  const existing = cachedMaterials.get(cacheKey);
  if (existing) return existing;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color(options.baseColor ?? preset.baseColor) },
      uCavityColor: { value: new THREE.Color(options.cavityColor ?? preset.cavityColor) },
      uRidgeColor: { value: new THREE.Color(options.ridgeColor ?? preset.ridgeColor) },
      uCavityStrength: { value: options.cavityStrength ?? preset.cavityStrength },
      uRidgeStrength: { value: options.ridgeStrength ?? preset.ridgeStrength },
      uRoughness: { value: options.roughness ?? preset.roughness },
      uSpecularIntensity: { value: options.specularIntensity ?? preset.specularIntensity },
      uLightDir1: { value: new THREE.Vector3(0.35, 0.75, 0.65) },
      uLightDir2: { value: new THREE.Vector3(-0.45, -0.25, 0.55) },
    },
    vertexShader: RESIN_VERTEX_SHADER,
    fragmentShader: RESIN_FRAGMENT_SHADER,
    wireframe: isWireframe,
  });

  cachedMaterials.set(cacheKey, material);
  return material;
}

export function clearStudioResinCache(): void {
  cachedMaterials.forEach((mat) => mat.dispose());
  cachedMaterials.clear();
}

