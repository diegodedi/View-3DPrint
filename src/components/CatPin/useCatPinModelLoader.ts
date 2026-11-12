import { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { extractRootGeometry } from '../../utils/catpin/rootGeometryExtractor';
import { parseModelBufferToMesh, prepareObjectOnPlate } from '../../utils/threeHelpers';
import { toArrayBuffer } from './useCatPinMultiParts';
import type { CatPinPart } from '../../types/catpinMultiParts';

interface UseCatPinModelLoaderParams {
  isOpen: boolean;
  modelPath?: string;
  sourceObject3D?: THREE.Object3D;
  activePart?: CatPinPart | null;
  initFromGeometry: (geom: THREE.BufferGeometry, rawBuf?: ArrayBuffer) => void;
  handleStartCutSelectedPart: () => void;
}

export function useCatPinModelLoader({
  isOpen,
  modelPath,
  sourceObject3D,
  activePart,
  initFromGeometry,
  handleStartCutSelectedPart,
}: UseCatPinModelLoaderParams) {
  const [autonomousGeometry, setAutonomousGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [multiMeshWarning, setMultiMeshWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;

    const loadCleanModel = async () => {
      if (modelPath && window.electronAPI?.readModelBuffer) {
        try {
          const buf = await window.electronAPI.readModelBuffer(modelPath);
          if (cancel) return;
          const ext = modelPath.split('.').pop() || 'stl';
          const freshMesh = parseModelBufferToMesh(buf, ext);
          prepareObjectOnPlate(freshMesh);
          const { geometry, warning } = extractRootGeometry(freshMesh);
          let rawBuf: ArrayBuffer | undefined;
          if (/\.stl$/i.test(modelPath) && buf.byteLength > 84) {
            rawBuf = toArrayBuffer(buf);
          }
          if (!cancel && geometry) {
            setMultiMeshWarning(warning);
            setAutonomousGeometry(geometry);
            initFromGeometry(geometry, rawBuf);
            handleStartCutSelectedPart();
            return;
          }
        } catch {
          // Fallback gracioso
        }
      }

      if (sourceObject3D && !cancel) {
        const { geometry, warning } = extractRootGeometry(sourceObject3D);
        setMultiMeshWarning(warning);
        setAutonomousGeometry(geometry);
        if (geometry) {
          initFromGeometry(geometry);
          handleStartCutSelectedPart();
        }
      }
    };

    loadCleanModel();
    return () => {
      cancel = true;
    };
  }, [isOpen, modelPath, sourceObject3D, initFromGeometry, handleStartCutSelectedPart]);

  const activeGeometry = activePart?.geometry ?? autonomousGeometry;

  return {
    autonomousGeometry,
    multiMeshWarning,
    activeGeometry,
  };
}
