const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { primeLocalAssetCache } = require('./localAssetProtocol.cjs');
const { extract3mfEmbeddedThumbnail } = require('./thumb3mfExtractor.cjs');

const THUMB_CACHE_SUBDIR = 'thumb-cache';
const CACHE_KEY_PREFIX = 'v3';
const AUTO_EXTS = ['.webp', '.png', '.jpg'];
const CUSTOM_EXTS = ['.webp', '.jpg', '.png'];

function sha1Short(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 20);
}

/**
 * Returns the centralized SSD thumbnail cache directory inside Electron userData.
 * @param {string | null | undefined} cacheDir
 */
function getThumbCacheDir(cacheDir) {
  if (!cacheDir) return null;
  return path.join(cacheDir, THUMB_CACHE_SUBDIR);
}

/**
 * Computes a deterministic hash for custom user-captured folder thumbnails.
 * @param {string} folderPath
 */
function computeCustomThumbBase(folderPath) {
  return `custom-${sha1Short(folderPath)}`;
}

/**
 * Computes an incremental cache key bound to folder, model path, size, and mtime.
 * @param {string} folderPath
 * @param {{ path: string, sizeBytes: number, mtimeMs?: number } | undefined} primaryModel
 */
function computeAutoThumbCacheKey(folderPath, primaryModel) {
  if (!folderPath || !primaryModel) return '';
  const signature = `${CACHE_KEY_PREFIX}|${folderPath}|${primaryModel.path}|${primaryModel.sizeBytes}|${Math.trunc(primaryModel.mtimeMs || 0)}`;
  return `auto-${sha1Short(signature)}`;
}

/**
 * Lists all cached thumbnail filenames in a single async directory read for O(1) lookup.
 * @param {string | null | undefined} cacheDir
 * @returns {Promise<Set<string>>}
 */
async function listCachedThumbFiles(cacheDir) {
  const dir = getThumbCacheDir(cacheDir);
  if (!dir) return new Set();
  try {
    const names = await fs.promises.readdir(dir);
    return new Set(names);
  } catch {
    return new Set();
  }
}

/**
 * Resolves a cached thumbnail absolute path in O(1) RAM using a preloaded filename set.
 * Priority: 1) custom user capture, 2) incremental auto cache, 3) legacy folder file.
 */
function resolveCachedThumbPath(params) {
  const { cacheDir, thumbFileSet, folderPath, cacheKey, legacyPath } = params;
  const dir = getThumbCacheDir(cacheDir);
  if (dir && thumbFileSet && thumbFileSet.size > 0) {
    const customBase = computeCustomThumbBase(folderPath);
    for (const ext of CUSTOM_EXTS) {
      const name = `${customBase}${ext}`;
      if (thumbFileSet.has(name)) return path.join(dir, name);
    }
    if (cacheKey) {
      for (const ext of AUTO_EXTS) {
        const name = `${cacheKey}${ext}`;
        if (thumbFileSet.has(name)) return path.join(dir, name);
      }
    }
  }
  return legacyPath || null;
}

async function ensureThumbDir(cacheDir) {
  const dir = getThumbCacheDir(cacheDir);
  if (!dir) throw new Error('Diretório de cache não disponível.');
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Writes binary WebP/PNG/JPG auto-thumbnail bytes directly to centralized SSD cache and primes RAM.
 */
async function saveAutoThumbnailBytes(params) {
  const { cacheDir, cacheKey, bytes, ext = '.webp' } = params;
  if (!cacheKey || !bytes) return null;
  const dir = await ensureThumbDir(cacheDir);
  const safeExt = AUTO_EXTS.includes(ext) ? ext : '.webp';
  const safeKey = String(cacheKey).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeKey) return null;
  const targetPath = path.join(dir, `${safeKey}${safeExt}`);
  const imgBuf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
  primeLocalAssetCache(targetPath, imgBuf);
  await fs.promises.writeFile(targetPath, imgBuf);
  return targetPath;
}

/**
 * Saves a manual custom thumbnail capture (data URL) into the centralized cache override slot.
 */
async function saveCustomThumbnailDataUrl(cacheDir, folderPath, dataUrl) {
  if (!folderPath || !dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const dir = await ensureThumbDir(cacheDir);
  const mimeMatch = dataUrl.match(/^data:image\/(\w+);base64,/);
  const extRaw = mimeMatch ? mimeMatch[1].toLowerCase() : 'jpeg';
  const ext = extRaw === 'webp' ? '.webp' : extRaw === 'png' ? '.png' : '.jpg';
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const imgBuf = Buffer.from(base64Data, 'base64');
  const baseName = computeCustomThumbBase(folderPath);
  const targetPath = path.join(dir, `${baseName}${ext}`);

  for (const oldExt of CUSTOM_EXTS) {
    if (oldExt !== ext) {
      fs.promises.unlink(path.join(dir, `${baseName}${oldExt}`)).catch(() => {});
    }
  }

  primeLocalAssetCache(targetPath, imgBuf);
  await fs.promises.writeFile(targetPath, imgBuf);
  return targetPath;
}

/**
 * Registers IPC handlers for binary WebP cache saving and instant .3mf embedded thumbnail extraction.
 * @param {string} cacheDir
 */
function registerThumbCacheIpc(cacheDir) {
  ipcMain.handle('thumbcache:save-auto', async (_event, payload) => {
    const { cacheKey, bytes, ext } = payload || {};
    const thumbnailPath = await saveAutoThumbnailBytes({ cacheDir, cacheKey, bytes, ext: ext || '.webp' });
    return { thumbnailPath };
  });

  ipcMain.handle('thumbcache:extract-3mf', async (_event, payload) => {
    const { modelPath, cacheKey } = payload || {};
    if (!modelPath || !cacheKey) return { thumbnailPath: null };
    const extracted = await extract3mfEmbeddedThumbnail(modelPath);
    if (!extracted) return { thumbnailPath: null };
    const thumbnailPath = await saveAutoThumbnailBytes({
      cacheDir,
      cacheKey,
      bytes: extracted.buffer,
      ext: extracted.ext,
    });
    return { thumbnailPath };
  });
}

module.exports = {
  getThumbCacheDir,
  computeAutoThumbCacheKey,
  computeCustomThumbBase,
  listCachedThumbFiles,
  resolveCachedThumbPath,
  saveAutoThumbnailBytes,
  saveCustomThumbnailDataUrl,
  registerThumbCacheIpc,
};
