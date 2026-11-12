import * as THREE from 'three';
import type { BoundingBoxDimensions, SerializedMeshPayload } from '../types/models';

interface DedupContext {
  vertexMap: Map<string, number>;
  coords: number[];
  indices: number[];
  halfHeight: number;
}

function registerSlicerVertex(vec: THREE.Vector3, ctx: DedupContext): number {
  const sx = vec.x;
  const sy = -vec.z;
  const sz = vec.y - ctx.halfHeight;
  const key = `${Math.round(sx * 10000)},${Math.round(sy * 10000)},${Math.round(sz * 10000)}`;

  const existing = ctx.vertexMap.get(key);
  if (existing !== undefined) return existing;

  const newIdx = ctx.coords.length / 3;
  ctx.coords.push(sx, sy, sz);
  ctx.vertexMap.set(key, newIdx);
  return newIdx;
}

function appendMeshTriangles(mesh: THREE.Mesh, ctx: DedupContext): void {
  const posAttr = mesh.geometry?.attributes?.position;
  if (!posAttr) return;

  const indexAttr = mesh.geometry.index;
  const count = indexAttr ? indexAttr.count : posAttr.count;
  const tempVec = new THREE.Vector3();

  for (let i = 0; i + 2 < count; i += 3) {
    const a = indexAttr ? indexAttr.getX(i) : i;
    const b = indexAttr ? indexAttr.getX(i + 1) : i + 1;
    const c = indexAttr ? indexAttr.getX(i + 2) : i + 2;

    tempVec.fromBufferAttribute(posAttr, a).applyMatrix4(mesh.matrixWorld);
    const v1 = registerSlicerVertex(tempVec, ctx);

    tempVec.fromBufferAttribute(posAttr, b).applyMatrix4(mesh.matrixWorld);
    const v2 = registerSlicerVertex(tempVec, ctx);

    tempVec.fromBufferAttribute(posAttr, c).applyMatrix4(mesh.matrixWorld);
    const v3 = registerSlicerVertex(tempVec, ctx);

    if (v1 !== v2 && v2 !== v3 && v1 !== v3) {
      ctx.indices.push(v1, v2, v3);
    }
  }
}

/**
 * Extracts a deduplicated Z-up indexed mesh ready for Creality Print .3mf packaging.
 * @param object3d Centered Three.js Object3D
 * @param dims Measured bounding box dimensions in mm
 */
export function extractSerializedMesh(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): SerializedMeshPayload {
  object3d.updateMatrixWorld(true);
  const ctx: DedupContext = {
    vertexMap: new Map<string, number>(),
    coords: [],
    indices: [],
    halfHeight: dims.heightMm / 2,
  };

  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      appendMeshTriangles(child as THREE.Mesh, ctx);
    }
  });

  return {
    vertices: new Float32Array(ctx.coords),
    indices: new Uint32Array(ctx.indices),
    heightMm: dims.heightMm,
  };
}

