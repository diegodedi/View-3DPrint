import * as THREE from 'three';
import { computeBestFitPlane } from './bestFitPlane';
import {
  attachBoundaryDecorations,
  createCutterVolumeMaterial,
} from './cutterSplineHelpers';
import {
  buildDeformedSeamGeometry,
  sampleCatmullRom3D,
  selectOptimalSeamBasis,
} from './deformedSeamMesh';
import { buildDetailPlugCutterMesh } from './detailPlugCutterBuilder';
import { buildStraightCutter } from './straightCutterBuilder';

export { buildDetailPlugCutterMesh, buildStraightCutter };

export interface CutPoint3D2D {
  worldPos: THREE.Vector3;
  x: number;
  y: number;
  surfaceNormal?: THREE.Vector3;
  isOccluded?: boolean;
}

export function computeCentroid(points: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3(0, 0, 0);
  for (const p of points) c.add(p);
  return c.divideScalar(Math.max(points.length, 1));
}

export function computeNewellNormal(points: THREE.Vector3[]): THREE.Vector3 {
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
 * FERRAMENTA 1: Corte de Membro / Costura (Seam Cut)
 * Constrói uma Membrana 3D Deformada cuja borda acompanha 100% os pontos e curvas
 * da Polyline desenhada pelo usuário, deformando-se em 3D conforme a malha.
 */
export function buildSeamCutterMesh(
  points3D: THREE.Vector3[],
  flipSide: boolean,
  _modelBox?: THREE.Box3,
  camera?: THREE.Camera | null
): { cutterMesh: THREE.Mesh } | null {
  if (!points3D || points3D.length < 3) return null;
  const rawBoundary3D = sampleCatmullRom3D(points3D, true, 5);

  // Normal e centróide calculados EXATAMENTE a partir dos pontos reais da seleção (Stokes / Newell)
  const { origin: centroid, normal: rawFitNormal } = computeBestFitPlane(rawBoundary3D);
  const fitNormal = rawFitNormal.clone();

  if (_modelBox && !_modelBox.isEmpty()) {
    const modelCenter = _modelBox.getCenter(new THREE.Vector3());
    const outward = new THREE.Vector3().subVectors(centroid, modelCenter);
    if (outward.lengthSq() > 1e-4) {
      outward.normalize();
      // Garante orientação para fora (em direção ao membro Part B), sem nunca distorcer a direção analítica
      if (fitNormal.dot(outward) < 0) {
        fitNormal.negate();
      }
    }
  }

  const targetNormal = flipSide ? fitNormal.clone().negate() : fitNormal;
  const { xAxis, yAxis, zAxis } = selectOptimalSeamBasis(
    rawBoundary3D,
    centroid,
    targetNormal.clone().normalize(),
    camera
  );

  const PLANAR_BLADE_THICKNESS_MM = 0.08;
  const {
    geometry: geom,
    polygonUV,
    polygonW,
    boundaryLocal3D,
    wMin,
    wMax,
  } = buildDeformedSeamGeometry(
    rawBoundary3D,
    centroid,
    xAxis,
    yAxis,
    zAxis,
    PLANAR_BLADE_THICKNESS_MM
  );

  const cutterMesh = new THREE.Mesh(geom, createCutterVolumeMaterial());
  cutterMesh.renderOrder = 15;

  const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  basisMatrix.setPosition(centroid);
  basisMatrix.decompose(cutterMesh.position, cutterMesh.quaternion, cutterMesh.scale);
  cutterMesh.updateMatrixWorld(true);

  attachBoundaryDecorations(cutterMesh, boundaryLocal3D, {
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3(0, 0, 1),
    length: 10,
  });

  cutterMesh.userData.cutterKind = 'seam';
  cutterMesh.userData.flipSide = flipSide;
  cutterMesh.userData.planePoint = centroid;
  cutterMesh.userData.planeNormal = zAxis;
  cutterMesh.userData.boundary3D = rawBoundary3D;
  cutterMesh.userData.seamCentroid = centroid;
  cutterMesh.userData.seamXAxis = xAxis;
  cutterMesh.userData.seamYAxis = yAxis;
  cutterMesh.userData.seamZAxis = zAxis;

  cutterMesh.userData.cutSpec2D = {
    polygonUV,
    polygonW,
    wMin,
    wMax,
    scale: [1.0, 1.0],
  };
  return { cutterMesh };
}
