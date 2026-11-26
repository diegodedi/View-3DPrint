const fs = require('fs');
const path = require('path');
const { scanLibraryFolderAsync } = require('./scannerAsync.cjs');
const { loadScannerCache } = require('./scannerCache.cjs');
const { primeLocalAssetCache } = require('./localAssetProtocol.cjs');
const {
  computeAutoThumbCacheKey,
  listCachedThumbFiles,
  resolveCachedThumbPath,
  saveCustomThumbnailDataUrl,
} = require('./thumbCache.cjs');

const META_FILE_NAME = '.view3dprint.json';
const THUMB_FILE_NAME = '.view3dprint-matcap-v2.jpg';

/**
 * Reads custom metadata file inside an object folder if present.
 * @param {string} folderPath
 * @returns {{ notes: string, tags: string[] }}
 */
function readFolderMetadata(folderPath) {
  const metaPath = path.join(folderPath, META_FILE_NAME);
  if (!fs.existsSync(metaPath)) {
    return { notes: '', tags: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { notes: '', tags: [] };
  }
}

/**
 * Saves custom metadata (notes, tags, or JPEG/WebP custom thumbnail) asynchronously.
 * Custom thumbnails are saved to centralized SSD cache when cacheDir is provided.
 * @param {string} folderPath
 * @param {{ notes?: string, tags?: string[], customThumbnail?: string }} payload
 * @param {string | null} [cacheDir]
 */
async function saveFolderMetadata(folderPath, payload, cacheDir = null) {
  if (!folderPath) throw new Error('Pasta do objeto não encontrada.');
  const current = readFolderMetadata(folderPath);
  const updated = {
    notes: payload.notes !== undefined ? payload.notes : current.notes,
    tags: payload.tags !== undefined ? payload.tags : current.tags,
  };

  let savedThumbPath = null;
  if (payload.customThumbnail && payload.customThumbnail.startsWith('data:image/')) {
    if (cacheDir) {
      savedThumbPath = await saveCustomThumbnailDataUrl(cacheDir, folderPath, payload.customThumbnail);
    } else {
      const base64Data = payload.customThumbnail.replace(/^data:image\/\w+;base64,/, '');
      const imgBuf = Buffer.from(base64Data, 'base64');
      savedThumbPath = path.join(folderPath, THUMB_FILE_NAME);
      primeLocalAssetCache(savedThumbPath, imgBuf);
      await fs.promises.writeFile(savedThumbPath, imgBuf);
    }
  }

  if (payload.notes !== undefined || payload.tags !== undefined) {
    const metaPath = path.join(folderPath, META_FILE_NAME);
    await fs.promises.writeFile(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
  }
  return { ...updated, customThumbnail: savedThumbPath };
}

/**
 * Reads persisted scanner cache items immediately for instant warm startup with O(1) thumb lookup.
 * @param {string} rootPath
 * @param {string | null} cacheDir
 */
async function readCachedLibraryItems(rootPath, cacheDir) {
  const [entries, thumbFileSet] = await Promise.all([
    loadScannerCache(cacheDir, rootPath),
    listCachedThumbFiles(cacheDir),
  ]);
  const items = [];
  for (const entry of Object.values(entries)) {
    if (!entry || !entry.item) continue;
    const item = entry.item;
    const cacheKey = item.thumbCacheKey || computeAutoThumbCacheKey(item.folderPath, item.models?.[0]);
    const resolvedThumb = resolveCachedThumbPath({
      cacheDir,
      thumbFileSet,
      folderPath: item.folderPath,
      cacheKey,
      legacyPath: item.thumbnailPath,
    });
    const latestModelMtime = Array.isArray(item.models)
      ? item.models.reduce((max, m) => Math.max(max, m.mtimeMs || 0), 0)
      : 0;
    const updatedAt = Math.max(item.updatedAt || 0, latestModelMtime);
    items.push({ ...item, thumbCacheKey: cacheKey, thumbnailPath: resolvedThumb, updatedAt });
  }
  return items.sort(
    (a, b) => ((b.updatedAt || 0) - (a.updatedAt || 0)) || a.name.localeCompare(b.name, 'pt-BR')
  );
}

module.exports = { scanLibraryFolderAsync, saveFolderMetadata, readCachedLibraryItems };
