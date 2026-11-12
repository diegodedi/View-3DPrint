import type * as THREE from 'three';

export interface ExtractedMeshData {
  vertices: number[];
  indices: number[];
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

