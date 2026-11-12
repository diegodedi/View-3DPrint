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

const DOWN_VECTOR = new THREE.Vector3(0, 0, -1);
const OVERHANG_COS_THRESHOLD = -0.7071; // cos(135 deg) -> ângulo normal com o plano horizontal < 45 deg

function getTriangleCount(geom: THREE.BufferGeometry): number {
  if (geom.index) return Math.floor(geom.index.count / 3);
  if (geom.attributes.position) return Math.floor(geom.attributes.position.count / 3);
  return 0;
}

function getTriangleIndices(geom: THREE.BufferGeometry, triIdx: number): [number, number, number] {
  const i3 = triIdx * 3;
  if (geom.index) {
    return [geom.index.getX(i3), geom.index.getX(i3 + 1), geom.index.getX(i3 + 2)];
  }
  return [i3, i3 + 1, i3 + 2];
}

/**
 * Extrai normais candidatas agrupando faces coplanares por direção.
 */
function extractCandidateNormals(
  geom: THREE.BufferGeometry,
  preferredNormal?: [number, number, number] | null
): THREE.Vector3[] {
  const candidates: THREE.Vector3[] = [];
  if (preferredNormal) {
    const pref = new THREE.Vector3(...preferredNormal).normalize();
    if (pref.lengthSq() > 0.5) candidates.push(pref);
    candidates.push(pref.clone().negate());
  }

  // Direções canônicas de fallback
  const canonicalAxes = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
  ];

  canonicalAxes.forEach((axis) => {
    if (!candidates.some((c) => c.dot(axis) > 0.95)) {
      candidates.push(axis);
    }
  });

  const posAttr = geom.attributes.position;
  const triangleCount = getTriangleCount(geom);
  if (!posAttr || triangleCount < 1) return candidates;

  const normalBuckets = new Map<string, { normal: THREE.Vector3; area: number }>();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  const step = Math.max(1, Math.floor(triangleCount / 3000));

  for (let i = 0; i < triangleCount; i += step) {
    const [iA, iB, iC] = getTriangleIndices(geom, i);
    vA.fromBufferAttribute(posAttr, iA);
    vB.fromBufferAttribute(posAttr, iB);
    vC.fromBufferAttribute(posAttr, iC);

    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    faceNormal.crossVectors(edge1, edge2);
    const doubleArea = faceNormal.length();
    if (doubleArea < 1e-6) continue;

    const area = doubleArea * 0.5;
    faceNormal.multiplyScalar(1 / doubleArea);

    const quantX = Math.round(faceNormal.x * 10) / 10;
    const quantY = Math.round(faceNormal.y * 10) / 10;
    const quantZ = Math.round(faceNormal.z * 10) / 10;
    const key = `${quantX}_${quantY}_${quantZ}`;

    const existing = normalBuckets.get(key);
    if (existing) {
      existing.area += area;
    } else {
      normalBuckets.set(key, { normal: faceNormal.clone(), area });
    }
  }

  const sortedBuckets = Array.from(normalBuckets.values()).sort((a, b) => b.area - a.area);
  for (const b of sortedBuckets.slice(0, 6)) {
    if (!candidates.some((c) => c.dot(b.normal) > 0.92)) {
      candidates.push(b.normal.normalize());
    }
  }

  return candidates;
}

/**
 * Avalia uma rotação candidata, calculando a área de contato com a mesa e área de balanços críticos.
 */
function evaluateCandidate(geom: THREE.BufferGeometry, quat: THREE.Quaternion): OrientationCandidate {
  const posAttr = geom.attributes.position;
  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i).applyQuaternion(quat);
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }

  const offsetZ = -minZ; // translada para que o ponto mais baixo fique em Z = 0
  const height = maxZ - minZ;
  const width = maxX - minX;
  const depth = maxY - minY;

  let contactArea = 0;
  let overhangArea = 0;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const triangleCount = getTriangleCount(geom);
  const sampleStep = Math.max(1, Math.floor(triangleCount / 1500));

  for (let i = 0; i < triangleCount; i += sampleStep) {
    const [iA, iB, iC] = getTriangleIndices(geom, i);
    vA.fromBufferAttribute(posAttr, iA).applyQuaternion(quat);
    vB.fromBufferAttribute(posAttr, iB).applyQuaternion(quat);
    vC.fromBufferAttribute(posAttr, iC).applyQuaternion(quat);

    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    normal.crossVectors(e1, e2);
    const doubleArea = normal.length();
    if (doubleArea < 1e-6) continue;

    const area = doubleArea * 0.5 * sampleStep;
    normal.multiplyScalar(1 / doubleArea);

    const avgZ = (vA.z + vB.z + vC.z) / 3 + offsetZ;
    const isCloseToBed = avgZ < 0.4;

    if (normal.z < -0.9 && isCloseToBed) {
      contactArea += area;
    } else if (normal.z < OVERHANG_COS_THRESHOLD && !isCloseToBed) {
      overhangArea += area;
    }
  }

  // Pontuação: maximizar contato na mesa, minimizar balanços no ar e altura z desnecessária
  const score = contactArea * 2.5 - overhangArea * 1.8 - height * 0.15;

  return {
    quaternion: quat,
    offsetZ,
    contactAreaMm2: contactArea,
    overhangAreaMm2: overhangArea,
    score,
    bounds: {
      width, depth, height,
      minX, maxX, minY, maxY,
      minZ: 0, maxZ: height,
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
  const candidateNormals = extractCandidateNormals(geometry, preferredCutNormal);
  let bestCandidate: OrientationCandidate | null = null;

  for (const norm of candidateNormals) {
    const quat = new THREE.Quaternion().setFromUnitVectors(norm, DOWN_VECTOR);
    const candidate = evaluateCandidate(geometry, quat);

    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate || evaluateCandidate(geometry, new THREE.Quaternion());
}
