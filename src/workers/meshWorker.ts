import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { BoundingBoxDimensions } from '../types/models';
import { analyzeRawMeshes, type RawMeshInput } from '../utils/meshAnalyzer';
import { extractSerializedRawMeshes } from '../utils/meshExtractor';
import { computeCreasedNormalsInPlace } from '../utils/normalSmoother';
import { ensureValidGeometryNormals, parseStlBufferSafe } from '../utils/stlSafeParser';
import { parseViewer3mfBufferToParts } from '../utils/viewer3mfParser';

export interface ParsedGeometryChunk {
  name?: string;
  positions: Float32Array;
  normals: Float32Array | null;
  cavities: Float32Array | null;
  indices: Uint32Array | null;
}

export type MeshParseMode = 'viewer' | 'thumbnail';

type WorkerRequest =
  | { id: number; type: 'parse'; buffer: ArrayBuffer; extension: string; mode?: MeshParseMode }
  | { id: number; type: 'analyze'; meshes: RawMeshInput[]; dims: BoundingBoxDimensions }
  | { id: number; type: 'extract'; meshes: RawMeshInput[]; heightMm: number };

function extractGeometryChunk(
  geom: THREE.BufferGeometry,
  mode: MeshParseMode = 'viewer'
): ParsedGeometryChunk | null {
  const initialPosAttr = geom.attributes.position;
  if (!initialPosAttr || initialPosAttr.count < 3) return null;

  if (mode === 'thumbnail') {
    ensureValidGeometryNormals(geom);
  } else {
    computeCreasedNormalsInPlace(geom);
    ensureValidGeometryNormals(geom);
  }
  const posAttr = geom.attributes.position;
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

function parse3mfToChunks(buffer: ArrayBuffer, mode: MeshParseMode): ParsedGeometryChunk[] {
  const parts = parseViewer3mfBufferToParts(buffer);
  const chunks: ParsedGeometryChunk[] = [];
  for (const part of parts) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(part.indices, 1));
    const chunk = extractGeometryChunk(geom, mode);
    geom.dispose();
    if (chunk) chunks.push({ ...chunk, name: part.name });
  }
  return chunks;
}

function parseToChunks(
  buffer: ArrayBuffer,
  extension: string,
  mode: MeshParseMode = 'viewer'
): ParsedGeometryChunk[] {
  const ext = extension.toUpperCase();
  if (ext === 'STL') {
    const geom = parseStlBufferSafe(buffer);
    const chunk = extractGeometryChunk(geom, mode);
    geom.dispose();
    if (!chunk) throw new Error('Nenhuma malha 3D válida encontrada no arquivo .stl');
    return [chunk];
  }

  if (ext === 'OBJ') {
    const text = new TextDecoder().decode(buffer);
    const group = new OBJLoader().parse(text);
    const chunks: ParsedGeometryChunk[] = [];
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const chunk = extractGeometryChunk(mesh.geometry, mode);
        if (chunk) chunks.push({ ...chunk, name: mesh.name || undefined });
        mesh.geometry.dispose();
      }
    });
    return chunks;
  }

  if (ext === '3MF') {
    return parse3mfToChunks(buffer, mode);
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
      const chunks = parseToChunks(msg.buffer, msg.extension, msg.mode ?? 'viewer');
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
