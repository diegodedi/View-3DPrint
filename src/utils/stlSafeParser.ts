import * as THREE from 'three';

const STL_HEADER_BYTES = 80;
const STL_BINARY_MIN_BYTES = 84;
const STL_FACE_BYTES = 50;
const ASCII_PROBE_BYTES = 4096;

function decodeTextWithBom(bytes: Uint8Array): string {
  if (bytes.byteLength >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function hasNullByte(bytes: Uint8Array, limit: number): boolean {
  const end = Math.min(bytes.byteLength, limit);
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function isLikelyAsciiStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 15) return false;

  const isUtf16 =
    bytes.byteLength >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));

  if (bytes.byteLength >= STL_BINARY_MIN_BYTES && !isUtf16) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declaredFaces = view.getUint32(STL_HEADER_BYTES, true);
    if (declaredFaces > 0 && STL_BINARY_MIN_BYTES + declaredFaces * STL_FACE_BYTES === bytes.byteLength) {
      return false;
    }
  }

  const probeSlice = bytes.subarray(0, Math.min(bytes.byteLength, ASCII_PROBE_BYTES));
  if (!isUtf16 && hasNullByte(probeSlice, 256)) return false;

  const head = decodeTextWithBom(probeSlice).replace(/^\uFEFF/, '').trimStart();
  if (!/^solid\b/i.test(head)) return false;

  return /\bfacet\b|\bvertex\b|\bendsolid\b/i.test(head);
}

interface FaceNormalInput {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  rawNx: number; rawNy: number; rawNz: number;
}

function computeSafeFaceNormal(f: FaceNormalInput): [number, number, number] {
  if (Number.isFinite(f.rawNx) && Number.isFinite(f.rawNy) && Number.isFinite(f.rawNz)) {
    const rawLen = Math.hypot(f.rawNx, f.rawNy, f.rawNz);
    if (rawLen > 1e-6) {
      return [f.rawNx / rawLen, f.rawNy / rawLen, f.rawNz / rawLen];
    }
  }
  const ux = f.bx - f.ax, uy = f.by - f.ay, uz = f.bz - f.az;
  const vx = f.cx - f.ax, vy = f.cy - f.ay, vz = f.cz - f.az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-12) return [nx / len, ny / len, nz / len];
  return [0, 0, 1];
}

function parseBinaryStlSafe(bytes: Uint8Array): THREE.BufferGeometry {
  if (bytes.byteLength < STL_BINARY_MIN_BYTES) {
    throw new Error('Arquivo STL vazio ou corrompido (menor que 84 bytes).');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredFaces = view.getUint32(STL_HEADER_BYTES, true);
  const maxFaces = Math.floor((bytes.byteLength - STL_BINARY_MIN_BYTES) / STL_FACE_BYTES);
  const faceCount = declaredFaces > 0 ? Math.min(declaredFaces, maxFaces) : maxFaces;

  if (faceCount <= 0) {
    throw new Error('Arquivo STL não contém triângulos válidos.');
  }

  const positions = new Float32Array(faceCount * 9);
  const normals = new Float32Array(faceCount * 9);
  let writeIdx = 0;

  for (let face = 0; face < faceCount; face++) {
    const start = STL_BINARY_MIN_BYTES + face * STL_FACE_BYTES;
    const rawNx = view.getFloat32(start, true);
    const rawNy = view.getFloat32(start + 4, true);
    const rawNz = view.getFloat32(start + 8, true);

    const ax = view.getFloat32(start + 12, true);
    const ay = view.getFloat32(start + 16, true);
    const az = view.getFloat32(start + 20, true);
    const bx = view.getFloat32(start + 24, true);
    const by = view.getFloat32(start + 28, true);
    const bz = view.getFloat32(start + 32, true);
    const cx = view.getFloat32(start + 36, true);
    const cy = view.getFloat32(start + 40, true);
    const cz = view.getFloat32(start + 44, true);

    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      continue;
    }

    const [nx, ny, nz] = computeSafeFaceNormal({
      ax, ay, az, bx, by, bz, cx, cy, cz, rawNx, rawNy, rawNz,
    });

    positions[writeIdx] = ax; positions[writeIdx + 1] = ay; positions[writeIdx + 2] = az;
    positions[writeIdx + 3] = bx; positions[writeIdx + 4] = by; positions[writeIdx + 5] = bz;
    positions[writeIdx + 6] = cx; positions[writeIdx + 7] = cy; positions[writeIdx + 8] = cz;

    normals[writeIdx] = nx; normals[writeIdx + 1] = ny; normals[writeIdx + 2] = nz;
    normals[writeIdx + 3] = nx; normals[writeIdx + 4] = ny; normals[writeIdx + 5] = nz;
    normals[writeIdx + 6] = nx; normals[writeIdx + 7] = ny; normals[writeIdx + 8] = nz;
    writeIdx += 9;
  }

  if (writeIdx < 9) {
    throw new Error('Arquivo STL contém apenas coordenadas inválidas.');
  }

  const finalPositions = writeIdx === positions.length ? positions : positions.slice(0, writeIdx);
  const finalNormals = writeIdx === normals.length ? normals : normals.slice(0, writeIdx);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(finalNormals, 3));
  return geometry;
}

function parseLocaleFloat(token: string): number {
  const num = Number(token);
  if (Number.isFinite(num)) return num;
  if (token.includes(',')) return Number(token.replace(',', '.'));
  return NaN;
}

function parseAsciiStlSafe(bytes: Uint8Array): THREE.BufferGeometry {
  const text = decodeTextWithBom(bytes);
  const lines = text.split(/\r?\n/);
  const positions: number[] = [];
  const normals: number[] = [];
  const faceVerts: number[] = [];
  let curNx = 0, curNy = 0, curNz = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const lower = line.toLowerCase();

    if (lower.startsWith('facet')) {
      faceVerts.length = 0;
      const parts = line.split(/\s+/);
      const nIdx = parts.findIndex((p) => p.toLowerCase() === 'normal');
      if (nIdx >= 0 && parts.length >= nIdx + 4) {
        curNx = parseLocaleFloat(parts[nIdx + 1]);
        curNy = parseLocaleFloat(parts[nIdx + 2]);
        curNz = parseLocaleFloat(parts[nIdx + 3]);
      } else {
        curNx = 0; curNy = 0; curNz = 0;
      }
      continue;
    }

    if (lower.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      const x = parseLocaleFloat(parts[1]);
      const y = parseLocaleFloat(parts[2]);
      const z = parseLocaleFloat(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      faceVerts.push(x, y, z);

      if (faceVerts.length === 9) {
        const [nx, ny, nz] = computeSafeFaceNormal({
          ax: faceVerts[0], ay: faceVerts[1], az: faceVerts[2],
          bx: faceVerts[3], by: faceVerts[4], bz: faceVerts[5],
          cx: faceVerts[6], cy: faceVerts[7], cz: faceVerts[8],
          rawNx: curNx, rawNy: curNy, rawNz: curNz,
        });
        positions.push(
          faceVerts[0], faceVerts[1], faceVerts[2],
          faceVerts[3], faceVerts[4], faceVerts[5],
          faceVerts[6], faceVerts[7], faceVerts[8]
        );
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        faceVerts.length = 0;
      }
    }
  }

  if (positions.length < 9) {
    throw new Error('Arquivo STL ASCII não contém triângulos válidos.');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/**
 * Ensures a BufferGeometry has finite, non-zero vertex normals (protects against zeroed STL normals).
 */
export function ensureValidGeometryNormals(geometry: THREE.BufferGeometry): void {
  const normAttr = geometry.attributes.normal;
  if (!normAttr || normAttr.count === 0) {
    geometry.computeVertexNormals();
    return;
  }

  const arr = normAttr.array as ArrayLike<number>;
  const sampleCount = Math.min(normAttr.count, 64);
  const step = Math.max(1, Math.floor(normAttr.count / sampleCount));
  let validSamples = 0;

  for (let i = 0; i < normAttr.count; i += step) {
    const j = i * 3;
    const nx = arr[j], ny = arr[j + 1], nz = arr[j + 2];
    if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz) && nx * nx + ny * ny + nz * nz > 1e-8) {
      validSamples++;
    }
  }

  if (validSamples === 0) {
    geometry.computeVertexNormals();
  }
}

/**
 * Parses binary or ASCII STL buffers safely, handling solid-prefixed binaries, padding,
 * truncated files, case-insensitive ASCII, zero normals, and NaN/Infinity vertices.
 */
export function parseStlBufferSafe(buffer: ArrayBuffer | Uint8Array): THREE.BufferGeometry {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength === 0) {
    throw new Error('Arquivo STL vazio.');
  }

  if (isLikelyAsciiStl(bytes)) {
    try {
      return parseAsciiStlSafe(bytes);
    } catch (asciiErr) {
      if (bytes.byteLength >= STL_BINARY_MIN_BYTES) {
        return parseBinaryStlSafe(bytes);
      }
      throw asciiErr;
    }
  }

  return parseBinaryStlSafe(bytes);
}
