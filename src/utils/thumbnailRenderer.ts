import * as THREE from 'three';
import { disposeObjectGeometries, prepareObjectOnPlate } from './threeHelpers';
import { parseModelBufferAsync } from './meshWorkerClient';

let thumbRenderer: THREE.WebGLRenderer | null = null;
let thumbScene: THREE.Scene | null = null;
let thumbCamera: THREE.PerspectiveCamera | null = null;
let thumbHolder: THREE.Group | null = null;

function ensureThumbEngine(): void {
  if (thumbRenderer) return;
  thumbRenderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  thumbRenderer.setSize(320, 220);
  thumbRenderer.setPixelRatio(1);

  thumbScene = new THREE.Scene();
  thumbScene.background = new THREE.Color(0x161616);

  const grid = new THREE.GridHelper(180, 18, 0x2e2e2e, 0x1f1f1f);
  thumbScene.add(grid);

  thumbHolder = new THREE.Group();
  thumbScene.add(thumbHolder);

  thumbCamera = new THREE.PerspectiveCamera(38, 320 / 220, 0.1, 4000);
}

/**
 * Parses a 3D model off-thread (for STL/OBJ) and renders a MatCap JPEG thumbnail data URL.
 */
export async function renderBufferToThumbnailDataUrlAsync(
  buffer: ArrayBuffer | Uint8Array,
  extension: string
): Promise<string> {
  ensureThumbEngine();
  if (!thumbRenderer || !thumbScene || !thumbCamera || !thumbHolder) {
    return '';
  }

  let object3d: THREE.Object3D | null = null;
  try {
    object3d = await parseModelBufferAsync(buffer, extension);
    const dims = prepareObjectOnPlate(object3d);
    thumbHolder.add(object3d);

    const maxDim = Math.max(dims.widthMm, dims.depthMm, dims.heightMm, 20);
    thumbCamera.position.set(maxDim * 1.4, maxDim * 1.1, maxDim * 1.4);
    thumbCamera.lookAt(0, dims.heightMm * 0.42, 0);

    thumbRenderer.render(thumbScene, thumbCamera);
    return thumbRenderer.domElement.toDataURL('image/jpeg', 0.86);
  } finally {
    if (object3d) {
      thumbHolder.remove(object3d);
      disposeObjectGeometries(object3d);
    }
  }
}

