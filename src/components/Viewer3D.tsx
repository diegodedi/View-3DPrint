import React, { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { Camera, RotateCcw, Grid, Scissors, Palette } from 'lucide-react';
import type { BoundingBoxDimensions, ModelFileEntry } from '../types/models';
import {
  disposeObjectGeometries,
  parseModelBufferToMesh,
  prepareObjectOnPlate,
} from '../utils/threeHelpers';
import { formatMillimeters } from '../utils/formatters';
import { useViewer3DScene, type ShadingMode } from './useViewer3DScene';

const SHADING_OPTIONS: { key: ShadingMode; label: string }[] = [
  { key: 'jade', label: 'Verde Jade (Cavity)' },
  { key: 'knight', label: 'Azul Armadura' },
  { key: 'clay', label: 'Cinza Studio' },
  { key: 'wax', label: 'Terracota' },
  { key: 'matcap', label: 'MatCap Clássico' },
];

interface Viewer3DProps {
  modelFile: ModelFileEntry | null;
  onCaptureThumbnail: (dataUrl: string) => void;
  onMeshLoaded?: (object3d: THREE.Object3D, dims: BoundingBoxDimensions) => void;
  onMeshLoadingChange?: (isLoading: boolean) => void;
  onOpenCatpinCut?: () => void;
}

/**
 * Visualizador 3D Interativo: Camada de Interface React desacoplada do Motor WebGL.
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
  const [shadingMode, setShadingMode] = useState<ShadingMode>('jade');
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

        const object3d = parseModelBufferToMesh(buffer, modelFile.extension);
        const dims = prepareObjectOnPlate(object3d);
        meshGroupRef.current.add(object3d);
        setDimensions(dims);
        setIsWireframe(false);
        onMeshLoaded?.(object3d, dims);

        resetEngineCamera(dims);
        applyMaterialToMesh(shadingMode, false);
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
  }, [modelFile, onMeshLoaded, onMeshLoadingChange, resetEngineCamera, applyMaterialToMesh, shadingMode, meshGroupRef]);

  const toggleWireframe = () => {
    const next = !isWireframe;
    setIsWireframe(next);
    applyMaterialToMesh(shadingMode, next);
  };

  const cycleShading = () => {
    if (isWireframe) setIsWireframe(false);
    const currIdx = SHADING_OPTIONS.findIndex((o) => o.key === shadingMode);
    const nextIdx = (currIdx + 1) % SHADING_OPTIONS.length;
    const nextMode = SHADING_OPTIONS[nextIdx].key;
    setShadingMode(nextMode);
    applyMaterialToMesh(nextMode, false);
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

          <button
            type="button"
            className="btn"
            onClick={cycleShading}
            title="Alternar estilo de material e cor (Cavity + Specular + Roughness)"
          >
            <Palette size={16} aria-hidden="true" />
            <span>{SHADING_OPTIONS.find((o) => o.key === shadingMode)?.label || 'Shader'}</span>
          </button>

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
