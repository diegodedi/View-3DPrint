import * as THREE from 'three';
import type {
  BoundingBoxDimensions,
  MeshAnalysisMetrics,
} from '../types/models';
import { recommendCrealitySliceConfig } from './sliceRecommender';

export { recommendCrealitySliceConfig };

interface Accumulator {
  signedVolumeMm3: number;
  totalAreaMm2: number;
  bedContactAreaMm2: number;
  overhangAreaMm2: number;
  severeOverhangAreaMm2: number;
  curvedTopAreaMm2: number;
  organicAreaMm2: number;
}

function accumulateMeshStats(mesh: THREE.Mesh, acc: Accumulator): void {
  const pos = mesh.geometry?.attributes?.position;
  if (!pos) return;
  const idx = mesh.geometry.index;
  const count = idx ? idx.count : pos.count;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i + 2 < count; i += 3) {
    vA.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    vB.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    vC.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);

    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    cross.crossVectors(e1, e2);
    const doubleArea = cross.length();
    if (doubleArea < 1e-6) continue;

    const area = doubleArea * 0.5;
    const nx = cross.x / doubleArea;
    const ny = cross.y / doubleArea;
    const nz = cross.z / doubleArea;

    acc.totalAreaMm2 += area;
    acc.signedVolumeMm3 += vA.dot(cross) / 6.0;

    if (vA.y <= 0.3 && vB.y <= 0.3 && vC.y <= 0.3 && ny < -0.75) {
      acc.bedContactAreaMm2 += area;
    }

    const avgY = (vA.y + vB.y + vC.y) / 3;
    if (avgY > 0.8 && ny < -0.64) {
      acc.overhangAreaMm2 += area;
      if (ny < -0.766) acc.severeOverhangAreaMm2 += area;
    }

    if (ny > 0.45 && ny < 0.96) acc.curvedTopAreaMm2 += area;
    if (Math.abs(nx) < 0.94 && Math.abs(ny) < 0.94 && Math.abs(nz) < 0.94) {
      acc.organicAreaMm2 += area;
    }
  }
}

/**
 * Analyzes a positioned Three.js Object3D to extract deep geometric printability metrics.
 * @param object3d Centered Three.js Object3D
 * @param dims Bounding box dimensions in mm
 */
export function analyzeMeshGeometry(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): MeshAnalysisMetrics {
  object3d.updateMatrixWorld(true);

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
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      accumulateMeshStats(mesh, acc);
      const geom = mesh.geometry;
      triangles += geom.index
        ? geom.index.count / 3
        : geom.attributes.position
          ? geom.attributes.position.count / 3
          : 0;
    }
  });

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
