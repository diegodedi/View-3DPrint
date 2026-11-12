import type * as THREE from 'three';

export interface CatPinPart {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  stlBuffer: ArrayBuffer;
  color: string;
  triangles: number;
  volumeMm3: number;
  parentPartId: string | null;
  cutLevel: number;
  visible: boolean;
  explodeDir?: [number, number, number];
}

export interface CatPinCutHistoryEntry {
  parts: CatPinPart[];
  selectedPartId: string;
  description: string;
}

/**
 * Paleta canônica de 10 cores hexadecimais para identificação de peças na Viewport 3D (WebGL) e UI.
 * Nota: Three.js requer valores hexadecimais literais para instanciação de THREE.Color em shaders.
 */
export const CATPIN_PART_COLORS: readonly string[] = [
  '#38bdf8', // 0: Azul Claro (Parte A inicial)
  '#fb923c', // 1: Laranja (Parte B inicial)
  '#4ade80', // 2: Verde Menta
  '#a78bfa', // 3: Roxo Lavanda
  '#f472b6', // 4: Rosa
  '#facc15', // 5: Âmbar
  '#2dd4bf', // 6: Verde Água
  '#f87171', // 7: Coral
  '#818cf8', // 8: Índigo
  '#a3e635', // 9: Lima
] as const;

/** Retorna cor por índice com ciclo automático */
export function getPartColor(index: number): string {
  return CATPIN_PART_COLORS[index % CATPIN_PART_COLORS.length];
}

