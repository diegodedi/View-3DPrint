// =============================================================================
// CatPin Engine — Exportador STL Binário e Extração de Métricas de Peça
// Puro Node/ESM: serialização binária padrão STL Little-Endian (84 bytes header)
// =============================================================================
import { sub, cross, norm } from './algebra.mjs';

/**
 * Serializa posições e índices de triângulos no padrão binário STL (50 bytes/triângulo).
 * @param {Float32Array|Array<number>} positions
 * @param {Uint32Array|Array<number>} indices
 * @returns {ArrayBuffer}
 */
export function encodeBinaryStl(positions, indices) {
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const ia = indices[3 * t] * 3;
    const ib = indices[3 * t + 1] * 3;
    const ic = indices[3 * t + 2] * 3;
    const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
    const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
    const c = [positions[ic], positions[ic + 1], positions[ic + 2]];
    const n = norm(cross(sub(b, a), sub(c, a)));
    for (const v of [n, a, b, c]) {
      dv.setFloat32(o, v[0], true);
      dv.setFloat32(o + 4, v[1], true);
      dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/**
 * Extrai buffer STL, contagem de triângulos, volume, ilhas e centróide da malha Manifold3D.
 * @param {import('manifold-3d').Manifold} m
 */
export function extractPart(m) {
  const rawComps = m.decompose();
  const minVol = Math.min(0.25, Math.max(1e-7, Math.abs(m.volume()) * 1e-4));
  const comps = rawComps.filter(c => Math.abs(c.volume()) >= minVol);
  const cleanM = (comps.length > 0 && comps.length < rawComps.length)
    ? comps.reduce((acc, c) => acc.add(c))
    : m;
  const mesh = cleanM.getMesh();
  const positions = mesh.vertProperties;
  const indices = mesh.triVerts;
  let cx = 0, cy = 0, cz = 0;
  const nv = positions.length / 3;
  for (let i = 0; i < nv; i++) {
    cx += positions[3 * i];
    cy += positions[3 * i + 1];
    cz += positions[3 * i + 2];
  }
  return {
    stl: encodeBinaryStl(positions, indices),
    triangles: indices.length / 3,
    volumeMm3: cleanM.volume(),
    islands: Math.max(1, comps.length),
    centroid: nv ? [cx / nv, cy / nv, cz / nv] : [0, 0, 0],
    bounds: cleanM.boundingBox(),
  };
}

