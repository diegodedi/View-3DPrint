import * as THREE from 'three';
import {
  attachWireframeDecorations,
  createCutterVolumeMaterial,
  ensureCounterClockwise2D,
} from './cutterSplineHelpers';
import { sampleCatmullRom3D } from './deformedSeamMesh';

function computeCentroid(points: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3(0, 0, 0);
  for (const p of points) c.add(p);
  return c.divideScalar(Math.max(points.length, 1));
}

function computeNewellNormal(points: THREE.Vector3[]): THREE.Vector3 {
  const normal = new THREE.Vector3(0, 0, 0);
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const next = points[(i + 1) % n];
    normal.x += (cur.y - next.y) * (cur.z + next.z);
    normal.y += (cur.z - next.z) * (cur.x + next.x);
    normal.z += (cur.x - next.x) * (cur.y + next.y);
  }
  if (normal.lengthSq() < 1e-8) return new THREE.Vector3(0, 1, 0);
  return normal.normalize();
}

/**
 * FERRAMENTA 2: Extrusão de Detalhes (Detail Plug Cut)
 * Para extrair olhos, bocas, orelhas com profundidade rasa de encaixe.
 * A extrusão é orientada estritamente pelo ÂNGULO DA NORMAL CRIADA PELA SELEÇÃO (Newell / Stokes).
 */
export function buildDetailPlugCutterMesh(
  points3D: THREE.Vector3[],
  depthMm: number,
  modelBox?: THREE.Box3 | THREE.Camera | null,
  flipSide: boolean = false,
  surfaceNormals?: THREE.Vector3[],
  camera?: THREE.Camera | null
): { cutterMesh: THREE.Mesh } | null {
  if (!points3D || points3D.length < 3) return null;

  const targetPts = Math.max(64, Math.min(128, points3D.length * 8));
  const subdivisions = Math.max(3, Math.min(12, Math.round(targetPts / points3D.length)));
  const smoothBoundary3D = sampleCatmullRom3D(points3D, true, subdivisions);
  const centroid = computeCentroid(smoothBoundary3D);

  let targetBox: THREE.Box3 | undefined;
  let targetCam = camera;
  if (modelBox instanceof THREE.Box3) {
    targetBox = modelBox;
  } else if (modelBox && 'isCamera' in modelBox) {
    targetCam = modelBox as THREE.Camera;
  }

  const selectionNormal = computeNewellNormal(smoothBoundary3D);

  let outwardRef = new THREE.Vector3();
  if (surfaceNormals && surfaceNormals.length > 0) {
    for (const sn of surfaceNormals) outwardRef.add(sn);
    if (outwardRef.lengthSq() > 1e-4) outwardRef.normalize();
  }
  if (outwardRef.lengthSq() < 1e-4 && targetBox && !targetBox.isEmpty()) {
    outwardRef.subVectors(centroid, targetBox.getCenter(new THREE.Vector3()));
    if (outwardRef.lengthSq() > 1e-4) outwardRef.normalize();
  }
  if (outwardRef.lengthSq() < 1e-4 && targetCam) {
    outwardRef.subVectors(targetCam.position, centroid);
    if (outwardRef.lengthSq() > 1e-4) outwardRef.normalize();
  }
  if (outwardRef.lengthSq() < 1e-4) {
    outwardRef.set(0, 0, 1);
  }

  if (selectionNormal.dot(outwardRef) < 0) {
    selectionNormal.negate();
  }
  if (flipSide) {
    selectionNormal.negate();
  }

  const zAxis = selectionNormal.clone().normalize();

  let xAxis = new THREE.Vector3();
  for (const pt of smoothBoundary3D) {
    const rel = new THREE.Vector3().subVectors(pt, centroid);
    const proj = rel.sub(zAxis.clone().multiplyScalar(rel.dot(zAxis)));
    if (proj.lengthSq() > 1e-4) {
      xAxis = proj.normalize();
      break;
    }
  }
  if (xAxis.lengthSq() < 1e-4) {
    const ref = Math.abs(zAxis.x) > 0.85 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    xAxis = new THREE.Vector3().crossVectors(ref, zAxis).normalize();
  }
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  basisMatrix.setPosition(centroid);

  const pts2D = smoothBoundary3D.map((p) => {
    const rel = new THREE.Vector3().subVectors(p, centroid);
    return new THREE.Vector2(rel.dot(xAxis), rel.dot(yAxis));
  });

  const polygonUV = ensureCounterClockwise2D(pts2D);
  const clampedDepth = THREE.MathUtils.clamp(depthMm, 1.0, 60.0);
  const wMin = -clampedDepth;
  const wMax = 0.5;

  const geom = new THREE.ExtrudeGeometry(new THREE.Shape(polygonUV), {
    depth: wMax - wMin,
    bevelEnabled: false,
  });
  geom.translate(0, 0, wMin);
  geom.computeVertexNormals();

  const cutterMesh = new THREE.Mesh(geom, createCutterVolumeMaterial());
  cutterMesh.renderOrder = 15;

  basisMatrix.decompose(cutterMesh.position, cutterMesh.quaternion, cutterMesh.scale);
  cutterMesh.updateMatrixWorld(true);

  attachWireframeDecorations(cutterMesh, geom, {
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3(0, 0, -1),
    length: Math.max(clampedDepth, 8),
  });

  cutterMesh.userData.cutterKind = 'detail';
  cutterMesh.userData.cutSpec2D = {
    polygonUV: polygonUV.map((v) => [v.x, v.y] as [number, number]),
    wMin,
    wMax,
  };
  return { cutterMesh };
}

