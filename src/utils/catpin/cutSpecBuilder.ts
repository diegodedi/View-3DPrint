import * as THREE from 'three';
import type { CatpinCutSpec, CatpinConnectorSpec } from '../../types/models';
import type { CatpinConnectorConfig } from './connectorMeshBuilder';
import { buildDeformedSeamGeometry } from './deformedSeamMesh';

type V3 = [number, number, number];
const toV3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];

/**
 * Converte o cortador (que vive no mundo Three.js) para o ESPAÇO DO MODELO (= espaço local da
 * geometria de mainMesh = espaço do arquivo STL). É a ÚNICA ponte entre a UI e o motor.
 *
 * - Corte plano: cutterMesh.userData.cutterKind === 'straight'. Ponto = posição do plano; normal = +Z local
 *   do plano (lado +normal vira Parte B).
 * - Laço/Linha divisora: cutterMesh.userData.cutSpec2D = { polygonUV, wMin, wMax } e cutterMesh.matrixWorld
 *   é a base DESTRA (X=direita, Y=cima, Z=-viewDir, origem=planeOrigin).
 */
export function buildCutSpecModel(
  cutterMesh: THREE.Mesh,
  mainMesh: THREE.Mesh,
  _cutGapMm?: number
): CatpinCutSpec {
  cutterMesh.updateMatrixWorld(true);
  mainMesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(mainMesh.matrixWorld).invert();

  if (cutterMesh.userData.cutterKind === 'straight') {
    const point = new THREE.Vector3().setFromMatrixPosition(cutterMesh.matrixWorld).applyMatrix4(inv);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(cutterMesh.matrixWorld).transformDirection(inv);
    return { kind: 'plane', point: toV3(point), normal: toV3(normal) };
  }

  const spec2D = cutterMesh.userData.cutSpec2D as
    | { polygonUV: Array<[number, number]>; polygonW?: number[]; wMin: number; wMax: number; scale?: [number, number] }
    | undefined;
  if (!spec2D) throw new Error('Cortador sem cutSpec2D: refaça o contorno de corte.');
  const basisModel = new THREE.Matrix4().multiplyMatrices(inv, cutterMesh.matrixWorld);
  if (basisModel.determinant() < 0) throw new Error('Base do cortador canhota (determinante < 0): bug em cutterMeshBuilder.');

  if (cutterMesh.userData.cutterKind === 'seam') {
    const point = new THREE.Vector3().setFromMatrixPosition(cutterMesh.matrixWorld).applyMatrix4(inv);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(cutterMesh.matrixWorld).transformDirection(inv);

    let bladeMesh: Extract<CatpinCutSpec, { kind: 'seam' }>['bladeMesh'] = undefined;
    const boundary3D = cutterMesh.userData.boundary3D as THREE.Vector3[] | undefined;
    const seamCentroid = cutterMesh.userData.seamCentroid as THREE.Vector3 | undefined;
    const seamX = cutterMesh.userData.seamXAxis as THREE.Vector3 | undefined;
    const seamY = cutterMesh.userData.seamYAxis as THREE.Vector3 | undefined;
    const seamZ = cutterMesh.userData.seamZAxis as THREE.Vector3 | undefined;

    const cutterToModel = new THREE.Matrix4().multiplyMatrices(inv, cutterMesh.matrixWorld);
    const v = new THREE.Vector3();
    const g = Math.min(Math.max(_cutGapMm ?? 0, 0), 3);

    let loopSpan = 0;
    if (boundary3D && boundary3D.length >= 3 && seamCentroid) {
      for (const p of boundary3D) loopSpan = Math.max(loopSpan, p.distanceTo(seamCentroid) * 2);
    }
    const minBlade = Math.min(0.08, Math.max(loopSpan * 0.004, 1e-4));
    const hBlade = Math.max(g, minBlade);

    if (boundary3D && boundary3D.length >= 3 && seamCentroid && seamX && seamY && seamZ) {
      // REGRA CATPIN ANTI-CILINDRO: Lâmina 3D fina conforme à polyline em Z=0 (espessura hBlade).
      // Saia inicial proporcional e justa ao diâmetro da junta evita danificar membros vizinhos próximos;
      // o motor escalona em UV mantendo 100% da curvatura 3D se necessário.
      const initialSkirt = Math.min(Math.max(loopSpan * 0.04, loopSpan * 0.015), 1.5);
      const geomBlade = buildDeformedSeamGeometry(
        boundary3D,
        seamCentroid,
        seamX,
        seamY,
        seamZ,
        hBlade,
        initialSkirt
      );
      const posAttr = geomBlade.geometry.attributes.position;
      const count = posAttr.count;
      const bladePos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(cutterToModel);
        bladePos[3 * i] = v.x;
        bladePos[3 * i + 1] = v.y;
        bladePos[3 * i + 2] = v.z;
      }
      bladeMesh = {
        positions: bladePos,
        indices: Uint32Array.from(geomBlade.geometry.index!.array as ArrayLike<number>),
      };
      geomBlade.geometry.dispose();
    } else {
      const geom = cutterMesh.geometry;
      if (geom && geom.attributes.position && geom.index) {
        const posAttr = geom.attributes.position;
        const count = posAttr.count;
        const bladePos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(cutterToModel);
          bladePos[3 * i] = v.x;
          bladePos[3 * i + 1] = v.y;
          bladePos[3 * i + 2] = v.z;
        }
        bladeMesh = { positions: bladePos, indices: Uint32Array.from(geom.index.array as ArrayLike<number>) };
      }
    }

    return {
      kind: 'seam',
      polygonUV: spec2D.polygonUV,
      polygonW: spec2D.polygonW,
      basis: Array.from(basisModel.elements),
      point: toV3(point),
      normal: toV3(normal),
      scale: spec2D.scale ?? [1.0, 1.0],
      wMin: spec2D.wMin,
      wMax: spec2D.wMax,
      flipSide: Boolean(cutterMesh.userData.flipSide),
      bladeMesh,
    };
  }
  const point = new THREE.Vector3().setFromMatrixPosition(cutterMesh.matrixWorld).applyMatrix4(inv);
  return {
    kind: 'extrude',
    polygonUV: spec2D.polygonUV,
    basis: Array.from(basisModel.elements),
    wMin: spec2D.wMin,
    wMax: spec2D.wMax,
    scale: spec2D.scale,
    point: toV3(point),
  };
}

/**
 * Pose do pino no espaço do modelo. O pino da UI aponta para +Y local; o eixo do motor é esse +Y
 * (da peça que recebe o pino para a peça que recebe o furo — o motor corrige o lado sozinho).
 */
export function buildConnectorSpecModel(
  pinMesh: THREE.Mesh,
  mainMesh: THREE.Mesh,
  cfg: CatpinConnectorConfig,
  hasManualPin: boolean = true
): CatpinConnectorSpec {
  pinMesh.updateMatrixWorld(true);
  mainMesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(mainMesh.matrixWorld).invert();
  const position = new THREE.Vector3().setFromMatrixPosition(pinMesh.matrixWorld).applyMatrix4(inv);
  const axis = new THREE.Vector3(0, 1, 0).transformDirection(pinMesh.matrixWorld).transformDirection(inv).normalize();
  const xAxis = new THREE.Vector3(1, 0, 0).transformDirection(pinMesh.matrixWorld).transformDirection(inv).normalize();
  return {
    type: cfg.type === 'trapezoid' ? 'trapezoid' : 'cylinder',
    diameterMm: cfg.diameterMm,
    heightMm: cfg.depthMm,
    clearanceMm: cfg.clearanceMm,
    position: toV3(position),
    axis: toV3(axis),
    xAxis: toV3(xAxis),
    pinSide: cfg.pinSide ?? 'auto',
    hasManualPosition: hasManualPin,
  };
}

/** Converte uma pose do espaço do modelo (devolvida pelo motor) para o mundo Three.js. */
export function modelPoseToWorld(
  mainMesh: THREE.Mesh,
  position: V3,
  axis: V3
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  mainMesh.updateMatrixWorld(true);
  const pos = new THREE.Vector3(...position).applyMatrix4(mainMesh.matrixWorld);
  const dir = new THREE.Vector3(...axis).transformDirection(mainMesh.matrixWorld).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return { position: pos, quaternion };
}

