import { useEffect } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CatpinToolMode } from './CatPinControls';
import type { GizmoMode, GizmoTarget } from './CatPinViewportToolbar';

interface UseCatPinGizmoSyncParams {
  transformControlsRef: React.MutableRefObject<TransformControls | null>;
  orbitControlsRef: React.MutableRefObject<OrbitControls | null>;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  cutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  pinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  socketMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  straightPoseRef: React.MutableRefObject<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>;
  autoPoseRef?: React.MutableRefObject<{ position: THREE.Vector3; quaternion: THREE.Quaternion } | null>;
  userModifiedPinTransformRef: React.MutableRefObject<boolean>;
  savedPinPositionRef: React.MutableRefObject<THREE.Vector3>;
  savedPinQuaternionRef: React.MutableRefObject<THREE.Quaternion>;
  cutNormalRef: React.MutableRefObject<THREE.Vector3>;
  toolMode: CatpinToolMode;
  gizmoTarget: GizmoTarget;
  gizmoMode: GizmoMode;
  isDragging2DPoint: boolean;
  hasResult: boolean;
  syncDependencyTick: number;
  onChangeGizmoMode: (mode: GizmoMode) => void;
  onMarkManualPin: (isManual: boolean) => void;
  onTriggerSync?: () => void;
  renderScene: () => void;
}

/**
 * Sincroniza o TransformControls (Gizmo 3D) com o Cortador ou Pino e salva a pose manual do Pino.
 */
export function useCatPinGizmoSync({
  transformControlsRef,
  orbitControlsRef,
  mainMeshRef,
  cutterMeshRef,
  pinMeshRef,
  socketMeshRef,
  straightPoseRef,
  autoPoseRef,
  userModifiedPinTransformRef,
  savedPinPositionRef,
  savedPinQuaternionRef,
  cutNormalRef,
  toolMode,
  gizmoTarget,
  gizmoMode,
  isDragging2DPoint,
  hasResult,
  syncDependencyTick,
  onChangeGizmoMode,
  onMarkManualPin,
  onTriggerSync,
  renderScene,
}: UseCatPinGizmoSyncParams): void {
  useEffect(() => {
    const tControls = transformControlsRef.current;
    const orbit = orbitControlsRef.current;
    if (!tControls || !orbit) return;

    orbit.enabled = !isDragging2DPoint;

    if (hasResult) {
      tControls.detach();
      tControls.enabled = false;
      renderScene();
      return;
    }

    tControls.setMode(gizmoMode);
    let target: THREE.Object3D | null = null;
    if (gizmoTarget === 'pin' && pinMeshRef.current && toolMode === 'seam') {
      target = pinMeshRef.current;
    } else if (gizmoTarget === 'cutter' && toolMode === 'straight' && cutterMeshRef.current) {
      target = cutterMeshRef.current;
    }

    if (target) {
      tControls.enabled = true;
      tControls.attach(target);
    } else {
      tControls.detach();
      tControls.enabled = false;
    }
    renderScene();
  }, [
    gizmoTarget,
    gizmoMode,
    toolMode,
    isDragging2DPoint,
    hasResult,
    syncDependencyTick,
    transformControlsRef,
    orbitControlsRef,
    cutterMeshRef,
    pinMeshRef,
    renderScene,
  ]);

  useEffect(() => {
    const tControls = transformControlsRef.current;
    if (!tControls) return;

    const handleObjectChange = () => {
      const attachedObj = tControls.object;
      if (attachedObj === cutterMeshRef.current && cutterMeshRef.current && mainMeshRef.current) {
        if (toolMode === 'straight') {
          straightPoseRef.current = {
            pos: cutterMeshRef.current.position.clone(),
            quat: cutterMeshRef.current.quaternion.clone(),
          };
          const planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(cutterMeshRef.current.quaternion).normalize();
          cutNormalRef.current.copy(planeNormal);
          if (!userModifiedPinTransformRef.current && pinMeshRef.current && socketMeshRef.current) {
            pinMeshRef.current.position.copy(cutterMeshRef.current.position);
            pinMeshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), planeNormal);
            socketMeshRef.current.position.copy(cutterMeshRef.current.position);
            socketMeshRef.current.quaternion.copy(pinMeshRef.current.quaternion);
          }
        }
      } else if (attachedObj === pinMeshRef.current && pinMeshRef.current && socketMeshRef.current) {
        userModifiedPinTransformRef.current = true;
        savedPinPositionRef.current.copy(pinMeshRef.current.position);
        savedPinQuaternionRef.current.copy(pinMeshRef.current.quaternion);
        onMarkManualPin(true);
        socketMeshRef.current.position.copy(pinMeshRef.current.position);
        socketMeshRef.current.quaternion.copy(pinMeshRef.current.quaternion);
        cutNormalRef.current.set(0, 1, 0).applyQuaternion(pinMeshRef.current.quaternion).normalize();
      }
      renderScene();
    };

    const handleDraggingChanged = (ev: { value: boolean }) => {
      const orbit = orbitControlsRef.current;
      if (orbit) orbit.enabled = !ev.value && !isDragging2DPoint;
      if (!ev.value && tControls.object === cutterMeshRef.current) {
        if (!userModifiedPinTransformRef.current && autoPoseRef) {
          autoPoseRef.current = null;
        }
        if (onTriggerSync) onTriggerSync();
      }
    };

    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key.toLowerCase() === 'w') onChangeGizmoMode('translate');
      if (ev.key.toLowerCase() === 'e') onChangeGizmoMode('rotate');
    };

    tControls.addEventListener('objectChange', handleObjectChange);
    tControls.addEventListener('dragging-changed', handleDraggingChanged as (e: unknown) => void);
    window.addEventListener('keydown', handleKey);
    return () => {
      tControls.removeEventListener('objectChange', handleObjectChange);
      tControls.removeEventListener('dragging-changed', handleDraggingChanged as (e: unknown) => void);
      window.removeEventListener('keydown', handleKey);
    };
  }, [
    toolMode,
    transformControlsRef,
    orbitControlsRef,
    mainMeshRef,
    cutterMeshRef,
    pinMeshRef,
    socketMeshRef,
    straightPoseRef,
    autoPoseRef,
    userModifiedPinTransformRef,
    savedPinPositionRef,
    savedPinQuaternionRef,
    cutNormalRef,
    isDragging2DPoint,
    onChangeGizmoMode,
    onMarkManualPin,
    onTriggerSync,
    renderScene,
  ]);
}
