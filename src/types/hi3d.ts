export type Hi3dResolution = 512 | 1024 | 1536;
export type Hi3dOutputFormat = 'stl' | 'obj';
export type Hi3dCompatibilityLevel = 'unsupported' | 'minimum' | 'recommended';

export interface Hi3dGpuInfo {
  name: string;
  vramMb: number;
  vramGb: number;
  computeCap: number;
  driverVersion: string;
}

export interface Hi3dCompatibility {
  isCompatible: boolean;
  level: Hi3dCompatibilityLevel;
  summary: string;
  recommendedResolution: Hi3dResolution;
  warnings: string[];
}

export interface Hi3dEnvironment {
  platform: string;
  gpu: Hi3dGpuInfo | null;
  freeDiskGb: number | null;
  hasGit: boolean;
  uvPath: string | null;
  compatibility: Hi3dCompatibility;
  requirements: {
    minComputeCap: number;
    minVramMb: number;
    recommendedVramMb: number;
    ultraVramMb: number;
    minDiskFreeGb: number;
  };
}

export interface Hi3dConfig {
  runtimeDir: string;
  resolution: Hi3dResolution;
  outputFormat: Hi3dOutputFormat;
  targetSizeMm: number;
  removeBackground: boolean;
  cpuOffload: boolean;
}

export interface Hi3dInstallState {
  isInstalled: boolean;
  installedAt: string | null;
}

export interface Hi3dStatusPayload {
  config: Hi3dConfig;
  environment: Hi3dEnvironment;
  installState: Hi3dInstallState;
  isInstalling: boolean;
  isGenerating: boolean;
}

export interface Hi3dProgressEvent {
  step?: string;
  stage?: string;
  percent?: number;
  message?: string;
  log?: string;
}

export interface Hi3dGenerateRequest {
  imagePath: string;
  modelName?: string;
  resolution?: Hi3dResolution;
  outputFormat?: Hi3dOutputFormat;
  targetSizeMm?: number;
  removeBackground?: boolean;
  cpuOffload?: boolean;
  seed?: number;
}

export interface Hi3dGenerateResult {
  success: boolean;
  modelPath: string;
  folderPath: string;
  modelName: string;
  triangles: number;
  elapsedMs: number;
  resolution: number;
}

export interface Hi3dBridgeAPI {
  getStatus: () => Promise<Hi3dStatusPayload>;
  updateConfig: (patch: Partial<Hi3dConfig>) => Promise<Hi3dStatusPayload>;
  selectRuntimeDir: () => Promise<Hi3dStatusPayload | null>;
  selectImage: () => Promise<string | null>;
  install: () => Promise<Hi3dStatusPayload>;
  cancelInstall: () => Promise<boolean>;
  generate: (request: Hi3dGenerateRequest) => Promise<Hi3dGenerateResult>;
  cancelGenerate: () => Promise<boolean>;
  onInstallProgress: (listener: (event: Hi3dProgressEvent) => void) => () => void;
  onGenerateProgress: (listener: (event: Hi3dProgressEvent) => void) => () => void;
}
