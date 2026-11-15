import * as THREE from 'three';
import type {
  BoundingBoxDimensions,
  MeshAnalysisMetrics,
  SerializedMeshPayload,
} from '../types/models';
import {
  analyzeMeshGeometry,
  collectRawMeshInputs,
} from './meshAnalyzer';
import { extractSerializedMesh } from './meshExtractor';
import { createGrayMatcapMaterial } from './matcapUtils';
import { parseModelBufferToMesh } from './threeHelpers';
import type { ParsedGeometryChunk } from '../workers/meshWorker';

let meshWorker: Worker | null = null;
let msgSeq = 0;
const pending = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();

function getMeshWorker(): Worker {
  if (!meshWorker) {
    meshWorker = new Worker(new URL('../workers/meshWorker.ts', import.meta.url), {
      type: 'module',
    });
    meshWorker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const { id, ok, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Erro no Mesh Worker'));
    };
    meshWorker.onerror = () => {
      for (const entry of pending.values()) {
        entry.reject(new Error('Falha no Mesh Worker'));
      }
      pending.clear();
      meshWorker = null;
    };
  }
  return meshWorker;
}

function callMeshWorker<T>(payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++msgSeq;
    pending.set(id, {
      resolve: resolve as (val: unknown) => void,
      reject,
    });
    try {
      getMeshWorker().postMessage({ ...payload, id }, transfer);
    } catch (err) {
      pending.delete(id);
      reject(err as Error);
    }
  });
}

function toOwnedArrayBuffer(buf: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf.slice(0);
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer.slice(0) as ArrayBuffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function chunksToObject3D(chunks: ParsedGeometryChunk[]): THREE.Object3D {
  const mat = createGrayMatcapMaterial();
  if (chunks.length === 1) {
    const c = chunks[0];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    if (c.normals) geom.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
    if (c.cavities) geom.setAttribute('aCavity', new THREE.BufferAttribute(c.cavities, 3));
    if (c.indices) geom.setIndex(new THREE.BufferAttribute(c.indices, 1));
    return new THREE.Mesh(geom, mat);
  }

  const group = new THREE.Group();
  for (const c of chunks) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    if (c.normals) geom.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
    if (c.cavities) geom.setAttribute('aCavity', new THREE.BufferAttribute(c.cavities, 3));
    if (c.indices) geom.setIndex(new THREE.BufferAttribute(c.indices, 1));
    group.add(new THREE.Mesh(geom, mat));
  }
  return group;
}

/**
 * Parses STL/OBJ off the UI thread via Web Worker; falls back to ThreeMFLoader on main thread for 3MF.
 */
export async function parseModelBufferAsync(
  buffer: ArrayBuffer | Uint8Array,
  extension: string
): Promise<THREE.Object3D> {
  const ext = extension.toUpperCase();
  if (ext === 'STL' || ext === 'OBJ') {
    try {
      const owned = toOwnedArrayBuffer(buffer);
      const chunks = await callMeshWorker<ParsedGeometryChunk[]>(
        { type: 'parse', buffer: owned, extension: ext },
        [owned]
      );
      return chunksToObject3D(chunks);
    } catch {
      return parseModelBufferToMesh(buffer, extension);
    }
  }
  return parseModelBufferToMesh(buffer, extension);
}

/**
 * Analyzes mesh geometry metrics asynchronously in the Web Worker.
 */
export async function analyzeMeshGeometryAsync(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): Promise<MeshAnalysisMetrics> {
  try {
    const meshes = collectRawMeshInputs(object3d);
    return await callMeshWorker<MeshAnalysisMetrics>({ type: 'analyze', meshes, dims });
  } catch {
    return analyzeMeshGeometry(object3d, dims);
  }
}

/**
 * Extracts deduplicated Z-up mesh payload asynchronously in the Web Worker.
 */
export async function extractSerializedMeshAsync(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): Promise<SerializedMeshPayload> {
  try {
    const meshes = collectRawMeshInputs(object3d);
    return await callMeshWorker<SerializedMeshPayload>({
      type: 'extract',
      meshes,
      heightMm: dims.heightMm,
    });
  } catch {
    return extractSerializedMesh(object3d, dims);
  }
}

