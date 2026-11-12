import React from 'react';
import { Box, Check, Eye, Layers, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { CatpinConnectorConfig } from '../../utils/catpin/connectorMeshBuilder';
import { CatPinConnectorFields } from './CatPinConnectorFields';
import { CatPinPartsList } from './CatPinPartsList';
import type { CutAxisAlign } from './CatPinViewportToolbar';

export type CatpinToolMode = 'seam' | 'detail' | 'straight';

interface CatPinControlsProps {
  toolMode: CatpinToolMode;
  detailDepthMm: number;
  detailTaperPct: number;
  cutGapMm: number;
  isLoopClosed: boolean;
  connectorConfig: CatpinConnectorConfig;
  isBuilding: boolean;
  errorMsg: string | null;
  pointsCount: number;
  parts?: CatPinPart[];
  selectedPartId?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  onChangeToolMode: (mode: CatpinToolMode) => void;
  onChangeDetailDepth: (depthMm: number) => void;
  onChangeDetailTaper: (taperPct: number) => void;
  onChangeCutGap: (gapMm: number) => void;
  onChangeConnector: (patch: Partial<CatpinConnectorConfig>) => void;
  onCloseLoop: () => void;
  onClearPoints: () => void;
  onFlipCutSide: () => void;
  onInvertPin: () => void;
  onAlignAxis: (axis: CutAxisAlign) => void;
  onExecuteCut: () => void;
  onSelectPart?: (partId: string) => void;
  onTogglePartVisibility?: (partId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onStartCutSelectedPart?: () => void;
}

export const CatPinControls: React.FC<CatPinControlsProps> = ({
  toolMode, detailDepthMm, detailTaperPct, cutGapMm, isLoopClosed, connectorConfig, isBuilding, errorMsg,
  pointsCount, parts, selectedPartId, canUndo, canRedo,
  onChangeToolMode, onChangeDetailDepth, onChangeDetailTaper, onChangeCutGap, onChangeConnector,
  onCloseLoop, onClearPoints, onFlipCutSide, onInvertPin, onAlignAxis, onExecuteCut,
  onSelectPart, onTogglePartVisibility, onUndo, onRedo, onStartCutSelectedPart,
}) => {
  const minPoints = 3;
  const isCutterReady = toolMode === 'straight' || pointsCount >= minPoints;

  return (
    <aside className="catpin-aside" aria-label="Configurações de Corte e Conectores CatPin">
      {parts && parts.length > 1 && onSelectPart && onTogglePartVisibility && onUndo && onRedo && (
        <CatPinPartsList
          parts={parts}
          selectedPartId={selectedPartId || ''}
          canUndo={Boolean(canUndo)}
          canRedo={Boolean(canRedo)}
          isDraftMode={true}
          onSelectPart={onSelectPart}
          onToggleVisibility={onTogglePartVisibility}
          onUndo={onUndo}
          onRedo={onRedo}
          onStartCutSelectedPart={onStartCutSelectedPart || (() => {})}
        />
      )}

      <div className="catpin-section-box">
        <span className="catpin-section-title">1. Ferramenta de Corte</span>
        <div className="catpin-tool-grid">
          <button
            type="button" className="catpin-tool-card" data-active={toolMode === 'seam'}
            onClick={() => onChangeToolMode('seam')}
            title="Corte de Membro: Corta estritamente na seção delimitada pelos pontos desenhados com conectores"
          >
            <Scissors size={20} aria-hidden="true" />
            <span>Corte Membro</span>
          </button>

          <button
            type="button" className="catpin-tool-card" data-active={toolMode === 'detail'}
            onClick={() => onChangeToolMode('detail')}
            title="Extrusão de Detalhe: Extrai olhos, bocas, orelhas com profundidade rasa de encaixe (sem conectores)"
          >
            <Layers size={20} aria-hidden="true" />
            <span>Extrusão Detalhe</span>
          </button>

          <button
            type="button" className="catpin-tool-card" data-active={toolMode === 'straight'}
            onClick={() => onChangeToolMode('straight')}
            title="Corte Plano: Plano reto com Gizmo 3D (sem conectores)"
          >
            <Box size={20} aria-hidden="true" />
            <span>Corte Plano</span>
          </button>
        </div>

        {toolMode === 'seam' && (
          <div className="smart-field">
            <div className="catpin-slider-row">
              <span>Superfície de Corte:</span>
              <strong className="text-primary">Mesh Planar Fina</strong>
            </div>
          </div>
        )}

        {toolMode === 'detail' && (
          <>
            <div className="smart-field">
              <label className="catpin-slider-row" htmlFor="catpin-depth-slider">
                <span>Profundidade Detalhe:</span>
                <strong className="text-primary">{detailDepthMm.toFixed(1)} mm</strong>
              </label>
              <input
                id="catpin-depth-slider" type="range" min={1.0} max={60.0} step={1.0}
                value={detailDepthMm}
                onChange={(e) => onChangeDetailDepth(Number(e.target.value))}
              />
            </div>

            <div className="smart-field">
              <label className="catpin-slider-row" htmlFor="catpin-taper-slider">
                <span>Afunilamento (Taper):</span>
                <strong className="text-primary">{detailTaperPct}%</strong>
              </label>
              <input
                id="catpin-taper-slider" type="range" min={0} max={80} step={5}
                value={detailTaperPct}
                onChange={(e) => onChangeDetailTaper(Number(e.target.value))}
              />
            </div>
          </>
        )}

        {(toolMode === 'seam' || toolMode === 'straight' || toolMode === 'detail') && (
          <button type="button" className="btn full-width-btn" onClick={onFlipCutSide}>
            <RotateCcw size={15} aria-hidden="true" />
            <span>⇄ Inverter Direção / Lado</span>
          </button>
        )}

        {toolMode === 'straight' && (
          <div className="catpin-clearance-group">
            {(['x', 'y', 'z'] as CutAxisAlign[]).map((ax) => (
              <button key={ax} type="button" className="catpin-chip-btn" onClick={() => onAlignAxis(ax)}>
                Alinhar {ax.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {toolMode !== 'straight' && (
          <div className="flex-col-gap2">
            <div className="catpin-slider-row">
              <span>Pontos marcados (mín. {minPoints}):</span>
              <strong className="text-primary">
                {pointsCount} {isLoopClosed ? '· Fechado ✓' : ''}
              </strong>
            </div>

            {!isLoopClosed && pointsCount >= minPoints && (
              <button type="button" className="btn btn-primary full-width-btn" onClick={onCloseLoop}>
                <Check size={15} aria-hidden="true" />
                <span>✓ Fechar Contorno (Duplo Clique)</span>
              </button>
            )}

            {pointsCount > 0 && (
              <button type="button" className="btn full-width-btn" onClick={onClearPoints}>
                <Trash2 size={15} aria-hidden="true" />
                <span>Limpar / Redesenhar ({pointsCount})</span>
              </button>
            )}
          </div>
        )}
      </div>

      {toolMode === 'seam' && (
        <CatPinConnectorFields
          connectorConfig={connectorConfig}
          cutGapMm={cutGapMm}
          onChangeCutGap={onChangeCutGap}
          onChangeConnector={onChangeConnector}
          onInvertPin={onInvertPin}
        />
      )}

      <div className="catpin-section-box">
        <span className="catpin-section-title">{toolMode === 'seam' ? '3' : '2'}. Visualização</span>
        <label className="catpin-checkbox-label">
          <input
            type="checkbox" checked={connectorConfig.xrayMode}
            onChange={(e) => onChangeConnector({ xrayMode: e.target.checked })}
          />
          <Eye size={16} aria-hidden="true" />
          <span>Modo Raio-X (Enxergar Volume Interno)</span>
        </label>
      </div>

      {errorMsg && <div className="catpin-error-banner" role="alert">{errorMsg}</div>}

      <div className="margin-top-auto">
        <button
          type="button" className="btn btn-primary full-width-btn"
          onClick={onExecuteCut} disabled={isBuilding || !isCutterReady}
        >
          <Layers size={18} aria-hidden="true" />
          <span>
            {isBuilding
              ? 'Executando CSG Manifold3D...'
              : !isCutterReady
                ? `Marque o contorno no modelo (${pointsCount}/${minPoints})`
                : toolMode === 'seam' && connectorConfig.type !== 'none'
                  ? 'Executar Corte & Conectores (Build)'
                  : 'Executar Corte (Build)'}
          </span>
        </button>
      </div>
    </aside>
  );
};
