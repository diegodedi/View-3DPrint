import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export interface CatPinSceneRefs {
  mountRef: React.RefObject<HTMLDivElement>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  orbitControlsRef: React.MutableRefObject<OrbitControls | null>;
  transformControlsRef: React.MutableRefObject<TransformControls | null>;
  renderScene: () => void;
}

/**
 * Inicializa a Viewport WebGL do CatPin com OrbitControls, TransformControls e iluminação de estúdio.
 */
export function useCatPinScene(): CatPinSceneRefs {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);

  const renderScene = useCallback(() => {
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

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 6000);
    camera.position.set(130, 105, 130);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = false;
    orbit.addEventListener('change', renderScene);
    orbitControlsRef.current = orbit;

    const tControls = new TransformControls(camera, renderer.domElement);
    tControls.size = 0.85;
    tControls.enabled = false;
    tControls.addEventListener('change', renderScene);
    tControls.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
    });
    scene.add(tControls.getHelper());
    transformControlsRef.current = tControls;

    const grid = new THREE.GridHelper(280, 28, 0x303030, 0x1f1f1f);
    scene.add(grid);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.75);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
    keyLight.position.set(160, 220, 140);
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.45);
    fillLight.position.set(-150, -90, -140);
    scene.add(ambLight, keyLight, fillLight);

    renderScene();

    const syncViewportSize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = Math.max(mountRef.current.clientWidth, 1);
      const h = Math.max(mountRef.current.clientHeight, 1);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      renderScene();
    };

    const resizeObserver = new ResizeObserver(syncViewportSize);
    resizeObserver.observe(container);
    window.addEventListener('resize', syncViewportSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncViewportSize);
      orbit.dispose();
      tControls.dispose();
      renderer.dispose();
    };
  }, [renderScene]);

  return {
    mountRef,
    sceneRef,
    cameraRef,
    rendererRef,
    orbitControlsRef,
    transformControlsRef,
    renderScene,
  };
}

