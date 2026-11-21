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
import type { MeshParseMode, ParsedGeometryChunk } from '../workers/meshWorker';

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>;
}

let viewerSlot: WorkerSlot | null = null;
const thumbPool: WorkerSlot[] = [];
let msgSeq = 0;

function getThumbPoolSize(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 4;
  return Math.min(3, Math.max(2, Math.floor(cores / 2)));
}

function createWorkerSlot(onReset: () => void): WorkerSlot {
  const worker = new Worker(new URL('../workers/meshWorker.ts', import.meta.url), {
    type: 'module',
  });
  const pending = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();

  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const { id, ok, result, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Erro no Mesh Worker'));
  };

  worker.onerror = () => {
    for (const entry of pending.values()) {
      entry.reject(new Error('Falha no Mesh Worker'));
    }
    pending.clear();
    onReset();
  };

  return { worker, pending };
}

function getViewerSlot(): WorkerSlot {
  if (!viewerSlot) {
    viewerSlot = createWorkerSlot(() => {
      viewerSlot = null;
    });
  }
  return viewerSlot;
}

function pickThumbPoolSlot(): WorkerSlot {
  const targetSize = getThumbPoolSize();
  if (thumbPool.length < targetSize) {
    let slotRef: WorkerSlot | null = null;
    const slot = createWorkerSlot(() => {
      const idx = slotRef ? thumbPool.indexOf(slotRef) : -1;
      if (idx >= 0) thumbPool.splice(idx, 1);
    });
    slotRef = slot;
    thumbPool.push(slot);
    return slot;
  }

  let leastBusy = thumbPool[0];
  for (let i = 1; i < thumbPool.length; i++) {
    if (thumbPool[i].pending.size < leastBusy.pending.size) {
      leastBusy = thumbPool[i];
    }
  }
  return leastBusy;
}

function callWorkerSlot<T>(
  slot: WorkerSlot,
  payload: Record<string, unknown>,
  transfer: Transferable[] = []
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++msgSeq;
    slot.pending.set(id, {
      resolve: resolve as (val: unknown) => void,
      reject,
    });
    try {
      slot.worker.postMessage({ ...payload, id }, transfer);
    } catch (err) {
      slot.pending.delete(id);
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
    const mesh = new THREE.Mesh(geom, mat);
    if (c.name) mesh.name = c.name;
    return mesh;
  }

  const group = new THREE.Group();
  for (const c of chunks) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    if (c.normals) geom.setAttribute('normal', new THREE.BufferAttribute(c.normals, 3));
    if (c.cavities) geom.setAttribute('aCavity', new THREE.BufferAttribute(c.cavities, 3));
    if (c.indices) geom.setIndex(new THREE.BufferAttribute(c.indices, 1));
    const mesh = new THREE.Mesh(geom, mat);
    if (c.name) mesh.name = c.name;
    group.add(mesh);
  }
  return group;
}

export interface ParseModelOptions {
  mode?: MeshParseMode;
}

/**
 * Returns the recommended parallel parse concurrency matching the thumbnail worker pool.
 */
export function getThumbnailWorkerConcurrency(): number {
  return getThumbPoolSize();
}

/**
 * Parses STL/OBJ (and 3MF in thumbnail mode) off the UI thread via dedicated or pooled Web Workers.
 */
export async function parseModelBufferAsync(
  buffer: ArrayBuffer | Uint8Array,
  extension: string,
  options: ParseModelOptions = {}
): Promise<THREE.Object3D> {
  const ext = extension.toUpperCase();
  const mode: MeshParseMode = options.mode ?? 'viewer';
  const fallbackOptions = { skipCavity: mode === 'thumbnail' };
  const canUseWorker = ext === 'STL' || ext === 'OBJ' || ext === '3MF';

  if (canUseWorker) {
    try {
      const owned = toOwnedArrayBuffer(buffer);
      const slot = mode === 'thumbnail' ? pickThumbPoolSlot() : getViewerSlot();
      const chunks = await callWorkerSlot<ParsedGeometryChunk[]>(
        slot,
        { type: 'parse', buffer: owned, extension: ext, mode },
        [owned]
      );
      return chunksToObject3D(chunks);
    } catch {
      return parseModelBufferToMesh(buffer, extension, fallbackOptions);
    }
  }
  return parseModelBufferToMesh(buffer, extension, fallbackOptions);
}

/**
 * Analyzes mesh geometry metrics asynchronously in the dedicated viewer Web Worker.
 */
export async function analyzeMeshGeometryAsync(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): Promise<MeshAnalysisMetrics> {
  try {
    const meshes = collectRawMeshInputs(object3d);
    return await callWorkerSlot<MeshAnalysisMetrics>(getViewerSlot(), { type: 'analyze', meshes, dims });
  } catch {
    return analyzeMeshGeometry(object3d, dims);
  }
}

/**
 * Extracts deduplicated Z-up mesh payload asynchronously in the dedicated viewer Web Worker.
 */
export async function extractSerializedMeshAsync(
  object3d: THREE.Object3D,
  dims: BoundingBoxDimensions
): Promise<SerializedMeshPayload> {
  try {
    const meshes = collectRawMeshInputs(object3d);
    return await callWorkerSlot<SerializedMeshPayload>(getViewerSlot(), {
      type: 'extract',
      meshes,
      heightMm: dims.heightMm,
    });
  } catch {
    return extractSerializedMesh(object3d, dims);
  }
}
