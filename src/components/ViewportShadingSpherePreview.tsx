import React, { useEffect, useRef } from 'react';
import type { ViewportShadingConfig } from '../types/models';
import { RESIN_PRESETS } from '../utils/studioResinMaterial';

interface ViewportShadingSpherePreviewProps {
  config: ViewportShadingConfig;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstepAsc(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-5), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function hexToRgb01(hex: number): [number, number, number] {
  return [
    ((hex >> 16) & 255) / 255,
    ((hex >> 8) & 255) / 255,
    (hex & 255) / 255,
  ];
}

/**
 * Esfera visual 3D esculpida com cavidade orbital e crista (inspirada nas Imagens 2, 3 e 4)
 * para pré-visualização em tempo real do MatCap, Cavity Distance, Cavity Intensity, Roughness e Specular.
 */
export const ViewportShadingSpherePreview: React.FC<ViewportShadingSpherePreviewProps> = ({
  config,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const half = size * 0.5;
    const radius = half * 0.86;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    const preset = RESIN_PRESETS[config.preset] || RESIN_PRESETS.clay;
    const [bR, bG, bB] = hexToRgb01(preset.baseColor);
    const [cR, cG, cB] = hexToRgb01(preset.cavityColor);
    const [rR, rG, rB] = hexToRgb01(preset.ridgeColor);

    const { cavityDistance, cavityIntensity, roughness, specularIntensity } = config;
    const wrap = 0.24 + (0.65 - 0.24) * roughness;
    const shininess = 40.0 + (9.0 - 40.0) * roughness;
    const darkToBlack = smoothstepAsc(0.20, 0.92, cavityIntensity);
    const intensityBoost = 1.0 + 1.35 * (cavityIntensity * cavityIntensity);

    // Alcance espacial do Cavity controlado pelo slider Cavity Distance
    const spreadWidth = 0.032 + cavityDistance * 0.165;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const sx = (px - half) / radius;
        const sy = (half - py) / radius;
        const r2 = sx * sx + sy * sy;
        const idx = (py * size + px) * 4;

        if (r2 > 1.0) {
          data[idx] = 18;
          data[idx + 1] = 18;
          data[idx + 2] = 18;
          data[idx + 3] = 255;
          continue;
        }

        const sz = Math.sqrt(Math.max(0.0, 1.0 - r2));
        const r = Math.sqrt(r2);

        // Escultura de teste na esfera: cavidade circular + sulco equatorial
        const eyeDist = Math.hypot(sx + 0.18, sy - 0.14);
        const socketSeam = Math.abs(eyeDist - 0.36);
        const grooveSeam = Math.abs(sy + 0.28 + sx * 0.22);
        const seamDist = Math.min(socketSeam, grooveSeam);

        // Vinco estreito (Imagem 3) vs espalhamento largo na cavidade (Imagem 4)
        const tightValley = Math.exp(-(seamDist * seamDist) / (0.032 * 0.032));
        const wideBowl = eyeDist < 0.52 && eyeDist > 0.20
          ? Math.exp(-((eyeDist - 0.36) * (eyeDist - 0.36)) / (spreadWidth * spreadWidth))
          : 0.0;
        const wideGroove = Math.exp(-(grooveSeam * grooveSeam) / (spreadWidth * spreadWidth));
        const wideValley = Math.max(wideBowl, wideGroove);

        const valleyField = tightValley * (1.0 - cavityDistance * 0.5) + wideValley * cavityDistance;

        // Crista convexa nas bordas externas do sulco/cavidade
        const ridgeDist = Math.min(Math.abs(eyeDist - 0.44), Math.abs(grooveSeam - 0.065));
        const ridgeWidth = 0.028 + cavityDistance * 0.045;
        const ridgeField = Math.exp(-(ridgeDist * ridgeDist) / (ridgeWidth * ridgeWidth));

        // Perturbação suave da normal para dar volume 3D real aos sulcos da esfera
        const nTilt = (seamDist < 0.05 ? -0.26 : 0.18) * tightValley;
        let nx = sx + nTilt * sx;
        let ny = sy + nTilt * sy;
        let nz = sz;
        const nLen = Math.hypot(nx, ny, nz) || 1.0;
        nx /= nLen; ny /= nLen; nz /= nLen;

        // Iluminação Difusa Studio MatCap com Roughness
        const dotL1 = nx * -0.30 + ny * 0.56 + nz * 0.77;
        const dotL2 = nx * 0.44 + ny * 0.22 + nz * 0.87;
        const dotL3 = ny * -0.82 + nz * 0.57;

        const diff1 = clamp((dotL1 + wrap) / (1.0 + wrap), 0.0, 1.0);
        const diff2 = clamp((dotL2 + wrap) / (1.0 + wrap), 0.0, 1.0);
        const bounce = clamp((dotL3 + 0.40) / 1.40, 0.0, 1.0);

        const clayFlatness = (0.92 + (1.02 - 0.92) * nz) * 0.22 * roughness;
        let totalDiffuse = 0.42 + diff1 * 0.42 + diff2 * 0.14 + bounce * 0.08 + clayFlatness;
        totalDiffuse = clamp(totalDiffuse, 0.60, 1.06);

        const valleyMix = clamp(valleyField * cavityIntensity * intensityBoost, 0.0, 1.0);
        const ridgeMix = clamp(ridgeField * Math.min(cavityIntensity * 1.15, 0.75), 0.0, 0.68) * (1.0 - valleyMix * 0.85);

        // Specular acetinado baixo
        const hx = -0.17, hy = 0.31, hz = 0.93;
        const ndoth = Math.max(0.0, nx * hx + ny * hy + nz * hz);
        const spec = Math.pow(ndoth, shininess) * specularIntensity * (1.0 - valleyMix * 0.95);

        const darkR = cR * totalDiffuse * (1.0 - darkToBlack);
        const darkG = cG * totalDiffuse * (1.0 - darkToBlack);
        const darkB = cB * totalDiffuse * (1.0 - darkToBlack);

        let outR = bR * totalDiffuse * (1.0 - valleyMix) + darkR * valleyMix;
        let outG = bG * totalDiffuse * (1.0 - valleyMix) + darkG * valleyMix;
        let outB = bB * totalDiffuse * (1.0 - valleyMix) + darkB * valleyMix;

        const rHiR = rR * 0.75 + 0.25;
        const rHiG = rG * 0.75 + 0.25;
        const rHiB = rB * 0.75 + 0.25;

        outR = outR * (1.0 - ridgeMix) + rHiR * ridgeMix + (rR * 0.65 + 0.35) * spec;
        outG = outG * (1.0 - ridgeMix) + rHiG * ridgeMix + (rG * 0.65 + 0.35) * spec;
        outB = outB * (1.0 - ridgeMix) + rHiB * ridgeMix + (rB * 0.65 + 0.35) * spec;

        // Anti-aliasing suave na borda da esfera contra o fundo (#121212)
        const edgeBlend = 1.0 - smoothstepAsc(0.95, 1.0, r);
        const bg = 18 / 255;
        const finR = outR * edgeBlend + bg * (1.0 - edgeBlend);
        const finG = outG * edgeBlend + bg * (1.0 - edgeBlend);
        const finB = outB * edgeBlend + bg * (1.0 - edgeBlend);

        data[idx] = Math.round(clamp(finR, 0.0, 1.0) * 255);
        data[idx + 1] = Math.round(clamp(finG, 0.0, 1.0) * 255);
        data[idx + 2] = Math.round(clamp(finB, 0.0, 1.0) * 255);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [config]);

  return (
    <div className="shading-sphere-preview-box">
      <canvas
        ref={canvasRef}
        width={124}
        height={124}
        className="shading-sphere-canvas"
        aria-label="Esfera de pré-visualização em tempo real do MatCap e Cavity"
      />
    </div>
  );
};
