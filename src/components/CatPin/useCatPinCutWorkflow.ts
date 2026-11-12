import { useCallback, useState } from 'react';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { CatpinCutResult } from '../../types/models';
import type { CatpinConnectorConfig } from '../../utils/catpin/connectorMeshBuilder';
import type { CutPoint3D2D } from '../../utils/catpin/cutterMeshBuilder';
import { buildCutSpecModel, buildConnectorSpecModel } from '../../utils/catpin/cutSpecBuilder';
import type { CatpinToolMode } from './CatPinControls';
import type { CutAxisAlign } from './CatPinViewportToolbar';
import type { CatpinLiveMeshes } from './CatPinCanvas';
import { decodeBinaryStlToPositions } from './useCatPinMultiParts';

interface UseCatPinCutWorkflowParams {
  selectedPartId: string;
  activePart?: CatPinPart | null;
  applyCutResult: (targetPartId: string, cutResult: CatpinCutResult) => void;
  meshesGetterRef: React.MutableRefObject<() => CatpinLiveMeshes>;
}

/**
 * Hook que encapsula os parâmetros de corte, conectores, modos de ferramenta e execução CSG.
 */
export function useCatPinCutWorkflow({
  selectedPartId,
  activePart,
  applyCutResult,
  meshesGetterRef,
}: UseCatPinCutWorkflowParams) {
  const [toolMode, setToolMode] = useState<CatpinToolMode>('seam');
  const [detailDepthMm, setDetailDepthMm] = useState<number>(3.0);
  const [cutGapMm, setCutGapMm] = useState<number>(0.2);
  const [isLoopClosed, setIsLoopClosed] = useState<boolean>(false);
  const [connectorConfig, setConnectorConfig] = useState<CatpinConnectorConfig>({
    type: 'cylinder',
    diameterMm: 6.0,
    depthMm: 7.0,
    clearanceMm: 0.25,
    xrayMode: true,
    pinSide: 'partA',
  });

  const [cutPoints, setCutPoints] = useState<CutPoint3D2D[]>([]);
  const [isPolylineFlipped, setIsPolylineFlipped] = useState<boolean>(false);
  const [straightFlipTrigger, setStraightFlipTrigger] = useState<number>(0);
  const [pinFlipTrigger, setPinFlipTrigger] = useState<number>(0);
  const [axisAlignRequest, setAxisAlignRequest] = useState<{ axis: CutAxisAlign; tick: number } | null>(null);

  const [result, setResult] = useState<CatpinCutResult | null>(null);
  const [explodeDistance, setExplodeDistance] = useState<number>(0);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleChangeToolMode = useCallback((nextMode: CatpinToolMode) => {
    setToolMode(nextMode);
    setErrorMsg(null);
    setIsLoopClosed(false);
    setIsPolylineFlipped(false);
    setCutPoints([]);
  }, []);

  const handleClearPoints = useCallback(() => {
    setCutPoints([]);
    setIsLoopClosed(false);
    setErrorMsg(null);
  }, []);

  const handleFlipCutSide = useCallback(() => {
    setStraightFlipTrigger((n) => n + 1);
    if (toolMode !== 'straight') setIsPolylineFlipped((prev) => !prev);
  }, [toolMode]);

  const handleAlignAxis = useCallback((axis: CutAxisAlign) => {
    setAxisAlignRequest((prev) => ({ axis, tick: (prev?.tick ?? 0) + 1 }));
  }, []);

  const handleInvertPin = useCallback(() => {
    setConnectorConfig((prev) => ({ ...prev, pinSide: prev.pinSide === 'partB' ? 'partA' : 'partB' }));
    setPinFlipTrigger((n) => n + 1);
  }, []);

  const handleChangeConnector = useCallback((patch: Partial<CatpinConnectorConfig>) => {
    setConnectorConfig((prev) => {
      if (patch.pinSide && patch.pinSide !== prev.pinSide) setPinFlipTrigger((n) => n + 1);
      return { ...prev, ...patch };
    });
  }, []);

  const handleExecuteCut = useCallback(async () => {
    if (!window.electronAPI) {
      setErrorMsg('Ambiente desktop Electron não detectado. O corte CSG requer execução no aplicativo.');
      return;
    }
    const { cutterMesh, pinMesh, mainMesh } = meshesGetterRef.current();
    if (!cutterMesh || !mainMesh) {
      setErrorMsg('Defina o contorno de corte na Viewport 3D antes de executar.');
      return;
    }

    try {
      setIsBuilding(true);
      setErrorMsg(null);
      setIsLoopClosed(true);

      const effectiveCutGap = toolMode === 'seam' ? cutGapMm : 0;
      const cutSpec = buildCutSpecModel(cutterMesh, mainMesh, effectiveCutGap);
      const connector = toolMode === 'seam' && connectorConfig.type !== 'none' && pinMesh
        ? buildConnectorSpecModel(pinMesh, mainMesh, connectorConfig, true)
        : null;

      let positions: Float32Array;
      let indices: Uint32Array | null = null;

      const directPositions = activePart?.stlBuffer && activePart.stlBuffer.byteLength > 84
        ? decodeBinaryStlToPositions(activePart.stlBuffer)
        : null;

      if (directPositions && directPositions.length >= 9) {
        positions = directPositions;
        indices = null;
      } else {
        const geom = mainMesh.geometry;
        positions = (geom.attributes.position.array as Float32Array).slice();
        indices = geom.index ? Uint32Array.from(geom.index.array as ArrayLike<number>) : null;
      }

      const cutRes = await window.electronAPI.executeCatpinCut({
        positions,
        indices,
        cut: cutSpec,
        cutGapMm: effectiveCutGap,
        connector,
      });

      if (!cutRes.success) throw new Error(cutRes.error || 'Falha no corte.');
      applyCutResult(selectedPartId, cutRes);
      setResult(cutRes);
      setExplodeDistance(0);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Erro ao executar corte booleano.');
    } finally {
      setIsBuilding(false);
    }
  }, [activePart, applyCutResult, connectorConfig, cutGapMm, meshesGetterRef, selectedPartId, toolMode]);

  const handleStartCutSelectedPart = useCallback(() => {
    setResult(null);
    setExplodeDistance(0);
    setCutPoints([]);
    setIsLoopClosed(false);
    setErrorMsg(null);
  }, []);

  return {
    toolMode, detailDepthMm, cutGapMm, isLoopClosed, connectorConfig,
    cutPoints, isPolylineFlipped, polylineFlipSide: isPolylineFlipped, straightFlipTrigger, pinFlipTrigger,
    axisAlignRequest, result, explodeDistance,
    isBuilding, errorMsg,
    setDetailDepthMm, setCutGapMm, setIsLoopClosed, setCutPoints,
    setResult, setExplodeDistance, setErrorMsg,
    handleChangeToolMode, handleClearPoints, handleFlipCutSide,
    handleAlignAxis, handleInvertPin, handleChangeConnector,
    handleExecuteCut, handleStartCutSelectedPart,
  };
}
