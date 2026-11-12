import * as THREE from 'three';

let cachedGrayMatcap: THREE.CanvasTexture | null = null;
let sharedMatcapMaterial: THREE.MeshMatcapMaterial | null = null;

/**
 * Generates a high-definition studio clay/resin gray MatCap sphere texture with built-in
 * cavity/contact occlusion falloff procedurally on a 512x512 canvas (Blender Workbench style).
 */
export function getGrayMatcapTexture(): THREE.CanvasTexture {
  if (cachedGrayMatcap) return cachedGrayMatcap;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const imgData = ctx.createImageData(size, size);
    const pixelBuffer = imgData.data;
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x - half) / half;
        const ny = (half - y) / half;
        const r2 = nx * nx + ny * ny;

        if (r2 > 1.0) {
          const idx = (y * size + x) * 4;
          pixelBuffer[idx] = 0;
          pixelBuffer[idx + 1] = 0;
          pixelBuffer[idx + 2] = 0;
          pixelBuffer[idx + 3] = 0;
          continue;
        }

        const nz = Math.sqrt(Math.max(0, 1.0 - r2));

        // Luz principal direcional do topo-esquerda-frente
        const keyLight = Math.max(0, nx * -0.38 + ny * 0.60 + nz * 0.70);
        // Luz de preenchimento suave da base-direita
        const fillLight = Math.max(0, nx * 0.38 + ny * -0.32 + nz * 0.45) * 0.24;
        // Brilho especular sutil de resina/clay
        const spec = Math.pow(Math.max(0, nx * -0.22 + ny * 0.52 + nz * 0.82), 22) * 0.26;
        // Realce de aro / silhueta (Fresnel rim)
        const rim = Math.pow(1.0 - nz, 2.6) * 0.18;
        // Curva de oclusão de cavidade (Workbench Cavity): aprofunda suavemente em fendas e ângulos rasantes
        const cavity = Math.pow(nz, 0.42) * 0.38 + 0.62;

        const baseAmbient = 0.32;
        const intensity = Math.min(1.0, Math.max(0.0, (baseAmbient + keyLight * 0.56 + fillLight + spec + rim) * cavity));
        const grayValue = Math.round(intensity * 242);

        const idx = (y * size + x) * 4;
        pixelBuffer[idx] = grayValue;
        pixelBuffer[idx + 1] = grayValue;
        pixelBuffer[idx + 2] = grayValue;
        pixelBuffer[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  cachedGrayMatcap = new THREE.CanvasTexture(canvas);
  cachedGrayMatcap.colorSpace = THREE.SRGBColorSpace;
  cachedGrayMatcap.needsUpdate = true;
  return cachedGrayMatcap;
}

/**
 * Retorna o material MatCap Cinza canônico (Blender Workbench Clay)
 * utilizado com blindagem pelo CatPin e pelo visualizador 3D em modo matcap.
 */
export function createGrayMatcapMaterial(): THREE.MeshMatcapMaterial {
  if (!sharedMatcapMaterial) {
    sharedMatcapMaterial = new THREE.MeshMatcapMaterial({
      matcap: getGrayMatcapTexture(),
    });
  }
  return sharedMatcapMaterial;
}

export { clearThumbnailQueue, enqueueThumbnailJob } from './thumbnailQueue';
