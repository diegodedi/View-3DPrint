import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { CatpinCutResult } from '../../types/models';
import type { PlateArrangementResult } from '../../types/plateTypes';
import type { CatpinConnectorConfig } from '../../utils/catpin/connectorMeshBuilder';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';
import type { CatpinToolMode } from './CatPinControls';
import { CatPinOverlay2D } from './CatPinOverlay2D';
import { CatPinViewportToolbar, type CutAxisAlign, type GizmoMode, type GizmoTarget } from './CatPinViewportToolbar';
import { useCatPinConnectors } from './useCatPinConnectors';
import { useCatPinGizmoSync } from './useCatPinGizmoSync';
import { useCatPinModelMesh } from './useCatPinModelMesh';
import { useCatPinPoints3D } from './useCatPinPoints3D';
import { useCatPinResultMesh } from './useCatPinResultMesh';
import { useCatPinScene } from './useCatPinScene';
import { useCatPinCutterLifecycle } from './useCatPinCutterLifecycle';

export interface CatpinLiveMeshes {
  cutterMesh: THREE.Mesh | null;
  pinMesh: THREE.Mesh | null;
  socketMesh: THREE.Mesh | null;
  mainMesh: THREE.Mesh | null;
  hasManualPin: boolean;
}

interface CatPinCanvasProps {
  sourceGeometry: THREE.BufferGeometry;
  toolMode: CatpinToolMode;
  detailDepthMm: number;
  detailTaperPct?: number;
  isLoopClosed: boolean;
  connectorConfig: CatpinConnectorConfig;
  result: CatpinCutResult | null;
  explodeDistance: number;
  cutPoints: CutPoint3D2D[];
  polylineFlipSide: boolean;
  straightFlipTrigger: number;
  pinFlipTrigger: number;
  axisAlignRequest: { axis: CutAxisAlign; tick: number } | null;
  parts?: CatPinPart[];
  selectedPartId?: string;
  isDraftMode?: boolean;
  isPlateMode?: boolean;
  plateArrangement?: PlateArrangementResult | null;
  onUpdateCutPoints: React.Dispatch<React.SetStateAction<CutPoint3D2D[]>>;
  onCloseLoop: () => void;
  onInvertPin: () => void;
  onRegisterMeshesGetter: (getter: () => CatpinLiveMeshes) => void;
}

export const CatPinCanvas: React.FC<CatPinCanvasProps> = ({
  sourceGeometry, toolMode, detailDepthMm, detailTaperPct = 0, isLoopClosed, connectorConfig,
  result, explodeDistance, cutPoints, polylineFlipSide, straightFlipTrigger, pinFlipTrigger, axisAlignRequest,
  parts = [], selectedPartId = '', isDraftMode = true,
  isPlateMode = false, plateArrangement = null,
  onUpdateCutPoints, onCloseLoop, onInvertPin, onRegisterMeshesGetter,
}) => {
  const { mountRef, sceneRef, cameraRef, rendererRef, orbitControlsRef, transformControlsRef, renderScene } = useCatPinScene();
  const mainMeshRef = useRef<THREE.Mesh | null>(null);
  const cutterMeshRef = useRef<THREE.Mesh | null>(null);
  const pinMeshRef = useRef<THREE.Mesh | null>(null);
  const socketMeshRef = useRef<THREE.Mesh | null>(null);
  const modelBoxRef = useRef<THREE.Box3>(new THREE.Box3());
  const straightPoseRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const autoPoseRef = useRef<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>(null);
  const userModifiedPinTransformRef = useRef<boolean>(false);
  const savedPinPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const savedPinQuaternionRef = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const cutNormalRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));

  const [gizmoTarget, setGizmoTarget] = useState<GizmoTarget>('cutter');
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [hasManualPin, setHasManualPin] = useState<boolean>(false);
  const [syncTick, setSyncTick] = useState<number>(0);

  const { draggingIndex, cursorPos, setDraggingIndex, handleCanvasPointerDown, handleCanvasPointerMove, handleCanvasPointerUp, handleCanvasDoubleClick } =
    useCatPinPoints3D({
      sceneRef, cameraRef, rendererRef, orbitControlsRef, mainMeshRef, pinMeshRef, modelBoxRef,
      toolMode, isLoopClosed, hasResult: Boolean(result), cutPoints, onUpdateCutPoints, onCloseLoop,
      onSelectPinGizmo: () => setGizmoTarget('pin'),
      renderScene,
    });

  useEffect(() => {
    onRegisterMeshesGetter(() => ({
      cutterMesh: cutterMeshRef.current, pinMesh: pinMeshRef.current,
      socketMesh: socketMeshRef.current, mainMesh: mainMeshRef.current, hasManualPin,
    }));
  }, [onRegisterMeshesGetter, hasManualPin]);

  useEffect(() => {
    if (cutPoints.length === 0 && toolMode !== 'straight') {
      userModifiedPinTransformRef.current = false;
      setHasManualPin(false);
    }
  }, [toolMode, cutPoints.length]);

  useEffect(() => {
    if (toolMode !== 'seam' && gizmoTarget === 'pin') {
      setGizmoTarget('cutter');
    }
  }, [toolMode, gizmoTarget]);

  const handleResetPoses = useCallback(() => {
    straightPoseRef.current = null;
    autoPoseRef.current = null;
    userModifiedPinTransformRef.current = false;
    setHasManualPin(false);
  }, []);

  useCatPinModelMesh({
    sceneRef, cameraRef, orbitControlsRef, sourceGeometry, mainMeshRef, modelBoxRef,
    xrayMode: connectorConfig.xrayMode, hasResult: Boolean(result),
    onResetPoses: handleResetPoses,
    renderScene,
  });

  const { syncConnectorsWithCutter } = useCatPinConnectors({
    sceneRef, cutterMeshRef, mainMeshRef, pinMeshRef, socketMeshRef, autoPoseRef,
    userModifiedPinTransformRef, savedPinPositionRef, savedPinQuaternionRef, cutNormalRef,
    toolMode, connectorConfig, result, syncTick, setSyncTick, renderScene,
  });

  useCatPinCutterLifecycle({
    sceneRef, cameraRef, mainMeshRef, cutterMeshRef, modelBoxRef, straightPoseRef,
    autoPoseRef, toolMode, sourceGeometry, detailDepthMm, detailTaperPct, cutPoints, polylineFlipSide, result,
    syncConnectorsWithCutter, setSyncTick, renderScene,
  });

  const applyStraightOrientation = useCallback((axis: CutAxisAlign) => {
    const cutter = cutterMeshRef.current;
    if (!cutter || toolMode !== 'straight') return;
    cutter.position.copy(modelBoxRef.current.getCenter(new THREE.Vector3()));
    if (axis === 'x') cutter.rotation.set(0, Math.PI / 2, 0);
    else if (axis === 'y') cutter.rotation.set(-Math.PI / 2, 0, 0);
    else cutter.rotation.set(0, 0, 0);
    cutter.updateMatrixWorld(true);
    straightPoseRef.current = { pos: cutter.position.clone(), quat: cutter.quaternion.clone() };
    userModifiedPinTransformRef.current = false;
    setHasManualPin(false);
    autoPoseRef.current = null;
    syncConnectorsWithCutter();
    setSyncTick((t) => t + 1);
    renderScene();
  }, [toolMode, syncConnectorsWithCutter, renderScene]);

  useEffect(() => {
    if (axisAlignRequest) applyStraightOrientation(axisAlignRequest.axis);
  }, [axisAlignRequest, applyStraightOrientation]);

  useEffect(() => {
    if (straightFlipTrigger === 0) return;
    if (toolMode === 'straight' && cutterMeshRef.current) {
      cutterMeshRef.current.rotateY(Math.PI);
      cutterMeshRef.current.updateMatrixWorld(true);
      straightPoseRef.current = { pos: cutterMeshRef.current.position.clone(), quat: cutterMeshRef.current.quaternion.clone() };
    }
    if (pinMeshRef.current && socketMeshRef.current) {
      pinMeshRef.current.rotateX(Math.PI);
      pinMeshRef.current.updateMatrixWorld(true);
      socketMeshRef.current.quaternion.copy(pinMeshRef.current.quaternion);
      socketMeshRef.current.updateMatrixWorld(true);
      savedPinPositionRef.current.copy(pinMeshRef.current.position);
      savedPinQuaternionRef.current.copy(pinMeshRef.current.quaternion);
      cutNormalRef.current.set(0, 1, 0).applyQuaternion(pinMeshRef.current.quaternion).normalize();
    }
    renderScene();
  }, [straightFlipTrigger, toolMode, renderScene]);

  useEffect(() => {
    if (pinFlipTrigger === 0) return;
    if (pinMeshRef.current && socketMeshRef.current) {
      pinMeshRef.current.rotateX(Math.PI);
      pinMeshRef.current.updateMatrixWorld(true);
      socketMeshRef.current.quaternion.copy(pinMeshRef.current.quaternion);
      socketMeshRef.current.updateMatrixWorld(true);
      savedPinPositionRef.current.copy(pinMeshRef.current.position);
      savedPinQuaternionRef.current.copy(pinMeshRef.current.quaternion);
      cutNormalRef.current.set(0, 1, 0).applyQuaternion(pinMeshRef.current.quaternion).normalize();
      renderScene();
    }
  }, [pinFlipTrigger, renderScene]);

  useCatPinGizmoSync({
    transformControlsRef, orbitControlsRef, mainMeshRef, cutterMeshRef, pinMeshRef, socketMeshRef,
    straightPoseRef, autoPoseRef, userModifiedPinTransformRef, savedPinPositionRef, savedPinQuaternionRef, cutNormalRef,
    toolMode, gizmoTarget, gizmoMode, isDragging2DPoint: draggingIndex !== null, hasResult: Boolean(result),
    syncDependencyTick: syncTick, onChangeGizmoMode: setGizmoMode, onMarkManualPin: setHasManualPin,
    onTriggerSync: () => setSyncTick((t) => t + 1), renderScene,
  });

  useCatPinResultMesh({
    sceneRef, mainMeshRef, cutterMeshRef, pinMeshRef, cutNormalRef,
    result, explodeDistance, parts, selectedPartId, isDraftMode,
    isPlateMode, plateArrangement, renderScene,
  });

  const handleInvertPin = useCallback(() => {
    onInvertPin();
  }, [onInvertPin]);

  return (
    <div className="catpin-viewport-pane" onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp}>
      <div
        ref={mountRef}
        className={`catpin-canvas-mount ${toolMode !== 'straight' && !result && !isLoopClosed ? 'cursor-crosshair' : 'cursor-default'}`}
        onPointerDown={handleCanvasPointerDown}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      <CatPinOverlay2D
        isActive={!result && toolMode !== 'straight'}
        isLoopClosed={isLoopClosed}
        points={cutPoints} cursorPos={cursorPos} draggingIndex={draggingIndex}
        onStartDragPoint={(idx) => setDraggingIndex(idx)} onCloseLoop={onCloseLoop}
      />
      <CatPinViewportToolbar
        visible={!result} toolMode={toolMode} hasCutter={Boolean(cutterMeshRef.current)}
        hasPin={Boolean(pinMeshRef.current)} hasManualPinOffset={hasManualPin}
        gizmoTarget={gizmoTarget} gizmoMode={gizmoMode}
        onChangeTarget={setGizmoTarget} onChangeMode={setGizmoMode}
        onAlignAxis={applyStraightOrientation}
        onInvertPin={handleInvertPin}
        onRecenterPin={() => {
          userModifiedPinTransformRef.current = false;
          setHasManualPin(false);
          autoPoseRef.current = null;
          syncConnectorsWithCutter();
          setSyncTick((t) => t + 1);
          renderScene();
        }}
      />
    </div>
  );
};
