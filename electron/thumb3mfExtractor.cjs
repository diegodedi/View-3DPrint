const fs = require('fs');
const zlib = require('zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CD_ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_TAIL_READ = 65557;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

function detectImageExtFromMagic(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return '.webp';
  }
  return null;
}

function scoreThumbEntryName(rawName) {
  const lower = rawName.toLowerCase().replace(/\\/g, '/');
  if (!/\.(png|jpe?g|webp)$/.test(lower)) return -1;
  if (lower.includes('_small') || lower.includes('pick_') || lower.includes('top_')) {
    return lower.includes('metadata/') ? 10 : 5;
  }
  if (lower === 'metadata/plate_1.png') return 100;
  if (lower === 'metadata/thumbnail.png' || lower === 'thumbnail.png') return 90;
  if (lower.startsWith('metadata/plate_1.')) return 85;
  if (lower.startsWith('metadata/plate_')) return 75;
  if (lower.includes('thumbnail') || lower.includes('preview')) return 60;
  return -1;
}

function findEocdOffset(tailBuf) {
  for (let i = tailBuf.length - 22; i >= 0; i--) {
    if (tailBuf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function pickBestThumbEntry(cdBuf) {
  let offset = 0;
  let best = null;
  while (offset + 46 <= cdBuf.length) {
    if (cdBuf.readUInt32LE(offset) !== CD_ENTRY_SIGNATURE) break;
    const method = cdBuf.readUInt16LE(offset + 10);
    const compressedSize = cdBuf.readUInt32LE(offset + 20);
    const uncompressedSize = cdBuf.readUInt32LE(offset + 24);
    const nameLen = cdBuf.readUInt16LE(offset + 28);
    const extraLen = cdBuf.readUInt16LE(offset + 30);
    const commentLen = cdBuf.readUInt16LE(offset + 32);
    const localHeaderOffset = cdBuf.readUInt32LE(offset + 42);
    const name = cdBuf.toString('utf-8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if ((method !== 0 && method !== 8) || uncompressedSize === 0 || uncompressedSize > MAX_THUMB_BYTES) {
      continue;
    }
    const score = scoreThumbEntryName(name);
    if (score > 0 && (!best || score > best.score)) {
      best = { score, method, compressedSize, uncompressedSize, localHeaderOffset };
    }
  }
  return best;
}

/**
 * Extracts an embedded preview image (PNG/JPG/WebP) from a .3mf ZIP archive by reading only its Central Directory.
 * @param {string} filePath
 * @returns {Promise<{ buffer: Buffer, ext: string } | null>}
 */
async function extract3mfEmbeddedThumbnail(filePath) {
  if (!filePath || !filePath.toLowerCase().endsWith('.3mf')) return null;
  let fh;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const stat = await fh.stat();
    if (stat.size < 22) return null;

    const tailSize = Math.min(stat.size, MAX_TAIL_READ);
    const tailBuf = Buffer.allocUnsafe(tailSize);
    await fh.read(tailBuf, 0, tailSize, stat.size - tailSize);

    const eocdPos = findEocdOffset(tailBuf);
    if (eocdPos < 0) return null;

    const cdSize = tailBuf.readUInt32LE(eocdPos + 12);
    const cdOffset = tailBuf.readUInt32LE(eocdPos + 16);
    if (cdSize === 0 || cdSize > 4 * 1024 * 1024 || cdOffset + cdSize > stat.size) return null;

    const cdBuf = Buffer.allocUnsafe(cdSize);
    await fh.read(cdBuf, 0, cdSize, cdOffset);
    const entry = pickBestThumbEntry(cdBuf);
    if (!entry) return null;

    const localHdr = Buffer.allocUnsafe(30);
    await fh.read(localHdr, 0, 30, entry.localHeaderOffset);
    if (localHdr.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) return null;

    const localNameLen = localHdr.readUInt16LE(26);
    const localExtraLen = localHdr.readUInt16LE(28);
    const dataOffset = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawData = Buffer.allocUnsafe(entry.compressedSize);
    await fh.read(rawData, 0, entry.compressedSize, dataOffset);

    const imgBuf = entry.method === 8 ? zlib.inflateRawSync(rawData) : rawData;
    const ext = detectImageExtFromMagic(imgBuf);
    if (!ext) return null;
    return { buffer: imgBuf, ext };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

module.exports = { extract3mfEmbeddedThumbnail };
