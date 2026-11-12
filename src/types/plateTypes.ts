/**
 * Tipos e interfaces para organização de peças na mesa de impressão 3D (Plate Layout & Nesting).
 */

export interface PlatePartBounds {
  width: number;
  depth: number;
  height: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface PlatePartPlacement {
  partId: string;
  name: string;
  /** Posição final (X, Y, Z) na mesa em milímetros. Z sempre assenta em 0. */
  position: [number, number, number];
  /** Quatérnion de rotação [x, y, z, w] que orienta a melhor face plana para baixo. */
  rotation: [number, number, number, number];
  bounds: PlatePartBounds;
  contactAreaMm2: number;
  overhangAreaMm2: number;
  score: number;
}

export interface PlateArrangementResult {
  bedWidthMm: number;
  bedDepthMm: number;
  bedHeightMm: number;
  bedCenterX: number;
  bedCenterY: number;
  placements: Map<string, PlatePartPlacement>;
  allFitOnBed: boolean;
  totalOccupiedAreaMm2: number;
  bedUtilizationPercent: number;
}

