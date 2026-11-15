import * as THREE from 'three';
import type { PlatePartBounds } from '../../types/plateTypes';

export interface OrientationCandidate {
  quaternion: THREE.Quaternion;
  offsetZ: number;
  contactAreaMm2: number;
  overhangAreaMm2: number;
  score: number;
  bounds: PlatePartBounds;
}

interface PrecomputedMeshTris {
  count: number;
  normals: Float32Array;
  areas: Float32Array;
  centers: Float32Array;
  sampleVertices: Float32Array;
}

const DOWN_VECTOR = new THREE.Vector3(0, 0, -1);
const UP_VECTOR = new THREE.Vector3(0, 0, 1);
const OVERHANG_COS_THRESHOLD = -0.7071; // cos(135°) -> ângulo > 45° requer suporte no fatiador

function precomputeMeshTriangles(geom: THREE.BufferGeometry): PrecomputedMeshTris {
  const posAttr = geom.attributes.position;
  if (!posAttr || posAttr.count < 3) {
    const empty = new Float32Array(0);
    return { count: 0, normals: empty, areas: empty, centers: empty, sampleVertices: empty };
  }

  const idxAttr = geom.index;
  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
  const normals = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);
  const centers = new Float32Array(triCount * 3);

  let validCount = 0;
  for (let i = 0; i < triCount; i++) {
    const i3 = i * 3;
    const iA = idxAttr ? idxAttr.getX(i3) : i3;
    const iB = idxAttr ? idxAttr.getX(i3 + 1) : i3 + 1;
    const iC = idxAttr ? idxAttr.getX(i3 + 2) : i3 + 2;

    const ax = posAttr.getX(iA), ay = posAttr.getY(iA), az = posAttr.getZ(iA);
    const bx = posAttr.getX(iB), by = posAttr.getY(iB), bz = posAttr.getZ(iB);
    const cx = posAttr.getX(iC), cy = posAttr.getY(iC), cz = posAttr.getZ(iC);

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const doubleArea = Math.hypot(nx, ny, nz);
    if (doubleArea < 1e-7) continue;

    const invLen = 1 / doubleArea;
    const out3 = validCount * 3;
    normals[out3] = nx * invLen;
    normals[out3 + 1] = ny * invLen;
    normals[out3 + 2] = nz * invLen;
    areas[validCount] = doubleArea * 0.5;
    centers[out3] = (ax + bx + cx) / 3;
    centers[out3 + 1] = (ay + by + cy) / 3;
    centers[out3 + 2] = (az + bz + cz) / 3;
    validCount++;
  }

  const vCount = posAttr.count;
  const vStep = Math.max(1, Math.floor(vCount / 4000));
  const sampleVertices = new Float32Array(Math.ceil(vCount / vStep) * 3);
  let svIdx = 0;
  for (let i = 0; i < vCount; i += vStep) {
    sampleVertices[svIdx++] = posAttr.getX(i);
    sampleVertices[svIdx++] = posAttr.getY(i);
    sampleVertices[svIdx++] = posAttr.getZ(i);
  }

  return {
    count: validCount,
    normals: normals.subarray(0, validCount * 3),
    areas: areas.subarray(0, validCount),
    centers: centers.subarray(0, validCount * 3),
    sampleVertices: sampleVertices.subarray(0, svIdx),
  };
}

function extractCandidateDownDirections(
  tris: PrecomputedMeshTris,
  preferredNormal?: [number, number, number] | null
): THREE.Vector3[] {
  const candidates: THREE.Vector3[] = [];
  const addUnique = (vec: THREE.Vector3) => {
    if (vec.lengthSq() < 0.5) return;
    const n = vec.clone().normalize();
    if (!candidates.some((c) => c.dot(n) > 0.985)) candidates.push(n);
  };

  if (preferredNormal) {
    const pref = new THREE.Vector3(...preferredNormal);
    addUnique(pref);
    addUnique(pref.clone().negate());
  }

  const buckets = new Map<string, { normal: THREE.Vector3; area: number }>();
  for (let i = 0; i < tris.count; i++) {
    const i3 = i * 3;
    const nx = tris.normals[i3], ny = tris.normals[i3 + 1], nz = tris.normals[i3 + 2];
    const area = tris.areas[i];
    const key = `${Math.round(nx * 20)}_${Math.round(ny * 20)}_${Math.round(nz * 20)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.area += area;
      existing.normal.addScaledVector(new THREE.Vector3(nx, ny, nz), area);
    } else {
      buckets.set(key, { normal: new THREE.Vector3(nx * area, ny * area, nz * area), area });
    }
  }

  const sortedClusters = Array.from(buckets.values()).sort((a, b) => b.area - a.area);
  for (const cluster of sortedClusters.slice(0, 12)) addUnique(cluster.normal);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx !== 0 || dy !== 0 || dz !== 0) addUnique(new THREE.Vector3(dx, dy, dz));
      }
    }
  }

  return candidates;
}

function scoreDownDirection(
  tris: PrecomputedMeshTris,
  downDir: THREE.Vector3
): { score: number; contactArea: number; overhangArea: number } {
  const ux = -downDir.x, uy = -downDir.y, uz = -downDir.z;
  let minZ = Infinity, maxZ = -Infinity;
  const sv = tris.sampleVertices;
  for (let i = 0; i < sv.length; i += 3) {
    const z = sv[i] * ux + sv[i + 1] * uy + sv[i + 2] * uz;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  let contactArea = 0;
  let overhangArea = 0;
  let floatingFlatArea = 0;
  let weightedZ = 0;
  let totalArea = 0;

  for (let i = 0; i < tris.count; i++) {
    const i3 = i * 3;
    const area = tris.areas[i];
    const nz = tris.normals[i3] * ux + tris.normals[i3 + 1] * uy + tris.normals[i3 + 2] * uz;
    const cz = tris.centers[i3] * ux + tris.centers[i3 + 1] * uy + tris.centers[i3 + 2] * uz;
    const zAboveBed = cz - minZ;

    totalArea += area;
    weightedZ += area * zAboveBed;

    if (zAboveBed <= 0.4 && nz < -0.92) {
      contactArea += area;
    } else if (zAboveBed > 0.4) {
      if (nz < -0.92 && zAboveBed > 0.85) {
        floatingFlatArea += area;
        overhangArea += area;
      } else if (nz < OVERHANG_COS_THRESHOLD) {
        overhangArea += area;
      }
    }
  }

  const height = Math.max(0, maxZ - minZ);
  const comZ = totalArea > 0 ? weightedZ / totalArea : height * 0.5;
  const score =
    contactArea * 3.0 - overhangArea * 2.4 - floatingFlatArea * 4.5 - comZ * 0.35 - height * 0.15;

  return { score, contactArea, overhangArea };
}

function findCompactYawQuaternion(
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  baseQuat: THREE.Quaternion
): THREE.Quaternion {
  const v = new THREE.Vector3();
  const yawAngles = [0, Math.PI / 6, Math.PI / 4, Math.PI / 3];
  let bestQuat = baseQuat.clone();
  let bestFootprint = Infinity;
  const step = Math.max(1, Math.floor(posAttr.count / 2000));

  for (const angle of yawAngles) {
    const candidateQuat = new THREE.Quaternion().setFromAxisAngle(UP_VECTOR, angle).multiply(baseQuat);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < posAttr.count; i += step) {
      v.fromBufferAttribute(posAttr, i).applyQuaternion(candidateQuat);
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const footprint = (maxX - minX) * (maxY - minY);
    if (footprint < bestFootprint) {
      bestFootprint = footprint;
      bestQuat = candidateQuat;
    }
  }
  return bestQuat;
}

function computeOrientedBounds(
  geom: THREE.BufferGeometry,
  baseQuat: THREE.Quaternion
): { bestQuat: THREE.Quaternion; bounds: PlatePartBounds; offsetZ: number } {
  const posAttr = geom.attributes.position;
  const bestQuat = findCompactYawQuaternion(posAttr, baseQuat);
  const v = new THREE.Vector3();

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).applyQuaternion(bestQuat);
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }

  return {
    bestQuat,
    offsetZ: -minZ,
    bounds: {
      width: maxX - minX,
      depth: maxY - minY,
      height: maxZ - minZ,
      minX, maxX, minY, maxY, minZ, maxZ,
    },
  };
}

/**
 * Calcula a orientação ideal da peça para assentamento na mesa com menor incidência de suportes.
 */
export function findOptimalBedOrientation(
  geometry: THREE.BufferGeometry,
  preferredCutNormal?: [number, number, number] | null
): OrientationCandidate {
  const tris = precomputeMeshTriangles(geometry);
  if (tris.count === 0) {
    return {
      quaternion: new THREE.Quaternion(),
      offsetZ: 0,
      contactAreaMm2: 0,
      overhangAreaMm2: 0,
      score: 0,
      bounds: { width: 0, depth: 0, height: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    };
  }

  const candidateDirs = extractCandidateDownDirections(tris, preferredCutNormal);
  let bestDown = candidateDirs[0] || DOWN_VECTOR;
  let bestStats = scoreDownDirection(tris, bestDown);

  for (let i = 1; i < candidateDirs.length; i++) {
    const dir = candidateDirs[i];
    const stats = scoreDownDirection(tris, dir);
    if (stats.score > bestStats.score) {
      bestStats = stats;
      bestDown = dir;
    }
  }

  const baseQuat = new THREE.Quaternion().setFromUnitVectors(bestDown, DOWN_VECTOR);
  const { bestQuat, bounds, offsetZ } = computeOrientedBounds(geometry, baseQuat);

  return {
    quaternion: bestQuat,
    offsetZ,
    contactAreaMm2: Math.round(bestStats.contactArea * 10) / 10,
    overhangAreaMm2: Math.round(bestStats.overhangArea * 10) / 10,
    score: Math.round(bestStats.score * 10) / 10,
    bounds,
  };
}
