import React, { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Scissors, X } from 'lucide-react';
import { CatPinCanvas, type CatpinLiveMeshes } from './CatPinCanvas';
import { CatPinControls } from './CatPinControls';
import { CatPinResultPanel } from './CatPinResultPanel';
import { useCatPinMultiParts } from './useCatPinMultiParts';
import { useCatPinCutWorkflow } from './useCatPinCutWorkflow';
import { useCatPinShortcuts } from './useCatPinShortcuts';
import { useCatPinPlateArrangement } from './useCatPinPlateArrangement';
import { useCatPinModelLoader } from './useCatPinModelLoader';
import { resolveWorkingObjectFolder } from '../../utils/modelFolderResolver';

interface CatPinModalProps {
  isOpen: boolean;
  modelName: string;
  modelPath: string;
  objectFolderPath?: string;
  sourceObject3D?: THREE.Object3D | null;
  onClose: () => void;
  onSavedParts?: (folderPath: string) => void;
}

/**
 * Orquestrador principal do módulo CatPin (WASM Manifold3D + Cortes Sucessivos Multipartes).
 */
export const CatPinModal: React.FC<CatPinModalProps> = ({
  isOpen,
  modelName,
  modelPath,
  objectFolderPath,
  sourceObject3D,
  onClose,
  onSavedParts,
}) => {
  const [multiMeshWarning, setMultiMeshWarning] = useState<string | null>(null);

  const workingFolder = useMemo(() => {
    return resolveWorkingObjectFolder({
      folderPath: objectFolderPath,
      modelPath,
    });
  }, [objectFolderPath, modelPath]);

  const {
    parts, activePart, selectedPartId, isSaving, canUndo, canRedo,
    setSelectedPartId, initFromGeometry, applyCutResult, undo, redo,
    togglePartVisibility, saveAllParts, saveSelectedPart,
  } = useCatPinMultiParts(modelName, onSavedParts, workingFolder);

  const {
    plateArrangement, isPlateMode, isArranging, isExporting3mf,
    arrangeOnBed, togglePlateMode, saveMultiPart3mf, openInSlicer,
  } = useCatPinPlateArrangement();

  const meshesGetterRef = useRef<() => CatpinLiveMeshes>(() => ({
    cutterMesh: null, pinMesh: null, socketMesh: null, mainMesh: null, hasManualPin: false,
  }));

  const {
    toolMode, detailDepthMm, cutGapMm, isLoopClosed, connectorConfig,
    cutPoints, polylineFlipSide, straightFlipTrigger, pinFlipTrigger,
    axisAlignRequest, result, explodeDistance,
    isBuilding, errorMsg,
    setDetailDepthMm, setCutGapMm, setIsLoopClosed, setCutPoints,
    setResult, setExplodeDistance, setErrorMsg,
    handleChangeToolMode, handleClearPoints, handleFlipCutSide,
    handleAlignAxis, handleInvertPin, handleChangeConnector,
    handleExecuteCut, handleStartCutSelectedPart,
  } = useCatPinCutWorkflow({
    selectedPartId,
    activePart,
    applyCutResult,
    meshesGetterRef,
  });

  const { autonomousGeometry: _autonomousGeometry, multiMeshWarning: loaderWarning, activeGeometry } = useCatPinModelLoader({
    isOpen,
    modelPath,
    sourceObject3D: sourceObject3D ?? undefined,
    activePart,
    initFromGeometry,
    handleStartCutSelectedPart,
  });

  useEffect(() => {
    if (loaderWarning) setMultiMeshWarning(loaderWarning);
  }, [loaderWarning]);

  useEffect(() => {
    if (!activeGeometry || !window.electronAPI) return;
    const geom = activeGeometry as THREE.BufferGeometry;
    let cancel = false;
    const runDiag = async () => {
      try {
        const positions = (geom.attributes.position.array as Float32Array).slice();
        const indices = geom.index ? Uint32Array.from(geom.index.array as ArrayLike<number>) : null;
        const diag = await window.electronAPI!.diagnoseCatpinModel({ positions, indices });
        if (!cancel && diag.success && diag.status === 'invalid') {
          setMultiMeshWarning('Atenção: A malha possui arestas abertas (buracos). Pode requerer reparo antes do corte.');
        }
      } catch { /* silencioso */ }
    };
    runDiag();
    return () => { cancel = true; };
  }, [activeGeometry]);

  useCatPinShortcuts({
    isOpen,
    isBuilding,
    isSaving,
    result,
    cutPointsCount: cutPoints.length,
    canUndo,
    canRedo,
    partsCount: parts.length,
    onPopCutPoint: () => {
      setCutPoints((prev) => prev.slice(0, -1));
      setIsLoopClosed(false);
      setErrorMsg(null);
    },
    onUndoCut: undo,
    onRedoCut: redo,
    onClearPoints: handleClearPoints,
    onExitResult: () => setResult(null),
  });

  if (!isOpen || !activeGeometry) return null;

  return (
    <div className="catpin-backdrop" role="dialog" aria-modal="true" aria-label={`CatPin Corte e Conectores — ${modelName}`}>
      <div className="catpin-window">
        <div className="catpin-viewport-pane">
          <header className="catpin-header-bar">
            <div className="catpin-title-chip">
              <Scissors size={18} color="var(--color-primary)" aria-hidden="true" />
              <span>CatPin · Split & Connectors — {activePart?.name ?? modelName}</span>
            </div>
            {multiMeshWarning && <span className="catpin-warning-badge">{multiMeshWarning}</span>}
            <button type="button" className="btn" onClick={onClose} disabled={isBuilding || isSaving} aria-label="Fechar estação de corte CatPin">
              <X size={18} aria-hidden="true" />
              <span>Fechar</span>
            </button>
          </header>

          <CatPinCanvas
            sourceGeometry={activeGeometry}
            toolMode={toolMode}
            detailDepthMm={detailDepthMm}
            isLoopClosed={isLoopClosed}
            connectorConfig={connectorConfig}
            result={result}
            explodeDistance={explodeDistance}
            cutPoints={cutPoints}
            polylineFlipSide={polylineFlipSide}
            straightFlipTrigger={straightFlipTrigger}
            pinFlipTrigger={pinFlipTrigger}
            axisAlignRequest={axisAlignRequest}
            parts={parts}
            selectedPartId={selectedPartId}
            isDraftMode={!result}
            isPlateMode={isPlateMode}
            plateArrangement={plateArrangement}
            onUpdateCutPoints={(pts) => { setCutPoints(pts); setErrorMsg(null); }}
            onCloseLoop={() => { setIsLoopClosed(true); setErrorMsg(null); }}
            onInvertPin={handleInvertPin}
            onRegisterMeshesGetter={(getter) => { meshesGetterRef.current = getter; }}
          />
        </div>

        {result ? (
          <CatPinResultPanel
            result={result}
            explodeDistance={explodeDistance}
            isSaving={isSaving}
            parts={parts}
            selectedPartId={selectedPartId}
            canUndo={canUndo}
            canRedo={canRedo}
            workingFolder={workingFolder}
            isPlateMode={isPlateMode}
            isArranging={isArranging}
            isExporting3mf={isExporting3mf}
            plateArrangement={plateArrangement}
            onChangeExplode={setExplodeDistance}
            onSelectPart={setSelectedPartId}
            onToggleVisibility={togglePartVisibility}
            onUndo={() => {
              const shouldExit = parts.length <= 2;
              undo();
              if (shouldExit) setResult(null);
            }}
            onRedo={redo}
            onStartCutSelectedPart={handleStartCutSelectedPart}
            onSaveAllFiles={() => saveAllParts(result)}
            onSaveSelectedPart={saveSelectedPart}
            onArrangeOnBed={() => arrangeOnBed(parts)}
            onTogglePlateMode={togglePlateMode}
            onSaveMultiPart3mf={() => saveMultiPart3mf(modelName, parts, workingFolder, onSavedParts)}
            onOpenInSlicer={() => openInSlicer(modelName, parts)}
          />
        ) : (
          <CatPinControls
            toolMode={toolMode}
            detailDepthMm={detailDepthMm}
            cutGapMm={cutGapMm}
            isLoopClosed={isLoopClosed}
            connectorConfig={connectorConfig}
            isBuilding={isBuilding}
            errorMsg={errorMsg}
            pointsCount={cutPoints.length}
            parts={parts}
            selectedPartId={selectedPartId}
            canUndo={canUndo}
            canRedo={canRedo}
            onChangeToolMode={handleChangeToolMode}
            onChangeDetailDepth={setDetailDepthMm}
            onChangeCutGap={setCutGapMm}
            onChangeConnector={handleChangeConnector}
            onCloseLoop={() => { setIsLoopClosed(true); setErrorMsg(null); }}
            onClearPoints={handleClearPoints}
            onFlipCutSide={handleFlipCutSide}
            onInvertPin={handleInvertPin}
            onAlignAxis={handleAlignAxis}
            onExecuteCut={handleExecuteCut}
            onSelectPart={(id) => { setSelectedPartId(id); handleClearPoints(); }}
            onTogglePartVisibility={togglePartVisibility}
            onUndo={() => { undo(); handleClearPoints(); }}
            onRedo={() => { redo(); handleClearPoints(); }}
            onStartCutSelectedPart={handleStartCutSelectedPart}
          />
        )}
      </div>
    </div>
  );
};
