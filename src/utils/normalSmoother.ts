import * as THREE from 'three';

const MAX_HASH_TABLE_SIZE = 1 << 22;

function nextPowerOfTwo(target: number): number {
  let size = 1024;
  while (size < target && size < MAX_HASH_TABLE_SIZE) size <<= 1;
  return size;
}

/**
 * Calcula normais suaves com Crease Angle E o atributo de curvatura multi-escala `aCavity`
 * (`vec3(valleyTight, valleyWide, ridge)`) diretamente na geometria, SEM alterar `position` ou `index`.
 * Garante fidelidade 1:1 ao Cavity do Blender Workbench (Imagens 2, 3 e 4).
 */
export function computeCreasedNormalsInPlace(
  geometry: THREE.BufferGeometry,
  creaseAngleDeg: number = 68
): void {
  const posAttr = geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) return;

  const vertexCount = posAttr.count;
  const idxAttr = geometry.index;
  const idxArray = idxAttr ? (idxAttr.array as ArrayLike<number>) : null;
  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(vertexCount / 3);
  if (triCount === 0) return;

  if (triCount > 600000) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return;
  }

  const posArray = posAttr.array as ArrayLike<number>;
  const faceNormals = new Float32Array(triCount * 3);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let v = 0; v < vertexCount; v++) {
    const i = v * 3;
    const x = posArray[i], y = posArray[i + 1], z = posArray[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // 1. Soldagem espacial rápida (mapeia cada vértice v -> weldedOf[v])
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const invCell = 100000 / span;
  const epsSq = (span * 1e-4) * (span * 1e-4);

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

  // 2. Normais das faces e normal suave contínua por vértice soldado (para cálculo de curvatura)
  const wNormals = new Float32Array(weldedCount * 3);
  const triWelded = new Int32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const v0 = idxArray ? idxArray[t3] : t3;
    const v1 = idxArray ? idxArray[t3 + 1] : t3 + 1;
    const v2 = idxArray ? idxArray[t3 + 2] : t3 + 2;

    const i0 = v0 * 3, i1 = v1 * 3, i2 = v2 * 3;
    const ax = posArray[i0], ay = posArray[i0 + 1], az = posArray[i0 + 2];
    const abx = posArray[i1] - ax, aby = posArray[i1 + 1] - ay, abz = posArray[i1 + 2] - az;
    const acx = posArray[i2] - ax, acy = posArray[i2 + 1] - ay, acz = posArray[i2 + 2] - az;

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      const invLen = 1 / len;
      nx *= invLen; ny *= invLen; nz *= invLen;
    }
    faceNormals[t3] = nx;
    faceNormals[t3 + 1] = ny;
    faceNormals[t3 + 2] = nz;

    const w0 = weldedOf[v0], w1 = weldedOf[v1], w2 = weldedOf[v2];
    triWelded[t3] = w0; triWelded[t3 + 1] = w1; triWelded[t3 + 2] = w2;

    wNormals[w0 * 3] += nx; wNormals[w0 * 3 + 1] += ny; wNormals[w0 * 3 + 2] += nz;
    wNormals[w1 * 3] += nx; wNormals[w1 * 3 + 1] += ny; wNormals[w1 * 3 + 2] += nz;
    wNormals[w2 * 3] += nx; wNormals[w2 * 3 + 1] += ny; wNormals[w2 * 3 + 2] += nz;
  }

  for (let w = 0; w < weldedCount; w++) {
    const w3 = w * 3;
    const x = wNormals[w3], y = wNormals[w3 + 1], z = wNormals[w3 + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-12) {
      const invLen = 1 / len;
      wNormals[w3] = x * invLen; wNormals[w3 + 1] = y * invLen; wNormals[w3 + 2] = z * invLen;
    }
  }

  // 3. Curvatura discreta adimensional por aresta: c = dot(N_b - N_a, normalize(P_b - P_a))
  const valleySum = new Float32Array(weldedCount);
  const ridgeSum = new Float32Array(weldedCount);
  const edgeCnt = new Uint16Array(weldedCount);

  const accumEdge = (wa: number, wb: number) => {
    if (wa === wb) return;
    const pa = repVertex[wa] * 3, pb = repVertex[wb] * 3;
    const dx = posArray[pb] - posArray[pa];
    const dy = posArray[pb + 1] - posArray[pa + 1];
    const dz = posArray[pb + 2] - posArray[pa + 2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-9) return;

    const na = wa * 3, nb = wb * 3;
    const dnx = wNormals[nb] - wNormals[na];
    const dny = wNormals[nb + 1] - wNormals[na + 1];
    const dnz = wNormals[nb + 2] - wNormals[na + 2];

    const curv = (dnx * dx + dny * dy + dnz * dz) / dist;
    if (curv < -0.015) {
      const val = -curv;
      valleySum[wa] += val;
      valleySum[wb] += val;
    } else if (curv > 0.02) {
      ridgeSum[wa] += curv;
      ridgeSum[wb] += curv;
    }
    edgeCnt[wa]++;
    edgeCnt[wb]++;
  };

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const w0 = triWelded[t3], w1 = triWelded[t3 + 1], w2 = triWelded[t3 + 2];
    accumEdge(w0, w1);
    accumEdge(w1, w2);
    accumEdge(w2, w0);
  }

  const valleyTight = new Float32Array(weldedCount);
  let valleyWide = new Float32Array(weldedCount);
  const ridgeArr = new Float32Array(weldedCount);

  for (let w = 0; w < weldedCount; w++) {
    const cnt = Math.max(edgeCnt[w], 1);
    const vRaw = Math.min(1.0, (valleySum[w] / cnt) * 2.6);
    const rRaw = Math.min(1.0, (ridgeSum[w] / cnt) * 2.2);
    valleyTight[w] = vRaw;
    valleyWide[w] = vRaw;
    ridgeArr[w] = rRaw;
  }

  // 4. Difusão topológica multi-anel adaptativa para o Cavity Distance (espalhamento em cavidades largas)
  const diffusionPasses = triCount > 300000 ? 6 : triCount > 150000 ? 8 : 10;
  let nextWide = new Float32Array(weldedCount);
  const ringCnt = new Uint16Array(weldedCount);

  for (let pass = 0; pass < diffusionPasses; pass++) {
    nextWide.fill(0);
    ringCnt.fill(0);
    for (let t = 0; t < triCount; t++) {
      const t3 = t * 3;
      const w0 = triWelded[t3], w1 = triWelded[t3 + 1], w2 = triWelded[t3 + 2];
      const avg = (valleyWide[w0] + valleyWide[w1] + valleyWide[w2]) / 3;
      nextWide[w0] += avg; ringCnt[w0]++;
      nextWide[w1] += avg; ringCnt[w1]++;
      nextWide[w2] += avg; ringCnt[w2]++;
    }
    for (let w = 0; w < weldedCount; w++) {
      const diffused = ringCnt[w] > 0 ? nextWide[w] / ringCnt[w] : valleyWide[w];
      valleyWide[w] = Math.min(1.0, Math.max(valleyTight[w], diffused * 1.12));
    }
    if (pass === 0) {
      for (let w = 0; w < weldedCount; w++) {
        valleyTight[w] = Math.min(1.0, valleyTight[w] * 0.7 + valleyWide[w] * 0.3);
      }
    }
  }

  // 5. Grava atributo `aCavity` (valleyTight, valleyWide, ridge) e normais com Crease Angle
  const outCavity = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const w = weldedOf[v];
    const v3 = v * 3;
    outCavity[v3] = valleyTight[w];
    outCavity[v3 + 1] = valleyWide[w];
    outCavity[v3 + 2] = ridgeArr[w];
  }
  geometry.setAttribute('aCavity', new THREE.BufferAttribute(outCavity, 3));

  if (idxAttr) {
    geometry.computeVertexNormals();
    return;
  }

  const cosThreshold = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const outNormals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const w = weldedOf[v];
    const tSelf = Math.floor(v / 3) * 3;
    const fnx = faceNormals[tSelf], fny = faceNormals[tSelf + 1], fnz = faceNormals[tSelf + 2];
    const wn3 = w * 3;
    const wnx = wNormals[wn3], wny = wNormals[wn3 + 1], wnz = wNormals[wn3 + 2];
    const dot = fnx * wnx + fny * wny + fnz * wnz;
    const v3 = v * 3;
    if (dot >= cosThreshold) {
      outNormals[v3] = wnx; outNormals[v3 + 1] = wny; outNormals[v3 + 2] = wnz;
    } else {
      outNormals[v3] = fnx; outNormals[v3 + 1] = fny; outNormals[v3 + 2] = fnz;
    }
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(outNormals, 3));
}
