export interface ThumbIndexerProgress {
  total: number;
  completed: number;
  pending: number;
  isRunning: boolean;
  isPaused: boolean;
}

export interface ThumbCacheBridgeAPI {
  saveAutoWebp: (
    cacheKey: string,
    bytes: Uint8Array,
    ext?: string
  ) => Promise<{ thumbnailPath: string | null }>;
  extract3mfThumb: (
    modelPath: string,
    cacheKey: string
  ) => Promise<{ thumbnailPath: string | null }>;
}
