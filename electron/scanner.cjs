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

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '__MACOSX', '$RECYCLE.BIN', 'System Volume Information']);
const META_FILE_NAME = '.view3dprint.json';
const THUMB_FILE_NAME = '.view3dprint-matcap-v2.jpg';

/**
 * Formats a raw folder name into a readable title.
 * @param {string} folderName
 * @returns {string}
 */
function formatFolderTitle(folderName) {
  return folderName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

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
    items.push({ ...item, thumbCacheKey: cacheKey, thumbnailPath: resolvedThumb });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * Inspects a single directory and collects 3D files, description text, category, and preview image.
 * @param {string} dirPath
 * @param {string} rootPath
 */
function inspectObjectFolder(dirPath, rootPath) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const models = [];
  const textFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const fullPath = path.join(dirPath, entry.name);

    if (MODEL_EXTENSIONS.has(ext)) {
      const stat = fs.statSync(fullPath);
      models.push({
        name: entry.name,
        path: fullPath,
        extension: ext.replace('.', '').toUpperCase(),
        sizeBytes: stat.size,
      });
    } else if (
      entry.name.startsWith('.view3dprint') &&
      entry.name !== THUMB_FILE_NAME &&
      entry.name !== META_FILE_NAME
    ) {
      try {
        fs.unlinkSync(fullPath);
      } catch (err) {
        // Arquivo temporário legado pode estar bloqueado ou já removido pelo SO
      }
    } else if (TEXT_EXTENSIONS.has(ext)) {
      textFiles.push(fullPath);
    }
  }

  if (models.length === 0) return null;

  let description = '';
  if (textFiles.length > 0) {
    try {
      description = fs.readFileSync(textFiles[0], 'utf-8').trim();
    } catch {
      description = '';
    }
  }

  const folderName = path.basename(dirPath);
  const relativeFolder = path.relative(rootPath, dirPath) || folderName;
  const segments = relativeFolder.split(path.sep).filter(Boolean);
  const category = segments.length > 1 ? formatFolderTitle(segments[0]) : 'Geral';
  const meta = readFolderMetadata(dirPath);
  const autoThumbPath = path.join(dirPath, THUMB_FILE_NAME);
  const hasAutoThumb = fs.existsSync(autoThumbPath);

  if (!description) {
    description = `${models.length} arquivo(s): ${models.map((m) => m.name).join(', ')}`;
  }

  return {
    id: Buffer.from(dirPath).toString('base64url'),
    name: formatFolderTitle(folderName),
    category,
    folderName,
    folderPath: dirPath,
    relativeFolder,
    description,
    notes: meta.notes,
    tags: meta.tags,
    thumbnailPath: hasAutoThumb ? autoThumbPath : null,
    models,
    updatedAt: fs.statSync(dirPath).mtimeMs,
  };
}

/**
 * Recursively scans a root directory up to maxDepth to find all 3D object folders.
 * @param {string} rootPath
 * @param {number} maxDepth
 */
function scanLibraryFolder(rootPath, maxDepth = 5) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const results = [];

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    const item = inspectObjectFolder(currentDir, rootPath);
    if (item) results.push(item);

    let subEntries = [];
    try {
      subEntries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const sub of subEntries) {
      if (sub.isDirectory() && !sub.name.startsWith('.') && !IGNORED_DIRS.has(sub.name)) {
        walk(path.join(currentDir, sub.name), depth + 1);
      }
    }
  }

  walk(rootPath, 0);
  return results.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

module.exports = { scanLibraryFolder, scanLibraryFolderAsync, saveFolderMetadata, readCachedLibraryItems };
