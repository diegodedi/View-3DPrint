import * as THREE from 'three';
import type { BoundingBoxDimensions, MeshAnalysisMetrics } from '../types/models';
import { recommendCrealitySliceConfig } from './sliceRecommender';

export { recommendCrealitySliceConfig };

export interface RawMeshInput {
  positions: Float32Array;
  indices: Uint32Array | null;
  matrix: Float32Array | number[] | null;
}

interface Accumulator {
  signedVolumeMm3: number;
  totalAreaMm2: number;
  bedContactAreaMm2: number;
  overhangAreaMm2: number;
  severeOverhangAreaMm2: number;
  curvedTopAreaMm2: number;
  organicAreaMm2: number;
}

function isIdentityMatrix(m: Float32Array | number[] | null): boolean {
  if (!m || m.length !== 16) return true;
  return (
    m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 &&
    m[4] === 0 && m[5] === 1 && m[6] === 0 && m[7] === 0 &&
    m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0 &&
    m[12] === 0 && m[13] === 0 && m[14] === 0 && m[15] === 1
  );
}

function accumulateRawMeshStats(mesh: RawMeshInput, acc: Accumulator): number {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const count = idx ? idx.length : pos.length / 3;
  const useMat = !isIdentityMatrix(mesh.matrix);
  const m = mesh.matrix;

  const m0 = useMat ? m![0] : 1, m1 = useMat ? m![1] : 0, m2 = useMat ? m![2] : 0;
  const m4 = useMat ? m![4] : 0, m5 = useMat ? m![5] : 1, m6 = useMat ? m![6] : 0;
  const m8 = useMat ? m![8] : 0, m9 = useMat ? m![9] : 0, m10 = useMat ? m![10] : 1;
  const m12 = useMat ? m![12] : 0, m13 = useMat ? m![13] : 0, m14 = useMat ? m![14] : 0;

  let tris = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = (idx ? idx[i] : i) * 3;
    const ib = (idx ? idx[i + 1] : i + 1) * 3;
    const ic = (idx ? idx[i + 2] : i + 2) * 3;
    tris++;

    const ax0 = pos[ia], ay0 = pos[ia + 1], az0 = pos[ia + 2];
    const bx0 = pos[ib], by0 = pos[ib + 1], bz0 = pos[ib + 2];
    const cx0 = pos[ic], cy0 = pos[ic + 1], cz0 = pos[ic + 2];

    const ax = useMat ? m0 * ax0 + m4 * ay0 + m8 * az0 + m12 : ax0;
    const ay = useMat ? m1 * ax0 + m5 * ay0 + m9 * az0 + m13 : ay0;
    const az = useMat ? m2 * ax0 + m6 * ay0 + m10 * az0 + m14 : az0;

    const bx = useMat ? m0 * bx0 + m4 * by0 + m8 * bz0 + m12 : bx0;
    const by = useMat ? m1 * bx0 + m5 * by0 + m9 * bz0 + m13 : by0;
    const bz = useMat ? m2 * bx0 + m6 * by0 + m10 * bz0 + m14 : bz0;

    const cx = useMat ? m0 * cx0 + m4 * cy0 + m8 * cz0 + m12 : cx0;
    const cy = useMat ? m1 * cx0 + m5 * cy0 + m9 * cz0 + m13 : cy0;
    const cz = useMat ? m2 * cx0 + m6 * cy0 + m10 * cz0 + m14 : cz0;

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;

    const doubleArea = Math.hypot(crx, cry, crz);
    if (doubleArea < 1e-6) continue;

    const area = doubleArea * 0.5;
    const invDoubleArea = 1 / doubleArea;
    const nx = crx * invDoubleArea;
    const ny = cry * invDoubleArea;
    const nz = crz * invDoubleArea;

    acc.totalAreaMm2 += area;
    acc.signedVolumeMm3 += (ax * crx + ay * cry + az * crz) / 6.0;

    if (ay <= 0.3 && by <= 0.3 && cy <= 0.3 && ny < -0.75) {
      acc.bedContactAreaMm2 += area;
    }

    const avgY = (ay + by + cy) / 3;
    if (avgY > 0.8 && ny < -0.64) {
      acc.overhangAreaMm2 += area;
      if (ny < -0.766) acc.severeOverhangAreaMm2 += area;
    }

    if (ny > 0.45 && ny < 0.96) acc.curvedTopAreaMm2 += area;
    if (Math.abs(nx) < 0.94 && Math.abs(ny) < 0.94 && Math.abs(nz) < 0.94) {
      acc.organicAreaMm2 += area;
    }
  }

  return tris;
}

/**
 * Pure geometry analyzer working directly on typed arrays (safe for Web Workers).
 */
export function analyzeRawMeshes(
  meshes: RawMeshInput[],
  dims: BoundingBoxDimensions
): MeshAnalysisMetrics {
  const acc: Accumulator = {
    signedVolumeMm3: 0,
    totalAreaMm2: 0,
    bedContactAreaMm2: 0,
    overhangAreaMm2: 0,
    severeOverhangAreaMm2: 0,
    curvedTopAreaMm2: 0,
    organicAreaMm2: 0,
  };

  let triangles = 0;
  for (const m of meshes) {
    triangles += accumulateRawMeshStats(m, acc);
  }

  const widthMm = Math.round(dims.widthMm);
  const depthMm = Math.round(dims.depthMm);
  const heightMm = Math.round(dims.heightMm);
  const foot = Math.max(widthMm, depthMm, 1);
  const slendernessRatio = Number((heightMm / foot).toFixed(2));
  const volumeCm3 = Math.max(0.1, Number((Math.abs(acc.signedVolumeMm3) / 1000).toFixed(1)));
  const surfaceAreaCm2 = Math.max(0.1, Number((acc.totalAreaMm2 / 100).toFixed(1)));

  const totalArea = Math.max(acc.totalAreaMm2, 1);
  const curvedTopRatio = Number((acc.curvedTopAreaMm2 / totalArea).toFixed(3));
  const organicRatio = Number((acc.organicAreaMm2 / totalArea).toFixed(3));

  return {
    triangles: Math.round(triangles),
    volumeCm3,
    surfaceAreaCm2,
    bedContactAreaMm2: Math.round(acc.bedContactAreaMm2),
    overhangAreaMm2: Math.round(acc.overhangAreaMm2),
    severeOverhangAreaMm2: Math.round(acc.severeOverhangAreaMm2),
    curvedTopRatio,
    organicRatio,
    slendernessRatio,
    widthMm,
    depthMm,
    heightMm,
  };
}

/**
 * Collects raw position/index/matrix buffers from a Three.js Object3D.
 */
export function collectRawMeshInputs(object3d: THREE.Object3D): RawMeshInput[] {
  object3d.updateMatrixWorld(true);
  const meshes: RawMeshInput[] = [];
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const posAttr = mesh.geometry?.attributes?.position;
      if (!posAttr) return;
      const positions = posAttr.array instanceof Float32Array
        ? posAttr.array
        : Float32Array.from(posAttr.array as ArrayLike<number>);
      const idxAttr = mesh.geometry.index;
      const indices = idxAttr
        ? (idxAttr.array instanceof Uint32Array
            ? idxAttr.array
            : Uint32Array.from(idxAttr.array as ArrayLike<number>))
        : null;
      meshes.push({
        positions,
        indices,
        matrix: mesh.matrixWorld.elements.slice(),
      });
    }
  });
  return meshes;
}

/**
 * Analyzes a positioned Three.js Object3D to extract deep geometric printability metrics.
 */
export function analyzeMeshGeometry(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): MeshAnalysisMetrics {
  return analyzeRawMeshes(collectRawMeshInputs(object3d), dims);
}
