// =============================================================================
// CatPin Engine — Conectores, Tolerâncias e Sugestão de Posição
// Modela pinos cilíndricos e trapezoidais anti-rotação com folga (clearance).
// =============================================================================
import {
  norm, sub, mul, dot, len, cross, mat4, applyPoint, applyDir, invRigid, frameFromZ, perpendicularPair
} from './algebra.mjs';
import { buildModel } from './meshDiagnostics.mjs';
import { ensureCCW } from './cutSolids.mjs';

/**
 * Constrói os sólidos do pino e do furo (socket) no espaço local do conector.
 * `axis` aponta da peça que RECEBE O PINO para a peça que recebe o FURO.
 * Quando `cutNormal` (apontando para sockBase) é fornecido, a ancoragem interna do pino
 * é estritamente ceifada ao semi-espaço da peça de apoio (pinBase), garantindo que a base
 * jamais transgrida ou crie degraus na face de corte quando o conector for rotacionado/inclinado em 3D,
 * e a cavidade do furo é delimitada ao semi-espaço da peça de encaixe (sockBase).
 */
export function buildConnectorSolids(wasm, c, options = {}) {
  const { cutNormal = null } = options;
  const { Manifold } = wasm;
  const r = c.diameterMm / 2;
  const h = c.heightMm;
  const clr = c.clearanceMm;
  const embed = c.embedMm ?? 3;
  const slack = c.slackMm ?? 0.5;
  const seg = 64;

  let protrusion, anchor, sockCavity, sockLeadIn;
  let socketCavityVolume = 0;

  if (c.type === 'trapezoid') {
    const k = Math.SQRT2;
    const rTip = r * 0.72;
    const sq = (m) => m.rotate([0, 0, 45]);
    protrusion = sq(Manifold.cylinder(h, r, rTip, 4, false));
    anchor = sq(Manifold.cylinder(embed + 0.01, r, r, 4, false)).translate([0, 0, -embed]);
    sockCavity = sq(Manifold.cylinder(h + slack, r + clr * k, rTip + clr * k, 4, false));
    sockLeadIn = sq(Manifold.cylinder(embed, r + clr * k, r + clr * k, 4, false)).translate([0, 0, -embed]);
  } else {
    protrusion = Manifold.cylinder(h, r, r, seg, false);
    anchor = Manifold.cylinder(embed + 0.01, r, r, seg, false).translate([0, 0, -embed]);
    sockCavity = Manifold.cylinder(h + slack, r + clr, r + clr, seg, false);
    sockLeadIn = Manifold.cylinder(embed, r + clr, r + clr, seg, false).translate([0, 0, -embed]);
  }

  socketCavityVolume = sockCavity.volume();

  let M;
  if (c.xAxis && (c.xAxis[0] !== 0 || c.xAxis[1] !== 0 || c.xAxis[2] !== 0)) {
    const z = norm(c.axis);
    const xRaw = sub(c.xAxis, mul(z, dot(c.xAxis, z)));
    const lX = len(xRaw);
    let x = lX > 1e-4 ? mul(xRaw, 1 / lX) : null;
    if (!x) [x] = perpendicularPair(z);
    const y = cross(z, x);
    M = mat4(x, y, z, c.position);
  } else {
    M = frameFromZ(c.axis, c.position);
  }

  const worldProtrusion = protrusion.transform(M);
  protrusion.delete();
  const worldAnchor = anchor.transform(M);
  anchor.delete();
  const rawSocket = Manifold.union([sockCavity, sockLeadIn]).transform(M);
  sockCavity.delete();
  sockLeadIn.delete();

  let pin;
  if (cutNormal && len(cutNormal) > 1e-4) {
    const nSock = norm(cutNormal);
    const nPin = mul(nSock, -1);
    const big = Math.max(h + embed + 50, 150) * 4;
    const halfPin = Manifold.cube([big, big, big], true)
      .translate([0, 0, big / 2])
      .transform(frameFromZ(nPin, c.position));

    const clippedAnchor = worldAnchor.intersect(halfPin);
    worldAnchor.delete();
    halfPin.delete();

    pin = Manifold.union([worldProtrusion, clippedAnchor]);
    worldProtrusion.delete();
    clippedAnchor.delete();
  } else {
    pin = Manifold.union([worldProtrusion, worldAnchor]);
    worldProtrusion.delete();
    worldAnchor.delete();
  }

  return {
    pin,
    socket: rawSocket,
    pinFootprint: c.type === 'trapezoid' ? 2 * r * r : Math.PI * r * r,
    embed,
    socketCavityVolume,
  };
}

// -------------------- Análise 2D de faces e centróides -----------------------
function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

export function polyCentroid(p) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const k = p[i][0] * q[1] - q[0] * p[i][1];
    A += k;
    cx += (p[i][0] + q[0]) * k;
    cy += (p[i][1] + q[1]) * k;
  }
  A /= 2;
  return Math.abs(A) < 1e-9 ? p[0] : [cx / (6 * A), cy / (6 * A)];
}

function insideEvenOdd(polys, pt) {
  let inside = false;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function bestPointInRegion(cs) {
  if (cs.isEmpty()) return null;
  const comps = cs.decompose().map((c) => ({ c, a: c.area() })).sort((x, y) => y.a - x.a);
  const top = comps[0];
  const polys = top.c.toPolygons();
  const outer = polys.map((p) => ({ p, a: Math.abs(polyArea(p)) })).sort((x, y) => y.a - x.a)[0].p;
  let pt = polyCentroid(outer);

  if (!insideEvenOdd(polys, pt)) {
    const xs = outer.map((q) => q[0]), ys = outer.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let best = null, bd = Infinity;
    for (let i = 0; i <= 24; i++) {
      for (let j = 0; j <= 24; j++) {
        const q = [x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24];
        if (!insideEvenOdd(polys, q)) continue;
        const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]);
        if (d < bd) { bd = d; best = q; }
      }
    }
    if (!best) return null;
    pt = best;
  }
  return { pt, area: top.a };
}

function sectionPose(wasm, model, options) {
  const { frame, clip, margin } = options;
  const { CrossSection } = wasm;
  const section = model.transform(invRigid(frame)).slice(0);
  let region = section;
  if (clip) region = section.intersect(CrossSection.square(clip.size, false).translate(clip.origin));
  const safe = region.offset(-margin, 'Round', 24);
  const best = bestPointInRegion(safe);
  if (!best) return null;
  return { position: applyPoint(frame, [best.pt[0], best.pt[1], 0]), area: best.area };
}

export function suggestConnectorPose(wasm, input) {
  const { cut, connector: c } = input;
  const model = buildModel(wasm, input.positions, input.indices);
  const r = c.diameterMm / 2;
  const margin = r * (c.type === 'trapezoid' ? Math.SQRT2 : 1) + c.clearanceMm + (c.wallMm ?? 2);

  if (cut.kind === 'seam') {
    if (!cut.polygonUV || cut.polygonUV.length < 3) return { found: false };
    const poly = ensureCCW(cut.polygonUV);
    const cs = CrossSection.ofPolygons([poly], 'NonZero');
    const safe = cs.offset(-margin, 'Round', 24);
    let hit = bestPointInRegion(safe);
    if (!hit) hit = bestPointInRegion(cs);
    const pt = hit ? hit.pt : polyCentroid(poly);
    const n = norm(cut.normal);
    return {
      found: true,
      position: applyPoint(cut.basis, [pt[0], pt[1], 0]),
      axis: n,
      areaMm2: hit?.area ?? Math.abs(polyArea(poly)),
    };
  }

  if (cut.kind === 'plane') {
    const n = norm(cut.normal);
    const frame = frameFromZ(n, cut.point);
    const section = model.transform(invRigid(frame)).slice(0);
    const safe = section.offset(-margin, 'Round', 24);
    let hit = bestPointInRegion(safe);
    if (!hit) hit = bestPointInRegion(section);
    if (!hit) return { found: false };
    return {
      found: true,
      position: applyPoint(frame, [hit.pt[0], hit.pt[1], 0]),
      axis: n,
      areaMm2: hit.area,
    };
  }

  const poly = ensureCCW(cut.polygonUV);
  const zAxis = norm(applyDir(cut.basis, [0, 0, 1]));
  let best = null;

  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (L < 2 * margin) continue;
    const t = norm(applyDir(cut.basis, [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L, 0]));
    const out = cross(t, zAxis);
    const frame = mat4(t, zAxis, out, applyPoint(cut.basis, [p0[0], p0[1], 0]));
    const clip = { size: [L, cut.wMax - cut.wMin], origin: [0, cut.wMin] };
    const hit = sectionPose(wasm, model, { frame, clip, margin });
    if (hit && (!best || hit.area > best.area)) {
      best = { ...hit, axis: mul(out, -1) };
    }
  }

  if (!best) return { found: false };
  return { found: true, position: best.position, axis: best.axis, areaMm2: best.area };
}

