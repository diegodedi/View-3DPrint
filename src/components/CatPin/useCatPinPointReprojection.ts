import { useEffect } from 'react';
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';

/**
 * Reprojeta os pontos 3D da seleção para coordenadas 2D do Canvas ao girar ou redimensionar a câmera.
 */
export function useCatPinPointReprojection(
  orbitControlsRef: React.MutableRefObject<OrbitControls | null>,
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
  onUpdateCutPoints: React.Dispatch<React.SetStateAction<CutPoint3D2D[]>>
) {
  useEffect(() => {
    const orbit = orbitControlsRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!orbit || !camera || !renderer) return;

    let rafId = 0;
    const camPos = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const reprojectAllPoints = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!cameraRef.current || !rendererRef.current) return;
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const w = Math.max(rect.width, 1);
        const h = Math.max(rect.height, 1);
        cameraRef.current.updateMatrixWorld();
        cameraRef.current.getWorldPosition(camPos);

        onUpdateCutPoints((prev) => {
          if (prev.length === 0) return prev;
          let changed = false;
          const next = prev.map((pt) => {
            const p = pt.worldPos.clone().project(cameraRef.current!);
            const nx = (p.x * 0.5 + 0.5) * w;
            const ny = (-p.y * 0.5 + 0.5) * h;
            let isOccluded = p.z > 1;
            if (!isOccluded && pt.surfaceNormal) {
              toCam.subVectors(camPos, pt.worldPos).normalize();
              isOccluded = pt.surfaceNormal.dot(toCam) < -0.05;
            }
            if (Math.abs(nx - pt.x) > 0.5 || Math.abs(ny - pt.y) > 0.5 || Boolean(pt.isOccluded) !== isOccluded) {
              changed = true;
              return { worldPos: pt.worldPos, x: nx, y: ny, surfaceNormal: pt.surfaceNormal, isOccluded };
            }
            return pt;
          });
          return changed ? next : prev;
        });
      });
    };

    orbit.addEventListener('change', reprojectAllPoints);
    window.addEventListener('resize', reprojectAllPoints);
    return () => {
      cancelAnimationFrame(rafId);
      orbit.removeEventListener('change', reprojectAllPoints);
      window.removeEventListener('resize', reprojectAllPoints);
    };
  }, [orbitControlsRef, cameraRef, rendererRef, onUpdateCutPoints]);
}

