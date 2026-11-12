const zlib = require('zlib');

const LOCAL_FILE_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const END_CENTRAL_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const ZIP_VERSION = 20;

const CRC_TABLE = buildCrc32Table();

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildLocalHeader(options) {
  const { nameBuf, crc, compressedLen, rawLen } = options;
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(LOCAL_FILE_SIG, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedLen, 18);
  header.writeUInt32LE(rawLen, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuf.copy(header, 30);
  return header;
}

function buildCentralHeader(meta) {
  const header = Buffer.alloc(46 + meta.nameBuf.length);
  header.writeUInt32LE(CENTRAL_DIR_SIG, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(meta.crc, 16);
  header.writeUInt32LE(meta.compressedLen, 20);
  header.writeUInt32LE(meta.rawLen, 24);
  header.writeUInt16LE(meta.nameBuf.length, 28);
  header.writeUInt32LE(meta.offset, 42);
  meta.nameBuf.copy(header, 46);
  return header;
}

function buildEndRecord(entryCount, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_CENTRAL_SIG, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return end;
}

/**
 * Compresses in-memory files into a valid ZIP/3MF Buffer using native Node.js zlib.
 * @param {Array<{ path: string, content: string | Buffer }>} entries
 * @returns {Buffer}
 */
function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path.replace(/\\/g, '/'), 'utf-8');
    const rawBuf = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf-8');
    const compressedBuf = zlib.deflateRawSync(rawBuf, { level: 6 });
    const crc = computeCrc32(rawBuf);
    const localHeader = buildLocalHeader({
      nameBuf,
      crc,
      compressedLen: compressedBuf.length,
      rawLen: rawBuf.length,
    });

    centralParts.push(
      buildCentralHeader({ nameBuf, crc, compressedLen: compressedBuf.length, rawLen: rawBuf.length, offset })
    );
    localParts.push(localHeader, compressedBuf);
    offset += localHeader.length + compressedBuf.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const endRecord = buildEndRecord(entries.length, centralBuffer.length, offset);
  return Buffer.concat([...localParts, centralBuffer, endRecord]);
}

module.exports = { createZipBuffer };

