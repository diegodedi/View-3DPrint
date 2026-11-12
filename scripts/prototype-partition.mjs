// ISENÇÃO (GOLDCODE): Protótipo Geométrico Isolado v2 — Partição por Primeira Casca
import { getWasm } from '../electron/catpin/engine.mjs';
import { ensureCCW } from '../electron/catpin/cutSolids.mjs';

const wasm = await getWasm();
const { Manifold, CrossSection, Mesh } = wasm;

export function raycastShellIntervals(options) {
  const { meshData, u, v, bucketTris = null } = options;
  const { triVerts, vertProperties } = meshData;
  const hits = [];
  const count = bucketTris ? bucketTris.length : triVerts.length / 3;
  for (let idx = 0; idx < count; idx++) {
    const t = (bucketTris ? bucketTris[idx] : idx) * 3;
    const i0 = triVerts[t] * 3, i1 = triVerts[t + 1] * 3, i2 = triVerts[t + 2] * 3;
    const [u0, v0, w0] = [vertProperties[i0], vertProperties[i0 + 1], vertProperties[i0 + 2]];
    const [u1, v1, w1] = [vertProperties[i1], vertProperties[i1 + 1], vertProperties[i1 + 2]];
    const [u2, v2, w2] = [vertProperties[i2], vertProperties[i2 + 1], vertProperties[i2 + 2]];
    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(denom) < 1e-9) continue;
    const l0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / denom;
    const l1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / denom;
    const l2 = 1 - l0 - l1;
    if (l0 >= -1e-5 && l1 >= -1e-5 && l2 >= -1e-5) {
      const w = l0 * w0 + l1 * w1 + l2 * w2;
      const nw = (u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0);
      hits.push({ w, sign: nw >= 0 ? 1 : -1 });
    }
  }
  hits.sort((a, b) => b.w - a.w);
  const unique = [];
  for (const h of hits) {
    if (unique.length === 0 || Math.abs(h.w - unique[unique.length - 1].w) > 1e-3) unique.push(h);
  }
  const intervals = [];
  let entry = null;
  for (const h of unique) {
    if (h.sign > 0 && entry === null) entry = h.w;
    else if (h.sign < 0 && entry !== null) {
      intervals.push({ wEntry: entry, wExit: h.w });
      entry = null;
    }
  }
  return intervals;
}

function pointInPolygon2D(u, v, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > v) !== (yj > v)) && (u < ((xj - xi) * (v - yi)) / (yj - yi + 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function buildSpatialBuckets(options) {
  const { meshData, minU, maxU, minV, maxV, gridN } = options;
  const { triVerts, vertProperties } = meshData;
  const buckets = Array.from({ length: gridN * gridN }, () => []);
  const du = Math.max(maxU - minU, 1e-3) / gridN, dv = Math.max(maxV - minV, 1e-3) / gridN;
  for (let ti = 0, nTris = triVerts.length / 3; ti < nTris; ti++) {
    const t = ti * 3, i0 = triVerts[t] * 3, i1 = triVerts[t + 1] * 3, i2 = triVerts[t + 2] * 3;
    const [u0, u1, u2] = [vertProperties[i0], vertProperties[i1], vertProperties[i2]];
    const [v0, v1, v2] = [vertProperties[i0 + 1], vertProperties[i1 + 1], vertProperties[i2 + 1]];
    const [tuMin, tuMax] = [Math.min(u0, u1, u2), Math.max(u0, u1, u2)];
    const [tvMin, tvMax] = [Math.min(v0, v1, v2), Math.max(v0, v1, v2)];
    if (tuMax < minU || tuMin > maxU || tvMax < minV || tvMin > maxV) continue;
    const c0 = Math.max(0, Math.floor((tuMin - minU) / du)), c1 = Math.min(gridN - 1, Math.floor((tuMax - minU) / du));
    const r0 = Math.max(0, Math.floor((tvMin - minV) / dv)), r1 = Math.min(gridN - 1, Math.floor((tvMax - minV) / dv));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * gridN + c].push(ti);
  }
  return { buckets, du, dv };
}

function buildVariableHeightFieldManifold(options) {
  const { minU, maxU, minV, maxV, gridN, wBottomGrid, wTop } = options;
  const nSide = gridN + 1, nLayer = nSide * nSide;
  const vertProperties = new Float32Array(nLayer * 6);
  const tris = [];
  for (let r = 0; r < nSide; r++) {
    const v = minV + ((maxV - minV) * r) / gridN;
    for (let c = 0; c < nSide; c++) {
      const u = minU + ((maxU - minU) * c) / gridN, idx = r * nSide + c;
      vertProperties.set([u, v, Math.min(wBottomGrid[idx], wTop - 0.4)], idx * 3);
      vertProperties.set([u, v, wTop], (nLayer + idx) * 3);
    }
  }
  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const b00 = r * nSide + c, b10 = b00 + 1, b01 = b00 + nSide, b11 = b01 + 1;
      const t00 = nLayer + b00, t10 = nLayer + b10, t01 = nLayer + b01, t11 = nLayer + b11;
      tris.push(t00, t10, t11, t00, t11, t01, b00, b11, b10, b00, b01, b11);
    }
  }
  for (let i = 0; i < gridN; i++) {
    const b0 = i, b1 = i + 1, sb0 = gridN * nSide + i, sb1 = sb0 + 1;
    const lb0 = i * nSide, lb1 = (i + 1) * nSide, rb0 = lb0 + gridN, rb1 = lb1 + gridN;
    tris.push(b0, b1, nLayer + b1, b0, nLayer + b1, nLayer + b0);
    tris.push(sb1, sb0, nLayer + sb0, sb1, nLayer + sb0, nLayer + sb1);
    tris.push(lb1, lb0, nLayer + lb0, lb1, nLayer + lb0, nLayer + lb1);
    tris.push(rb0, rb1, nLayer + rb1, rb0, nLayer + rb1, nLayer + rb0);
  }
  const mesh = new Mesh({ numProp: 3, vertProperties, triVerts: new Uint32Array(tris) });
  mesh.merge();
  return new Manifold(mesh);
}

export function partitionByFirstShellContour(model, polygonUV, options = {}) {
  const ccwPoly = ensureCCW(polygonUV);
  const meshData = model.getMesh();
  const gridN = options.gridN ?? 20, nSide = gridN + 1;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of ccwPoly) {
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const spanU = maxU - minU, spanV = maxV - minV, contourRadius = 0.5 * Math.hypot(spanU, spanV);
  minU -= spanU * 0.04 + 0.5; maxU += spanU * 0.04 + 0.5;
  minV -= spanV * 0.04 + 0.5; maxV += spanV * 0.04 + 0.5;

  const { buckets, du, dv } = buildSpatialBuckets({ meshData, minU, maxU, minV, maxV, gridN });
  const rayAt = (u, v) => {
    const c = Math.min(gridN - 1, Math.max(0, Math.floor((u - minU) / du)));
    const r = Math.min(gridN - 1, Math.max(0, Math.floor((v - minV) / dv)));
    return raycastShellIntervals({ meshData, u, v, bucketTris: buckets[r * gridN + c] });
  };

  const boundaryIntervals = ccwPoly.map(([u, v]) => rayAt(u, v));
  const rawBndW1 = boundaryIntervals.filter((l) => l.length > 0).map((l) => l[0].wEntry).sort((a, b) => a - b);
  const collarMedianW = rawBndW1.length > 0 ? rawBndW1[Math.floor(rawBndW1.length * 0.5)] : 0;

  // Consolida micro-reentrâncias (garras sobre almofada da pata, encaixes de manchas) na 1ª casca
  const consolidate = (list) => {
    if (list.length <= 1) return list;
    const out = [{ ...list[0] }];
    for (let k = 1; k < list.length; k++) {
      const prev = out[out.length - 1], gap = prev.wExit - list[k].wEntry;
      if (gap < 1.2 || list[k].wEntry > collarMedianW + 2.5) prev.wExit = list[k].wExit;
      else out.push({ ...list[k] });
    }
    return out;
  };

  const gridIntervals = new Array(nSide * nSide);
  let maxW1 = -Infinity, minW2Global = Infinity, maxW3Global = -Infinity;
  for (let r = 0; r < nSide; r++) {
    const v = minV + ((maxV - minV) * r) / gridN;
    for (let c = 0; c < nSide; c++) {
      const u = minU + ((maxU - minU) * c) / gridN;
      const inside = pointInPolygon2D(u, v, ccwPoly);
      const list = consolidate(rayAt(u, v));
      gridIntervals[r * nSide + c] = { u, v, inside, list };
      if (inside && list.length > 0) {
        if (list[0].wEntry > maxW1) maxW1 = list[0].wEntry;
        if (list[0].wExit < minW2Global) minW2Global = list[0].wExit;
        if (list.length > 1 && list[1].wEntry > maxW3Global) maxW3Global = list[1].wEntry;
      }
    }
  }

  if (options.useNaiveGlobalWBottom) {
    const wTop = maxW1 + 0.5;
    const wBottom = (maxW3Global > -Infinity && minW2Global > maxW3Global) ? 0.5 * (minW2Global + maxW3Global) : minW2Global - 0.5;
    const cs = CrossSection.ofPolygons([ccwPoly], 'NonZero');
    const cutter = Manifold.extrude(cs, wTop - wBottom, 0, 0, [1, 1], false).translate([0, 0, wBottom]);
    return { partA: model.subtract(cutter), partB: model.intersect(cutter), cutter, diagnostics: { wBottom, wTop, ruleUsed: 'NAIVE_GLOBAL' } };
  }

  // Flood-fill local de continuidade da 1ª Casca (sem corte global por bgFloor que decepa superfícies inclinadas)
  const stepJumpLimit = Math.hypot((maxU - minU) / gridN, (maxV - minV) / gridN) * 2.6 + 2.8;
  const onFrontShell = new Uint8Array(nSide * nSide);
  let seedIdx = -1, bestSeedW = -Infinity;
  for (let i = 0; i < gridIntervals.length; i++) {
    const { inside, list } = gridIntervals[i];
    if (inside && list.length > 0 && list[0].wEntry > bestSeedW) { bestSeedW = list[0].wEntry; seedIdx = i; }
  }
  if (seedIdx >= 0) {
    const queue = [seedIdx];
    onFrontShell[seedIdx] = 1;
    while (queue.length > 0) {
      const cur = queue.shift(), curCell = gridIntervals[cur];
      const cw = curCell.list[0].wEntry, curBgW = curCell.list.length > 1 ? curCell.list[1].wEntry : -Infinity;
      const cr = Math.floor(cur / nSide), cc = cur % nSide;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr >= nSide || nc < 0 || nc >= nSide) continue;
        const nIdx = nr * nSide + nc;
        if (onFrontShell[nIdx]) continue;
        const nList = gridIntervals[nIdx].list;
        if (nList.length === 0) continue;
        const nw = nList[0].wEntry;
        const jumpedToBg = curBgW > -Infinity && Math.abs(nw - curBgW) < Math.abs(nw - cw);
        if (!jumpedToBg && Math.abs(nw - cw) <= stepJumpLimit) {
          onFrontShell[nIdx] = 1;
          queue.push(nIdx);
        }
      }
    }
  }

  const cutBoundaryPts = [];
  let minBoundaryW1 = Infinity;
  for (let k = 0; k < ccwPoly.length; k++) {
    const list = consolidate(boundaryIntervals[k]);
    if (list.length > 0) {
      const [u, v] = ccwPoly[k];
      cutBoundaryPts.push({ u, v, w1: list[0].wEntry, w2: list[0].wExit });
      if (list[0].wEntry < minBoundaryW1) minBoundaryW1 = list[0].wEntry;
    }
  }
  if (minBoundaryW1 === Infinity) minBoundaryW1 = maxW1 - contourRadius;

  const overhangAnchors = [];
  for (let i = 0; i < gridIntervals.length; i++) {
    const { u, v, inside, list } = gridIntervals[i];
    if (!inside || !onFrontShell[i] || list.length < 2) continue;
    const frontExit = list[0].wExit, bgEntry = list[1].wEntry;
    const frontThick = list[0].wEntry - frontExit, gap = frontExit - bgEntry;
    if (gap >= 0.8 && frontThick <= contourRadius * 1.5 && frontExit >= minBoundaryW1 - contourRadius * 0.65) {
      overhangAnchors.push({ u, v, w: frontExit - Math.min(0.9, 0.45 * gap), wExit: frontExit, wBg: bgEntry });
    }
  }

  const allBoundaryHit = boundaryIntervals.every((l) => l.length > 0);
  const allBoundaryThick = boundaryIntervals.every((l) => l.length > 0 && (l[0].wEntry - l[0].wExit) > contourRadius * 0.6);
  const isSurfaceCap = allBoundaryHit && overhangAnchors.length === 0 && allBoundaryThick && (maxW1 - minBoundaryW1 > 0.4) && (minBoundaryW1 > minW2Global + 1.0);

  const anchorPts = [...overhangAnchors];
  const plungeFloor = overhangAnchors.length > 0 ? Math.min(...overhangAnchors.map((a) => a.w)) - 5.0 : minBoundaryW1 - contourRadius * 0.9;
  for (let i = 0; i < gridIntervals.length; i++) {
    const { u, v, list } = gridIntervals[i];
    if (onFrontShell[i] && list.length === 1 && list[0].wExit >= plungeFloor) {
      anchorPts.push({ u, v, w: list[0].wExit - 0.5 });
    }
  }
  for (const bp of cutBoundaryPts) {
    anchorPts.push({ u: bp.u, v: bp.v, w: bp.w2 >= plungeFloor ? bp.w2 - 0.4 : bp.w1 - 0.4 });
  }

  const wBottomGrid = new Float32Array(nSide * nSide);
  const safeFloorGrid = new Float32Array(nSide * nSide).fill(-Infinity);
  for (let i = 0; i < gridIntervals.length; i++) {
    const { u, v, list } = gridIntervals[i];
    if (isSurfaceCap) {
      let num = 0, den = 0;
      for (const bp of cutBoundaryPts) {
        const w = 1 / ((u - bp.u) ** 2 + (v - bp.v) ** 2 + 1.0);
        num += w * (bp.w1 - 0.25); den += w;
      }
      wBottomGrid[i] = den > 0 ? num / den : minBoundaryW1;
    } else {
      let num = 0, den = 0;
      for (const ap of anchorPts) {
        const d2 = (u - ap.u) ** 2 + (v - ap.v) ** 2 + 2.5;
        const w = 1 / (d2 * d2);
        num += w * ap.w; den += w;
      }
      let wb = den > 0 ? num / den : minW2Global - 0.5;
      if (!onFrontShell[i] && list.length > 0) safeFloorGrid[i] = list[0].wEntry + 0.8;
      else if (onFrontShell[i] && list.length > 1) safeFloorGrid[i] = list[1].wEntry + 0.5;
      wBottomGrid[i] = Math.max(wb, safeFloorGrid[i]);
    }
  }

  if (!isSurfaceCap) {
    for (let iter = 0; iter < 4; iter++) {
      const next = new Float32Array(wBottomGrid);
      for (let r = 1; r < gridN; r++) {
        for (let c = 1; c < gridN; c++) {
          const idx = r * nSide + c;
          const avg = 0.25 * (wBottomGrid[idx - 1] + wBottomGrid[idx + 1] + wBottomGrid[idx - nSide] + wBottomGrid[idx + nSide]);
          next[idx] = Math.max(0.5 * wBottomGrid[idx] + 0.5 * avg, safeFloorGrid[idx]);
        }
      }
      wBottomGrid.set(next);
    }
  }

  const wTop = maxW1 + 1.5, minWBottom = Math.min(...wBottomGrid), maxWBottom = Math.max(...wBottomGrid);
  const cs = CrossSection.ofPolygons([ccwPoly], 'NonZero');
  const cutterOmega = (maxWBottom - minWBottom < 0.2)
    ? Manifold.extrude(cs, wTop - minWBottom, 0, 0, [1, 1], false).translate([0, 0, minWBottom])
    : buildVariableHeightFieldManifold({ minU, maxU, minV, maxV, gridN, wBottomGrid, wTop })
        .intersect(Manifold.extrude(cs, wTop - minWBottom + 4.0, 0, 0, [1, 1], false).translate([0, 0, minWBottom - 2.0]));

  const partB = model.intersect(cutterOmega), partA = model.subtract(cutterOmega);
  return {
    partA, partB, cutter: cutterOmega,
    diagnostics: {
      ruleUsed: isSurfaceCap ? 'SURFACE_CAP_BOUNDARY' : 'FIRST_SHELL_EXIT_BOUND',
      wTop, wBottom: minWBottom, maxWBottom, maxW1,
      minW2FirstShell: minW2Global, maxW3SecondShell: maxW3Global,
      wBottomGrid, gridIntervals, onFrontShell, overhangAnchorsCount: overhangAnchors.length,
      minU, maxU, minV, maxV, gridN,
      islandsA: partA.decompose().length, islandsB: partB.decompose().length,
      volOrig: model.volume(), volA: partA.volume(), volB: partB.volume(),
    },
  };
}
