export interface ModelFileEntry {
  name: string;
  path: string;
  extension: string;
  sizeBytes: number;
}

export interface PrintObjectItem {
  id: string;
  name: string;
  category: string;
  folderName: string;
  folderPath: string;
  relativeFolder: string;
  description: string;
  notes: string;
  tags: string[];
  thumbnailPath: string | null;
  models: ModelFileEntry[];
  updatedAt: number;
}

export interface SlicerProfile {
  id: string;
  name: string;
  executablePath: string;
}

export interface AppSettings {
  libraryPath: string;
  slicers: SlicerProfile[];
  activeSlicerId: string;
  crealityPrinter?: string;
  crealityFilament?: string;
}

export interface BoundingBoxDimensions {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  triangles: number;
}

export type PrintIntent = 'auto' | 'quality' | 'strength' | 'draft';
export type SupportMode = 'none' | 'tree' | 'normal';
export type BrimMode = 'no_brim' | 'auto_brim' | 'outer_only';
export type InfillPattern = 'gyroid' | 'grid' | 'crosshatch';

export interface MeshAnalysisMetrics extends BoundingBoxDimensions {
  volumeCm3: number;
  surfaceAreaCm2: number;
  bedContactAreaMm2: number;
  overhangAreaMm2: number;
  severeOverhangAreaMm2: number;
  curvedTopRatio: number;
  organicRatio: number;
  slendernessRatio: number;
}

export interface SmartSliceConfig {
  layerHeight: number;
  wallLoops: number;
  topShellLayers: number;
  bottomShellLayers: number;
  infillDensity: number;
  infillPattern: InfillPattern;
  supportMode: SupportMode;
  supportOnBuildPlateOnly: boolean;
  brimMode: BrimMode;
  brimWidthMm: number;
  outerWallSpeed: number;
  innerWallSpeed: number;
  infillSpeed: number;
  topSurfaceSpeed: number;
  initialLayerSpeed: number;
  heightSpeedLimit: boolean;
  estimatedGrams: number;
  reasons: string[];
}

export interface SerializedMeshPayload {
  vertices: Float32Array;
  indices: Uint32Array;
  heightMm: number;
}

export interface CrealityCatalog {
  printers: string[];
  filaments: string[];
  defaultPrinter: string;
  defaultFilament: string;
}

export interface OpenConfiguredSlicerPayload {
  modelPath: string;
  slicerExecutablePath: string | null;
  meshPayload: SerializedMeshPayload;
  sliceConfig: SmartSliceConfig;
  printerName?: string;
  filamentName?: string;
}

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
    bladeMesh?: {
      positions: Float32Array;
      indices: Uint32Array;
      positionsA?: Float32Array;
      indicesA?: Uint32Array;
    };
  }
  | { kind: 'extrude'; polygonUV: Array<[number, number]>; basis: number[]; wMin: number; wMax: number; scale?: [number, number] };

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

export interface ElectronBridgeAPI {
  getInitialState: () => Promise<{ settings: AppSettings; items: PrintObjectItem[] }>;
  selectLibraryFolder: () => Promise<{ settings: AppSettings; items: PrintObjectItem[] } | null>;
  rescanLibrary: (folderPath?: string) => Promise<{ settings: AppSettings; items: PrintObjectItem[] }>;
  readModelBuffer: (filePath: string) => Promise<ArrayBuffer>;
  readImageDataUrl: (imagePath: string) => Promise<string | null>;
  openInSlicer: (
    modelPath: string,
    slicerExecutablePath: string | null
  ) => Promise<{ mode: string; path: string }>;
  openConfiguredInSlicer: (
    payload: OpenConfiguredSlicerPayload
  ) => Promise<{ mode: string; path: string }>;
  getCrealityCatalog: (
    slicerExecutablePath: string | null,
    selectedPrinter?: string
  ) => Promise<CrealityCatalog>;
  openFolderInExplorer: (folderPath: string) => Promise<boolean>;
  selectSlicerExecutable: () => Promise<SlicerProfile | null>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  saveObjectMetadata: (
    folderPath: string,
    metadata: { notes?: string; tags?: string[]; customThumbnail?: string }
  ) => Promise<{ notes: string; tags: string[]; customThumbnail: string | null }>;
  executeCatpinCut: (payload: CatpinCutPayload) => Promise<CatpinCutResult>;
  suggestCatpinPin: (payload: CatpinSuggestPayload) => Promise<CatpinSuggestResult>;
  diagnoseCatpinModel: (payload: CatpinDiagnosticPayload) => Promise<CatpinDiagnosticResult>;
  saveCatpinFiles: (payload: {
    targetFolder?: string;
    defaultPath?: string;
    files: Array<{ name: string; buffer: ArrayBuffer }>;
    openFolderAfter?: boolean;
  }) => Promise<{ success: boolean; savedPaths: string[]; folder: string }>;
  saveMultiPart3mf: (payload: {
    projectName: string;
    parts: Array<{
      name: string;
      vertices: number[];
      indices: number[];
      position: [number, number, number];
      rotation: [number, number, number, number];
    }>;
    defaultPath?: string;
  }) => Promise<{ success: boolean; savedPath: string }>;
  openMultiPartInSlicer: (payload: {
    projectName: string;
    parts: Array<{
      name: string;
      vertices: number[];
      indices: number[];
      position: [number, number, number];
      rotation: [number, number, number, number];
    }>;
    slicerExecutablePath?: string;
  }) => Promise<{ mode: string; path: string }>;
  checkForUpdates?: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
  }
}
