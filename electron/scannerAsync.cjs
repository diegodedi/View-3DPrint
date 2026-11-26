const fs = require('fs');
const path = require('path');
const { loadScannerCache, saveScannerCache } = require('./scannerCache.cjs');
const {
  computeAutoThumbCacheKey,
  listCachedThumbFiles,
  resolveCachedThumbPath,
} = require('./thumbCache.cjs');

const MODEL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '__MACOSX', '$RECYCLE.BIN', 'System Volume Information']);
const META_FILE_NAME = '.view3dprint.json';
const THUMB_FILE_NAME = '.view3dprint-matcap-v2.jpg';
const DESCRIPTION_MAX_BYTES = 2048;
const SCAN_CONCURRENCY = 16;

function formatFolderTitle(folderName) {
  return folderName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function readDescriptionHeadAsync(filePath) {
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(DESCRIPTION_MAX_BYTES);
    const { bytesRead } = await fh.read(buf, 0, DESCRIPTION_MAX_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf-8').trim();
  } catch {
    return '';
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

async function readFolderMetaAsync(metaPath) {
  try {
    const raw = await fs.promises.readFile(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { notes: '', tags: [] };
  }
}

async function buildItemFromEntries(params) {
  const { dirPath, rootPath, entries, dirMtimeMs, metaMtimeMs, hasThumb, cacheDir, thumbFileSet } = params;
  const modelFiles = [];
  const textFiles = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const fullPath = path.join(dirPath, entry.name);

    if (MODEL_EXTENSIONS.has(ext)) {
      modelFiles.push({ name: entry.name, fullPath, ext });
    } else if (
      entry.name.startsWith('.view3dprint') &&
      entry.name !== THUMB_FILE_NAME &&
      entry.name !== META_FILE_NAME
    ) {
      fs.promises.unlink(fullPath).catch(() => {});
    } else if (TEXT_EXTENSIONS.has(ext)) {
      textFiles.push(fullPath);
    }
  }

  if (modelFiles.length === 0) return null;

  const models = await Promise.all(
    modelFiles.map(async (f) => {
      const stat = await fs.promises.stat(f.fullPath);
      return {
        name: f.name,
        path: f.fullPath,
        extension: f.ext.replace('.', '').toUpperCase(),
        sizeBytes: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs),
      };
    })
  );

  const metaPath = path.join(dirPath, META_FILE_NAME);
  const [descriptionRaw, meta] = await Promise.all([
    textFiles.length > 0 ? readDescriptionHeadAsync(textFiles[0]) : Promise.resolve(''),
    metaMtimeMs > 0 ? readFolderMetaAsync(metaPath) : Promise.resolve({ notes: '', tags: [] }),
  ]);

  const folderName = path.basename(dirPath);
  const relativeFolder = path.relative(rootPath, dirPath) || folderName;
  const segments = relativeFolder.split(path.sep).filter(Boolean);
  const category = segments.length > 1 ? formatFolderTitle(segments[0]) : 'Geral';
  const description = descriptionRaw || `${models.length} arquivo(s): ${models.map((m) => m.name).join(', ')}`;
  const thumbCacheKey = computeAutoThumbCacheKey(dirPath, models[0]);
  const legacyThumbPath = hasThumb ? path.join(dirPath, THUMB_FILE_NAME) : null;
  const resolvedThumb = resolveCachedThumbPath({
    cacheDir,
    thumbFileSet,
    folderPath: dirPath,
    cacheKey: thumbCacheKey,
    legacyPath: legacyThumbPath,
  });

  const latestModelMtimeMs = models.reduce((max, m) => Math.max(max, m.mtimeMs || 0), 0);
  const updatedAt = Math.max(dirMtimeMs || 0, latestModelMtimeMs);

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
    thumbnailPath: resolvedThumb,
    thumbCacheKey,
    models,
    updatedAt,
  };
}

/**
 * Recursively scans a root directory asynchronously with bounded concurrency and mtime cache.
 * @param {string} rootPath
 * @param {{ maxDepth?: number, cacheDir?: string }} [options]
 */
async function scanLibraryFolderAsync(rootPath, options = {}) {
  const { maxDepth = 5, cacheDir = null } = options;
  if (!rootPath) return [];
  try {
    await fs.promises.access(rootPath);
  } catch {
    return [];
  }

  const [prevCache, thumbFileSet] = await Promise.all([
    loadScannerCache(cacheDir, rootPath),
    listCachedThumbFiles(cacheDir),
  ]);
  const nextCache = {};
  const results = [];
  const queue = [{ dirPath: rootPath, depth: 0 }];

  async function processDir(dirPath, depth) {
    let entries;
    let dirStat;
    try {
      [entries, dirStat] = await Promise.all([
        fs.promises.readdir(dirPath, { withFileTypes: true }),
        fs.promises.stat(dirPath),
      ]);
    } catch {
      return;
    }

    let hasMeta = false;
    let hasThumb = false;
    let hasModelCandidate = false;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < maxDepth && !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name)) {
          queue.push({ dirPath: path.join(dirPath, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === META_FILE_NAME) hasMeta = true;
      else if (entry.name === THUMB_FILE_NAME) hasThumb = true;
      else if (MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) hasModelCandidate = true;
    }

    if (!hasModelCandidate) return;

    let metaMtimeMs = 0;
    if (hasMeta) {
      try {
        metaMtimeMs = (await fs.promises.stat(path.join(dirPath, META_FILE_NAME))).mtimeMs;
      } catch {
        metaMtimeMs = 0;
      }
    }

    const dirMtimeMs = dirStat.mtimeMs;
    const cached = prevCache[dirPath];
    if (
      cached &&
      cached.dirMtimeMs === dirMtimeMs &&
      cached.metaMtimeMs === metaMtimeMs &&
      cached.hasThumb === hasThumb &&
      cached.item
    ) {
      const legacyThumbPath = hasThumb ? path.join(dirPath, THUMB_FILE_NAME) : null;
      const cacheKey = cached.item.thumbCacheKey || computeAutoThumbCacheKey(dirPath, cached.item.models?.[0]);
      const resolvedThumb = resolveCachedThumbPath({
        cacheDir,
        thumbFileSet,
        folderPath: dirPath,
        cacheKey,
        legacyPath: legacyThumbPath,
      });
      const latestCachedModelMtime = Array.isArray(cached.item.models)
        ? cached.item.models.reduce((max, m) => Math.max(max, m.mtimeMs || 0), 0)
        : 0;
      const updatedAt = Math.max(cached.item.updatedAt || 0, dirMtimeMs || 0, latestCachedModelMtime);
      const hydratedItem = { ...cached.item, thumbCacheKey: cacheKey, thumbnailPath: resolvedThumb, updatedAt };
      nextCache[dirPath] = { ...cached, item: hydratedItem };
      results.push(hydratedItem);
      return;
    }

    const item = await buildItemFromEntries({
      dirPath,
      rootPath,
      entries,
      dirMtimeMs,
      metaMtimeMs,
      hasThumb,
      cacheDir,
      thumbFileSet,
    });
    if (item) {
      nextCache[dirPath] = { dirMtimeMs, metaMtimeMs, hasThumb, item };
      results.push(item);
    }
  }

  let active = 0;
  await new Promise((resolve) => {
    function pump() {
      while (active < SCAN_CONCURRENCY && queue.length > 0) {
        const next = queue.shift();
        active++;
        processDir(next.dirPath, next.depth).finally(() => {
          active--;
          if (queue.length === 0 && active === 0) resolve();
          else pump();
        });
      }
      if (queue.length === 0 && active === 0) resolve();
    }
    pump();
  });

  saveScannerCache(cacheDir, rootPath, nextCache);
  return results.sort(
    (a, b) => ((b.updatedAt || 0) - (a.updatedAt || 0)) || a.name.localeCompare(b.name, 'pt-BR')
  );
}

module.exports = { scanLibraryFolderAsync };

