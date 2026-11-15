import * as THREE from 'three';
import type { BoundingBoxDimensions, SerializedMeshPayload } from '../types/models';
import { collectRawMeshInputs, type RawMeshInput } from './meshAnalyzer';

interface DedupContext {
  vertexMap: Map<bigint, number>;
  coords: number[];
  indices: number[];
  halfHeight: number;
}

type Point3Tuple = [number, number, number];

function registerSlicerVertex(point: Point3Tuple, ctx: DedupContext): number {
  const [sx, sy, sz] = point;
  const qx = Math.round(sx * 10000) | 0;
  const qy = Math.round(sy * 10000) | 0;
  const qz = Math.round(sz * 10000) | 0;
  const key = (BigInt(qx >>> 0) << 64n) | (BigInt(qy >>> 0) << 32n) | BigInt(qz >>> 0);

  const existing = ctx.vertexMap.get(key);
  if (existing !== undefined) return existing;

  const newIdx = ctx.coords.length / 3;
  ctx.coords.push(sx, sy, sz);
  ctx.vertexMap.set(key, newIdx);
  return newIdx;
}

function appendRawMeshTriangles(mesh: RawMeshInput, ctx: DedupContext): void {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const count = idx ? idx.length : pos.length / 3;
  const m = mesh.matrix;
  const hasMat = Boolean(m && m.length === 16);

  const m0 = hasMat ? m![0] : 1, m1 = hasMat ? m![1] : 0, m2 = hasMat ? m![2] : 0;
  const m4 = hasMat ? m![4] : 0, m5 = hasMat ? m![5] : 1, m6 = hasMat ? m![6] : 0;
  const m8 = hasMat ? m![8] : 0, m9 = hasMat ? m![9] : 0, m10 = hasMat ? m![10] : 1;
  const m12 = hasMat ? m![12] : 0, m13 = hasMat ? m![13] : 0, m14 = hasMat ? m![14] : 0;

  const mapVertex = (vOffset: number): number => {
    const x0 = pos[vOffset];
    const y0 = pos[vOffset + 1];
    const z0 = pos[vOffset + 2];
    const wx = hasMat ? m0 * x0 + m4 * y0 + m8 * z0 + m12 : x0;
    const wy = hasMat ? m1 * x0 + m5 * y0 + m9 * z0 + m13 : y0;
    const wz = hasMat ? m2 * x0 + m6 * y0 + m10 * z0 + m14 : z0;
    return registerSlicerVertex([wx, -wz, wy - ctx.halfHeight], ctx);
  };

  for (let i = 0; i + 2 < count; i += 3) {
    const a = (idx ? idx[i] : i) * 3;
    const b = (idx ? idx[i + 1] : i + 1) * 3;
    const c = (idx ? idx[i + 2] : i + 2) * 3;

    const v1 = mapVertex(a);
    const v2 = mapVertex(b);
    const v3 = mapVertex(c);

    if (v1 !== v2 && v2 !== v3 && v1 !== v3) {
      ctx.indices.push(v1, v2, v3);
    }
  }
}

/**
 * Pure typed-array mesh extractor using BigInt spatial keys (safe for Web Workers).
 */
export function extractSerializedRawMeshes(
  meshes: RawMeshInput[],
  heightMm: number
): SerializedMeshPayload {
  const ctx: DedupContext = {
    vertexMap: new Map<bigint, number>(),
    coords: [],
    indices: [],
    halfHeight: heightMm / 2,
  };

  for (const m of meshes) {
    appendRawMeshTriangles(m, ctx);
  }

  return {
    vertices: new Float32Array(ctx.coords),
    indices: new Uint32Array(ctx.indices),
    heightMm,
  };
}

/**
 * Extracts a deduplicated Z-up indexed mesh ready for Creality Print .3mf packaging.
 */
export function extractSerializedMesh(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): SerializedMeshPayload {
  return extractSerializedRawMeshes(collectRawMeshInputs(object3d), dims.heightMm);
}
