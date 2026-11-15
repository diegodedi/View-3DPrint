// =============================================================================
// CatPin Engine — Motor CSG do cortador de peças (View 3DPrint)
// Puro Node/ESM: sem DOM, sem Three.js, sem Python. Usa manifold-3d (WASM).
// Espaço de coordenadas: TUDO aqui está no "espaço do modelo" (= espaço local
// da geometria exibida = espaço do arquivo STL original).
// =============================================================================
import Module from 'manifold-3d';
import { sub, add, mul, dot, cross, len, norm, frameFromZ, invRigid, applyPoint } from './algebra.mjs';
import { CatpinError, weldMesh, buildModel, diagnoseMesh } from './meshDiagnostics.mjs';
import { cutterSolid, ensureCCW, executeSeamBladeCut } from './cutSolids.mjs';
import { buildConnectorSolids, suggestConnectorPose, bestPointInRegion } from './connectorBuilder.mjs';
import { isolateTargetIsland } from './islandFilter.mjs';

import { encodeBinaryStl, extractPart } from './stlExporter.mjs';

export { CatpinError, weldMesh, buildModel, diagnoseMesh, suggestConnectorPose, frameFromZ, encodeBinaryStl, extractPart };

let wasmPromise = null;
export function getWasm() {
  if (!wasmPromise) {
    wasmPromise = Module().then((w) => {
      w.setup();
      return w;
    });
  }
  return wasmPromise;
}

// ------------------------------ Operação de Corte ----------------------------
export function executeCut(wasm, input) {
  const t0 = Date.now();
  const { Manifold } = wasm;
  const g = Math.min(Math.max(input.cutGapMm ?? 0, 0), 3);
  const warnings = [];
  let model = buildModel(wasm, input.positions, input.indices);
  const initialSolids = model.decompose().filter(c => Math.abs(c.volume()) >= 0.01);
  if (initialSolids.length > 1) {
    const united = wasm.Manifold.union(initialSolids);
    model.delete();
    for (const s of initialSolids) s.delete();
    model = united;
  } else {
    for (const s of initialSolids) s.delete();
  }
  const bb = model.boundingBox();
  const diag = len(sub(bb.max, bb.min));
  const center = mul(add(bb.min, bb.max), 0.5);
  const cutRef = input.cut.point || (input.cut.basis && input.cut.basis.length === 16 ? [input.cut.basis[12], input.cut.basis[13], input.cut.basis[14]] : center);
  const S = diag * 2 + len(sub(cutRef, center)) * 2 + 50;

  let cutterBForProbe = null;
  let actualSeamCutPoint = null;
  let actualSeamCutNormal = null;
  let partA, partB;

  if (input.cut.kind === 'seam') {
    const seamCut = executeSeamBladeCut(wasm, model, { cut: input.cut, gapMm: g });
    partA = seamCut.partA;
    partB = seamCut.partB;
    actualSeamCutPoint = seamCut.actualCutPoint ?? null;
    actualSeamCutNormal = seamCut.actualCutNormal ?? null;
  } else {
    const cutterB = cutterSolid(wasm, input.cut, { delta: -g / 2, S });
    const cutterA = cutterSolid(wasm, input.cut, { delta: +g / 2, S });
    if (!cutterB || !cutterA) {
      throw new CatpinError('CUTTER_INVALID', 'O contorno de corte ficou pequeno demais para a folga escolhida.');
    }
    cutterBForProbe = cutterB;
    const gapSlab = g > 1e-4 ? cutterA.subtract(cutterB) : null;
    const rawB = model.intersect(cutterB);
    const rawA = model.subtract(cutterA);
    if (rawB.isEmpty()) {
      throw new CatpinError('CUT_MISSES_MODEL', 'O volume de corte não toca o modelo (Parte B ficou vazia).');
    }
    if (rawA.isEmpty()) {
      throw new CatpinError('CUT_COVERS_MODEL', 'O volume de corte cobre o modelo por completo (Parte A ficou vazia).');
    }
    const isolated = isolateTargetIsland(wasm, {
      partA: rawA,
      partB: rawB,
      cutRef,
      cutNormal: input.cut.normal,
      model,
      gapSlab,
    });
    partA = isolated.partA;
    partB = isolated.partB;
  }
  const volA0 = partA.volume(), volB0 = partB.volume();
  const bbA = partA.boundingBox(), bbB = partB.boundingBox();
  const centA = mul(add(bbA.min, bbA.max), 0.5);
  const centB = mul(add(bbB.min, bbB.max), 0.5);
  const toB = sub(centB, centA);

  let effCutNormal = norm(actualSeamCutNormal || input.cut.normal || toB);
  if (dot(effCutNormal, toB) < 0) effCutNormal = mul(effCutNormal, -1);

  const cutPlanePoint = (input.cut.kind === 'plane' || input.cut.kind === 'seam')
    ? (actualSeamCutPoint || input.cut.point || center)
    : center;

  let socketOnB = true, connectorUsed = false, minGapMm = null, connPos = null;
  const c = input.connector && input.connector.type !== 'none' ? input.connector : null;

  if (c) {
    const pinOnA = c.pinSide !== 'partB';
    socketOnB = pinOnA;

    const cutPlaneNormal = norm(actualSeamCutNormal || input.cut.normal || effCutNormal);

    // Centróide exato da seção do corte (CatPin Standard):
    // Se o usuário não definiu offset manual, calcula o centróide exato da face real de contato das peças
    connPos = null;

    const frame = frameFromZ(cutPlaneNormal, cutPlanePoint);
    const invF = invRigid(frame);
    const bTrans = partB.transform(invF);
    const bBox = bTrans.boundingBox();
    const partBIsPos = (bBox.min[2] + bBox.max[2]) >= 0;

    const rPin = (c.diameterMm ?? 6) / 2;
    const margin = rPin * (c.type === 'trapezoid' ? Math.SQRT2 : 1) + (c.clearanceMm ?? 0.25) + 0.8;

    let autoCentroid = null;
    try {
      const zProbeB = partBIsPos ? Math.max(0.05, bBox.min[2] + 0.05) : Math.min(-0.05, bBox.max[2] - 0.05);
      const sectionB = bTrans.slice(zProbeB);

      if (!sectionB.isEmpty() && sectionB.area() > 1) {
        const safeB = sectionB.offset(-margin, 'Round', 16);
        const hitB = bestPointInRegion(!safeB.isEmpty() ? safeB : sectionB);
        if (hitB) {
          autoCentroid = applyPoint(frame, [hitB.pt[0], hitB.pt[1], 0]);
        }
        safeB.delete();
      }
      sectionB.delete();

      if (!autoCentroid) {
        const aTrans = partA.transform(invF);
        const aBox = aTrans.boundingBox();
        const partAIsPos = (aBox.min[2] + aBox.max[2]) >= 0;
        const zProbeA = partAIsPos ? Math.max(0.05, aBox.min[2] + 0.05) : Math.min(-0.05, aBox.max[2] - 0.05);
        const sectionA = aTrans.slice(zProbeA);
        aTrans.delete();

        if (!sectionA.isEmpty() && sectionA.area() > 1) {
          const safeA = sectionA.offset(-margin, 'Round', 16);
          const hitA = bestPointInRegion(!safeA.isEmpty() ? safeA : sectionA);
          if (hitA) {
            autoCentroid = applyPoint(frame, [hitA.pt[0], hitA.pt[1], 0]);
          }
          safeA.delete();
        }
        sectionA.delete();
      }
    } catch { /* contingência graciosa */ }
    bTrans.delete();

    // Posição do conector no plano da junta:
    // Se o usuário reposicionou manualmente o conector (hasManualPosition), respeita 100% a posição 3D escolhida.
    // No modo automático, ancora no centróide analítico exato da seção transversal cortada.
    if (!c.hasManualPosition) {
      connPos = autoCentroid || (c.position ? [...c.position] : cutPlanePoint);
      const shift = dot(sub(cutPlanePoint, connPos), cutPlaneNormal);
      connPos = add(connPos, mul(cutPlaneNormal, shift));
    } else {
      connPos = c.position ? [...c.position] : cutPlanePoint;
    }

    // Determinação precisa de pinBase (peça do pino) e sockBase (peça do furo):
    const pinBase = pinOnA ? partA : partB;
    const sockBase = pinOnA ? partB : partA;

    // Direção analítica perpendicular da junta apontando de pinBase para sockBase:
    const dirAtoB = effCutNormal;
    const dirToSock = pinOnA ? dirAtoB : mul(dirAtoB, -1);

    // Eixo de orientação do conector (effAxis e effXAxis):
    // Se o usuário rotacionou o conector em 3D (c.axis), respeita 100% o ângulo e rotação rígida do usuário.
    let effAxis = c.axis && (c.axis[0] !== 0 || c.axis[1] !== 0 || c.axis[2] !== 0)
      ? norm(c.axis)
      : norm(dirToSock);
    let effXAxis = c.xAxis;

    // Se a orientação apontar para o semi-espaço oposto ao furo, alinha a polaridade preservando a base anti-rotação:
    if (dot(effAxis, dirToSock) < 0) {
      effAxis = mul(effAxis, -1);
      if (effXAxis) effXAxis = mul(effXAxis, -1);
    }

    const { pin, socket, pinFootprint, embed, socketCavityVolume } = buildConnectorSolids(
      wasm,
      { ...c, position: connPos, axis: effAxis, xAxis: effXAxis },
      { cutNormal: dirToSock }
    );

    const anchor = pin.intersect(pinBase).volume();
    if (anchor < 0.5 * pinFootprint * embed) {
      warnings.push({
        code: 'PIN_WEAK_ANCHOR',
        message: 'O pino tem pouco material de apoio (parede fina ou conector fora da peça).',
      });
    }

    const checkVol = socketCavityVolume || (0.7 * socket.volume());
    if (socket.intersect(sockBase).volume() < 0.75 * checkVol) {
      warnings.push({
        code: 'SOCKET_OUT_OF_MATERIAL',
        message: 'O furo vaza para fora da peça ou a parede ficou fina. Reduza dimensões ou reposicione.',
      });
    }

    const withPin = pinBase.add(pin);
    const withSocket = sockBase.subtract(socket);
    if (pinBase === partA) {
      partA = withPin;
      partB = withSocket;
    } else {
      partB = withPin;
      partA = withSocket;
    }
    connectorUsed = true;

    const interf = partA.intersect(partB).volume();
    if (interf > 1e-3 * Math.max(pin.volume(), 1)) {
      warnings.push({
        code: 'PARTS_INTERFERE',
        message: 'As peças se interpenetram após o encaixe (folga insuficiente). Aumente o clearance.',
      });
    }
  }

  if (partA.numTri() + partB.numTri() < 400000) {
    try { minGapMm = partA.minGap(partB, 2); } catch { /* informativo */ }
  }

  const A = extractPart(partA), B = extractPart(partB);
  if (A.islands > 1) warnings.push({ code: 'ISLANDS_A', message: `A Parte A tem ${A.islands} pedaços desconectados.` });
  if (B.islands > 1) warnings.push({ code: 'ISLANDS_B', message: `A Parte B tem ${B.islands} pedaços desconectados.` });

  const seamCenter = connectorUsed && connPos ? connPos : mul(add(A.centroid, B.centroid), 0.5);
  const explodeDir = effCutNormal;

  return {
    partA: A,
    partB: B,
    warnings,
    explodeDir,
    seamCenter,
    minGapMm,
    connectorUsed,
    originalVolumeMm3: model.volume(),
    volumesBeforeConnector: [volA0, volB0],
    timeMs: Date.now() - t0,
  };
}

// ------------------------------ Roteador de Jobs -----------------------------
export async function runJob(job) {
  const wasm = await getWasm();
  try {
    if (job.type === 'cut') return executeCut(wasm, job);
    if (job.type === 'suggest') return suggestConnectorPose(wasm, job);
    if (job.type === 'diagnose') return diagnoseMesh(wasm, job.positions, job.indices);
    throw new CatpinError('INTERNAL', `Job desconhecido: ${job.type}`);
  } catch (e) {
    if (e instanceof CatpinError) throw e;
    throw new CatpinError('INTERNAL', `Falha interna do motor de corte: ${e?.message ?? e}`);
  }
}
