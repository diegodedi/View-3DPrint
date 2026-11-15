const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;
const CACHE_FILENAME = 'library-index-cache.json';

function getCacheFilePath(cacheDir) {
  if (!cacheDir) return null;
  return path.join(cacheDir, CACHE_FILENAME);
}

/**
 * Loads the persisted library index cache for a specific root folder.
 * @param {string | null | undefined} cacheDir
 * @param {string} rootPath
 * @returns {Record<string, { dirMtimeMs: number, metaMtimeMs: number, hasThumb: boolean, item: object }>}
 */
async function loadScannerCache(cacheDir, rootPath) {
  const filePath = getCacheFilePath(cacheDir);
  if (!filePath || !rootPath) return {};
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== CACHE_VERSION || parsed.rootPath !== rootPath || !parsed.entries) {
      return {};
    }
    return parsed.entries;
  } catch {
    return {};
  }
}

/**
 * Persists the scanned folder entries index to disk asynchronously.
 * @param {string | null | undefined} cacheDir
 * @param {string} rootPath
 * @param {Record<string, { dirMtimeMs: number, metaMtimeMs: number, hasThumb: boolean, item: object }>} entries
 */
async function saveScannerCache(cacheDir, rootPath, entries) {
  const filePath = getCacheFilePath(cacheDir);
  if (!filePath || !rootPath) return;
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      rootPath,
      updatedAt: Date.now(),
      entries,
    });
    await fs.promises.writeFile(filePath, payload, 'utf-8');
  } catch {
    // Falha ao gravar cache não deve interromper o catálogo
  }
}

module.exports = { loadScannerCache, saveScannerCache };

