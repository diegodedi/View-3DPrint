import * as THREE from 'three';
import type { PlatePartPlacement } from '../../types/plateTypes';

export interface ExtractedMeshData {
  vertices: number[];
  indices: number[];
}

export interface OrientedPartMeshPayload {
  vertices: number[];
  indices: number[];
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * Extrai vértices e índices numéricos de um BufferGeometry para serialização 3MF / IPC.
 */
export function extractGeometryMeshData(geom: THREE.BufferGeometry): ExtractedMeshData {
  const pos = geom.attributes.position;
  if (!pos || pos.count === 0) {
    return { vertices: [], indices: [] };
  }

  const vertices: number[] = new Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const idx = i * 3;
    vertices[idx] = pos.getX(i);
    vertices[idx + 1] = pos.getY(i);
    vertices[idx + 2] = pos.getZ(i);
  }

  let indices: number[];
  if (geom.index) {
    indices = new Array(geom.index.count);
    for (let i = 0; i < geom.index.count; i++) {
      indices[i] = geom.index.getX(i);
    }
  } else {
    indices = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      indices[i] = i;
    }
  }

  return { vertices, indices };
}

/**
 * Extrai malha já rotacionada para a melhor orientação anti-suporte e centralizada localmente em (0, 0, Z=0),
 * retornando o deslocamento 2D (bedOffset) para posicionamento independente na mesa do fatiador (.3MF).
 */
export function extractOrientedPartMeshData(
  geom: THREE.BufferGeometry,
  placement?: PlatePartPlacement | null
): OrientedPartMeshPayload {
  const pos = geom.attributes.position;
  if (!pos || pos.count === 0) {
    return {
      vertices: [],
      indices: [],
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
    };
  }

  const quat = placement
    ? new THREE.Quaternion(
        placement.rotation[0],
        placement.rotation[1],
        placement.rotation[2],
        placement.rotation[3]
      )
    : new THREE.Quaternion();

  const v = new THREE.Vector3();
  const tempCoords = new Float32Array(pos.count * 3);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyQuaternion(quat);
    const i3 = i * 3;
    tempCoords[i3] = v.x;
    tempCoords[i3 + 1] = v.y;
    tempCoords[i3 + 2] = v.z;
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  // Deduplica vértices caso a geometria não esteja indexada (garante malha fechada 100% manifold no 3MF)
  if (geom.index) {
    const vertices: number[] = new Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      vertices[i3] = tempCoords[i3] - centerX;
      vertices[i3 + 1] = tempCoords[i3 + 1] - centerY;
      vertices[i3 + 2] = tempCoords[i3 + 2] - minZ;
    }
    const indices: number[] = new Array(geom.index.count);
    for (let i = 0; i < geom.index.count; i++) {
      indices[i] = geom.index.getX(i);
    }
    return {
      vertices,
      indices,
      position: placement ? placement.bedOffset : [0, 0, 0],
      rotation: [0, 0, 0, 1],
    };
  }

  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const indices: number[] = new Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const i3 = i * 3;
    const vx = tempCoords[i3] - centerX;
    const vy = tempCoords[i3 + 1] - centerY;
    const vz = tempCoords[i3 + 2] - minZ;
    const key = `${Math.round(vx * 10000)}_${Math.round(vy * 10000)}_${Math.round(vz * 10000)}`;
    let idx = vertexMap.get(key);
    if (idx === undefined) {
      idx = vertices.length / 3;
      vertices.push(vx, vy, vz);
      vertexMap.set(key, idx);
    }
    indices[i] = idx;
  }

  return {
    vertices,
    indices,
    position: placement ? placement.bedOffset : [0, 0, 0],
    rotation: [0, 0, 0, 1],
  };
}

/**
 * Gera um ArrayBuffer STL binário com a orientação anti-suporte e assentamento Z=0 já aplicados.
 */
export function buildOrientedBinaryStlBuffer(
  geom: THREE.BufferGeometry,
  placement?: PlatePartPlacement | null
): ArrayBuffer {
  const { vertices, indices } = extractOrientedPartMeshData(geom, placement);
  const triCount = Math.floor(indices.length / 3);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const i0 = indices[t3] * 3;
    const i1 = indices[t3 + 1] * 3;
    const i2 = indices[t3 + 2] * 3;

    const ax = vertices[i0], ay = vertices[i0 + 1], az = vertices[i0 + 2];
    const bx = vertices[i1], by = vertices[i1 + 1], bz = vertices[i1 + 2];
    const cx = vertices[i2], cy = vertices[i2 + 1], cz = vertices[i2 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      nx /= len; ny /= len; nz /= len;
    }

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    view.setFloat32(offset, ax, true); offset += 4;
    view.setFloat32(offset, ay, true); offset += 4;
    view.setFloat32(offset, az, true); offset += 4;

    view.setFloat32(offset, bx, true); offset += 4;
    view.setFloat32(offset, by, true); offset += 4;
    view.setFloat32(offset, bz, true); offset += 4;

    view.setFloat32(offset, cx, true); offset += 4;
    view.setFloat32(offset, cy, true); offset += 4;
    view.setFloat32(offset, cz, true); offset += 4;

    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}
