import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { createGrayMatcapMaterial } from './matcapUtils';
import { computeCreasedNormalsInPlace } from './normalSmoother';
import { ensureValidGeometryNormals, parseStlBufferSafe } from './stlSafeParser';
import { parseViewer3mfBufferToObject3D } from './viewer3mfParser';

export interface ViewerFallbackOptions {
  skipCavity?: boolean;
}

function ensureSafeArrayBuffer(buf: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  return (buf.buffer as ArrayBuffer).slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function applyViewerMaterial(object3d: THREE.Object3D, skipCavity: boolean): void {
  const mat = createGrayMatcapMaterial();
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        if (!skipCavity) computeCreasedNormalsInPlace(mesh.geometry);
        ensureValidGeometryNormals(mesh.geometry);
      }
      mesh.material = mat;
    }
  });
}

/**
 * Isolated main-thread fallback parser used exclusively by meshWorkerClient (Viewer3D & Thumbnails).
 * Completely decoupled from threeHelpers.ts so CatPin remains 100% untouched.
 */
export function parseViewerModelFallback(
  buffer: ArrayBuffer | Uint8Array,
  extension: string,
  options: ViewerFallbackOptions = {}
): THREE.Object3D {
  const safeBuffer = ensureSafeArrayBuffer(buffer);
  const ext = extension.toUpperCase();
  const skipCavity = Boolean(options.skipCavity);

  if (ext === 'STL') {
    const geometry = parseStlBufferSafe(safeBuffer);
    if (!skipCavity) computeCreasedNormalsInPlace(geometry);
    ensureValidGeometryNormals(geometry);
    return new THREE.Mesh(geometry, createGrayMatcapMaterial());
  }

  if (ext === 'OBJ') {
    const group = new OBJLoader().parse(new TextDecoder().decode(safeBuffer));
    applyViewerMaterial(group, skipCavity);
    return group;
  }

  if (ext === '3MF') {
    let group: THREE.Object3D;
    try {
      group = parseViewer3mfBufferToObject3D(safeBuffer);
    } catch {
      group = new ThreeMFLoader().parse(safeBuffer);
    }
    applyViewerMaterial(group, skipCavity);
    return group;
  }

  throw new Error(`Formato 3D não suportado: ${extension}`);
}
