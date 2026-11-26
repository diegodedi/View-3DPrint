import * as THREE from 'three';
import { disposeObjectGeometries, prepareObjectOnPlate } from './threeHelpers';
import { parseModelBufferAsync } from './meshWorkerClient';

let thumbRenderer: THREE.WebGLRenderer | null = null;
let thumbScene: THREE.Scene | null = null;
let thumbCamera: THREE.PerspectiveCamera | null = null;
let thumbHolder: THREE.Group | null = null;
let renderLock: Promise<void> = Promise.resolve();

function ensureThumbEngine(): void {
  if (thumbRenderer) return;
  thumbRenderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  thumbRenderer.setSize(320, 220);
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    thumbRenderer = null;
    thumbScene = null;
    thumbCamera = null;
    thumbHolder = null;
  });

  thumbScene = new THREE.Scene();
  thumbScene.background = new THREE.Color(0x161616);

  const grid = new THREE.GridHelper(180, 18, 0x2e2e2e, 0x1f1f1f);
  thumbScene.add(grid);

  thumbHolder = new THREE.Group();
  thumbScene.add(thumbHolder);

  thumbCamera = new THREE.PerspectiveCamera(38, 320 / 220, 0.1, 4000);
}

function canvasToWebpBytesAsync(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
  return new Promise<Uint8Array | null>((resolve) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        try {
          const ab = await blob.arrayBuffer();
          resolve(new Uint8Array(ab));
        } catch {
          resolve(null);
        }
      },
      'image/webp',
      quality
    );
  });
}

function canvasToDataUrlAsync(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  if (typeof canvas.toBlob !== 'function') {
    return Promise.resolve(canvas.toDataURL('image/webp', quality));
  }
  return new Promise<string>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(canvas.toDataURL('image/webp', quality));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve(canvas.toDataURL('image/webp', quality));
        reader.readAsDataURL(blob);
      },
      'image/webp',
      quality
    );
  });
}

function runSerializedRender<T>(fn: () => Promise<T>): Promise<T> {
  const next = renderLock.then(fn, fn);
  renderLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function renderObjectWithEncoder<T>(
  object3d: THREE.Object3D,
  fallback: T,
  encode: (canvas: HTMLCanvasElement) => Promise<T>
): Promise<T> {
  return runSerializedRender(async () => {
    ensureThumbEngine();
    if (!thumbRenderer || !thumbScene || !thumbCamera || !thumbHolder) {
      disposeObjectGeometries(object3d);
      return fallback;
    }
    try {
      const dims = prepareObjectOnPlate(object3d);
      const rawMax = Math.max(dims.widthMm, dims.depthMm, dims.heightMm);
      if (dims.triangles <= 0 || !Number.isFinite(rawMax) || rawMax <= 0) {
        return fallback;
      }
      thumbHolder.add(object3d);
      const maxDim = Math.max(rawMax, 0.05);
      thumbCamera.near = Math.max(0.005, maxDim * 0.001);
      thumbCamera.far = Math.max(4000, maxDim * 25);
      thumbCamera.updateProjectionMatrix();
      thumbCamera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.4);
      thumbCamera.lookAt(0, dims.heightMm * 0.42, 0);
      thumbRenderer.render(thumbScene, thumbCamera);
      return await encode(thumbRenderer.domElement);
    } finally {
      thumbHolder.remove(object3d);
      disposeObjectGeometries(object3d);
    }
  });
}

/**
 * Parses a 3D model off-thread in the worker pool, then renders a compact binary WebP thumbnail (zero Base64).
 */
export async function renderBufferToThumbnailWebpBytesAsync(
  buffer: ArrayBuffer | Uint8Array,
  extension: string
): Promise<Uint8Array | null> {
  const object3d = await parseModelBufferAsync(buffer, extension, { mode: 'thumbnail' });
  return renderObjectWithEncoder(object3d, null, (canvas) => canvasToWebpBytesAsync(canvas, 0.84));
}

/**
 * Legacy helper: renders a model buffer to a WebP data URL when binary cache API is unavailable.
 */
export async function renderBufferToThumbnailDataUrlAsync(
  buffer: ArrayBuffer | Uint8Array,
  extension: string
): Promise<string> {
  const object3d = await parseModelBufferAsync(buffer, extension, { mode: 'thumbnail' });
  return renderObjectWithEncoder(object3d, '', (canvas) => canvasToDataUrlAsync(canvas, 0.84));
}
