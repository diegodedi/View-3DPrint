import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoundingBoxDimensions } from '../types/models';
import { disposeObjectGeometries } from '../utils/threeHelpers';
import { createGrayMatcapMaterial } from '../utils/matcapUtils';
import {
  createStudioResinMaterial,
  type ResinPresetKey,
} from '../utils/studioResinMaterial';

export type ShadingMode = ResinPresetKey | 'matcap';

/**
 * Hook modular que encapsula a infraestrutura WebGL (Scene, Camera, Renderer, Controls)
 * do visualizador 3D principal, isolando o Three.js do ciclo de vida da interface React.
 */
export function useViewer3DScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);

  const renderSceneOnce = useCallback(() => {
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121212);
    sceneRef.current = scene;

    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 5000);
    camera.position.set(110, 95, 110);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.addEventListener('change', renderSceneOnce);
    controlsRef.current = controls;

    const grid = new THREE.GridHelper(220, 22, 0x333333, 0x222222);
    scene.add(grid);

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    renderSceneOnce();

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = Math.max(mountRef.current.clientHeight, 1);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      renderSceneOnce();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      controls.removeEventListener('change', renderSceneOnce);
      controls.dispose();
      window.removeEventListener('resize', handleResize);
      if (meshGroupRef.current) {
        disposeObjectGeometries(meshGroupRef.current);
      }
      renderer.dispose();
    };
  }, [renderSceneOnce]);

  const applyMaterialToMesh = useCallback(
    (mode: ShadingMode, wire: boolean) => {
      if (!meshGroupRef.current) return;
      const wireMat = new THREE.MeshBasicMaterial({ color: 0xb0b0b8, wireframe: true });
      const targetMat =
        mode === 'matcap' ? createGrayMatcapMaterial() : createStudioResinMaterial(mode);
      meshGroupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = wire ? wireMat : targetMat;
        }
      });
      renderSceneOnce();
    },
    [renderSceneOnce]
  );

  const resetCamera = useCallback(
    (dimensions: BoundingBoxDimensions | null) => {
      if (!cameraRef.current || !controlsRef.current || !dimensions) return;
      const maxDim = Math.max(dimensions.widthMm, dimensions.depthMm, dimensions.heightMm, 30);
      cameraRef.current.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
      controlsRef.current.target.set(0, dimensions.heightMm * 0.45, 0);
      controlsRef.current.update();
      renderSceneOnce();
    },
    [renderSceneOnce]
  );

  const captureSnapshot = useCallback((): string | null => {
    if (!rendererRef.current) return null;
    renderSceneOnce();
    return rendererRef.current.domElement.toDataURL('image/jpeg', 0.9);
  }, [renderSceneOnce]);

  return {
    mountRef,
    rendererRef,
    sceneRef,
    cameraRef,
    controlsRef,
    meshGroupRef,
    renderSceneOnce,
    applyMaterialToMesh,
    resetCamera,
    captureSnapshot,
  };
}

