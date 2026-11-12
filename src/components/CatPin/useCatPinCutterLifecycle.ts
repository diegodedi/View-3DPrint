import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  buildDetailPlugCutterMesh,
  buildSeamCutterMesh,
  buildStraightCutter,
  type CutPoint3D2D,
} from '../../utils/catpin/cutterMeshBuilder';
import { disposeObjectGeometries } from '../../utils/threeHelpers';
import type { CatpinToolMode } from './CatPinControls';
import type { CatpinCutResult } from '../../types/models';

interface UseCatPinCutterLifecycleParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  cutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  modelBoxRef: React.MutableRefObject<THREE.Box3>;
  straightPoseRef: React.MutableRefObject<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>;
  autoPoseRef: React.MutableRefObject<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>;
  toolMode: CatpinToolMode;
  sourceGeometry?: THREE.BufferGeometry;
  detailDepthMm: number;
  detailTaperPct?: number;
  cutPoints: CutPoint3D2D[];
  polylineFlipSide: boolean;
  result: CatpinCutResult | null;
  syncConnectorsWithCutter: () => void;
  setSyncTick: React.Dispatch<React.SetStateAction<number>>;
  renderScene: () => void;
}

/**
 * Hook que gerencia o ciclo de vida do cortador 3D (plano, membro ou detalhe) na cena Three.js.
 */
export function useCatPinCutterLifecycle({
  sceneRef,
  cameraRef,
  mainMeshRef,
  cutterMeshRef,
  modelBoxRef,
  straightPoseRef,
  autoPoseRef,
  toolMode,
  sourceGeometry,
  detailDepthMm,
  detailTaperPct = 0,
  cutPoints,
  polylineFlipSide,
  result,
  syncConnectorsWithCutter,
  setSyncTick,
  renderScene,
}: UseCatPinCutterLifecycleParams) {
  const worldPtsSig = useMemo(
    () => cutPoints.map((p) => `${p.worldPos.x.toFixed(2)},${p.worldPos.y.toFixed(2)},${p.worldPos.z.toFixed(2)}`).join('|'),
    [cutPoints]
  );

  useEffect(() => {
    autoPoseRef.current = null;
    const scene = sceneRef.current, mainMesh = mainMeshRef.current;
    if (!scene || !mainMesh) return;
    if (cutterMeshRef.current) {
      scene.remove(cutterMeshRef.current);
      disposeObjectGeometries(cutterMeshRef.current);
      cutterMeshRef.current = null;
    }
    const worldPts = cutPoints.map((p) => p.worldPos);
    let cutter: THREE.Mesh | null = null;

    if (toolMode === 'straight') {
      cutter = buildStraightCutter(modelBoxRef.current);
      if (straightPoseRef.current) {
        cutter.position.copy(straightPoseRef.current.pos);
        cutter.quaternion.copy(straightPoseRef.current.quat);
      } else {
        straightPoseRef.current = { pos: cutter.position.clone(), quat: cutter.quaternion.clone() };
      }
    } else if (toolMode === 'seam' && worldPts.length >= 3) {
      cutter = buildSeamCutterMesh(worldPts, polylineFlipSide, modelBoxRef.current, cameraRef.current)?.cutterMesh ?? null;
    } else if (toolMode === 'detail' && worldPts.length >= 3) {
      const surfaceNormals = cutPoints
        .map((p) => p.surfaceNormal)
        .filter((n): n is THREE.Vector3 => Boolean(n));
      cutter = buildDetailPlugCutterMesh(
        worldPts,
        detailDepthMm,
        modelBoxRef.current,
        polylineFlipSide,
        surfaceNormals,
        cameraRef.current,
        detailTaperPct
      )?.cutterMesh ?? null;
    }

    if (cutter) {
      cutter.visible = !result;
      scene.add(cutter);
      cutterMeshRef.current = cutter;
    }
    syncConnectorsWithCutter();
    setSyncTick((t) => t + 1);
    renderScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolMode, sourceGeometry, detailDepthMm, detailTaperPct, worldPtsSig, polylineFlipSide, result, sceneRef, cameraRef, renderScene]);
}

