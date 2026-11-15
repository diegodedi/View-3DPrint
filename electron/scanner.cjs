const fs = require('fs');
const path = require('path');
const { scanLibraryFolderAsync } = require('./scannerAsync.cjs');

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
 * Saves custom metadata (notes, tags, or PNG dataUrl thumbnail) inside the object folder.
 * @param {string} folderPath
 * @param {{ notes?: string, tags?: string[], customThumbnail?: string }} payload
 */
function saveFolderMetadata(folderPath, payload) {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('Pasta do objeto não encontrada.');
  }
  const current = readFolderMetadata(folderPath);
  const updated = {
    notes: payload.notes !== undefined ? payload.notes : current.notes,
    tags: payload.tags !== undefined ? payload.tags : current.tags,
  };

  let savedThumbPath = null;
  if (payload.customThumbnail && payload.customThumbnail.startsWith('data:image/')) {
    const base64Data = payload.customThumbnail.replace(/^data:image\/\w+;base64,/, '');
    savedThumbPath = path.join(folderPath, THUMB_FILE_NAME);
    fs.writeFileSync(savedThumbPath, Buffer.from(base64Data, 'base64'));
  }

  const metaPath = path.join(folderPath, META_FILE_NAME);
  fs.writeFileSync(metaPath, JSON.stringify(updated, null, 2), 'utf-8');
  return { ...updated, customThumbnail: savedThumbPath };
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

module.exports = { scanLibraryFolder, scanLibraryFolderAsync, saveFolderMetadata };
