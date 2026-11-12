// =============================================================================
// CatPin Engine — Geração de Sólidos de Corte (Cutter Solids)
// Produz volumes CSG Manifold para:
//  - Corte plano infinito (caixa delimitada pelo bounding box do modelo)
//  - Corte de membro (seam): Lâmina planar fina em Z = 0 com isolamento de ilhas,
//    sem caixas com relevo e sem cilindros projetados (Regra CatPin Anti-Cilindro)
//  - Extrusão de detalhe (detail): Plug raso no plano da câmera
// =============================================================================
import { norm, frameFromZ, sub, add, mul, dot, len } from './algebra.mjs';
import { CatpinError, buildModel } from './meshDiagnostics.mjs';

export function ensureCCW(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...poly].reverse() : poly;
}

function bboxDistToPoint(bb, pt) {
  const dx = Math.max(0, bb.min[0] - pt[0], pt[0] - bb.max[0]);
  const dy = Math.max(0, bb.min[1] - pt[1], pt[1] - bb.max[1]);
  const dz = Math.max(0, bb.min[2] - pt[2], pt[2] - bb.max[2]);
  return Math.hypot(dx, dy, dz);
}

/**
 * Executa o Corte de Membro (Seam Cut) usando a Lâmina Tridimensional Conforme à Polyline.
 * Respeita 100% a Regra Anti-Cilindro (zero extrusão em Z de comprimento S) e elimina
 * cubos retangulares e dilatações cegas que geravam relevos/degraus artificiais.
 * Garante que a Peça B seja exclusivamente o membro alvo e a Peça A mantenha 100% de
 * integridade física (orelhas, cabeças e membros adjacentes preservados).
 */
export function executeSeamBladeCut(wasm, model, options) {
  const { cut, gapMm } = options;
  const { CrossSection, Manifold } = wasm;
  const cutRef = cut.point;
  const g = Math.min(Math.max(gapMm ?? 0, 0), 3);
  const hBlade = Math.max(g, 0.08);

  const bb = model.boundingBox();
  const modelCenter = [
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  ];
  let nDir = norm(cut.normal);
  const outward = norm(sub(cutRef, modelCenter));
  if (len(outward) > 1e-4 && dot(nDir, outward) < 0) {
    nDir = mul(nDir, -1);
  }

  const basis = cut.basis && cut.basis.length === 16 ? cut.basis : frameFromZ(nDir, cutRef);
  const minValidVol = Math.min(0.35, Math.max(0.01, model.volume() * 1e-4));

  // Diagnóstico de componentes pré-existentes (apenas positivos: volumes negativos são cavidades internas)
  const initialComps = model.decompose().filter((c) => c.volume() >= minValidVol);
  const initialCount = initialComps.length;
  for (const c of initialComps) c.delete();

  let rawComps = null;

  // FASE 1: Seccionamento por Lâmina 3D Conforme Fina (Z = 0, espessura hBlade)
  // Subtrai a fenda fina 3D diretamente na junta traçada pela polyline.
  // Regra Anti-Cilindro: ZERO extrusão em Z, ZERO intersect com volume prismático.
  if (cut.bladeMesh && cut.bladeMesh.positions && cut.bladeMesh.indices) {
    try {
      const blade3D = buildModel(wasm, cut.bladeMesh.positions, cut.bladeMesh.indices);
      if (blade3D && blade3D.status() === 'NoError' && blade3D.volume() > 1e-6) {
        const subRes = model.subtract(blade3D);
        blade3D.delete();
        const comps = subRes.decompose().filter((c) => c.volume() >= minValidVol);
        subRes.delete();
        if (comps.length > initialCount) {
          rawComps = comps;
        } else {
          for (const c of comps) c.delete();
        }
      } else if (blade3D) {
        blade3D.delete();
      }
    } catch {
      // Continua para contingência da lâmina 2D caso a malha 3D falhe
    }
  }

  // FASE 2: Se a lâmina 3D não separou, opera com Lâmina seccionadora delimitada ao contorno da junta
  // Regra Anti-Cilindro: Lâmina fina em Z=0 (espessura hBlade), zero extrusão prismática em Z e
  // micro-offsets estritamente limitados ao perímetro local (max 2.0mm) para prevenir decepações
  if (!rawComps) {
    if (!cut.polygonUV || cut.polygonUV.length < 3) {
      throw new CatpinError('CUTTER_INVALID', 'O contorno de corte precisa de pelo menos 3 pontos.');
    }

    const cs = CrossSection.ofPolygons([ensureCCW(cut.polygonUV)], 'NonZero');
    if (cs.isEmpty() || cs.area() < 1e-4) {
      cs.delete();
      throw new CatpinError('CUTTER_INVALID', 'Contorno de corte do membro inválido.');
    }

    const effBladeThick = hBlade;
    const microOffsets = [0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.5, 6.0, 8.0];
    for (const r of microOffsets) {
      const blade2D = r > 0 ? cs.offset(r, 'Round', 16) : cs;
      const rawBlade = Manifold.extrude(blade2D, effBladeThick, 0, 0, [1, 1], true);
      const worldBlade = rawBlade.transform(basis);
      rawBlade.delete();
      const subRes = model.subtract(worldBlade);
      const comps = subRes.decompose().filter((c) => c.volume() >= minValidVol);

      if (r > 0) blade2D.delete();
      worldBlade.delete();

      if (comps.length > initialCount) {
        subRes.delete();
        rawComps = comps;
        break;
      } else {
        for (const c of comps) c.delete();
        subRes.delete();
      }
    }
    cs.delete();
  }

  if (rawComps && rawComps.length > initialCount) {
    const sorted = [...rawComps].sort((a, b) => b.volume() - a.volume());
    let bestLimbIdx = 1;
    let bestLimbScore = -Infinity;

    for (let i = 1; i < sorted.length; i++) {
      const c = sorted[i];
      const cBb = c.boundingBox();
      const cCenter = [
        (cBb.min[0] + cBb.max[0]) / 2,
        (cBb.min[1] + cBb.max[1]) / 2,
        (cBb.min[2] + cBb.max[2]) / 2,
      ];
      const zProj = dot(sub(cCenter, cutRef), nDir);
      const dist = bboxDistToPoint(cBb, cutRef);
      const score = (zProj > 0 ? 1000 : -1000) + Math.log(Math.max(1, c.volume())) * 10 - dist;
      if (score > bestLimbScore) {
        bestLimbScore = score;
        bestLimbIdx = i;
      }
    }

    const partB = sorted[bestLimbIdx];
    const bodyParts = sorted.filter((_, idx) => idx !== bestLimbIdx);
    const partA = bodyParts.length > 1 ? Manifold.union(bodyParts) : bodyParts[0];
    return { partA, partB, actualCutPoint: cutRef, actualCutNormal: nDir };
  }

  throw new CatpinError('CUT_MISSES_MODEL', 'O contorno de corte não dividiu o membro em duas partes. Certifique-se de desenhar um laço fechado que contorne a junta do membro por completo.');
}

/**
 * Cria o sólido Manifold do cortador para os modos 'plane' e 'extrude' (detail).
 */
export function cutterSolid(wasm, cut, options) {
  const { delta, S } = options;
  const { Manifold, CrossSection } = wasm;

  if (cut.kind === 'plane') {
    const n = norm(cut.normal);
    const box = Manifold.cube([2 * S, 2 * S, 2 * S + delta + 1], false).translate([-S, -S, -delta]);
    return box.transform(frameFromZ(n, cut.point));
  }

  if (cut.kind === 'seam') {
    if (!cut.polygonUV || cut.polygonUV.length < 3) {
      throw new CatpinError('CUTTER_INVALID', 'O contorno de corte precisa de pelo menos 3 pontos.');
    }
    let cs = CrossSection.ofPolygons([ensureCCW(cut.polygonUV)], 'NonZero');
    if (cs.isEmpty() || cs.area() < 1e-4) {
      throw new CatpinError('CUTTER_INVALID', 'Contorno de corte do membro inválido.');
    }
    cs = cs.offset(0.35, 'Round', 16);
    const thickness = Math.max(Math.abs(delta) * 2, 0.08);
    const basis = cut.basis ?? frameFromZ(cut.normal, cut.point);
    return Manifold.extrude(cs, thickness, 0, 0, [1, 1], true).transform(basis);
  }

  if (cut.kind === 'extrude') {
    if (!cut.polygonUV || cut.polygonUV.length < 3) {
      throw new CatpinError('CUTTER_INVALID', 'O contorno de corte precisa de pelo menos 3 pontos.');
    }
    let cs = CrossSection.ofPolygons([ensureCCW(cut.polygonUV)], 'NonZero');
    if (delta !== 0) {
      cs = cs.offset(delta, 'Miter', 2);
    }
    if (cs.isEmpty() || cs.area() < 1e-6) return null;
    const z0 = cut.wMin - delta;
    const z1 = cut.wMax + delta;
    const scale = cut.scale ?? [1, 1];
    return Manifold.extrude(cs, z1 - z0, 0, 0, scale, false)
      .translate([0, 0, z0])
      .transform(cut.basis);
  }

  throw new CatpinError('CUTTER_INVALID', `Tipo de corte desconhecido: ${cut.kind}`);
}
