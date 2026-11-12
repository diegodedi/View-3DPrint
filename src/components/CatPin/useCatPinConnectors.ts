import { useCallback, useEffect } from 'react';
import * as THREE from 'three';
import type { CatpinCutResult } from '../../types/models';
import {
  buildConnectorMeshes,
  updateConnectorMeshesInPlace,
  type CatpinConnectorConfig,
} from '../../utils/catpin/connectorMeshBuilder';
import { disposeObjectGeometries } from '../../utils/threeHelpers';
import type { CatpinToolMode } from './CatPinControls';

interface UseCatPinConnectorsParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  pinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  socketMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  autoPoseRef: React.MutableRefObject<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>;
  userModifiedPinTransformRef: React.MutableRefObject<boolean>;
  savedPinPositionRef: React.MutableRefObject<THREE.Vector3>;
  savedPinQuaternionRef: React.MutableRefObject<THREE.Quaternion>;
  cutNormalRef: React.MutableRefObject<THREE.Vector3>;
  toolMode: CatpinToolMode;
  connectorConfig: CatpinConnectorConfig;
  result: CatpinCutResult | null;
  syncTick: number;
  setSyncTick: React.Dispatch<React.SetStateAction<number>>;
  renderScene: () => void;
}

/**
 * Hook dedicado ao ciclo de vida e posicionamento dos conectores (Pino e Furo).
 * Conectores operam exclusivamente no modo 'seam' (Corte Membro); ferramentas de
 * Extrusão de Detalhe e Corte Plano não utilizam conectores.
 */
export function useCatPinConnectors({
  sceneRef,
  cutterMeshRef,
  mainMeshRef,
  pinMeshRef,
  socketMeshRef,
  autoPoseRef: _autoPoseRef,
  userModifiedPinTransformRef,
  savedPinPositionRef,
  savedPinQuaternionRef,
  cutNormalRef,
  toolMode,
  connectorConfig,
  result,
  syncTick: _syncTick,
  setSyncTick: _setSyncTick,
  renderScene,
}: UseCatPinConnectorsParams) {
  const syncConnectorsWithCutter = useCallback(() => {
    const scene = sceneRef.current, cutter = cutterMeshRef.current, mainMesh = mainMeshRef.current;
    if (!scene) return;
    if (!cutter || !mainMesh || connectorConfig.type === 'none' || toolMode !== 'seam') {
      if (pinMeshRef.current) {
        scene.remove(pinMeshRef.current);
        disposeObjectGeometries(pinMeshRef.current);
        pinMeshRef.current = null;
      }
      if (socketMeshRef.current) {
        scene.remove(socketMeshRef.current);
        disposeObjectGeometries(socketMeshRef.current);
        socketMeshRef.current = null;
      }
      return;
    }

    let pinPos = new THREE.Vector3(), pinQuat = new THREE.Quaternion();
    if (userModifiedPinTransformRef.current) {
      pinPos.copy(savedPinPositionRef.current);
      pinQuat.copy(savedPinQuaternionRef.current);
    } else {
      pinPos.copy(cutter.position);
      const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(cutter.quaternion).normalize();
      if (connectorConfig.pinSide === 'partB') planeNormal.negate();
      pinQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), planeNormal);
    }
    savedPinPositionRef.current.copy(pinPos);
    savedPinQuaternionRef.current.copy(pinQuat);
    cutNormalRef.current.set(0, 1, 0).applyQuaternion(pinQuat).normalize();

    if (pinMeshRef.current && socketMeshRef.current) {
      pinMeshRef.current.position.copy(pinPos);
      pinMeshRef.current.quaternion.copy(pinQuat);
      pinMeshRef.current.visible = !result;
      updateConnectorMeshesInPlace(pinMeshRef.current, socketMeshRef.current, connectorConfig);
    } else {
      const { pinMesh, socketMesh } = buildConnectorMeshes(connectorConfig, pinPos, pinQuat);
      if (pinMesh && socketMesh) {
        pinMesh.visible = !result;
        scene.add(pinMesh, socketMesh);
        pinMeshRef.current = pinMesh;
        socketMeshRef.current = socketMesh;
      }
    }
  }, [connectorConfig, toolMode, result, sceneRef, cutterMeshRef, mainMeshRef, pinMeshRef, socketMeshRef, userModifiedPinTransformRef, savedPinPositionRef, savedPinQuaternionRef, cutNormalRef]);

  useEffect(() => {
    if (toolMode !== 'seam') {
      syncConnectorsWithCutter();
      renderScene();
      return;
    }
    if (pinMeshRef.current && socketMeshRef.current && connectorConfig.type !== 'none') {
      pinMeshRef.current.visible = !result;
      updateConnectorMeshesInPlace(pinMeshRef.current, socketMeshRef.current, connectorConfig);
      renderScene();
    } else {
      syncConnectorsWithCutter();
      renderScene();
    }
  }, [
    toolMode,
    connectorConfig.type,
    connectorConfig.diameterMm,
    connectorConfig.depthMm,
    connectorConfig.clearanceMm,
    connectorConfig.xrayMode,
    result,
    syncConnectorsWithCutter,
    renderScene,
    pinMeshRef,
    socketMeshRef,
  ]);

  return { syncConnectorsWithCutter };
}

