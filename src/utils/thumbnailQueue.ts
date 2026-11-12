type TaskFn<T> = () => Promise<T>;

const queue: Array<() => void> = [];
let activeTaskCount = 0;
const MAX_CONCURRENT_RENDERS = 1;

function processNextInQueue(): void {
  if (activeTaskCount >= MAX_CONCURRENT_RENDERS || queue.length === 0) return;
  activeTaskCount++;
  const nextJob = queue.shift();
  if (nextJob) nextJob();
}

/**
 * Clears any pending thumbnail jobs in queue (e.g. when changing root folder).
 */
export function clearThumbnailQueue(): void {
  queue.length = 0;
}

/**
 * Enqueues heavy 3D parsing/thumbnail generation sequentially so the UI never freezes.
 * @param fn Async task function
 */
export function enqueueThumbnailJob<T>(fn: TaskFn<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      setTimeout(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          activeTaskCount--;
          processNextInQueue();
        }
      }, 16);
    });
    processNextInQueue();
  });
}

