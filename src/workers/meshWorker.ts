import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { BoundingBoxDimensions } from '../types/models';
import { analyzeRawMeshes, type RawMeshInput } from '../utils/meshAnalyzer';
import { extractSerializedRawMeshes } from '../utils/meshExtractor';
import { computeCreasedNormalsInPlace } from '../utils/normalSmoother';

export interface ParsedGeometryChunk {
  positions: Float32Array;
  normals: Float32Array | null;
  cavities: Float32Array | null;
  indices: Uint32Array | null;
}

type WorkerRequest =
  | { id: number; type: 'parse'; buffer: ArrayBuffer; extension: string }
  | { id: number; type: 'analyze'; meshes: RawMeshInput[]; dims: BoundingBoxDimensions }
  | { id: number; type: 'extract'; meshes: RawMeshInput[]; heightMm: number };

function extractGeometryChunk(geom: THREE.BufferGeometry): ParsedGeometryChunk | null {
  const posAttr = geom.attributes.position;
  if (!posAttr) return null;

  computeCreasedNormalsInPlace(geom);
  const normAttr = geom.attributes.normal;
  const cavAttr = geom.attributes.aCavity;
  const idxAttr = geom.index;

  const positions = posAttr.array instanceof Float32Array
    ? posAttr.array
    : Float32Array.from(posAttr.array as ArrayLike<number>);
  const normals = normAttr
    ? (normAttr.array instanceof Float32Array
        ? normAttr.array
        : Float32Array.from(normAttr.array as ArrayLike<number>))
    : null;
  const cavities = cavAttr
    ? (cavAttr.array instanceof Float32Array
        ? cavAttr.array
        : Float32Array.from(cavAttr.array as ArrayLike<number>))
    : null;
  const indices = idxAttr
    ? (idxAttr.array instanceof Uint32Array
        ? idxAttr.array
        : Uint32Array.from(idxAttr.array as ArrayLike<number>))
    : null;

  return { positions, normals, cavities, indices };
}

function parseToChunks(buffer: ArrayBuffer, extension: string): ParsedGeometryChunk[] {
  const ext = extension.toUpperCase();
  if (ext === 'STL') {
    const geom = new STLLoader().parse(buffer);
    const chunk = extractGeometryChunk(geom);
    geom.dispose();
    return chunk ? [chunk] : [];
  }

  if (ext === 'OBJ') {
    const text = new TextDecoder().decode(buffer);
    const group = new OBJLoader().parse(text);
    const chunks: ParsedGeometryChunk[] = [];
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const chunk = extractGeometryChunk(mesh.geometry);
        if (chunk) chunks.push(chunk);
        mesh.geometry.dispose();
      }
    });
    return chunks;
  }

  throw new Error(`Worker parser não suporta extensão: ${extension}`);
}

const workerScope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'parse') {
      const chunks = parseToChunks(msg.buffer, msg.extension);
      const transferSet = new Set<Transferable>();
      for (const c of chunks) {
        if (c.positions.buffer instanceof ArrayBuffer) transferSet.add(c.positions.buffer);
        if (c.normals && c.normals.buffer instanceof ArrayBuffer) transferSet.add(c.normals.buffer);
        if (c.cavities && c.cavities.buffer instanceof ArrayBuffer) transferSet.add(c.cavities.buffer);
        if (c.indices && c.indices.buffer instanceof ArrayBuffer) transferSet.add(c.indices.buffer);
      }
      workerScope.postMessage({ id: msg.id, ok: true, result: chunks }, Array.from(transferSet));
      return;
    }

    if (msg.type === 'analyze') {
      const metrics = analyzeRawMeshes(msg.meshes, msg.dims);
      workerScope.postMessage({ id: msg.id, ok: true, result: metrics });
      return;
    }

    if (msg.type === 'extract') {
      const payload = extractSerializedRawMeshes(msg.meshes, msg.heightMm);
      const transfers: Transferable[] = [];
      if (payload.vertices.buffer instanceof ArrayBuffer) transfers.push(payload.vertices.buffer);
      if (payload.indices.buffer instanceof ArrayBuffer) transfers.push(payload.indices.buffer);
      workerScope.postMessage({ id: msg.id, ok: true, result: payload }, transfers);
    }
  } catch (err) {
    workerScope.postMessage({
      id: msg.id,
      ok: false,
      error: (err as Error)?.message || 'Erro no Mesh Worker.',
    });
  }
};
