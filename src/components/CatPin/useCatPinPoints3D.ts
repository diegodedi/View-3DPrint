import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';
import type { CatpinToolMode } from './CatPinControls';
import { useCatPinPointReprojection } from './useCatPinPointReprojection';

interface UseCatPinPoints3DParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  orbitControlsRef: React.MutableRefObject<OrbitControls | null>;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  pinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  modelBoxRef: React.MutableRefObject<THREE.Box3>;
  toolMode: CatpinToolMode;
  isLoopClosed: boolean;
  hasResult: boolean;
  cutPoints: CutPoint3D2D[];
  onUpdateCutPoints: React.Dispatch<React.SetStateAction<CutPoint3D2D[]>>;
  onCloseLoop: () => void;
  onSelectPinGizmo: () => void;
  renderScene: () => void;
}

/**
 * Gerencia os pontos 3D colados na superfície, fechamento com Duplo Clique / Enter / 1º Ponto e arraste 2D/3D.
 */
export function useCatPinPoints3D({
  cameraRef,
  rendererRef,
  orbitControlsRef,
  mainMeshRef,
  pinMeshRef,
  modelBoxRef,
  toolMode,
  isLoopClosed,
  hasResult,
  cutPoints,
  onUpdateCutPoints,
  onCloseLoop,
  onSelectPinGizmo,
  renderScene,
}: UseCatPinPoints3DParams) {
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const raycastCanvasPointTo3D = useCallback(
    (canvasX: number, canvasY: number, refWorldPoint?: THREE.Vector3): { point: THREE.Vector3; normal?: THREE.Vector3 } | null => {
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const mainMesh = mainMeshRef.current;
      if (!camera || !renderer) return null;

      const rect = renderer.domElement.getBoundingClientRect();
      const ndcX = (canvasX / Math.max(rect.width, 1)) * 2 - 1;
      const ndcY = -(canvasY / Math.max(rect.height, 1)) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      if (mainMesh) {
        const hits = raycaster.intersectObject(mainMesh, false);
        if (hits.length > 0) {
          const point = hits[0].point.clone();
          const normal = hits[0].face
            ? hits[0].face.normal.clone().transformDirection(mainMesh.matrixWorld).normalize()
            : undefined;
          return { point, normal };
        }
      }

      if (cutPoints.length === 0 && !refWorldPoint) {
        return null;
      }

      // No modo corte de membro (seam), pontos precisam ancorar estritamente na superfície do modelo (inclusive ao arrastar)
      if (toolMode === 'seam') {
        return null;
      }

      const lastPt = cutPoints.length > 0 ? cutPoints[cutPoints.length - 1].worldPos : null;
      const planeAnchor = refWorldPoint || lastPt || modelBoxRef.current.getCenter(new THREE.Vector3());
      const camDir = camera.getWorldDirection(new THREE.Vector3());
      const fallbackPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, planeAnchor);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(fallbackPlane, hit) ? { point: hit } : null;
    },
    [cameraRef, rendererRef, mainMeshRef, modelBoxRef, cutPoints, toolMode]
  );

  // Atualiza a cena quando os vértices da polyline mudam (sem esferas 3D grandes; os vértices são renderizados no CatPinOverlay2D)
  useEffect(() => {
    renderScene();
  }, [cutPoints, toolMode, hasResult, renderScene]);

  // Atalho de teclado Enter ou Espaço para fechar o loop e limpar imediatamente a linha elástica
  useEffect(() => {
    if (isLoopClosed) {
      setCursorPos(null);
    }
  }, [isLoopClosed]);

  useEffect(() => {
    const minPts = 3;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasResult || toolMode === 'straight' || isLoopClosed) return;
      if ((e.key === 'Enter' || e.key === ' ') && cutPoints.length >= minPts) {
        e.preventDefault();
        setCursorPos(null);
        onCloseLoop();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasResult, toolMode, isLoopClosed, cutPoints.length, onCloseLoop]);

  // Reprojeta pontos 3D de volta para 2D (vector3.project(camera)) ao girar/mover a câmera
  useCatPinPointReprojection(orbitControlsRef, cameraRef, rendererRef, onUpdateCutPoints);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !rendererRef.current) return;
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    pointerDownRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rendererRef.current) return;
    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (toolMode !== 'straight' && !hasResult && !isLoopClosed) {
      setCursorPos({ x, y });
    }

    if (draggingIndex !== null) {
      onUpdateCutPoints((prev) => {
        const current = prev[draggingIndex];
        if (!current) return prev;
        const hit = raycastCanvasPointTo3D(x, y, current.worldPos);
        if (!hit) return prev;
        const next = [...prev];
        next[draggingIndex] = {
          worldPos: hit.point,
          x,
          y,
          surfaceNormal: hit.normal ?? current.surfaceNormal,
          isOccluded: false,
        };
        return next;
      });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIndex !== null) {
      setDraggingIndex(null);
      return;
    }
    if (hasResult || e.button !== 0 || !pointerDownRef.current || !rendererRef.current || !cameraRef.current) {
      return;
    }

    const rect = rendererRef.current.domElement.getBoundingClientRect();
    const upX = e.clientX - rect.left;
    const upY = e.clientY - rect.top;

    if (Math.hypot(upX - pointerDownRef.current.x, upY - pointerDownRef.current.y) >= 5) {
      return;
    }

    if ((isLoopClosed || toolMode === 'straight') && pinMeshRef.current && pinMeshRef.current.visible) {
      const ndcX = (upX / Math.max(rect.width, 1)) * 2 - 1;
      const ndcY = -(upY / Math.max(rect.height, 1)) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cameraRef.current);
      if (raycaster.intersectObject(pinMeshRef.current, false).length > 0) {
        onSelectPinGizmo();
        return;
      }
    }

    if (toolMode === 'straight' || isLoopClosed) return;

    // Se clicar a menos de 12px do 1º ponto visível (não ocluído do outro lado da peça), fecha o loop
    if (
      cutPoints.length >= 3 &&
      !cutPoints[0].isOccluded &&
      Math.hypot(upX - cutPoints[0].x, upY - cutPoints[0].y) < 12
    ) {
      onCloseLoop();
      return;
    }

    const hit = raycastCanvasPointTo3D(upX, upY);
    if (hit) {
      onUpdateCutPoints((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].worldPos.distanceToSquared(hit.point) < 1e-6) {
          return prev;
        }
        return [
          ...prev,
          { worldPos: hit.point, x: upX, y: upY, surfaceNormal: hit.normal, isOccluded: false },
        ];
      });
    }
  };

  const handleCanvasDoubleClick = () => {
    if (hasResult || toolMode === 'straight' || isLoopClosed) return;
    const minPts = 3;
    setCursorPos(null);
    onUpdateCutPoints((prev) => {
      if (prev.length > minPts) {
        const last = prev[prev.length - 1];
        const prevPt = prev[prev.length - 2];
        if (Math.hypot(last.x - prevPt.x, last.y - prevPt.y) < 12) {
          return prev.slice(0, -1);
        }
      }
      return prev;
    });
    if (cutPoints.length >= minPts) {
      onCloseLoop();
    }
  };

  return {
    draggingIndex,
    cursorPos,
    setDraggingIndex,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleCanvasDoubleClick,
  };
}
