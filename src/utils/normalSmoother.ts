import * as THREE from 'three';
import { computeGroupCavityAttribute } from './meshCavityBuilder';
import { computeFacesAndAngles, weldVertexPositions } from './normalTopologyUtils';

const MAX_SUPPORTED_TRIS = 600000;
const DEFAULT_CREASE_ANGLE_DEG = 35;

interface SmoothingResult {
  cornerGlobalGroup: Int32Array;
  cornerOutNormals: Float32Array;
  totalGroups: number;
}

function buildCreasedSmoothingGroups(
  weldedOf: Int32Array,
  weldedCount: number,
  idxArray: ArrayLike<number> | null,
  cornerCount: number,
  faceNormals: Float32Array,
  cornerAngles: Float32Array,
  creaseAngleDeg: number
): SmoothingResult {
  const vertHead = new Int32Array(weldedCount).fill(-1);
  const cornerNext = new Int32Array(cornerCount);
  for (let k = 0; k < cornerCount; k++) {
    const w = weldedOf[idxArray ? idxArray[k] : k];
    cornerNext[k] = vertHead[w];
    vertHead[w] = k;
  }

  const cosThreshold = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const cornerGlobalGroup = new Int32Array(cornerCount);
  const cornerOutNormals = new Float32Array(cornerCount * 3);
  const seedNx: number[] = [], seedNy: number[] = [], seedNz: number[] = [];
  const sumNx: number[] = [], sumNy: number[] = [], sumNz: number[] = [];
  const vertCorners: number[] = [];
  const localGroups: number[] = [];
  let totalGroups = 0;

  for (let w = 0; w < weldedCount; w++) {
    vertCorners.length = 0;
    for (let k = vertHead[w]; k !== -1; k = cornerNext[k]) vertCorners.push(k);
    if (vertCorners.length === 0) continue;

    seedNx.length = 0; seedNy.length = 0; seedNz.length = 0;
    sumNx.length = 0; sumNy.length = 0; sumNz.length = 0;
    localGroups.length = vertCorners.length;

    for (let idx = 0; idx < vertCorners.length; idx++) {
      const k = vertCorners[idx];
      const t3 = ((k / 3) | 0) * 3;
      const fnx = faceNormals[t3], fny = faceNormals[t3 + 1], fnz = faceNormals[t3 + 2];
      const angle = cornerAngles[k];

      let bestGroup = -1;
      let bestDot = cosThreshold;
      for (let g = 0; g < seedNx.length; g++) {
        const dot = fnx * seedNx[g] + fny * seedNy[g] + fnz * seedNz[g];
        if (dot >= bestDot) {
          bestDot = dot;
          bestGroup = g;
        }
      }

      if (bestGroup === -1) {
        bestGroup = seedNx.length;
        seedNx.push(fnx); seedNy.push(fny); seedNz.push(fnz);
        sumNx.push(fnx * angle); sumNy.push(fny * angle); sumNz.push(fnz * angle);
      } else {
        sumNx[bestGroup] += fnx * angle;
        sumNy[bestGroup] += fny * angle;
        sumNz[bestGroup] += fnz * angle;
      }
      localGroups[idx] = bestGroup;
    }

    const baseGroupId = totalGroups;
    totalGroups += sumNx.length;
    for (let g = 0; g < sumNx.length; g++) {
      const len = Math.hypot(sumNx[g], sumNy[g], sumNz[g]);
      if (len > 1e-12) { sumNx[g] /= len; sumNy[g] /= len; sumNz[g] /= len; }
      else { sumNx[g] = seedNx[g]; sumNy[g] = seedNy[g]; sumNz[g] = seedNz[g]; }
    }

    for (let idx = 0; idx < vertCorners.length; idx++) {
      const k = vertCorners[idx];
      const g = localGroups[idx];
      cornerGlobalGroup[k] = baseGroupId + g;
      const k3 = k * 3;
      cornerOutNormals[k3] = sumNx[g];
      cornerOutNormals[k3 + 1] = sumNy[g];
      cornerOutNormals[k3 + 2] = sumNz[g];
    }
  }
  return { cornerGlobalGroup, cornerOutNormals, totalGroups };
}

function buildSplitIndexedBuffers(
  posArray: ArrayLike<number>,
  idxArray: ArrayLike<number>,
  origVertCount: number,
  cornerCount: number,
  cornerGlobalGroup: Int32Array,
  cornerOutNormals: Float32Array
) {
  const newIndices = new Uint32Array(cornerCount);
  const firstGroupForVert = new Int32Array(origVertCount).fill(-1);
  const splitMap = new Map<string, number>();
  const extraOrigVert: number[] = [];
  const extraGroupId: number[] = [];
  const extraNormals: number[] = [];
  const baseNormals = new Float32Array(origVertCount * 3);

  for (let k = 0; k < cornerCount; k++) {
    const origV = idxArray[k];
    const gid = cornerGlobalGroup[k];
    const k3 = k * 3;
    const fg = firstGroupForVert[origV];

    if (fg === -1 || fg === gid) {
      if (fg === -1) {
        firstGroupForVert[origV] = gid;
        const v3 = origV * 3;
        baseNormals[v3] = cornerOutNormals[k3];
        baseNormals[v3 + 1] = cornerOutNormals[k3 + 1];
        baseNormals[v3 + 2] = cornerOutNormals[k3 + 2];
      }
      newIndices[k] = origV;
    } else {
      const key = `${origV}_${gid}`;
      let mapped = splitMap.get(key);
      if (mapped === undefined) {
        mapped = origVertCount + extraOrigVert.length;
        splitMap.set(key, mapped);
        extraOrigVert.push(origV);
        extraGroupId.push(gid);
        extraNormals.push(cornerOutNormals[k3], cornerOutNormals[k3 + 1], cornerOutNormals[k3 + 2]);
      }
      newIndices[k] = mapped;
    }
  }

  const totalVerts = origVertCount + extraOrigVert.length;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const groupVertexOf = new Int32Array(totalVerts);

  for (let v = 0; v < origVertCount; v++) {
    const v3 = v * 3;
    positions[v3] = posArray[v3]; positions[v3 + 1] = posArray[v3 + 1]; positions[v3 + 2] = posArray[v3 + 2];
    normals[v3] = baseNormals[v3]; normals[v3 + 1] = baseNormals[v3 + 1]; normals[v3 + 2] = baseNormals[v3 + 2];
    groupVertexOf[v] = firstGroupForVert[v] >= 0 ? firstGroupForVert[v] : 0;
  }
  for (let e = 0; e < extraOrigVert.length; e++) {
    const dstV = origVertCount + e;
    const dst = dstV * 3;
    const src = extraOrigVert[e] * 3;
    positions[dst] = posArray[src]; positions[dst + 1] = posArray[src + 1]; positions[dst + 2] = posArray[src + 2];
    normals[dst] = extraNormals[e * 3]; normals[dst + 1] = extraNormals[e * 3 + 1]; normals[dst + 2] = extraNormals[e * 3 + 2];
    groupVertexOf[dstV] = extraGroupId[e];
  }

  return { positions, normals, indices: newIndices, groupVertexOf, vertexCount: totalVerts };
}

/**
 * Computes angle-weighted crease-separated vertex normals (true face-to-face dihedral threshold)
 * and clean group-isolated `aCavity` curvature. For indexed meshes (.3MF), splits only vertices
 * sitting on hard creases so flat caps and 90° edges render crisp without triangle streaks.
 */
export function computeCreasedNormalsInPlace(
  geometry: THREE.BufferGeometry,
  creaseAngleDeg: number = DEFAULT_CREASE_ANGLE_DEG
): void {
  const posAttr = geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) return;

  const vertexCount = posAttr.count;
  const idxAttr = geometry.index;
  const idxArray = idxAttr ? (idxAttr.array as ArrayLike<number>) : null;
  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(vertexCount / 3);
  if (triCount === 0) return;

  if (triCount > MAX_SUPPORTED_TRIS) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return;
  }

  const posArray = posAttr.array as ArrayLike<number>;
  const { weldedOf, weldedCount, span } = weldVertexPositions(posArray, vertexCount);
  const { faceNormals, cornerAngles } = computeFacesAndAngles(posArray, idxArray, triCount);
  const { cornerGlobalGroup, cornerOutNormals, totalGroups } = buildCreasedSmoothingGroups(
    weldedOf,
    weldedCount,
    idxArray,
    triCount * 3,
    faceNormals,
    cornerAngles,
    creaseAngleDeg
  );

  let finalPositions: Float32Array;
  let finalNormals: Float32Array;
  let finalIndices: Uint32Array | null = null;
  let finalGroupVertexOf: Int32Array;
  let finalVertCount = vertexCount;

  if (!idxArray) {
    finalPositions = posArray instanceof Float32Array ? posArray : Float32Array.from(posArray);
    finalNormals = cornerOutNormals;
    finalGroupVertexOf = cornerGlobalGroup;
    geometry.setAttribute('normal', new THREE.BufferAttribute(finalNormals, 3));
  } else {
    const split = buildSplitIndexedBuffers(
      posArray, idxArray, vertexCount, triCount * 3, cornerGlobalGroup, cornerOutNormals
    );
    finalPositions = split.positions;
    finalNormals = split.normals;
    finalIndices = split.indices;
    finalGroupVertexOf = split.groupVertexOf;
    finalVertCount = split.vertexCount;
    geometry.setAttribute('position', new THREE.BufferAttribute(finalPositions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(finalNormals, 3));
    geometry.setIndex(new THREE.BufferAttribute(finalIndices, 1));
  }

  const cavityAttr = computeGroupCavityAttribute({
    triCount,
    vertexCount: finalVertCount,
    positions: finalPositions,
    normals: finalNormals,
    indices: finalIndices,
    groupVertexOf: finalGroupVertexOf,
    groupVertexCount: Math.max(totalGroups, 1),
    span,
  });
  geometry.setAttribute('aCavity', new THREE.BufferAttribute(cavityAttr, 3));
}
