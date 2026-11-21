import { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { extractAllMeshParts, extractRootGeometry } from '../../utils/catpin/rootGeometryExtractor';
import { parseModelBufferToMesh, prepareObjectOnPlate } from '../../utils/threeHelpers';
import { toArrayBuffer, type InitialCatPinPartInput } from './useCatPinMultiParts';
import type { CatPinPart } from '../../types/catpinMultiParts';

interface UseCatPinModelLoaderParams {
  isOpen: boolean;
  modelPath?: string;
  sourceObject3D?: THREE.Object3D;
  activePart?: CatPinPart | null;
  initFromGeometry: (geom: THREE.BufferGeometry, rawBuf?: ArrayBuffer) => void;
  initFromParts?: (parts: InitialCatPinPartInput[]) => void;
  handleStartCutSelectedPart: () => void;
}

export function useCatPinModelLoader({
  isOpen,
  modelPath,
  sourceObject3D,
  activePart,
  initFromGeometry,
  initFromParts,
  handleStartCutSelectedPart,
}: UseCatPinModelLoaderParams) {
  const [autonomousGeometry, setAutonomousGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [multiMeshWarning, setMultiMeshWarning] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancel = false;
    setLoadError(null);

    const loadObjectIntoCatPin = (obj: THREE.Object3D, rawBuf?: ArrayBuffer) => {
      const allParts = extractAllMeshParts(obj);
      if (allParts.length > 1 && initFromParts) {
        let primary = allParts[0];
        for (const p of allParts) {
          if (p.triangles > primary.triangles) primary = p;
        }
        setMultiMeshWarning(`Projeto com ${allParts.length} peças independentes carregado — selecione qualquer peça na lista para cortar.`);
        setAutonomousGeometry(primary.geometry);
        initFromParts(allParts.map((p) => ({ name: p.name, geometry: p.geometry })));
        handleStartCutSelectedPart();
        return true;
      }

      const { geometry, warning } = extractRootGeometry(obj);
      if (!geometry) return false;
      setMultiMeshWarning(warning);
      setAutonomousGeometry(geometry);
      initFromGeometry(geometry, rawBuf);
      handleStartCutSelectedPart();
      return true;
    };

    const loadCleanModel = async () => {
      if (modelPath && window.electronAPI?.readModelBuffer) {
        try {
          const buf = await window.electronAPI.readModelBuffer(modelPath);
          if (cancel) return;
          const ext = modelPath.split('.').pop() || 'stl';
          const freshMesh = parseModelBufferToMesh(buf, ext);
          prepareObjectOnPlate(freshMesh);
          let rawBuf: ArrayBuffer | undefined;
          if (/\.stl$/i.test(modelPath) && buf.byteLength > 84) {
            rawBuf = toArrayBuffer(buf);
          }
          if (!cancel && loadObjectIntoCatPin(freshMesh, rawBuf)) return;
          if (!cancel) setLoadError('Nenhuma malha 3D válida encontrada no arquivo.');
        } catch (err) {
          if (!cancel && !sourceObject3D) {
            setLoadError((err as Error)?.message || 'Não foi possível carregar o modelo 3D no CatPin.');
          }
        }
      }

      if (sourceObject3D && !cancel) {
        loadObjectIntoCatPin(sourceObject3D);
      }
    };

    loadCleanModel();
    return () => {
      cancel = true;
    };
  }, [isOpen, modelPath, sourceObject3D, initFromGeometry, initFromParts, handleStartCutSelectedPart]);

  const activeGeometry = activePart?.geometry ?? autonomousGeometry;

  return {
    autonomousGeometry,
    multiMeshWarning,
    loadError,
    activeGeometry,
  };
}
