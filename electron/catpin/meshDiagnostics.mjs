// =============================================================================
// CatPin Engine — Diagnóstico de Malha e Validação Manifold3D
// Identifica: arestas abertas, arestas não-manifold, orientação e status.
// =============================================================================
import { CatpinError, weldMesh, buildModel } from './meshWelder.mjs';

export { CatpinError, weldMesh, buildModel };

/**
 * Diagnóstico completo de integridade geométrica pré-corte.
 */
export function diagnoseMesh(wasm, positions, indices) {
  const { Manifold, Mesh } = wasm;
  const f32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const totalVertices = f32.length / 3;
  const rawTriCount = indices ? Math.floor(indices.length / 3) : Math.floor(totalVertices / 3);
  const { verts, tris, duplicateVerticesMerged, degenerateFacesRemoved } = weldMesh(positions, indices);

  // Mapa de arestas para contagem de boundary edges (arestas abertas)
  const edgeCounts = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const addEdge = (v1, v2) => {
      const k = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
    };
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  let boundaryEdgesCount = 0;
  let nonManifoldEdgesCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdgesCount++;
    else if (count > 2) nonManifoldEdgesCount++;
  }

  let isClosedManifold = false;
  let invertedWinding = false;
  let volumeMm3 = 0;
  let boundingBox = { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  let status = 'invalid';

  if (tris.length >= 12) {
    try {
      const m = new Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
      m.merge();
      let solid = new Manifold(m);
      if (solid.status() === 'NoError') {
        let vol = solid.volume();
        if (vol < 0) {
          invertedWinding = true;
          const flipped = Uint32Array.from(tris);
          for (let i = 0; i < flipped.length; i += 3) {
            const t = flipped[i + 1];
            flipped[i + 1] = flipped[i + 2];
            flipped[i + 2] = t;
          }
          const mFlip = new Mesh({ numProp: 3, vertProperties: verts, triVerts: flipped });
          mFlip.merge();
          solid = new Manifold(mFlip);
          vol = solid.volume();
        }
        if (vol > 1e-6) {
          isClosedManifold = true;
          boundaryEdgesCount = 0;
          volumeMm3 = vol;
          const bb = solid.boundingBox();
          boundingBox = {
            min: bb.min,
            max: bb.max,
            size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
          };
          status = (
            nonManifoldEdgesCount === 0 &&
            duplicateVerticesMerged === 0 &&
            degenerateFacesRemoved === 0 &&
            !invertedWinding
          )
            ? 'valid'
            : 'repairable';
        }
      }
    } catch {
      isClosedManifold = false;
    }
  }

  return {
    totalVertices,
    totalTriangles: rawTriCount,
    weldedVertices: verts.length / 3,
    weldedTriangles: tris.length / 3,
    duplicateVerticesMerged,
    degenerateFacesRemoved,
    boundaryEdgesCount,
    nonManifoldEdgesCount,
    invertedWinding,
    isClosedManifold,
    volumeMm3,
    boundingBox,
    status,
  };
}
