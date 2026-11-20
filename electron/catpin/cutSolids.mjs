// =============================================================================
// CatPin Engine — Geração de Sólidos de Corte (Cutter Solids)
// Produz volumes CSG Manifold para:
//  - Corte plano infinito (caixa delimitada pelo bounding box do modelo)
//  - Corte de membro (seam): Lâmina planar fina em Z = 0 com isolamento de ilhas,
//    sem caixas com relevo e sem cilindros projetados (Regra CatPin Anti-Cilindro)
//  - Extrusão de detalhe (detail): Plug raso no plano da câmera
// =============================================================================
import { norm, frameFromZ, invRigid, sub, add, mul, dot, len } from './algebra.mjs';
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

function computePolygonSpanUV(poly, fallbackSpan) {
  if (!poly || poly.length < 2) return fallbackSpan;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of poly) {
    if (p[0] < minU) minU = p[0];
    if (p[0] > maxU) maxU = p[0];
    if (p[1] < minV) minV = p[1];
    if (p[1] > maxV) maxV = p[1];
  }
  return Math.max(maxU - minU, maxV - minV, 1e-4);
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

  const bb = model.boundingBox();
  const modelDiag = Math.max(len(sub(bb.max, bb.min)), 1e-4);
  const loopSpan = computePolygonSpanUV(cut.polygonUV, modelDiag * 0.25);
  const minBlade = Math.min(0.08, Math.max(loopSpan * 0.004, 1e-4));
  const hBlade = Math.max(g, minBlade);
  const modelCenter = [
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  ];
  let nDir = norm(cut.normal);
  const outward = norm(sub(cutRef, modelCenter));
  if (!cut.flipSide && len(outward) > 1e-4 && dot(nDir, outward) < 0) {
    nDir = mul(nDir, -1);
  }

  const basis = cut.basis && cut.basis.length === 16 ? cut.basis : frameFromZ(nDir, cutRef);
  const modelVol = Math.abs(model.volume());
  const minValidVol = Math.min(0.35, Math.max(1e-7, modelVol * 1e-4));
  const bigVol = Math.max(minValidVol, modelVol * 5e-3);

  // Diagnóstico de componentes e genus pré-existentes (alças fechadas possuem genus >= 1)
  const initialGenus = model.genus();
  const initialComps = model.decompose().filter((c) => c.volume() >= minValidVol);
  const initialCount = initialComps.length;
  const initBigCount = initialComps.filter((c) => c.volume() >= bigVol).length;
  for (const c of initialComps) c.delete();

  const didSeparate = (comps) => {
    if (comps.length > initialCount) return true;
    return initialCount > 1 && comps.filter((c) => c.volume() >= bigVol).length > initBigCount;
  };

  let rawComps = null;
  let severedClosedLoop = false;

  // FASE 1: Seccionamento por Lâmina 3D Conforme Fina (Z = 0, espessura hBlade)
  // Escala apenas em UV (mantendo Z=1 e curvatura w(u,v) intacta — Regra Anti-Cilindro).
  if (cut.bladeMesh && cut.bladeMesh.positions && cut.bladeMesh.indices) {
    let blade3D = null;
    let bladeLocal = null;
    try {
      blade3D = buildModel(wasm, cut.bladeMesh.positions, cut.bladeMesh.indices);
      if (blade3D && blade3D.status() === 'NoError' && blade3D.volume() > 1e-9) {
        bladeLocal = blade3D.transform(invRigid(basis));
        const lBb = bladeLocal.boundingBox();
        const cu = (lBb.min[0] + lBb.max[0]) * 0.5;
        const cv = (lBb.min[1] + lBb.max[1]) * 0.5;
        const uvScales = [1.0, 1.08, 1.18, 1.32, 1.5];

        for (const s of uvScales) {
          let candidate = blade3D;
          if (s > 1.0) {
            const shifted = bladeLocal.translate([-cu, -cv, 0]);
            const scaled = shifted.scale([s, s, 1]);
            const restored = scaled.translate([cu, cv, 0]);
            candidate = restored.transform(basis);
            shifted.delete();
            scaled.delete();
            restored.delete();
          }
          const subRes = model.subtract(candidate);
          if (candidate !== blade3D) candidate.delete();

          const comps = subRes.decompose().filter((c) => c.volume() >= minValidVol);
          if (didSeparate(comps)) {
            subRes.delete();
            rawComps = comps;
            break;
          }
          if (initialGenus >= 1 && comps.length === initialCount) {
            const gAfter = subRes.genus();
            if (gAfter >= 0 && gAfter < initialGenus) severedClosedLoop = true;
          }
          for (const c of comps) c.delete();
          subRes.delete();
        }
      }
    } catch {
      // Continua para contingência da lâmina 2D caso a malha 3D falhe
    } finally {
      if (bladeLocal) bladeLocal.delete();
      if (blade3D) blade3D.delete();
    }
  }

  // FASE 2: Se a lâmina 3D não separou, opera com Lâmina seccionadora delimitada ao contorno da junta
  // Regra Anti-Cilindro: Lâmina fina em Z=0 (espessura hBlade), zero extrusão prismática em Z e
  // micro-offsets proporcionais ao diâmetro local do contorno.
  if (!rawComps) {
    if (!cut.polygonUV || cut.polygonUV.length < 3) {
      throw new CatpinError('CUTTER_INVALID', 'O contorno de corte precisa de pelo menos 3 pontos.');
    }

    const cs = CrossSection.ofPolygons([ensureCCW(cut.polygonUV)], 'NonZero');
    if (cs.isEmpty() || cs.area() < 1e-8) {
      cs.delete();
      throw new CatpinError('CUTTER_INVALID', 'Contorno de corte do membro inválido.');
    }

    const effBladeThick = hBlade;
    const offsetRatios = [0, 0.025, 0.05, 0.08, 0.12, 0.18, 0.26, 0.36, 0.5];
    for (const ratio of offsetRatios) {
      const r = ratio * loopSpan;
      const blade2D = r > 0 ? cs.offset(r, 'Round', 16) : cs;
      const rawBlade = Manifold.extrude(blade2D, effBladeThick, 0, 0, [1, 1], true);
      const worldBlade = rawBlade.transform(basis);
      rawBlade.delete();
      const subRes = model.subtract(worldBlade);
      const comps = subRes.decompose().filter((c) => c.volume() >= minValidVol);

      if (r > 0) blade2D.delete();
      worldBlade.delete();

      if (didSeparate(comps)) {
        subRes.delete();
        rawComps = comps;
        break;
      }
      if (initialGenus >= 1 && comps.length === initialCount) {
        const gAfter = subRes.genus();
        if (gAfter >= 0 && gAfter < initialGenus) severedClosedLoop = true;
      }
      for (const c of comps) c.delete();
      subRes.delete();
    }
    cs.delete();
  }

  if (rawComps && rawComps.length >= 2) {
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

    const limbPart = sorted[bestLimbIdx];
    const bodyParts = sorted.filter((_, idx) => idx !== bestLimbIdx);
    const bodyPart = bodyParts.length > 1 ? Manifold.union(bodyParts) : bodyParts[0];
    if (bodyParts.length > 1) {
      for (const bp of bodyParts) bp.delete();
    }
    const partA = cut.flipSide ? limbPart : bodyPart;
    const partB = cut.flipSide ? bodyPart : limbPart;
    return { partA, partB, actualCutPoint: cutRef, actualCutNormal: nDir };
  }

  if (severedClosedLoop) {
    throw new CatpinError(
      'CUT_CLOSED_LOOP',
      'O corte atravessou a junta por completo, mas o membro continua preso ao restante do modelo por outro ponto (ex.: base comum, mão encostada no corpo, capa ou acessório). Separe primeiro esse outro ponto de contato antes de destacar este membro.'
    );
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
      const orig = cs;
      cs = orig.offset(delta, 'Miter', 2);
      orig.delete();
    }
    if (cs.isEmpty() || cs.area() < 1e-6) {
      cs.delete();
      return null;
    }

    const depth = Math.max(Math.abs(cut.wMin ?? -5.0), 0.1);
    const outwardH = Math.max(cut.wMax ?? 50.0, 10.0);
    const taperScale = cut.scale ?? [1, 1];

    // Espiga interna de encaixe (Z de 0 a -depth, afunilando para taperScale)
    const inward = Manifold.extrude(cs, depth, 0, 0, taperScale, false).scale([1, 1, -1]);

    // Envelope externo (Z de 0 a +outwardH, reto 1.0x para preservar 100% do relevo do detalhe)
    const outward = Manifold.extrude(cs, outwardH, 0, 0, [1, 1], false);
    cs.delete();

    const fullCutter = Manifold.union([inward, outward]);
    inward.delete();
    outward.delete();

    const basis = cut.basis ?? frameFromZ(cut.normal, cut.point);
    const result = fullCutter.transform(basis);
    fullCutter.delete();
    return result;
  }

  throw new CatpinError('CUTTER_INVALID', `Tipo de corte desconhecido: ${cut.kind}`);
}
