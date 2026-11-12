// =============================================================================
// CatPin Engine — Soldagem de Malhas e Construção de Sólidos Manifold3D
// Isola as rotinas de soldagem bit-a-bit, soldagem com tolerância e cura progressiva.
// =============================================================================

export class CatpinError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Solda vértices idênticos bit a bit e filtra triângulos degenerados.
 */
export function weldMesh(positions, indices) {
  const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const u32 = new Uint32Array(f32.buffer, f32.byteOffset, f32.length);
  const count = f32.length / 3;
  const map = new Map();
  const remap = new Uint32Array(count);
  const verts = [];

  for (let i = 0; i < count; i++) {
    const bx = f32[3 * i] === 0 ? 0 : u32[3 * i];
    const by = f32[3 * i + 1] === 0 ? 0 : u32[3 * i + 1];
    const bz = f32[3 * i + 2] === 0 ? 0 : u32[3 * i + 2];
    const key = `${bx}_${by}_${bz}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(f32[3 * i], f32[3 * i + 1], f32[3 * i + 2]);
    }
    remap[i] = id;
  }

  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(count / 3);
  const tris = [];
  let degenerateFacesRemoved = 0;

  for (let t = 0; t < triCount; t++) {
    const a = remap[indices ? indices[3 * t] : 3 * t];
    const b = remap[indices ? indices[3 * t + 1] : 3 * t + 1];
    const c = remap[indices ? indices[3 * t + 2] : 3 * t + 2];
    if (a === b || b === c || a === c) {
      degenerateFacesRemoved++;
      continue;
    }
    tris.push(a, b, c);
  }

  const duplicateVerticesMerged = count - verts.length / 3;
  return {
    verts: Float32Array.from(verts),
    tris: Uint32Array.from(tris),
    duplicateVerticesMerged,
    degenerateFacesRemoved,
  };
}

/**
 * Solda vértices com tolerância espacial (grid snapping) para fechar micro-fendas de ponto flutuante.
 */
export function weldMeshWithTolerance(positions, indices, tol = 1e-4) {
  const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const count = f32.length / 3;
  const invTol = 1 / tol;
  const map = new Map();
  const remap = new Uint32Array(count);
  const verts = [];

  for (let i = 0; i < count; i++) {
    const kx = Math.round(f32[3 * i] * invTol);
    const ky = Math.round(f32[3 * i + 1] * invTol);
    const kz = Math.round(f32[3 * i + 2] * invTol);
    const key = `${kx}_${ky}_${kz}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(f32[3 * i], f32[3 * i + 1], f32[3 * i + 2]);
    }
    remap[i] = id;
  }

  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(count / 3);
  const tris = [];
  let degenerateFacesRemoved = 0;

  for (let t = 0; t < triCount; t++) {
    const a = remap[indices ? indices[3 * t] : 3 * t];
    const b = remap[indices ? indices[3 * t + 1] : 3 * t + 1];
    const c = remap[indices ? indices[3 * t + 2] : 3 * t + 2];
    if (a === b || b === c || a === c) {
      degenerateFacesRemoved++;
      continue;
    }
    tris.push(a, b, c);
  }

  return {
    verts: Float32Array.from(verts),
    tris: Uint32Array.from(tris),
    duplicateVerticesMerged: count - verts.length / 3,
    degenerateFacesRemoved,
  };
}

function tryMakeSolid(wasm, v, t) {
  if (!t || t.length < 12) return null;
  const { Manifold, Mesh } = wasm;
  try {
    const m = new Mesh({ numProp: 3, vertProperties: v, triVerts: t });
    m.merge();
    let s = new Manifold(m);
    if (s.volume() < 0) {
      const flipped = Uint32Array.from(t);
      for (let i = 0; i < flipped.length; i += 3) {
        const tmp = flipped[i + 1];
        flipped[i + 1] = flipped[i + 2];
        flipped[i + 2] = tmp;
      }
      const mF = new Mesh({ numProp: 3, vertProperties: v, triVerts: flipped });
      mF.merge();
      s = new Manifold(mF);
    }
    if (!s.isEmpty() && s.volume() > 1e-6) {
      return s;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Constrói um sólido fechado Manifold3D com cura progressiva para micro-fendas de ponto flutuante.
 */
export function buildModel(wasm, positions, indices) {
  // 1. Tentativa primária: soldagem bit-a-bit exata (velocidade pura e fidelidade)
  const primary = weldMesh(positions, indices);
  let model = tryMakeSolid(wasm, primary.verts, primary.tris);

  // 2. Se a malha tem micro-fendas de arredondamento (ponto flutuante), aplica tolerâncias espaciais
  if (!model) {
    for (const tol of [1e-5, 1e-4, 5e-4, 1e-3, 2e-3, 5e-3]) {
      const w = weldMeshWithTolerance(positions, indices, tol);
      model = tryMakeSolid(wasm, w.verts, w.tris);
      if (model) break;
    }
  }

  // 3. Se havia índices (Three.js/OBJ) com arestas não-manifold, desindexa para sopa pura de triângulos e re-solda
  if (!model && indices && indices.length > 0) {
    const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    const soup = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const vi = indices[i];
      soup[3 * i] = f32[3 * vi];
      soup[3 * i + 1] = f32[3 * vi + 1];
      soup[3 * i + 2] = f32[3 * vi + 2];
    }
    for (const tol of [0, 1e-5, 1e-4, 5e-4, 1e-3, 2e-3, 5e-3]) {
      const w = tol === 0 ? weldMesh(soup, null) : weldMeshWithTolerance(soup, null, tol);
      model = tryMakeSolid(wasm, w.verts, w.tris);
      if (model) break;
    }
  }

  // 4. Se for sopa de triângulos, tenta montagem direta no motor Manifold3D
  if (!model && (!indices || indices.length === 0)) {
    const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    const triCount = Math.floor(f32.length / 9);
    const rawTris = new Uint32Array(triCount * 3);
    for (let i = 0; i < rawTris.length; i++) rawTris[i] = i;
    model = tryMakeSolid(wasm, f32, rawTris);
  }

  if (!model) {
    throw new CatpinError(
      'MODEL_NOT_MANIFOLD',
      'A malha do modelo não é um sólido fechado (tem buracos, arestas abertas ou auto-interseções). ' +
      'Repare o arquivo (Creality Print > Reparar, 3D Builder, Meshmixer ou Blender) antes de cortar.'
    );
  }

  return model;
}

