import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { BoundingBoxDimensions } from '../types/models';
import { createGrayMatcapMaterial } from './matcapUtils';
import { computeCreasedNormalsInPlace } from './normalSmoother';

let sharedThumbRenderer: THREE.WebGLRenderer | null = null;
let sharedThumbScene: THREE.Scene | null = null;
let sharedThumbCamera: THREE.PerspectiveCamera | null = null;
let sharedModelHolder: THREE.Group | null = null;

export interface MeshMaterialOptions {
  skipCavity?: boolean;
}

/**
 * Applies the gray studio MatCap material to every mesh inside an Object3D.
 * @param object3d Target Three.js Object3D
 * @param options Optional parsing/material settings (skipCavity defaults to false)
 */
export function applyGrayMatcapToObject(
  object3d: THREE.Object3D,
  options: MeshMaterialOptions = {}
): void {
  const mat = createGrayMatcapMaterial();
  const skipCavity = Boolean(options.skipCavity);
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        if (skipCavity) {
          if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
        } else {
          computeCreasedNormalsInPlace(mesh.geometry);
        }
      }
      mesh.material = mat;
    }
  });
}

/**
 * Disposes all geometries inside an Object3D to free GPU VRAM immediately.
 * @param object3d Target Three.js Object3D
 */
export function disposeObjectGeometries(object3d: THREE.Object3D): void {
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      (child as THREE.Mesh).geometry?.dispose();
    }
  });
}

function ensureArrayBuffer(buf: unknown): ArrayBuffer {
  if (!buf) return new ArrayBuffer(0);
  if (buf instanceof ArrayBuffer) return buf;
  if (ArrayBuffer.isView(buf)) {
    const b = buf.buffer as ArrayBuffer;
    return b.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const anyBuf = buf as { buffer?: ArrayBuffer; byteOffset?: number; byteLength?: number; length?: number };
  if (anyBuf.buffer && typeof anyBuf.buffer.slice === 'function') {
    const offset = anyBuf.byteOffset ?? 0;
    const len = anyBuf.byteLength ?? anyBuf.length ?? 0;
    return anyBuf.buffer.slice(offset, offset + len);
  }
  return buf as ArrayBuffer;
}

/**
 * Parses an ArrayBuffer into a Three.js Object3D with stable gray MatCap applied.
 * @param buffer Raw file buffer
 * @param extension File extension ('STL' | 'OBJ' | '3MF')
 * @param options Optional parsing settings (skipCavity defaults to false)
 */
export function parseModelBufferToMesh(
  buffer: ArrayBuffer | Uint8Array,
  extension: string,
  options: MeshMaterialOptions = {}
): THREE.Object3D {
  const safeBuffer = ensureArrayBuffer(buffer);
  const ext = extension.toUpperCase();

  if (ext === 'STL') {
    const loader = new STLLoader();
    const geometry = loader.parse(safeBuffer);
    if (options.skipCavity) {
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
    } else {
      computeCreasedNormalsInPlace(geometry);
    }
    return new THREE.Mesh(geometry, createGrayMatcapMaterial());
  }

  if (ext === 'OBJ') {
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(safeBuffer);
    const group = loader.parse(text);
    applyGrayMatcapToObject(group, options);
    return group;
  }

  if (ext === '3MF') {
    const loader = new ThreeMFLoader();
    const group = loader.parse(safeBuffer);
    applyGrayMatcapToObject(group, options);
    return group;
  }

  throw new Error(`Formato 3D não suportado: ${extension}`);
}

/**
 * Centers object on the build plate (Y=0).
 */
export function centerObjectOnPlate(object3d: THREE.Object3D): THREE.Box3 {
  object3d.rotation.x = -Math.PI / 2;
  object3d.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return box;

  const center = new THREE.Vector3();
  box.getCenter(center);
  object3d.position.x -= center.x;
  object3d.position.z -= center.z;
  object3d.position.y -= box.min.y;
  object3d.updateMatrixWorld(true);
  return box;
}

/**
 * Calculates bounding box dimensions and triangle counts in mm.
 */
export function measureObject(object3d: THREE.Object3D): BoundingBoxDimensions {
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) {
    return { widthMm: 0, depthMm: 0, heightMm: 0, triangles: 0 };
  }
  const size = new THREE.Vector3();
  box.getSize(size);

  let triangles = 0;
  object3d.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const geom = (child as THREE.Mesh).geometry;
      if (geom.index) {
        triangles += geom.index.count / 3;
      } else if (geom.attributes.position) {
        triangles += geom.attributes.position.count / 3;
      }
    }
  });

  return {
    widthMm: size.x,
    depthMm: size.z,
    heightMm: size.y,
    triangles: Math.round(triangles),
  };
}

/**
 * Prepares an object on the plate and returns its dimensions.
 */
export function prepareObjectOnPlate(object3d: THREE.Object3D): BoundingBoxDimensions {
  centerObjectOnPlate(object3d);
  return measureObject(object3d);
}

/**
 * @deprecated Use prepareObjectOnPlate instead (retained for backward compatibility).
 */
export const centerAndMeasureObject = prepareObjectOnPlate;

/**
 * Renders an offscreen 3D preview JPEG data URL using the shared singleton scene and gray MatCap.
 * @param buffer Raw 3D model buffer
 * @param extension 'STL' | 'OBJ' | '3MF'
 */
export function renderBufferToThumbnailDataUrl(buffer: ArrayBuffer, extension: string): string {
  if (!sharedThumbRenderer) {
    sharedThumbRenderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    sharedThumbRenderer.setSize(320, 220);
    sharedThumbRenderer.setPixelRatio(1);

    sharedThumbScene = new THREE.Scene();
    sharedThumbScene.background = new THREE.Color(0x161616);

    const grid = new THREE.GridHelper(180, 18, 0x2e2e2e, 0x1f1f1f);
    sharedThumbScene.add(grid);

    sharedModelHolder = new THREE.Group();
    sharedThumbScene.add(sharedModelHolder);

    sharedThumbCamera = new THREE.PerspectiveCamera(38, 320 / 220, 0.1, 4000);
  }

  if (!sharedThumbScene || !sharedThumbCamera || !sharedModelHolder) {
    return '';
  }

  let object3d: THREE.Object3D | null = null;
  try {
    object3d = parseModelBufferToMesh(buffer, extension);
    const dims = centerAndMeasureObject(object3d);
    sharedModelHolder.add(object3d);

    const maxDim = Math.max(dims.widthMm, dims.depthMm, dims.heightMm, 20);
    sharedThumbCamera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.4);
    sharedThumbCamera.lookAt(0, dims.heightMm * 0.42, 0);

    sharedThumbRenderer.render(sharedThumbScene, sharedThumbCamera);
    return sharedThumbRenderer.domElement.toDataURL('image/jpeg', 0.86);
  } finally {
    if (object3d) {
      sharedModelHolder.remove(object3d);
      disposeObjectGeometries(object3d);
    }
  }
}
