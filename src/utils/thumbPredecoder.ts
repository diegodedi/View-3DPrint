const MAX_PREDECODED_IMAGES = 180;
const predecodedCache = new Map<string, HTMLImageElement>();

/**
 * Builds a stable local-asset:// URL for a cached thumbnail file.
 */
export function buildLocalAssetUrl(thumbnailPath: string, version: number = 1): string {
  return `local-asset://thumb?path=${encodeURIComponent(thumbnailPath)}&v=${version}`;
}

/**
 * Preloads and decodes thumbnail URLs ahead/behind the viewport so scroll-back and scroll-forward show pixels immediately.
 */
export function predecodeThumbnailUrls(urls: string[]): void {
  if (typeof Image === 'undefined' || urls.length === 0) return;

  for (const url of urls) {
    if (!url) continue;
    if (predecodedCache.has(url)) {
      const existing = predecodedCache.get(url)!;
      predecodedCache.delete(url);
      predecodedCache.set(url, existing);
      continue;
    }

    if (predecodedCache.size >= MAX_PREDECODED_IMAGES) {
      const oldestKey = predecodedCache.keys().next().value;
      if (oldestKey) predecodedCache.delete(oldestKey);
    }

    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    predecodedCache.set(url, img);
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {
        predecodedCache.delete(url);
      });
    }
  }
}

/**
 * Clears retained pre-decoded HTMLImageElements when switching libraries.
 */
export function clearPredecodeCache(): void {
  predecodedCache.clear();
}
