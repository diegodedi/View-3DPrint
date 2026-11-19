import type { PrintObjectItem } from '../types/models';
import type { ThumbIndexerProgress } from '../types/thumbCache';
import { getThumbnailWorkerConcurrency } from './meshWorkerClient';
import { clearPredecodeCache } from './thumbPredecoder';
import {
  clearSessionThumbStore,
  generateAndCacheThumbnail,
  getCachedGeneratedThumbnail,
  hasCachedGeneratedThumbnail,
  setCachedGeneratedThumbnail,
  subscribeThumbnailReady,
} from './thumbSessionStore';

type TaskFn<T> = () => Promise<T>;
type ProgressListener = (progress: ThumbIndexerProgress) => void;

const INITIAL_START_DELAY_MS = 180;
const SCROLL_YIELD_MS = 120;

const failedFolders = new Set<string>();
const inFlightFolders = new Set<string>();
const priorityQueue: PrintObjectItem[] = [];
const backgroundQueue: PrintObjectItem[] = [];
const queuedKeys = new Set<string>();
const progressListeners = new Set<ProgressListener>();

let onResolvedCallback: ((folderPath: string, thumbnailPath: string) => void) | null = null;
let activeWorkers = 0;
let isPaused = false;
let scrollCooldownUntil = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let sessionGeneration = 0;
let indexedTotal = 0;
let indexedCompleted = 0;

export {
  getCachedGeneratedThumbnail,
  setCachedGeneratedThumbnail,
  subscribeThumbnailReady,
};

function clearPumpTimer(): void {
  if (!pumpTimer) return;
  clearTimeout(pumpTimer);
  pumpTimer = null;
}

function getProgressSnapshot(): ThumbIndexerProgress {
  const pending = priorityQueue.length + backgroundQueue.length + inFlightFolders.size;
  return {
    total: indexedTotal,
    completed: indexedCompleted,
    pending,
    isRunning: pending > 0 && !isPaused,
    isPaused,
  };
}

function emitProgress(): void {
  const snap = getProgressSnapshot();
  progressListeners.forEach((cb) => cb(snap));
}

/**
 * Subscribes to live background thumbnail indexer progress updates.
 */
export function subscribeIndexerProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  cb(getProgressSnapshot());
  return () => {
    progressListeners.delete(cb);
  };
}

/**
 * Pauses or resumes background indexing (visible cards can still render on demand when unpaused).
 */
export function setThumbnailIndexerPaused(paused: boolean): void {
  isPaused = paused;
  emitProgress();
  if (!paused) schedulePump(0);
}

function pickNextItem(): PrintObjectItem | null {
  if (priorityQueue.length > 0) {
    return priorityQueue.pop() || null;
  }
  if (isPaused) return null;
  if (Date.now() < scrollCooldownUntil) return null;
  return backgroundQueue.shift() || null;
}

function schedulePump(delayMs: number = 0): void {
  clearPumpTimer();
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pumpWorkers();
  }, delayMs);
}

function pumpWorkers(): void {
  const maxConcurrency = getThumbnailWorkerConcurrency();
  while (activeWorkers < maxConcurrency) {
    const item = pickNextItem();
    if (!item) {
      if (backgroundQueue.length > 0 && !isPaused && Date.now() < scrollCooldownUntil) {
        schedulePump(Math.max(20, scrollCooldownUntil - Date.now()));
      }
      break;
    }

    queuedKeys.delete(item.folderPath);
    if (
      hasCachedGeneratedThumbnail(item.folderPath) ||
      failedFolders.has(item.folderPath) ||
      inFlightFolders.has(item.folderPath)
    ) {
      continue;
    }

    const gen = sessionGeneration;
    inFlightFolders.add(item.folderPath);
    activeWorkers++;
    emitProgress();

    void generateAndCacheThumbnail(item)
      .then(({ savedPath, resolvedUrl }) => {
        if (gen !== sessionGeneration) return;
        if (savedPath && resolvedUrl) {
          setCachedGeneratedThumbnail(item.folderPath, resolvedUrl);
          onResolvedCallback?.(item.folderPath, savedPath);
        } else if (resolvedUrl) {
          setCachedGeneratedThumbnail(item.folderPath, resolvedUrl);
        } else {
          failedFolders.add(item.folderPath);
        }
      })
      .catch(() => {
        if (gen === sessionGeneration) failedFolders.add(item.folderPath);
      })
      .finally(() => {
        activeWorkers--;
        if (gen === sessionGeneration) {
          inFlightFolders.delete(item.folderPath);
          indexedCompleted = Math.min(indexedTotal, indexedCompleted + 1);
          emitProgress();
          schedulePump(0);
        }
      });
  }
}

/**
 * Starts continuous parallel background indexing for all library items missing a cached thumbnail.
 */
export function startLibraryThumbnailIndexer(
  items: PrintObjectItem[],
  onThumbResolved: (folderPath: string, thumbnailPath: string) => void
): void {
  onResolvedCallback = onThumbResolved;
  let added = 0;

  for (const item of items) {
    if (
      item.thumbnailPath ||
      item.models.length === 0 ||
      hasCachedGeneratedThumbnail(item.folderPath) ||
      failedFolders.has(item.folderPath) ||
      inFlightFolders.has(item.folderPath) ||
      queuedKeys.has(item.folderPath)
    ) {
      continue;
    }
    backgroundQueue.push(item);
    queuedKeys.add(item.folderPath);
    added++;
  }

  if (added > 0) {
    indexedTotal += added;
    emitProgress();
    schedulePump(INITIAL_START_DELAY_MS);
  }
}

/**
 * Moves a currently visible card to the front of the priority queue without ever discarding in-flight renders.
 */
export function prioritizeThumbnailItem(item: PrintObjectItem): void {
  if (
    item.thumbnailPath ||
    item.models.length === 0 ||
    hasCachedGeneratedThumbnail(item.folderPath) ||
    failedFolders.has(item.folderPath) ||
    inFlightFolders.has(item.folderPath)
  ) {
    return;
  }

  const bgIdx = backgroundQueue.findIndex((it) => it.folderPath === item.folderPath);
  if (bgIdx >= 0) backgroundQueue.splice(bgIdx, 1);

  const prioIdx = priorityQueue.findIndex((it) => it.folderPath === item.folderPath);
  if (prioIdx >= 0) priorityQueue.splice(prioIdx, 1);

  if (!queuedKeys.has(item.folderPath)) {
    queuedKeys.add(item.folderPath);
    indexedTotal++;
  }
  priorityQueue.push(item);
  emitProgress();
  schedulePump(0);
}

/**
 * Demotes a not-yet-started card from visible priority back to background queue (never cancels in-flight work).
 */
export function deprioritizeThumbnailKey(folderPath: string): void {
  const idx = priorityQueue.findIndex((it) => it.folderPath === folderPath);
  if (idx < 0) return;
  const [item] = priorityQueue.splice(idx, 1);
  if (item) backgroundQueue.unshift(item);
}

/**
 * Briefly yields background-only picks during active scrolling while keeping visible priority running.
 */
export function notifyGridScrolling(): void {
  scrollCooldownUntil = Date.now() + SCROLL_YIELD_MS;
}

/**
 * Clears all queues, session caches, and progress state (e.g. when changing library root folder).
 */
export function clearThumbnailQueue(): void {
  sessionGeneration++;
  priorityQueue.length = 0;
  backgroundQueue.length = 0;
  queuedKeys.clear();
  inFlightFolders.clear();
  failedFolders.clear();
  clearSessionThumbStore();
  clearPredecodeCache();
  clearPumpTimer();
  indexedTotal = 0;
  indexedCompleted = 0;
  emitProgress();
}

/**
 * Generic async job helper retained for backwards compatibility with shared utilities.
 */
export function enqueueThumbnailJob<T>(fn: TaskFn<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    }, 0);
  });
}
