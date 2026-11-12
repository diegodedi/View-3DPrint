import * as THREE from 'three';

export interface LockedViewBasis {
  viewDir: THREE.Vector3;
  viewUp: THREE.Vector3;
  viewRight: THREE.Vector3;
  planeOrigin: THREE.Vector3;
}

/**
 * Congela os 3 eixos ortonormais da câmera atual (View-Projection Plane) e a origem no centro do modelo.
 */
export function captureCameraViewBasis(
  camera: THREE.Camera | null,
  modelBox: THREE.Box3
): LockedViewBasis {
  const viewDir = new THREE.Vector3(0, 0, -1);
  let viewUp = new THREE.Vector3(0, 1, 0);
  if (camera) {
    camera.getWorldDirection(viewDir).normalize();
    viewUp.applyQuaternion(camera.quaternion).normalize();
  }
  const viewRight = new THREE.Vector3().crossVectors(viewDir, viewUp).normalize();
  viewUp = new THREE.Vector3().crossVectors(viewRight, viewDir).normalize();
  const planeOrigin = modelBox.getCenter(new THREE.Vector3());

  return { viewDir, viewUp, viewRight, planeOrigin };
}

/**
 * Projeta um ponto 3D do mundo para coordenadas 2D planas (u, v) no plano da vista congelada.
 */
export function projectWorldPointToViewUV(
  worldPt: THREE.Vector3,
  basis: LockedViewBasis
): THREE.Vector2 {
  const rel = new THREE.Vector3().subVectors(worldPt, basis.planeOrigin);
  return new THREE.Vector2(rel.dot(basis.viewRight), rel.dot(basis.viewUp));
}

export function ensureCounterClockwise2D(pts: THREE.Vector2[]): THREE.Vector2[] {
  const copy = [...pts];
  if (copy.length >= 3 && THREE.ShapeUtils.isClockWise(copy)) {
    copy.reverse();
  }
  return copy;
}

/**
 * Intersecta uma semirreta 2D (origin + t * dir, t > 0) com a caixa [-R, R] x [-R, R]
 * e retorna o ponto de impacto e a coordenada perimetral CCW perimT em [0, 8R).
 */
function intersectRayWithSquare2D(
  origin: THREE.Vector2,
  dir: THREE.Vector2,
  R: number
): { hit: THREE.Vector2; perimT: number } {
  let bestT = Infinity;
  let hit = new THREE.Vector2(R, 0);

  if (Math.abs(dir.x) > 1e-8) {
    for (const targetX of [R, -R]) {
      const t = (targetX - origin.x) / dir.x;
      if (t > 1e-5 && t < bestT) {
        const y = origin.y + t * dir.y;
        if (y >= -R - 1e-4 && y <= R + 1e-4) {
          bestT = t;
          hit = new THREE.Vector2(targetX, THREE.MathUtils.clamp(y, -R, R));
        }
      }
    }
  }

  if (Math.abs(dir.y) > 1e-8) {
    for (const targetY of [R, -R]) {
      const t = (targetY - origin.y) / dir.y;
      if (t > 1e-5 && t < bestT) {
        const x = origin.x + t * dir.x;
        if (x >= -R - 1e-4 && x <= R + 1e-4) {
          bestT = t;
          hit = new THREE.Vector2(THREE.MathUtils.clamp(x, -R, R), targetY);
        }
      }
    }
  }

  let perimT = 0;
  if (Math.abs(hit.x - R) < 1e-3) {
    perimT = hit.y + R;
  } else if (Math.abs(hit.y - R) < 1e-3) {
    perimT = 2 * R + (R - hit.x);
  } else if (Math.abs(hit.x + R) < 1e-3) {
    perimT = 4 * R + (R - hit.y);
  } else {
    perimT = 6 * R + (hit.x + R);
  }

  return { hit, perimT: ((perimT % (8 * R)) + 8 * R) % (8 * R) };
}

/**
 * Transforma uma linha aberta (Split Line / Polyline) em um polígono 2D fechado contornando
 * um dos lados da caixa envolvente [-R, R] x [-R, R] no plano da vista (u, v).
 */
export function buildSplitLineClosedPolygon2D(
  ptsUV: THREE.Vector2[],
  boxHalfSize: number,
  flipSide: boolean
): {
  polygonUV: THREE.Vector2[];
  seamMidUV: THREE.Vector2;
  seamNormalUV: THREE.Vector2;
} {
  const maxCoord = ptsUV.reduce(
    (acc, p) => Math.max(acc, Math.abs(p.x), Math.abs(p.y)),
    0
  );
  const R = Math.max(boxHalfSize, maxCoord + 15);

  const firstPt = ptsUV[0];
  const secondPt = ptsUV[1];
  const lastPt = ptsUV[ptsUV.length - 1];
  const prevLastPt = ptsUV[ptsUV.length - 2];

  const dirStart = new THREE.Vector2().subVectors(firstPt, secondPt);
  if (dirStart.lengthSq() < 1e-6) dirStart.set(-1, 0);
  else dirStart.normalize();

  const dirEnd = new THREE.Vector2().subVectors(lastPt, prevLastPt);
  if (dirEnd.lengthSq() < 1e-6) dirEnd.set(1, 0);
  else dirEnd.normalize();

  const startHit = intersectRayWithSquare2D(firstPt, dirStart, R);
  const endHit = intersectRayWithSquare2D(lastPt, dirEnd, R);
  const perimLen = 8 * R;

  const corners = [
    { pt: new THREE.Vector2(R, R), t: 2 * R },
    { pt: new THREE.Vector2(-R, R), t: 4 * R },
    { pt: new THREE.Vector2(-R, -R), t: 6 * R },
    { pt: new THREE.Vector2(R, -R), t: 0 },
  ];

  const chosenCorners: THREE.Vector2[] = [];
  if (!flipSide) {
    const spanCCW = (startHit.perimT - endHit.perimT + perimLen) % perimLen;
    const valid = corners
      .map((c) => ({ pt: c.pt, dist: (c.t - endHit.perimT + perimLen) % perimLen }))
      .filter((c) => c.dist > 1e-3 && c.dist < spanCCW - 1e-3)
      .sort((a, b) => a.dist - b.dist);
    valid.forEach((v) => chosenCorners.push(v.pt));
  } else {
    const spanCW = (endHit.perimT - startHit.perimT + perimLen) % perimLen;
    const valid = corners
      .map((c) => ({ pt: c.pt, dist: (endHit.perimT - c.t + perimLen) % perimLen }))
      .filter((c) => c.dist > 1e-3 && c.dist < spanCW - 1e-3)
      .sort((a, b) => a.dist - b.dist);
    valid.forEach((v) => chosenCorners.push(v.pt));
  }

  const rawLoop = [startHit.hit, ...ptsUV, endHit.hit, ...chosenCorners];
  const polygonUV = ensureCounterClockwise2D(rawLoop);

  const midIdx = Math.floor((ptsUV.length - 1) / 2);
  const pA = ptsUV[midIdx];
  const pB = ptsUV[Math.min(midIdx + 1, ptsUV.length - 1)];
  const seamMidUV = new THREE.Vector2().addVectors(pA, pB).multiplyScalar(0.5);

  const chord = new THREE.Vector2().subVectors(lastPt, firstPt);
  if (chord.lengthSq() < 1e-6) chord.set(1, 0);
  else chord.normalize();

  const candidateNormal = new THREE.Vector2(-chord.y, chord.x);
  const cornerRef = chosenCorners[0] ?? new THREE.Vector2().addVectors(startHit.hit, endHit.hit).multiplyScalar(0.5);
  const toSide = new THREE.Vector2().subVectors(cornerRef, seamMidUV);
  const seamNormalUV = candidateNormal.dot(toSide) >= 0 ? candidateNormal : candidateNormal.negate();

  return { polygonUV, seamMidUV, seamNormalUV };
}

export function createCutterVolumeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
}

export interface ArrowVisualOptions {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
}

export function createDirectionArrow(options: ArrowVisualOptions): THREE.ArrowHelper {
  const { origin, dir, length } = options;
  const arrow = new THREE.ArrowHelper(
    dir.clone().normalize(),
    origin,
    Math.max(length, 8.0),
    0x22c55e,
    Math.max(length * 0.22, 2.5),
    Math.max(length * 0.14, 1.8)
  );
  arrow.renderOrder = 17;
  if (arrow.line) {
    (arrow.line.material as THREE.Material).depthTest = false;
    (arrow.line.material as THREE.Material).depthWrite = false;
  }
  if (arrow.cone) {
    (arrow.cone.material as THREE.Material).depthTest = false;
    (arrow.cone.material as THREE.Material).depthWrite = false;
  }
  return arrow;
}

export function attachWireframeEdges(mesh: THREE.Mesh, visualGeom: THREE.BufferGeometry): void {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(visualGeom, 20),
    new THREE.LineBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })
  );
  edges.renderOrder = 16;
  mesh.add(edges);
}

export function attachBoundaryLoop(mesh: THREE.Mesh, boundaryLocal3D: THREE.Vector3[]): void {
  const loopGeom = new THREE.BufferGeometry().setFromPoints([
    ...boundaryLocal3D,
    boundaryLocal3D[0],
  ]);
  const loopLine = new THREE.Line(
    loopGeom,
    new THREE.LineBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
    })
  );
  loopLine.renderOrder = 16;
  mesh.add(loopLine);
}

export function attachWireframeDecorations(
  mesh: THREE.Mesh,
  visualGeom: THREE.BufferGeometry,
  arrowOptions: ArrowVisualOptions
): void {
  attachWireframeEdges(mesh, visualGeom);
  mesh.add(createDirectionArrow(arrowOptions));
}

export function attachBoundaryDecorations(
  mesh: THREE.Mesh,
  boundaryLocal3D: THREE.Vector3[],
  arrowOptions: ArrowVisualOptions
): void {
  attachBoundaryLoop(mesh, boundaryLocal3D);
  mesh.add(createDirectionArrow(arrowOptions));
}
