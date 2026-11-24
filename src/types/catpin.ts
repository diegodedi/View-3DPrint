export type CatpinV3 = [number, number, number];

/** Tudo no ESPAÇO DO MODELO (= espaço local da geometria do mesh exibido = espaço do STL). */
export type CatpinCutSpec =
  | { kind: 'plane'; point: CatpinV3; normal: CatpinV3 }
  | {
    kind: 'seam';
    polygonUV: Array<[number, number]>;
    polygonW?: number[];
    basis: number[];
    point: CatpinV3;
    normal: CatpinV3;
    scale?: [number, number];
    wMin?: number;
    wMax?: number;
    flipSide?: boolean;
    bladeMesh?: {
      positions: Float32Array;
      indices: Uint32Array;
    };
  }
  | { kind: 'extrude'; polygonUV: Array<[number, number]>; basis: number[]; wMin: number; wMax: number; scale?: [number, number]; point?: CatpinV3 };

export type CatpinPinSide = 'auto' | 'partA' | 'partB';

export interface CatpinConnectorSpec {
  type: 'cylinder' | 'trapezoid';
  diameterMm: number;
  heightMm: number;
  clearanceMm: number;
  position: CatpinV3;
  axis: CatpinV3;
  xAxis?: CatpinV3;
  pinSide?: CatpinPinSide;
  hasManualPosition?: boolean;
}

export interface CatpinCutPayload {
  positions: Float32Array;          // geometry.attributes.position.array (cópia)
  indices: Uint32Array | null;      // geometry.index ou null
  cut: CatpinCutSpec;
  cutGapMm: number;
  connector: CatpinConnectorSpec | null;
}

export interface CatpinWarning { code: string; message: string }

export interface CatpinCutResult {
  success: boolean;
  error?: string;
  code?: string;
  partABuffer?: ArrayBuffer;        // STL binário, no espaço do modelo
  partBBuffer?: ArrayBuffer;
  partATriangles?: number;
  partBTriangles?: number;
  islandsA?: number;
  islandsB?: number;
  executionTimeMs?: number;
  explodeDirStl?: CatpinV3;
  seamCenterStl?: CatpinV3;
  warnings?: CatpinWarning[];
  minGapMm?: number | null;
  connectorUsed?: boolean;
}

export interface CatpinSuggestPayload {
  positions: Float32Array;
  indices: Uint32Array | null;
  cut: CatpinCutSpec;
  connector: Omit<CatpinConnectorSpec, 'position' | 'axis'>;
}

export interface CatpinSuggestResult {
  success: boolean;
  found?: boolean;
  position?: CatpinV3;
  axis?: CatpinV3;
  areaMm2?: number;
  error?: string;
  code?: string;
}

export interface CatpinDiagnosticPayload {
  positions: Float32Array;
  indices: Uint32Array | null;
}

export interface CatpinDiagnosticResult {
  success: boolean;
  error?: string;
  code?: string;
  totalVertices?: number;
  totalTriangles?: number;
  weldedVertices?: number;
  weldedTriangles?: number;
  duplicateVerticesMerged?: number;
  degenerateFacesRemoved?: number;
  boundaryEdgesCount?: number;
  nonManifoldEdgesCount?: number;
  invertedWinding?: boolean;
  isClosedManifold?: boolean;
  volumeMm3?: number;
  boundingBox?: {
    min: CatpinV3;
    max: CatpinV3;
    size: CatpinV3;
  };
  status?: 'valid' | 'repairable' | 'invalid';
}
