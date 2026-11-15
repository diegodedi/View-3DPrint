import * as THREE from 'three';
import { createStudioResinMaterial } from './studioResinMaterial';

let cachedGrayMatcap: THREE.CanvasTexture | null = null;

/**
 * Generates a high-definition studio clay/resin gray MatCap sphere texture on a 512x512 canvas.
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
        const keyLight = Math.max(0, nx * -0.38 + ny * 0.60 + nz * 0.70);
        const fillLight = Math.max(0, nx * 0.38 + ny * -0.32 + nz * 0.45) * 0.24;
        const spec = Math.pow(Math.max(0, nx * -0.22 + ny * 0.52 + nz * 0.82), 22) * 0.14;
        const cavity = Math.pow(nz, 0.38) * 0.32 + 0.68;

        const baseAmbient = 0.38;
        const intensity = Math.min(1.0, Math.max(0.0, (baseAmbient + keyLight * 0.52 + fillLight + spec) * cavity));
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
 * Retorna o material global unificado (MatCap + Cavity + Roughness Difuso + Baixa Specular)
 * padronizado para todas as abas e views do aplicativo (padrão Cinza Studio).
 */
export function createGrayMatcapMaterial(): THREE.Material {
  return createStudioResinMaterial();
}

export { clearThumbnailQueue, enqueueThumbnailJob } from './thumbnailQueue';
