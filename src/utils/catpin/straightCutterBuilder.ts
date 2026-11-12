import * as THREE from 'three';
import {
  attachWireframeDecorations,
  createCutterVolumeMaterial,
} from './cutterSplineHelpers';

/**
 * FERRAMENTA 3: Corte Plano Reto (Straight Cut)
 * Plano com Gizmo 3D para cortes globais.
 */
export function buildStraightCutter(modelBox: THREE.Box3): THREE.Mesh {
  const size = modelBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 30);
  const half = maxDim * 0.85;
  const center = modelBox.getCenter(new THREE.Vector3());

  const shape = new THREE.Shape([
    new THREE.Vector2(-half, -half),
    new THREE.Vector2(half, -half),
    new THREE.Vector2(half, half),
    new THREE.Vector2(-half, half),
  ]);
  const visualGeom = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
  visualGeom.translate(0, 0, -0.25);
  visualGeom.computeVertexNormals();

  const mesh = new THREE.Mesh(visualGeom, createCutterVolumeMaterial());
  mesh.renderOrder = 15;
  attachWireframeDecorations(mesh, visualGeom, {
    origin: new THREE.Vector3(0, 0, 0),
    dir: new THREE.Vector3(0, 0, 1),
    length: half * 0.45,
  });

  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  mesh.position.copy(center);
  mesh.updateMatrixWorld(true);
  mesh.userData.cutterKind = 'straight';
  return mesh;
}

