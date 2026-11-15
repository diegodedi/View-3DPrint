import { useEffect } from 'react';
import * as THREE from 'three';
import type { CatpinCutResult } from '../../types/models';
import {
  buildConnectorMeshes,
  updateConnectorMeshesInPlace,
  type CatpinConnectorConfig,
} from '../../utils/catpin/connectorMeshBuilder';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';
import {
  buildMirroredCutterMesh,
  computeMirroredPinPose,
} from '../../utils/catpin/mirrorCutUtils';
import { disposeObjectGeometries } from '../../utils/threeHelpers';
import type { CatpinToolMode } from './CatPinControls';

interface UseCatPinMirrorLifecycleParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  cutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  pinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  mirrorCutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  mirrorPinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  mirrorSocketMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  modelBoxRef: React.MutableRefObject<THREE.Box3>;
  mirrorEnabled: boolean;
  toolMode: CatpinToolMode;
  detailDepthMm: number;
  detailTaperPct: number;
  connectorConfig: CatpinConnectorConfig;
  cutPoints: CutPoint3D2D[];
  polylineFlipSide: boolean;
  hasManualPin: boolean;
  syncTick: number;
  straightFlipTrigger: number;
  pinFlipTrigger: number;
  result: CatpinCutResult | null;
  renderScene: () => void;
}

/**
 * Gerencia o ciclo de vida 3D isolado do cortador e conectores espelhados (Mirror Cut) na Viewport.
 */
export function useCatPinMirrorLifecycle({
  sceneRef,
  cameraRef,
  cutterMeshRef,
  pinMeshRef,
  mirrorCutterMeshRef,
  mirrorPinMeshRef,
  mirrorSocketMeshRef,
  modelBoxRef,
  mirrorEnabled,
  toolMode,
  detailDepthMm,
  detailTaperPct,
  connectorConfig,
  cutPoints,
  polylineFlipSide,
  hasManualPin,
  syncTick,
  straightFlipTrigger,
  pinFlipTrigger,
  result,
  renderScene,
}: UseCatPinMirrorLifecycleParams) {
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const cleanupMirrorMeshes = () => {
      if (mirrorCutterMeshRef.current) {
        scene.remove(mirrorCutterMeshRef.current);
        disposeObjectGeometries(mirrorCutterMeshRef.current);
        mirrorCutterMeshRef.current = null;
      }
      if (mirrorPinMeshRef.current) {
        scene.remove(mirrorPinMeshRef.current);
        disposeObjectGeometries(mirrorPinMeshRef.current);
        mirrorPinMeshRef.current = null;
      }
      if (mirrorSocketMeshRef.current) {
        scene.remove(mirrorSocketMeshRef.current);
        disposeObjectGeometries(mirrorSocketMeshRef.current);
        mirrorSocketMeshRef.current = null;
      }
    };

    cleanupMirrorMeshes();

    if (!mirrorEnabled || result || !cutterMeshRef.current) {
      renderScene();
      return;
    }

    const mirrorCutter = buildMirroredCutterMesh({
      toolMode,
      cutPoints,
      primaryCutter: cutterMeshRef.current,
      polylineFlipSide,
      detailDepthMm,
      detailTaperPct,
      modelBox: modelBoxRef.current,
      camera: cameraRef.current,
      planeWorldX: 0,
    });

    if (!mirrorCutter) {
      renderScene();
      return;
    }

    const maskOpacityPct = connectorConfig.maskOpacityPct ?? 65;
    if (mirrorCutter.material instanceof THREE.MeshBasicMaterial) {
      mirrorCutter.material.opacity = THREE.MathUtils.clamp(maskOpacityPct / 100, 0, 0.9);
    }
    mirrorCutter.visible = !result;
    scene.add(mirrorCutter);
    mirrorCutterMeshRef.current = mirrorCutter;

    if (toolMode === 'seam' && connectorConfig.type !== 'none') {
      const { position, quaternion } = computeMirroredPinPose(
        pinMeshRef.current,
        mirrorCutter,
        hasManualPin,
        connectorConfig.pinSide,
        0
      );
      const { pinMesh, socketMesh } = buildConnectorMeshes(connectorConfig, position, quaternion);
      if (pinMesh && socketMesh) {
        pinMesh.visible = !result;
        updateConnectorMeshesInPlace(pinMesh, socketMesh, connectorConfig);
        scene.add(pinMesh, socketMesh);
        mirrorPinMeshRef.current = pinMesh;
        mirrorSocketMeshRef.current = socketMesh;
      }
    }

    renderScene();
    return cleanupMirrorMeshes;
  }, [
    mirrorEnabled,
    toolMode,
    detailDepthMm,
    detailTaperPct,
    connectorConfig,
    cutPoints,
    polylineFlipSide,
    hasManualPin,
    syncTick,
    straightFlipTrigger,
    pinFlipTrigger,
    result,
    sceneRef,
    cameraRef,
    cutterMeshRef,
    pinMeshRef,
    mirrorCutterMeshRef,
    mirrorPinMeshRef,
    mirrorSocketMeshRef,
    modelBoxRef,
    renderScene,
  ]);
}

