import type {
  BrimMode,
  InfillPattern,
  MeshAnalysisMetrics,
  PrintIntent,
  SmartSliceConfig,
  SupportMode,
} from '../types/models';

function isClassicSlowPrinter(name?: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    (lower.includes('ender-3') && !lower.includes('v3') && !lower.includes('ke')) ||
    lower.includes('cr-10') ||
    lower.includes('ender-5 pro')
  );
}

function pickLayerHeight(m: MeshAnalysisMetrics, intent: PrintIntent, reasons: string[]): number {
  if (intent === 'draft') {
    const h = m.heightMm >= 90 ? 0.28 : 0.24;
    reasons.push(`Modo Rápido: camada ${h.toFixed(2)}mm priorizando velocidade de entrega.`);
    return h;
  }
  if (intent === 'strength') {
    reasons.push('Modo Forte: camada 0.20mm ideal para fusão estrutural entre camadas.');
    return 0.2;
  }

  const maxDim = Math.max(m.widthMm, m.depthMm, m.heightMm);
  const triDensity = m.triangles / Math.max(m.surfaceAreaCm2, 1);
  if (maxDim <= 42 || (m.curvedTopRatio > 0.28 && triDensity > 180)) {
    reasons.push('Peça compacta/detalhada detectada → Camada fina de 0.12mm.');
    return 0.12;
  }
  if (maxDim <= 85 || m.curvedTopRatio > 0.16 || m.organicRatio > 0.55) {
    reasons.push('Curvas suaves/orgânicas detectadas → Camada 0.16mm anti-degrau.');
    return 0.16;
  }
  if (maxDim >= 150 && m.organicRatio < 0.25 && m.curvedTopRatio < 0.08) {
    reasons.push('Peça grande de paredes retas → Camada 0.24mm (ganho real de tempo).');
    return 0.24;
  }
  reasons.push('Proporção geométrica equilibrada → Camada padrão de 0.20mm.');
  return 0.2;
}

function pickSupportMode(m: MeshAnalysisMetrics, reasons: string[]): { mode: SupportMode; plateOnly: boolean } {
  const needsSupport =
    m.severeOverhangAreaMm2 >= 22 || (m.overhangAreaMm2 >= 65 && m.severeOverhangAreaMm2 >= 10);
  const isOrganic = m.organicRatio >= 0.38;

  if (needsSupport) {
    const mode: SupportMode = isOrganic ? 'tree' : 'normal';
    reasons.push(
      isOrganic
        ? `Balanços críticos (${m.severeOverhangAreaMm2} mm²) em malha orgânica → Suporte Árvore.`
        : `Balanços suspensos (${m.severeOverhangAreaMm2} mm²) em peça técnica → Suporte Normal.`
    );
    return { mode, plateOnly: isOrganic };
  }
  reasons.push('Ângulos autoportantes → Suporte desativado (economia de filamento).');
  return { mode: 'none', plateOnly: false };
}

function pickBrimSettings(m: MeshAnalysisMetrics, reasons: string[]): { brimMode: BrimMode; brimWidthMm: number } {
  const maxFoot = Math.max(m.widthMm, m.depthMm);

  if ((m.heightMm > 45 && m.slendernessRatio > 2.1) || (m.heightMm > 25 && m.bedContactAreaMm2 < 140)) {
    reasons.push(`Peça esbelta/base pequena (${m.bedContactAreaMm2} mm²) → Brim de 7mm ativado.`);
    return { brimMode: 'outer_only', brimWidthMm: 7 };
  }
  if (maxFoot >= 145 && m.bedContactAreaMm2 > 6500) {
    reasons.push('Área ampla na mesa → Brim externo de 5mm contra warping nos cantos.');
    return { brimMode: 'outer_only', brimWidthMm: 5 };
  }
  if (m.bedContactAreaMm2 < 260) {
    return { brimMode: 'auto_brim', brimWidthMm: 5 };
  }
  return { brimMode: 'no_brim', brimWidthMm: 0 };
}

function pickStructure(m: MeshAnalysisMetrics, intent: PrintIntent) {
  if (intent === 'strength') {
    return { wallLoops: 4, topShellLayers: 5, bottomShellLayers: 4, infillDensity: 35, infillPattern: 'gyroid' as InfillPattern };
  }
  if (intent === 'draft') {
    return { wallLoops: 2, topShellLayers: 3, bottomShellLayers: 3, infillDensity: 10, infillPattern: 'grid' as InfillPattern };
  }
  if (intent === 'quality') {
    return { wallLoops: 3, topShellLayers: 5, bottomShellLayers: 4, infillDensity: 15, infillPattern: 'gyroid' as InfillPattern };
  }
  const isFunctional = m.organicRatio < 0.35 && m.volumeCm3 > 8;
  return {
    wallLoops: isFunctional ? 3 : 2,
    topShellLayers: 4,
    bottomShellLayers: isFunctional ? 4 : 3,
    infillDensity: isFunctional ? 20 : 15,
    infillPattern: 'gyroid' as InfillPattern,
  };
}

/**
 * Generates an optimized Creality Print configuration from 3D geometry metrics and user intent.
 */
export function recommendCrealitySliceConfig(options: {
  metrics: MeshAnalysisMetrics;
  intent: PrintIntent;
  printerName?: string;
}): SmartSliceConfig {
  const { metrics: m, intent, printerName } = options;
  const reasons: string[] = [];
  const layerHeight = pickLayerHeight(m, intent, reasons);
  const support = pickSupportMode(m, reasons);
  const brim = pickBrimSettings(m, reasons);
  const supportMode = support.mode;
  const supportOnBuildPlateOnly = support.plateOnly;
  const brimMode = brim.brimMode;
  const brimWidthMm = brim.brimWidthMm;
  const structure = pickStructure(m, intent);

  const classic = isClassicSlowPrinter(printerName);
  const baseOuter = classic ? 55 : 180;
  const baseInner = classic ? 85 : 260;
  const baseInfill = classic ? 95 : 270;
  const baseInit = classic ? 30 : 55;

  let factor = intent === 'quality' ? 0.65 : intent === 'strength' ? 0.8 : intent === 'draft' ? 1.12 : 1.0;
  if (m.slendernessRatio > 2.2) {
    factor *= 0.68;
    reasons.push('Velocidade reduzida automaticamente para evitar vibração em altura.');
  } else if (Math.max(m.widthMm, m.depthMm) < 35) {
    factor *= 0.72;
    reasons.push('Velocidade ajustada para resfriamento adequado de camadas curtas.');
  }

  const round5 = (val: number) => Math.max(25, Math.round((val * factor) / 5) * 5);
  const shellVolCm3 = Math.min(m.volumeCm3, m.surfaceAreaCm2 * structure.wallLoops * 0.042);
  const infillVolCm3 = Math.max(0, m.volumeCm3 - shellVolCm3) * (structure.infillDensity / 100);
  const supportMult = supportMode !== 'none' ? 1.14 : 1.0;
  const estimatedGrams = Math.max(1, Math.round((shellVolCm3 + infillVolCm3) * 1.24 * supportMult));

  return {
    layerHeight,
    ...structure,
    supportMode,
    supportOnBuildPlateOnly,
    brimMode,
    brimWidthMm,
    outerWallSpeed: round5(baseOuter),
    innerWallSpeed: round5(baseInner),
    infillSpeed: round5(baseInfill),
    topSurfaceSpeed: round5(baseOuter * 0.75),
    initialLayerSpeed: baseInit,
    heightSpeedLimit: m.heightMm >= 95 || m.slendernessRatio > 2.2,
    estimatedGrams,
    reasons,
  };
}

