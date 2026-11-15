import * as THREE from 'three';
import {
  buildDetailPlugCutterMesh,
  buildSeamCutterMesh,
  buildStraightCutter,
  type CutPoint3D2D,
} from './cutterMeshBuilder';
import type { CatpinToolMode } from '../../components/CatPin/CatPinControls';

export interface SymmetryAnalysisResult {
  isSymmetric: boolean;
  symmetryScorePct: number;
  planeWorldX: number;
}

const GRID_RES = 64;
const SYMMETRY_THRESHOLD_PCT = 95.0;
const PLANE_CROSS_MARGIN_MM = 0.6;

function packGridIndex(gx: number, gy: number, gz: number): number {
  return (gx << 12) | (gy << 6) | gz;
}

interface GridCoord {
  gx: number;
  gy: number;
  gz: number;
}

function hasNeighborInGrid(grid: Uint8Array, cell: GridCoord): boolean {
  const xMin = Math.max(0, cell.gx - 1);
  const xMax = Math.min(GRID_RES - 1, cell.gx + 1);
  const yMin = Math.max(0, cell.gy - 1);
  const yMax = Math.min(GRID_RES - 1, cell.gy + 1);
  const zMin = Math.max(0, cell.gz - 1);
  const zMax = Math.min(GRID_RES - 1, cell.gz + 1);

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      for (let z = zMin; z <= zMax; z++) {
        if (grid[packGridIndex(x, y, z)] === 1) return true;
      }
    }
  }
  return false;
}

/**
 * Analisa se a malha 3D possui simetria bilateral no eixo X (Esquerda/Direita) usando Spatial Hashing 3D.
 */
export function detectMeshSymmetryX(
  geometry: THREE.BufferGeometry,
  planeWorldX: number = 0
): SymmetryAnalysisResult {
  const pos = geometry.attributes.position;
  if (!pos || pos.count < 3) {
    return { isSymmetric: false, symmetryScorePct: 0, planeWorldX };
  }

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const spanX = bb.max.x - bb.min.x;
  const spanY = Math.max(bb.max.y - bb.min.y, 1e-4);
  const spanZ = Math.max(bb.max.z - bb.min.z, 1e-4);

  if (spanX < 1e-4) {
    return { isSymmetric: false, symmetryScorePct: 0, planeWorldX };
  }

  const grid = new Uint8Array(GRID_RES * GRID_RES * GRID_RES);
  const count = pos.count;
  const maxBuildStep = Math.max(1, Math.floor(count / 60000));
  const scale = GRID_RES - 0.001;

  for (let i = 0; i < count; i += maxBuildStep) {
    const gx = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getX(i) - bb.min.x) / spanX) * scale)));
    const gy = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getY(i) - bb.min.y) / spanY) * scale)));
    const gz = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getZ(i) - bb.min.z) / spanZ) * scale)));
    grid[packGridIndex(gx, gy, gz)] = 1;
  }

  const sampleStep = Math.max(1, Math.floor(count / 12000));
  let matched = 0;
  let total = 0;

  for (let i = 0; i < count; i += sampleStep) {
    const gx = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getX(i) - bb.min.x) / spanX) * scale)));
    const gy = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getY(i) - bb.min.y) / spanY) * scale)));
    const gz = Math.min(GRID_RES - 1, Math.max(0, Math.floor(((pos.getZ(i) - bb.min.z) / spanZ) * scale)));
    const rgx = GRID_RES - 1 - gx;
    if (hasNeighborInGrid(grid, { gx: rgx, gy, gz })) matched++;
    total++;
  }

  const symmetryScorePct = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;
  return {
    isSymmetric: symmetryScorePct >= SYMMETRY_THRESHOLD_PCT,
    symmetryScorePct,
    planeWorldX,
  };
}

/**
 * Verifica se o contorno de pontos desenhado atravessa o plano de simetria central (ex: cintura ou pescoço).
 */
export function doesCutCrossSymmetryPlane(points: CutPoint3D2D[], planeWorldX: number = 0): boolean {
  if (points.length < 2) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const pt of points) {
    if (pt.worldPos.x < minX) minX = pt.worldPos.x;
    if (pt.worldPos.x > maxX) maxX = pt.worldPos.x;
  }
  return minX < planeWorldX - PLANE_CROSS_MARGIN_MM && maxX > planeWorldX + PLANE_CROSS_MARGIN_MM;
}

/**
 * Reflete os pontos 3D através do plano X e inverte a ordem para preservar a base destra (det > 0).
 */
export function mirrorCutPointsAcrossX(
  points: CutPoint3D2D[],
  planeWorldX: number = 0
): { worldPts: THREE.Vector3[]; surfaceNormals: THREE.Vector3[] } | null {
  if (points.length < 3 || doesCutCrossSymmetryPlane(points, planeWorldX)) {
    return null;
  }

  const reversed = [...points].reverse();
  const worldPts = reversed.map(
    (p) => new THREE.Vector3(2 * planeWorldX - p.worldPos.x, p.worldPos.y, p.worldPos.z)
  );
  const surfaceNormals = reversed
    .map((p) => p.surfaceNormal)
    .filter((n): n is THREE.Vector3 => Boolean(n))
    .map((n) => new THREE.Vector3(-n.x, n.y, n.z).normalize());

  return { worldPts, surfaceNormals };
}

/**
 * Constrói a malha do cortador espelhado usando as mesmas funções homologadas do cortador principal.
 */
export function buildMirroredCutterMesh(params: {
  toolMode: CatpinToolMode;
  cutPoints: CutPoint3D2D[];
  primaryCutter: THREE.Mesh | null;
  polylineFlipSide: boolean;
  detailDepthMm: number;
  detailTaperPct: number;
  modelBox: THREE.Box3;
  camera: THREE.Camera | null;
  planeWorldX?: number;
}): THREE.Mesh | null {
  const {
    toolMode, cutPoints, primaryCutter, polylineFlipSide,
    detailDepthMm, detailTaperPct, modelBox, camera, planeWorldX = 0,
  } = params;
  if (!primaryCutter) return null;

  const n1 = new THREE.Vector3(0, 0, 1).applyQuaternion(primaryCutter.quaternion).normalize();
  const expectedMirrorNormal = new THREE.Vector3(-n1.x, n1.y, n1.z).normalize();

  if (toolMode === 'straight') {
    const distFromCenter = Math.abs(primaryCutter.position.x - planeWorldX);
    if (distFromCenter < PLANE_CROSS_MARGIN_MM && Math.abs(n1.x) < 0.15) return null;
    const cutter = buildStraightCutter(modelBox);
    cutter.position.set(
      2 * planeWorldX - primaryCutter.position.x,
      primaryCutter.position.y,
      primaryCutter.position.z
    );
    cutter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), expectedMirrorNormal);
    cutter.updateMatrixWorld(true);
    return cutter;
  }

  const mirrored = mirrorCutPointsAcrossX(cutPoints, planeWorldX);
  if (!mirrored) return null;

  const buildForFlip = (flip: boolean): THREE.Mesh | null => {
    if (toolMode === 'seam') {
      return buildSeamCutterMesh(mirrored.worldPts, flip, modelBox, camera)?.cutterMesh ?? null;
    }
    return buildDetailPlugCutterMesh(
      mirrored.worldPts, detailDepthMm, modelBox, flip, mirrored.surfaceNormals, camera, detailTaperPct
    )?.cutterMesh ?? null;
  };

  let mirrorCutter = buildForFlip(polylineFlipSide);
  if (mirrorCutter) {
    const n2 = new THREE.Vector3(0, 0, 1).applyQuaternion(mirrorCutter.quaternion).normalize();
    if (n2.dot(expectedMirrorNormal) < 0) {
      mirrorCutter.geometry.dispose();
      mirrorCutter = buildForFlip(!polylineFlipSide);
    }
  }
  return mirrorCutter;
}

/**
 * Calcula a pose 3D do pino espelhado a partir do cortador espelhado ou da pose manual do pino principal.
 */
export function computeMirroredPinPose(
  primaryPin: THREE.Mesh | null,
  mirrorCutter: THREE.Mesh,
  hasManualPin: boolean,
  pinSide: string | undefined,
  planeWorldX: number = 0
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  if (hasManualPin && primaryPin) {
    position.set(2 * planeWorldX - primaryPin.position.x, primaryPin.position.y, primaryPin.position.z);
    const dir1 = new THREE.Vector3(0, 1, 0).applyQuaternion(primaryPin.quaternion).normalize();
    const mirroredDir = new THREE.Vector3(-dir1.x, dir1.y, dir1.z).normalize();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mirroredDir);
  } else {
    position.copy(mirrorCutter.position);
    const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mirrorCutter.quaternion).normalize();
    if (pinSide === 'partB') planeNormal.negate();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), planeNormal);
  }

  return { position, quaternion };
}

