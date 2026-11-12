// =============================================================================
// CatPin Engine — Filtro e Isolamento de Ilhas Conexas (Island Filter)
// Isola a ilha alvo destacada mais próxima do ponto de corte e preserva o corpo.
// =============================================================================
import { sub, len, norm } from './algebra.mjs';

/**
 * Isola a componente conexa alvo de Part B mais próxima da referência de corte
 * e reanexa componentes do corpo principal a Part A.
 */
export function isolateTargetIsland(wasm, options) {
  const { partA, partB, cutRef, cutNormal = null, model = null, gapSlab = null } = options;
  const allCompsB = partB.decompose();
  const bComps = allCompsB.filter((c) => Math.abs(c.volume()) >= 0.01);

  let bestBIdx = 0, minDistB = Infinity;
  for (let i = 0; i < bComps.length; i++) {
    const bb = bComps[i].boundingBox();
    const dx = Math.max(0, bb.min[0] - cutRef[0], cutRef[0] - bb.max[0]);
    const dy = Math.max(0, bb.min[1] - cutRef[1], cutRef[1] - bb.max[1]);
    const dz = Math.max(0, bb.min[2] - cutRef[2], cutRef[2] - bb.max[2]);
    const d = Math.hypot(dx, dy, dz);
    if (d < minDistB) { minDistB = d; bestBIdx = i; }
  }
  const isolatedB = bComps.length > 0 ? bComps[bestBIdx] : partB;
  const strayB = bComps.filter((_, idx) => idx !== bestBIdx);

  const allCompsA = partA.decompose();
  const aComps = allCompsA.filter((c) => Math.abs(c.volume()) >= 0.01);

  let mainAIdx = 0, maxVolA = -Infinity;
  for (let i = 0; i < aComps.length; i++) {
    const v = aComps[i].volume();
    if (v > maxVolA) { maxVolA = v; mainAIdx = i; }
  }

  const finalA = aComps.length > 0 ? [aComps[mainAIdx]] : [partA];
  const normDir = cutNormal && len(cutNormal) > 1e-6 ? norm(cutNormal) : null;

  for (let i = 0; i < aComps.length; i++) {
    if (i === mainAIdx) continue;
    if (normDir) {
      const bb = aComps[i].boundingBox();
      const cen = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
      const d = (cen[0] - cutRef[0]) * normDir[0] + (cen[1] - cutRef[1]) * normDir[1] + (cen[2] - cutRef[2]) * normDir[2];
      if (d <= 0.5) finalA.push(aComps[i]);
    } else {
      finalA.push(aComps[i]);
    }
  }

  const strayGaps = [];
  if (strayB.length > 0 && model && gapSlab) {
    try {
      const gapSlices = model.intersect(gapSlab).decompose();
      for (const gs of gapSlices) {
        const bb = gs.boundingBox();
        const dx = Math.max(0, bb.min[0] - cutRef[0], cutRef[0] - bb.max[0]);
        const dy = Math.max(0, bb.min[1] - cutRef[1], cutRef[1] - bb.max[1]);
        const dz = Math.max(0, bb.min[2] - cutRef[2], cutRef[2] - bb.max[2]);
        const d = Math.hypot(dx, dy, dz);
        if (d > 1.5) strayGaps.push(gs);
      }
    } catch {
      // informativo
    }
  }
  const partsToUnion = [...finalA, ...strayB, ...strayGaps];
  return {
    partA: partsToUnion.length > 1 ? wasm.Manifold.union(partsToUnion) : partsToUnion[0],
    partB: isolatedB,
  };
}

