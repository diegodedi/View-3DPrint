import * as THREE from 'three';

/**
 * Amostra a curva Catmull-Rom cúbica de Bézier em 3D usando a mesma fórmula exata
 * do CatPinOverlay2D, garantindo que todos os vértices clicados pertençam à malha.
 */
export function sampleCatmullRom3D(
  pts: THREE.Vector3[],
  closed: boolean,
  subdivisionsPerSegment = 5
): THREE.Vector3[] {
  const n = pts.length;
  if (n < 3) return pts.map((p) => p.clone());

  const out: THREE.Vector3[] = [];
  const segCount = closed ? n : n - 1;
  const steps = Math.max(1, subdivisionsPerSegment);

  for (let i = 0; i < segCount; i++) {
    const p0 = closed || i > 0 ? pts[(i - 1 + n) % n] : pts[i];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = closed || i + 2 < n ? pts[(i + 2) % n] : p2;

    const cp1 = new THREE.Vector3().subVectors(p2, p0).multiplyScalar(1 / 6).add(p1);
    const cp2 = new THREE.Vector3().subVectors(p3, p1).multiplyScalar(-1 / 6).add(p2);

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const it = 1 - t;
      const b0 = it * it * it;
      const b1 = 3 * it * it * t;
      const b2 = 3 * it * t * t;
      const b3 = t * t * t;
      out.push(
        new THREE.Vector3(
          b0 * p1.x + b1 * cp1.x + b2 * cp2.x + b3 * p2.x,
          b0 * p1.y + b1 * cp1.y + b2 * cp2.y + b3 * p2.y,
          b0 * p1.z + b1 * cp1.z + b2 * cp2.z + b3 * p2.z
        )
      );
    }
  }
  if (!closed) out.push(pts[n - 1].clone());
  return out;
}

function segmentsIntersect2D(
  segA: [THREE.Vector2, THREE.Vector2],
  segB: [THREE.Vector2, THREE.Vector2]
): boolean {
  const [a, b] = segA;
  const [c, d] = segB;
  const ccw = (p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

export function hasSelfIntersection2D(pts: THREE.Vector2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect2D([a1, a2], [pts[j], pts[(j + 1) % n]])) return true;
    }
  }
  return false;
}

export function makeRightHandedAxes(zAxis: THREE.Vector3): { xAxis: THREE.Vector3; yAxis: THREE.Vector3 } {
  const ref = Math.abs(zAxis.x) > 0.85 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const xAxis = new THREE.Vector3().crossVectors(ref, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  return { xAxis, yAxis };
}

/**
 * Base destra ortonormal estritamente alinhada à Normal de Newell analítica da Polyline.
 * Não utiliza nem distorce a normal pela direção da câmera, preservando 100% a fidelidade 3D da seleção.
 */
export function selectOptimalSeamBasis(
  _points3D: THREE.Vector3[],
  _origin: THREE.Vector3,
  initialZ: THREE.Vector3,
  _camera?: THREE.Camera | null
): { xAxis: THREE.Vector3; yAxis: THREE.Vector3; zAxis: THREE.Vector3 } {
  const { xAxis, yAxis } = makeRightHandedAxes(initialZ);
  return { xAxis, yAxis, zAxis: initialZ };
}

/**
 * Constrói a geometria 3D deformada (Membrana Harmônica Mínima) cuja borda passa 100%
 * pelos pontos 3D da Polyline e cujo interior se deforma suavemente em 3D.
 */
export function buildDeformedSeamGeometry(
  boundary3D: THREE.Vector3[],
  origin: THREE.Vector3,
  xAxis: THREE.Vector3,
  yAxis: THREE.Vector3,
  zAxis: THREE.Vector3,
  thicknessMm: number,
  skirtMm = 0.35
): {
  geometry: THREE.BufferGeometry;
  polygonUV: Array<[number, number]>;
  polygonW: number[];
  boundaryLocal3D: THREE.Vector3[];
  wMin: number;
  wMax: number;
} {
  let minZ = Infinity;
  let maxZ = -Infinity;
  const rawUV: THREE.Vector2[] = [];
  const rawW: number[] = [];

  for (const p of boundary3D) {
    const rel = new THREE.Vector3().subVectors(p, origin);
    const u = rel.dot(xAxis);
    const v = rel.dot(yAxis);
    const w = rel.dot(zAxis);
    if (w < minZ) minZ = w;
    if (w > maxZ) maxZ = w;
    rawUV.push(new THREE.Vector2(u, v));
    rawW.push(w);
  }

  if (rawUV.length >= 3 && THREE.ShapeUtils.isClockWise(rawUV)) {
    rawUV.reverse();
    rawW.reverse();
  }

  const M = rawUV.length;
  let cu = 0, cv = 0;
  for (let i = 0; i < M; i++) { cu += rawUV[i].x; cv += rawUV[i].y; }
  cu /= Math.max(M, 1);
  cv /= Math.max(M, 1);

  // Saia perimetral coplanar (UV): expande sutilmente na tangente do corte sem alterar W (zero invasão em Z)
  const skirtUV: THREE.Vector2[] = [];
  for (let i = 0; i < M; i++) {
    const du = rawUV[i].x - cu;
    const dv = rawUV[i].y - cv;
    const dLen = Math.hypot(du, dv);
    const ndu = dLen > 1e-4 ? du / dLen : 1;
    const ndv = dLen > 1e-4 ? dv / dLen : 0;
    skirtUV.push(new THREE.Vector2(rawUV[i].x + ndu * skirtMm, rawUV[i].y + ndv * skirtMm));
  }

  const verts2D: Array<[number, number]> = skirtUV.map((p) => [p.x, p.y]);
  let tris: Array<[number, number, number]> = [];

  if (!hasSelfIntersection2D(skirtUV)) {
    const rawTris = THREE.ShapeUtils.triangulateShape(skirtUV, []);
    tris = rawTris.map((t) => [t[0], t[1], t[2]]);
  }

  if (tris.length < Math.max(1, M - 4)) {
    tris = [];
    const centerIdx = verts2D.length;
    verts2D.push([cu, cv]);
    for (let i = 0; i < M; i++) tris.push([i, (i + 1) % M, centerIdx]);
  }

  let span = 10;
  for (let i = 0; i < M; i++) {
    span = Math.max(span, Math.hypot(verts2D[i][0], verts2D[i][1]) * 2);
  }
  const maxEdgeLen = Math.max(1.5, span / 7.5);

  for (let step = 0; step < 96; step++) {
    const edgeMap = new Map<string, Array<{ ti: number; e: number; u: number; v: number }>>();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) {
        const u = t[e], v = t[(e + 1) % 3];
        const k = u < v ? `${u}_${v}` : `${v}_${u}`;
        const list = edgeMap.get(k) ?? [];
        list.push({ ti, e, u, v });
        edgeMap.set(k, list);
      }
    });
    let bestKey: string | null = null;
    let bestLen = maxEdgeLen;
    for (const [k, list] of edgeMap.entries()) {
      if (list.length !== 2) continue;
      const { u, v } = list[0];
      const d = Math.hypot(verts2D[u][0] - verts2D[v][0], verts2D[u][1] - verts2D[v][1]);
      if (d > bestLen) { bestLen = d; bestKey = k; }
    }
    if (!bestKey) break;
    const [e1, e2] = edgeMap.get(bestKey)!;
    const u = e1.u, v = e1.v;
    const mIdx = verts2D.length;
    verts2D.push([(verts2D[u][0] + verts2D[v][0]) * 0.5, (verts2D[u][1] + verts2D[v][1]) * 0.5]);
    const t1 = tris[e1.ti], t2 = tris[e2.ti];
    const w1 = t1[(e1.e + 2) % 3], w2 = t2[(e2.e + 2) % 3];
    tris[e1.ti] = [u, mIdx, w1];
    tris[e2.ti] = [v, mIdx, w2];
    tris.push([mIdx, v, w1], [mIdx, u, w2]);
  }

  const N = verts2D.length;
  const vertsW = new Float64Array(N);
  for (let i = 0; i < M; i++) vertsW[i] = rawW[i];
  for (let i = M; i < N; i++) {
    const [ux, uy] = verts2D[i];
    let num = 0, den = 0;
    for (let k = 0; k < M; k++) {
      const d2 = (ux - verts2D[k][0]) ** 2 + (uy - verts2D[k][1]) ** 2 + 0.05;
      const wt = 1 / (d2 * d2);
      num += wt * rawW[k];
      den += wt;
    }
    vertsW[i] = den > 0 ? num / den : 0;
  }

  const adj = Array.from({ length: N }, () => new Set<number>());
  for (const [a, b, c] of tris) {
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  for (let iter = 0; iter < 8; iter++) {
    const nextW = Float64Array.from(vertsW);
    for (let i = M; i < N; i++) {
      if (adj[i].size === 0) continue;
      let sum = 0;
      for (const nb of adj[i]) sum += vertsW[nb];
      nextW[i] = 0.3 * vertsW[i] + 0.7 * (sum / adj[i].size);
    }
    vertsW.set(nextW);
  }

  const halfH = thicknessMm * 0.5;
  const positions = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N; i++) {
    positions[i * 3] = verts2D[i][0];
    positions[i * 3 + 1] = verts2D[i][1];
    positions[i * 3 + 2] = vertsW[i] + halfH;
    positions[(N + i) * 3] = verts2D[i][0];
    positions[(N + i) * 3 + 1] = verts2D[i][1];
    positions[(N + i) * 3 + 2] = vertsW[i] - halfH;
  }

  const indices: number[] = [];
  for (const [a, b, c] of tris) {
    indices.push(a, b, c, N + a, N + c, N + b);
  }
  for (let i = 0; i < M; i++) {
    const ni = (i + 1) % M;
    indices.push(N + i, N + ni, ni, N + i, ni, i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const boundaryLocal3D = rawUV.map((p, idx) => new THREE.Vector3(p.x, p.y, rawW[idx]));

  return {
    geometry,
    polygonUV: skirtUV.map((p) => [p.x, p.y]),
    polygonW: rawW,
    boundaryLocal3D,
    wMin: minZ,
    wMax: maxZ,
  };
}

