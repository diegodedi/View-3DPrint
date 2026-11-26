const MAX_HASH_TABLE_SIZE = 1 << 22;

export interface WeldResult {
  weldedOf: Int32Array;
  weldedCount: number;
  span: number;
}

export interface FaceAngleData {
  faceNormals: Float32Array;
  cornerAngles: Float32Array;
}

function nextPowerOfTwo(target: number): number {
  let size = 1024;
  while (size < target && size < MAX_HASH_TABLE_SIZE) size <<= 1;
  return size;
}

/**
 * Spatially welds vertices within a scale-proportional tolerance into canonical vertex IDs.
 */
export function weldVertexPositions(posArray: ArrayLike<number>, vertexCount: number): WeldResult {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let v = 0; v < vertexCount; v++) {
    const i = v * 3;
    const x = posArray[i], y = posArray[i + 1], z = posArray[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const invCell = 100000 / span;
  const epsSq = (span * 2e-5) * (span * 2e-5);

  const tableSize = nextPowerOfTwo(vertexCount * 2);
  const tableMask = tableSize - 1;
  const head = new Int32Array(tableSize).fill(-1);
  const nextWelded = new Int32Array(vertexCount).fill(-1);
  const weldedOf = new Int32Array(vertexCount);
  const repVertex = new Int32Array(vertexCount);
  let weldedCount = 0;

  for (let v = 0; v < vertexCount; v++) {
    const pIdx = v * 3;
    const vx = posArray[pIdx], vy = posArray[pIdx + 1], vz = posArray[pIdx + 2];
    const qx = Math.round((vx - minX) * invCell);
    const qy = Math.round((vy - minY) * invCell);
    const qz = Math.round((vz - minZ) * invCell);
    const bucket = (((qx * 73856093) ^ (qy * 19349663) ^ (qz * 83492791)) | 0) & tableMask;

    let foundW = -1;
    let currW = head[bucket];
    while (currW !== -1) {
      const rIdx = repVertex[currW] * 3;
      const dx = posArray[rIdx] - vx;
      const dy = posArray[rIdx + 1] - vy;
      const dz = posArray[rIdx + 2] - vz;
      if (dx * dx + dy * dy + dz * dz <= epsSq) {
        foundW = currW;
        break;
      }
      currW = nextWelded[currW];
    }

    if (foundW === -1) {
      foundW = weldedCount++;
      repVertex[foundW] = v;
      nextWelded[foundW] = head[bucket];
      head[bucket] = foundW;
    }
    weldedOf[v] = foundW;
  }

  return { weldedOf, weldedCount, span };
}

/**
 * Computes unit face normals and internal corner angles (radians) for angle-weighted smoothing.
 */
export function computeFacesAndAngles(
  posArray: ArrayLike<number>,
  idxArray: ArrayLike<number> | null,
  triCount: number
): FaceAngleData {
  const faceNormals = new Float32Array(triCount * 3);
  const cornerAngles = new Float32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const v0 = idxArray ? idxArray[t3] : t3;
    const v1 = idxArray ? idxArray[t3 + 1] : t3 + 1;
    const v2 = idxArray ? idxArray[t3 + 2] : t3 + 2;

    const i0 = v0 * 3, i1 = v1 * 3, i2 = v2 * 3;
    const ax = posArray[i0], ay = posArray[i0 + 1], az = posArray[i0 + 2];
    const abx = posArray[i1] - ax, aby = posArray[i1 + 1] - ay, abz = posArray[i1 + 2] - az;
    const acx = posArray[i2] - ax, acy = posArray[i2 + 1] - ay, acz = posArray[i2 + 2] - az;
    const bcx = posArray[i2] - posArray[i1], bcy = posArray[i2 + 1] - posArray[i1 + 1], bcz = posArray[i2 + 2] - posArray[i1 + 2];

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len; ny /= len; nz /= len;
    }
    faceNormals[t3] = nx; faceNormals[t3 + 1] = ny; faceNormals[t3 + 2] = nz;

    const abLen = Math.hypot(abx, aby, abz);
    const acLen = Math.hypot(acx, acy, acz);
    const bcLen = Math.hypot(bcx, bcy, bcz);
    if (abLen > 1e-12 && acLen > 1e-12 && bcLen > 1e-12) {
      const a0 = Math.acos(Math.max(-1, Math.min(1, (abx * acx + aby * acy + abz * acz) / (abLen * acLen))));
      const a1 = Math.acos(Math.max(-1, Math.min(1, (-abx * bcx - aby * bcy - abz * bcz) / (abLen * bcLen))));
      cornerAngles[t3] = a0;
      cornerAngles[t3 + 1] = a1;
      cornerAngles[t3 + 2] = Math.max(0.001, Math.PI - a0 - a1);
    } else {
      cornerAngles[t3] = 1; cornerAngles[t3 + 1] = 1; cornerAngles[t3 + 2] = 1;
    }
  }
  return { faceNormals, cornerAngles };
}
