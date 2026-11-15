import React, { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { Camera, RotateCcw, Grid, Scissors } from 'lucide-react';
import type { BoundingBoxDimensions, ModelFileEntry } from '../types/models';
import {
  disposeObjectGeometries,
  prepareObjectOnPlate,
} from '../utils/threeHelpers';
import { parseModelBufferAsync } from '../utils/meshWorkerClient';
import { formatMillimeters } from '../utils/formatters';
import { useViewer3DScene } from './useViewer3DScene';
import { ViewportShadingControl } from './ViewportShadingControl';

interface Viewer3DProps {
  modelFile: ModelFileEntry | null;
  onCaptureThumbnail: (dataUrl: string) => void;
  onMeshLoaded?: (object3d: THREE.Object3D, dims: BoundingBoxDimensions) => void;
  onMeshLoadingChange?: (isLoading: boolean) => void;
  onOpenCatpinCut?: () => void;
}

/**
 * Visualizador 3D Interativo: respeita o MatCap + Cavity + Roughness + Specular global definido na entrada do App.
 */
export const Viewer3D: React.FC<Viewer3DProps> = ({
  modelFile,
  onCaptureThumbnail,
  onMeshLoaded,
  onMeshLoadingChange,
  onOpenCatpinCut,
}) => {
  const {
    mountRef,
    meshGroupRef,
    applyMaterialToMesh,
    resetCamera: resetEngineCamera,
    captureSnapshot,
  } = useViewer3DScene();

  const [dimensions, setDimensions] = useState<BoundingBoxDimensions | null>(null);
  const [isWireframe, setIsWireframe] = useState<boolean>(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [isLoadingMesh, setIsLoadingMesh] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    async function load3DFile() {
      if (!modelFile || !window.electronAPI || !meshGroupRef.current) {
        setDimensions(null);
        return;
      }
      try {
        setIsLoadingMesh(true);
        onMeshLoadingChange?.(true);
        setViewerError(null);
        disposeObjectGeometries(meshGroupRef.current);
        meshGroupRef.current.clear();

        const buffer = await window.electronAPI.readModelBuffer(modelFile.path);
        if (!active) return;

        const object3d = await parseModelBufferAsync(buffer, modelFile.extension);
        if (!active) {
          disposeObjectGeometries(object3d);
          return;
        }
        const dims = prepareObjectOnPlate(object3d);
        meshGroupRef.current.add(object3d);
        setDimensions(dims);
        setIsWireframe(false);
        onMeshLoaded?.(object3d, dims);

        resetEngineCamera(dims);
        applyMaterialToMesh(false);
      } catch (err) {
        if (active) setViewerError((err as Error).message || 'Erro ao renderizar malha 3D.');
      } finally {
        if (active) {
          setIsLoadingMesh(false);
          onMeshLoadingChange?.(false);
        }
      }
    }
    load3DFile();
    return () => {
      active = false;
    };
  }, [modelFile, onMeshLoaded, onMeshLoadingChange, resetEngineCamera, applyMaterialToMesh, meshGroupRef]);

  const toggleWireframe = () => {
    const next = !isWireframe;
    setIsWireframe(next);
    applyMaterialToMesh(next);
  };

  const handleResetCamera = () => {
    resetEngineCamera(dimensions);
  };

  const handleSnapshot = () => {
    const dataUrl = captureSnapshot();
    if (dataUrl) {
      onCaptureThumbnail(dataUrl);
    }
  };

  return (
    <section className="viewer-container" aria-label="Visualizador 3D MatCap interativo">
      <div ref={mountRef} className="viewer-viewport" />

      <div className="viewer-overlay-bar">
        <div className="metrics-badge">
          {isLoadingMesh && 'Carregando malha 3D...'}
          {viewerError && <span className="viewer-error-text">{viewerError}</span>}
          {!isLoadingMesh && !viewerError && dimensions && (
            <span>
              Dimensões: <strong>{formatMillimeters(dimensions.widthMm)}</strong> (X) ×{' '}
              <strong>{formatMillimeters(dimensions.depthMm)}</strong> (Y) ×{' '}
              <strong>{formatMillimeters(dimensions.heightMm)}</strong> (Z) ·{' '}
              {dimensions.triangles.toLocaleString('pt-BR')} triângulos
            </span>
          )}
        </div>

        <div className="viewer-actions-row">
          {onOpenCatpinCut && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onOpenCatpinCut}
              title="Cortar e separar peças com conectores para impressão 3D (CatPin)"
            >
              <Scissors size={16} aria-hidden="true" />
              <span>Cortar / Separar</span>
            </button>
          )}

          <ViewportShadingControl />

          <button type="button" className="btn" onClick={toggleWireframe} title="Alternar Malha (Wireframe)">
            <Grid size={16} aria-hidden="true" />
            <span>{isWireframe ? 'Sólido' : 'Wireframe'}</span>
          </button>

          <button type="button" className="btn" onClick={handleResetCamera} title="Centralizar Câmera">
            <RotateCcw size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleSnapshot}
            title="Salvar visão atual como foto de capa do objeto"
          >
            <Camera size={16} aria-hidden="true" />
            <span>Atualizar Capa</span>
          </button>
        </div>
      </div>
    </section>
  );
};
