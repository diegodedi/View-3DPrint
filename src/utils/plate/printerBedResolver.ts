import type { BedDimensions } from './plateArranger';

export interface ResolvedBedInfo {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  marginMm: number;
  printerLabel: string;
}

/**
 * Infere as dimensões úteis da mesa (X, Y, Z em mm) a partir do perfil ou nome da impressora configurada.
 */
export function resolvePrinterBedDimensions(
  printerName?: string | null,
  catalogBedDims?: { widthMm: number; depthMm: number; heightMm: number } | null
): ResolvedBedInfo {
  const rawName = (printerName && printerName !== 'keep-current' ? printerName : '').trim();
  const cleanLabel = rawName
    ? rawName.replace(/\s+\d+(\.\d+)?\s*nozzle$/i, '').replace(/^Creality\s+/i, '')
    : 'Padrão (220×220)';

  if (
    catalogBedDims &&
    Number.isFinite(catalogBedDims.widthMm) &&
    catalogBedDims.widthMm >= 100 &&
    Number.isFinite(catalogBedDims.depthMm) &&
    catalogBedDims.depthMm >= 100
  ) {
    return {
      widthMm: catalogBedDims.widthMm,
      depthMm: catalogBedDims.depthMm,
      heightMm: catalogBedDims.heightMm || 250,
      marginMm: 8,
      printerLabel: cleanLabel,
    };
  }

  const lower = rawName.toLowerCase();
  let widthMm = 220;
  let depthMm = 220;
  let heightMm = 250;

  if (lower.includes('k2 plus')) {
    widthMm = 350;
    depthMm = 350;
    heightMm = 350;
  } else if (lower.includes('ender-5 plus')) {
    widthMm = 350;
    depthMm = 350;
    heightMm = 400;
  } else if (
    lower.includes('k1 max') ||
    lower.includes('v3 plus') ||
    lower.includes('s1 plus') ||
    lower.includes('cr-10') ||
    lower.includes('300')
  ) {
    widthMm = 300;
    depthMm = 300;
    heightMm = 300;
  } else if (lower.includes('a1 mini') || lower.includes('180')) {
    widthMm = 180;
    depthMm = 180;
    heightMm = 180;
  } else if (lower.includes('bambu') || lower.includes('x1') || lower.includes('p1') || lower.includes('256')) {
    widthMm = 256;
    depthMm = 256;
    heightMm = 256;
  } else if (lower.includes('v3 ke')) {
    widthMm = 220;
    depthMm = 220;
    heightMm = 240;
  }

  return {
    widthMm,
    depthMm,
    heightMm,
    marginMm: 8,
    printerLabel: cleanLabel,
  };
}

/**
 * Converte informações da mesa em opções de entrada do organizador 2D.
 */
export function toBedDimensionsOptions(info: ResolvedBedInfo): BedDimensions {
  return {
    widthMm: info.widthMm,
    depthMm: info.depthMm,
    heightMm: info.heightMm,
    marginMm: info.marginMm,
  };
}

