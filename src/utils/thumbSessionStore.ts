import type { PrintObjectItem } from '../types/models';
import {
  renderBufferToThumbnailDataUrlAsync,
  renderBufferToThumbnailWebpBytesAsync,
} from './thumbnailRenderer';
import { buildLocalAssetUrl, predecodeThumbnailUrls } from './thumbPredecoder';

export type ThumbListener = (url: string) => void;

const MAX_SESSION_URL_CACHE = 5000;
const resolvedThumbCache = new Map<string, string>();
const thumbListeners = new Map<string, Set<ThumbListener>>();

function notifySubscribers(folderPath: string, url: string): void {
  const subs = thumbListeners.get(folderPath);
  if (!subs) return;
  subs.forEach((cb) => cb(url));
}

/**
 * Checks if a folder already has a resolved thumbnail URL in session memory.
 */
export function hasCachedGeneratedThumbnail(folderPath: string): boolean {
  return resolvedThumbCache.has(folderPath);
}

/**
 * Returns a resolved thumbnail URL from session memory if already generated.
 */
export function getCachedGeneratedThumbnail(folderPath: string): string | null {
  const hit = resolvedThumbCache.get(folderPath);
  if (!hit) return null;
  resolvedThumbCache.delete(folderPath);
  resolvedThumbCache.set(folderPath, hit);
  return hit;
}

/**
 * Stores a resolved thumbnail URL in session memory (LRU capped at 5000 strings) and notifies cards.
 */
export function setCachedGeneratedThumbnail(folderPath: string, url: string): void {
  if (!folderPath || !url) return;
  if (resolvedThumbCache.has(folderPath)) {
    resolvedThumbCache.delete(folderPath);
  } else if (resolvedThumbCache.size >= MAX_SESSION_URL_CACHE) {
    const oldestKey = resolvedThumbCache.keys().next().value;
    if (oldestKey) resolvedThumbCache.delete(oldestKey);
  }
  resolvedThumbCache.set(folderPath, url);
  notifySubscribers(folderPath, url);
}

/**
 * Subscribes a mounted card to receive background-generated thumbnail URLs for its folder.
 */
export function subscribeThumbnailReady(folderPath: string, cb: ThumbListener): () => void {
  let set = thumbListeners.get(folderPath);
  if (!set) {
    set = new Set();
    thumbListeners.set(folderPath, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) thumbListeners.delete(folderPath);
  };
}

/**
 * Clears all session-cached thumbnail URLs when switching libraries.
 */
export function clearSessionThumbStore(): void {
  resolvedThumbCache.clear();
}

/**
 * Generates or extracts a thumbnail for a single catalog item and persists it in centralized SSD WebP cache.
 */
export async function generateAndCacheThumbnail(
  item: PrintObjectItem
): Promise<{ savedPath: string | null; resolvedUrl: string }> {
  const api = window.electronAPI;
  const primaryModel = item.models[0];
  if (!api || !primaryModel) return { savedPath: null, resolvedUrl: '' };

  let savedPath: string | null = null;
  let resolvedUrl = '';
  const cacheKey = item.thumbCacheKey || '';

  if (primaryModel.extension.toUpperCase() === '3MF' && cacheKey && api.thumbCache?.extract3mfThumb) {
    const extracted = await api.thumbCache.extract3mfThumb(primaryModel.path, cacheKey);
    if (extracted?.thumbnailPath) {
      savedPath = extracted.thumbnailPath;
    }
  }

  if (!savedPath) {
    const buffer = await api.readModelBuffer(primaryModel.path);
    if (cacheKey && api.thumbCache?.saveAutoWebp) {
      const bytes = await renderBufferToThumbnailWebpBytesAsync(buffer, primaryModel.extension);
      if (bytes && bytes.byteLength > 0) {
        const saved = await api.thumbCache.saveAutoWebp(cacheKey, bytes, '.webp');
        savedPath = saved?.thumbnailPath || null;
      }
    } else {
      resolvedUrl = await renderBufferToThumbnailDataUrlAsync(buffer, primaryModel.extension);
    }
  }

  if (savedPath) {
    resolvedUrl = buildLocalAssetUrl(savedPath, 1);
    predecodeThumbnailUrls([resolvedUrl]);
  }
  return { savedPath, resolvedUrl };
}
