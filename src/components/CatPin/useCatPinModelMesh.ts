import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createGrayMatcapMaterial } from '../../utils/matcapUtils';
import { disposeObjectGeometries, prepareObjectOnPlate } from '../../utils/threeHelpers';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface UseCatPinModelMeshParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  orbitControlsRef: React.MutableRefObject<OrbitControls | null>;
  sourceGeometry: THREE.BufferGeometry;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  modelBoxRef: React.MutableRefObject<THREE.Box3>;
  xrayMode: boolean;
  hasResult: boolean;
  onResetPoses: () => void;
  renderScene: () => void;
}

/**
 * Hook responsável pela clonagem, medição, centralização e material Raio-X do modelo 3D.
 * Preserva a transformação de origem raiz durante cortes sucessivos em sub-peças.
 */
export function useCatPinModelMesh({
  sceneRef,
  cameraRef,
  orbitControlsRef,
  sourceGeometry,
  mainMeshRef,
  modelBoxRef,
  xrayMode: _xrayMode,
  hasResult,
  onResetPoses,
  renderScene,
}: UseCatPinModelMeshParams) {
  const onResetPosesRef = useRef(onResetPoses);
  onResetPosesRef.current = onResetPoses;
  const renderSceneRef = useRef(renderScene);
  renderSceneRef.current = renderScene;
  const rootTransformRef = useRef<{
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    scale: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current, camera = cameraRef.current, orbit = orbitControlsRef.current;
    if (!scene || !camera || !orbit || !sourceGeometry) return;
    if (mainMeshRef.current) {
      scene.remove(mainMeshRef.current);
      disposeObjectGeometries(mainMeshRef.current);
    }

    const cloned = sourceGeometry.clone();
    if (!cloned.attributes.normal) cloned.computeVertexNormals();
    const mesh = new THREE.Mesh(cloned, createGrayMatcapMaterial());

    if (!rootTransformRef.current) {
      const dims = prepareObjectOnPlate(mesh);
      rootTransformRef.current = {
        pos: mesh.position.clone(),
        quat: mesh.quaternion.clone(),
        scale: mesh.scale.clone(),
      };
      const maxDim = Math.max(dims.widthMm, dims.depthMm, dims.heightMm, 30);
      camera.position.set(maxDim * 1.55, maxDim * 1.15, maxDim * 1.55);
      orbit.target.set(0, dims.heightMm * 0.45, 0);
      orbit.update();
    } else {
      mesh.position.copy(rootTransformRef.current.pos);
      mesh.quaternion.copy(rootTransformRef.current.quat);
      mesh.scale.copy(rootTransformRef.current.scale);
    }

    mesh.renderOrder = 1;
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    mainMeshRef.current = mesh;
    modelBoxRef.current.setFromObject(mesh);
    onResetPosesRef.current();
    renderSceneRef.current();
  }, [sourceGeometry, sceneRef, cameraRef, orbitControlsRef, mainMeshRef, modelBoxRef]);

  useEffect(() => {
    const mainMesh = mainMeshRef.current;
    if (!mainMesh) return;
    // Padrão CatPin Oficial (Imagens 1 e 2): O modelo 3D principal permanece SEMPRE 100%
    // sólido e opaco com cinza estúdio, preservando anatomia, relevo e contraste.
    mainMesh.material = createGrayMatcapMaterial();
    renderScene();
  }, [hasResult, mainMeshRef, renderScene]);
}
