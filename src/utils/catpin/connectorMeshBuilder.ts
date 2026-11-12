import * as THREE from 'three';
import { disposeObjectGeometries } from '../threeHelpers';
import type { CatpinPinSide } from '../../types/models';

export type CatpinConnectorType = 'cylinder' | 'trapezoid' | 'none';

export interface CatpinConnectorConfig {
  type: CatpinConnectorType;
  diameterMm: number;
  depthMm: number;
  clearanceMm: number;
  xrayMode: boolean;
  pinSide?: CatpinPinSide;
}

export interface ConnectorMeshesPair {
  pinMesh: THREE.Mesh | null;
  socketMesh: THREE.Mesh | null;
}

export function createConnectorGeometries(config: CatpinConnectorConfig): {
  pinGeom: THREE.BufferGeometry;
  socketGeom: THREE.BufferGeometry;
  pinRadius: number;
  height: number;
} {
  const diameter = THREE.MathUtils.clamp(config.diameterMm, 2.0, 30.0);
  const height = THREE.MathUtils.clamp(config.depthMm, 4.0, 40.0);
  const clearance = THREE.MathUtils.clamp(config.clearanceMm, 0.05, 1.0);
  const embedMm = 3.0;

  const pinRadius = diameter / 2;
  const socketRadius = pinRadius + clearance;
  const pinTotalHeight = height + embedMm;
  const socketHeight = height + 0.5;

  let pinGeom: THREE.BufferGeometry;
  let socketGeom: THREE.BufferGeometry;

  if (config.type === 'trapezoid') {
    const rTop = pinRadius * 0.72;
    const rBottom = pinRadius;
    pinGeom = new THREE.CylinderGeometry(rTop, rBottom, pinTotalHeight, 4);
    socketGeom = new THREE.CylinderGeometry(rTop + clearance, rBottom + clearance, socketHeight, 4);
    pinGeom.rotateY(Math.PI / 4);
    socketGeom.rotateY(Math.PI / 4);
  } else {
    pinGeom = new THREE.CylinderGeometry(pinRadius, pinRadius, pinTotalHeight, 64);
    socketGeom = new THREE.CylinderGeometry(socketRadius, socketRadius, socketHeight, 64);
  }

  // Posiciona o pino com base em z=0: embutido de -embedMm até 0 na peça de apoio, e projetando de 0 até +height
  pinGeom.translate(0, (height - embedMm) / 2, 0);
  // O furo estende de 0 até +socketHeight na peça de encaixe
  socketGeom.translate(0, socketHeight / 2, 0);

  pinGeom.computeVertexNormals();
  socketGeom.computeVertexNormals();
  return { pinGeom, socketGeom, pinRadius, height };
}

function attachPinVisualHelpers(
  pinMesh: THREE.Mesh,
  pinGeom: THREE.BufferGeometry,
  socketGeom: THREE.BufferGeometry,
  pinRadius: number,
  height: number,
  xrayMode: boolean = true
): void {
  disposeObjectGeometries(pinMesh);
  pinMesh.clear();

  const pinEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(pinGeom, 25),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: !xrayMode,
      depthWrite: false,
    })
  );
  pinEdges.renderOrder = 32;

  const socketPreviewEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(socketGeom, 25),
    new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.85,
      depthTest: !xrayMode,
      depthWrite: false,
    })
  );
  socketPreviewEdges.renderOrder = 31;

  const normalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, height, 0),
    Math.max(height * 0.45, 4.0),
    0xffaa00,
    Math.max(pinRadius * 0.55, 1.8),
    Math.max(pinRadius * 0.35, 1.2)
  );
  normalArrow.renderOrder = 33;
  if (normalArrow.line) {
    (normalArrow.line.material as THREE.Material).depthTest = !xrayMode;
  }
  if (normalArrow.cone) {
    (normalArrow.cone.material as THREE.Material).depthTest = !xrayMode;
  }

  pinMesh.add(pinEdges, socketPreviewEdges, normalArrow);
}

/**
 * Atualiza APENAS a geometria interna do pinMesh e socketMesh existentes,
 * preservando 100% intactos pinMesh.position e pinMesh.quaternion!
 */
export function updateConnectorMeshesInPlace(
  pinMesh: THREE.Mesh,
  socketMesh: THREE.Mesh,
  config: CatpinConnectorConfig
): void {
  const { pinGeom, socketGeom, pinRadius, height } = createConnectorGeometries(config);

  pinMesh.geometry.dispose();
  pinMesh.geometry = pinGeom;
  pinMesh.renderOrder = 30;

  if (pinMesh.material instanceof THREE.Material) {
    pinMesh.material.depthTest = !config.xrayMode;
    pinMesh.material.needsUpdate = true;
  }

  attachPinVisualHelpers(pinMesh, pinGeom, socketGeom, pinRadius, height, config.xrayMode);

  socketMesh.geometry.dispose();
  socketMesh.geometry = socketGeom;
  socketMesh.position.copy(pinMesh.position);
  socketMesh.quaternion.copy(pinMesh.quaternion);

  pinMesh.updateMatrixWorld(true);
  socketMesh.updateMatrixWorld(true);
}

/**
 * Constrói o par pareado pinMesh + socketMesh no eixo padrão +Y (defaultUp = 0,1,0).
 */
export function buildConnectorMeshes(
  config: CatpinConnectorConfig,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion
): ConnectorMeshesPair {
  if (config.type === 'none') {
    return { pinMesh: null, socketMesh: null };
  }

  const { pinGeom, socketGeom, pinRadius, height } = createConnectorGeometries(config);

  const pinMat = new THREE.MeshStandardMaterial({
    color: 0xff8c00, // Laranja CatPin Oficial (Imagens 1 e 2)
    emissive: 0xff5500,
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    depthTest: !config.xrayMode,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const pinMesh = new THREE.Mesh(pinGeom, pinMat);
  pinMesh.position.copy(position);
  pinMesh.quaternion.copy(quaternion);
  pinMesh.renderOrder = 30;
  attachPinVisualHelpers(pinMesh, pinGeom, socketGeom, pinRadius, height, config.xrayMode);
  pinMesh.updateMatrixWorld(true);

  const socketMat = new THREE.MeshBasicMaterial({ visible: false });
  const socketMesh = new THREE.Mesh(socketGeom, socketMat);
  socketMesh.position.copy(position);
  socketMesh.quaternion.copy(quaternion);
  socketMesh.updateMatrixWorld(true);

  return { pinMesh, socketMesh };
}
