import type { WebTabsBridgeAPI } from './webTabs';
import type { ThumbCacheBridgeAPI } from './thumbCache';
import type {
  CatpinCutPayload,
  CatpinCutResult,
  CatpinSuggestPayload,
  CatpinSuggestResult,
  CatpinDiagnosticPayload,
  CatpinDiagnosticResult,
} from './catpin';

export type {
  CatpinV3,
  CatpinCutSpec,
  CatpinPinSide,
  CatpinConnectorSpec,
  CatpinCutPayload,
  CatpinWarning,
  CatpinCutResult,
  CatpinSuggestPayload,
  CatpinSuggestResult,
  CatpinDiagnosticPayload,
  CatpinDiagnosticResult,
} from './catpin';

export interface ModelFileEntry {
  name: string;
  path: string;
  extension: string;
  sizeBytes: number;
  mtimeMs?: number;
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
  thumbCacheKey?: string;
  models: ModelFileEntry[];
  updatedAt: number;
}

export interface SlicerProfile {
  id: string;
  name: string;
  executablePath: string;
}

export type ViewportShadingPresetKey = 'clay' | 'jade' | 'knight' | 'ochre' | 'wax';

export interface ViewportShadingConfig {
  preset: ViewportShadingPresetKey;
  cavityDistance: number;
  cavityIntensity: number;
  roughness: number;
  specularIntensity: number;
}

export interface AppSettings {
  libraryPath: string;
  slicers: SlicerProfile[];
  activeSlicerId: string;
  crealityPrinter?: string;
  crealityFilament?: string;
  viewportShading?: ViewportShadingConfig;
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
  bedDimensions?: { widthMm: number; depthMm: number; heightMm: number };
}

export interface MultiPart3mfItemPayload {
  name: string;
  vertices: number[];
  indices: number[];
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface OpenConfiguredSlicerPayload {
  modelPath: string;
  slicerExecutablePath: string | null;
  meshPayload: SerializedMeshPayload;
  sliceConfig: SmartSliceConfig;
  printerName?: string;
  filamentName?: string;
}

export interface ElectronBridgeAPI {
  getInitialState: () => Promise<{
    settings: AppSettings;
    items: PrintObjectItem[];
    crealityCatalog?: CrealityCatalog;
  }>;
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
    parts: MultiPart3mfItemPayload[];
    targetFolder?: string;
    defaultPath?: string;
    bedWidthMm?: number;
    bedDepthMm?: number;
  }) => Promise<{ success: boolean; savedPath: string; folder?: string }>;
  openMultiPartInSlicer: (payload: {
    projectName: string;
    parts: MultiPart3mfItemPayload[];
    slicerExecutablePath?: string;
    bedWidthMm?: number;
    bedDepthMm?: number;
  }) => Promise<{ mode: string; path: string }>;
  checkForUpdates?: () => Promise<boolean>;
  thumbCache?: ThumbCacheBridgeAPI;
  webTabs?: WebTabsBridgeAPI;
  hi3d?: import('./hi3d').Hi3dBridgeAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
  }
}
