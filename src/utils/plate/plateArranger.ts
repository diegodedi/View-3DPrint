import type {
  PlateArrangementResult,
  PlatePartPlacement,
} from '../../types/plateTypes';
import type { OrientationCandidate } from './autoOrientAntiSupport';

export interface ArrangerPartInput {
  id: string;
  name: string;
  orientation: OrientationCandidate;
}

export interface BedDimensions {
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  marginMm?: number;
}

const DEFAULT_BED_WIDTH = 220;
const DEFAULT_BED_DEPTH = 220;
const DEFAULT_BED_HEIGHT = 250;
const DEFAULT_MARGIN_MM = 10;

/**
 * Empacotador 2D (Shelf Nesting) que organiza as peças orientadas na mesa de impressão 3D.
 * Centraliza o conjunto ordenado por área e garante margens de folga entre as peças.
 */
export function arrangePartsOnBed(
  parts: ArrangerPartInput[],
  bedOptions?: BedDimensions
): PlateArrangementResult {
  const bedWidth = bedOptions?.widthMm ?? DEFAULT_BED_WIDTH;
  const bedDepth = bedOptions?.depthMm ?? DEFAULT_BED_DEPTH;
  const bedHeight = bedOptions?.heightMm ?? DEFAULT_BED_HEIGHT;
  const margin = bedOptions?.marginMm ?? DEFAULT_MARGIN_MM;

  const bedCenterX = 0;
  const bedCenterY = 0;

  if (parts.length === 0) {
    return {
      bedWidthMm: bedWidth,
      bedDepthMm: bedDepth,
      bedHeightMm: bedHeight,
      bedCenterX,
      bedCenterY,
      placements: new Map(),
      allFitOnBed: true,
      totalOccupiedAreaMm2: 0,
      bedUtilizationPercent: 0,
    };
  }

  // Ordena peças da maior área de pegada para a menor
  const sorted = [...parts].sort((a, b) => {
    const areaA = a.orientation.bounds.width * a.orientation.bounds.depth;
    const areaB = b.orientation.bounds.width * b.orientation.bounds.depth;
    return areaB - areaA;
  });

  const rawPositions: Array<{
    part: ArrangerPartInput;
    x: number;
    y: number;
    width: number;
    depth: number;
  }> = [];

  let currentX = 0;
  let currentY = 0;
  let currentRowHeight = 0;
  const maxRowWidth = bedWidth - margin * 2;

  for (const item of sorted) {
    const w = item.orientation.bounds.width;
    const d = item.orientation.bounds.depth;

    // Se ultrapassar a largura da prateleira atual, salta para a próxima linha
    if (currentX + w > maxRowWidth && currentX > 0) {
      currentX = 0;
      currentY += currentRowHeight + margin;
      currentRowHeight = 0;
    }

    rawPositions.push({
      part: item,
      x: currentX + w * 0.5,
      y: currentY + d * 0.5,
      width: w,
      depth: d,
    });

    currentX += w + margin;
    if (d > currentRowHeight) currentRowHeight = d;
  }

  // Calcula envelope total para centralizar na mesa
  let totalMinX = Infinity, totalMaxX = -Infinity;
  let totalMinY = Infinity, totalMaxY = -Infinity;
  let totalAreaMm2 = 0;

  rawPositions.forEach((p) => {
    const halfW = p.width * 0.5;
    const halfD = p.depth * 0.5;
    if (p.x - halfW < totalMinX) totalMinX = p.x - halfW;
    if (p.x + halfW > totalMaxX) totalMaxX = p.x + halfW;
    if (p.y - halfD < totalMinY) totalMinY = p.y - halfD;
    if (p.y + halfD > totalMaxY) totalMaxY = p.y + halfD;
    totalAreaMm2 += p.width * p.depth;
  });

  const clusterCenterX = (totalMinX + totalMaxX) * 0.5;
  const clusterCenterY = (totalMinY + totalMaxY) * 0.5;

  const placements = new Map<string, PlatePartPlacement>();
  let allFitOnBed = true;
  const halfBedW = bedWidth * 0.5;
  const halfBedD = bedDepth * 0.5;

  rawPositions.forEach(({ part, x, y, width, depth }) => {
    // Centraliza em relação à origem da mesa (0, 0)
    const finalX = x - clusterCenterX;
    const finalY = y - clusterCenterY;
    const finalZ = part.orientation.offsetZ;

    const bounds = part.orientation.bounds;
    const halfW = width * 0.5;
    const halfD = depth * 0.5;

    if (
      Math.abs(finalX) + halfW > halfBedW ||
      Math.abs(finalY) + halfD > halfBedD ||
      bounds.height > bedHeight
    ) {
      allFitOnBed = false;
    }

    const q = part.orientation.quaternion;

    placements.set(part.id, {
      partId: part.id,
      name: part.name,
      position: [finalX, finalY, finalZ],
      rotation: [q.x, q.y, q.z, q.w],
      bounds,
      contactAreaMm2: part.orientation.contactAreaMm2,
      overhangAreaMm2: part.orientation.overhangAreaMm2,
      score: part.orientation.score,
    });
  });

  const bedTotalArea = bedWidth * bedDepth;
  const bedUtilizationPercent = bedTotalArea > 0 ? (totalAreaMm2 / bedTotalArea) * 100 : 0;

  return {
    bedWidthMm: bedWidth,
    bedDepthMm: bedDepth,
    bedHeightMm: bedHeight,
    bedCenterX,
    bedCenterY,
    placements,
    allFitOnBed,
    totalOccupiedAreaMm2: totalAreaMm2,
    bedUtilizationPercent: Math.min(100, Math.round(bedUtilizationPercent * 10) / 10),
  };
}

