import React from 'react';
import { AlertTriangle, Check, Download, ExternalLink, Folder, LayoutGrid, Package, Scissors } from 'lucide-react';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { CatpinCutResult } from '../../types/models';
import type { PlateArrangementResult } from '../../types/plateTypes';
import { getFolderDisplayName } from '../../utils/modelFolderResolver';
import { CatPinPartsList } from './CatPinPartsList';

interface CatPinResultPanelProps {
  result: CatpinCutResult;
  explodeDistance: number;
  isSaving: boolean;
  parts: CatPinPart[];
  selectedPartId: string;
  canUndo: boolean;
  canRedo: boolean;
  workingFolder?: string;
  isPlateMode?: boolean;
  isArranging?: boolean;
  isExporting3mf?: boolean;
  plateArrangement?: PlateArrangementResult | null;
  onChangeExplode: (distanceMm: number) => void;
  onSelectPart: (partId: string) => void;
  onToggleVisibility: (partId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onStartCutSelectedPart: () => void;
  onSaveAllFiles: () => void;
  onSaveSelectedPart: () => void;
  onArrangeOnBed: () => void;
  onTogglePlateMode: () => void;
  onSaveMultiPart3mf: () => void;
  onOpenInSlicer: () => void;
}

/**
 * Painel lateral de inspeção pós-corte e cortes sucessivos multipartes.
 */
export const CatPinResultPanel: React.FC<CatPinResultPanelProps> = ({
  result,
  explodeDistance,
  isSaving,
  parts,
  selectedPartId,
  canUndo,
  canRedo,
  workingFolder,
  isPlateMode = false,
  isArranging = false,
  isExporting3mf = false,
  plateArrangement = null,
  onChangeExplode,
  onSelectPart,
  onToggleVisibility,
  onUndo,
  onRedo,
  onStartCutSelectedPart,
  onSaveAllFiles,
  onSaveSelectedPart,
  onArrangeOnBed,
  onTogglePlateMode,
  onSaveMultiPart3mf,
  onOpenInSlicer,
}) => {
  const selectedPart = parts.find((p) => p.id === selectedPartId) || parts[0];

  return (
    <aside className="catpin-aside" aria-label="Inspeção Pós-Corte CatPin">
      <div className="catpin-section-box">
        <span className="catpin-section-title">Montagem Multipartes</span>
        <div className="catpin-success-banner">
          <Check size={18} aria-hidden="true" />
          <span>{parts.length} peças separadas e 100% fechadas!</span>
        </div>
      </div>

      <CatPinPartsList
        parts={parts}
        selectedPartId={selectedPartId}
        canUndo={canUndo}
        canRedo={canRedo}
        isDraftMode={false}
        onSelectPart={onSelectPart}
        onToggleVisibility={onToggleVisibility}
        onUndo={onUndo}
        onRedo={onRedo}
        onStartCutSelectedPart={onStartCutSelectedPart}
      />

      <div className="catpin-section-box">
        <span className="catpin-section-title">Visualização Pós-Corte</span>
        <div className="catpin-tool-grid">
          <button
            type="button"
            className="catpin-chip-btn"
            data-active={!isPlateMode}
            onClick={isPlateMode ? onTogglePlateMode : undefined}
          >
            Montagem
          </button>
          <button
            type="button"
            className="catpin-chip-btn"
            data-active={isPlateMode}
            onClick={isPlateMode ? undefined : onArrangeOnBed}
          >
            Mesa 3D
          </button>
        </div>

        {!isPlateMode ? (
          <>
            <label className="catpin-slider-row" htmlFor="catpin-explode-slider">
              <span>Separação / Explosão:</span>
              <strong className="text-main">{explodeDistance.toFixed(1)} mm</strong>
            </label>
            <input
              id="catpin-explode-slider"
              type="range"
              min={0}
              max={80}
              step={0.5}
              value={explodeDistance}
              onChange={(e) => onChangeExplode(Number(e.target.value))}
            />
            <span className="catpin-helper-text">
              Desloca as peças ao longo do eixo de corte para inspecionar encaixes e conectores.
            </span>
          </>
        ) : (
          <div className="catpin-plate-status">
            <div className="catpin-slider-row">
              <span>Mesa Útil:</span>
              <strong className="text-primary">
                {plateArrangement?.bedWidthMm ?? 220} × {plateArrangement?.bedDepthMm ?? 220} mm
              </strong>
            </div>
            <div className="catpin-slider-row">
              <span>Ocupação da Mesa:</span>
              <strong className="text-main">{plateArrangement?.bedUtilizationPercent ?? 0}%</strong>
            </div>
            <span className="catpin-helper-text">
              Peças orientadas pela face de corte em Z=0 (menor suporte, maior adesão).
            </span>
          </div>
        )}
      </div>

      <div className="catpin-section-box">
        <span className="catpin-section-title">Métricas da Peça Ativa</span>
        <div className="catpin-slider-row">
          <span>Nome:</span>
          <strong className="text-primary">{selectedPart?.name ?? '—'}</strong>
        </div>
        <div className="catpin-slider-row">
          <span>Triângulos:</span>
          <strong className="text-main">
            {(selectedPart?.triangles ?? 0).toLocaleString('pt-BR')} tri
          </strong>
        </div>
        {typeof result.minGapMm === 'number' && (
          <div className="catpin-slider-row">
            <span>Folga Mínima Real:</span>
            <strong className="text-primary">{result.minGapMm.toFixed(2)} mm</strong>
          </div>
        )}
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <div className="catpin-section-box catpin-warning-box">
          <div className="catpin-warning-header">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>Avisos de Impressão / Encaixe:</span>
          </div>
          <ul className="catpin-warning-list">
            {result.warnings.map((w, idx) => (
              <li key={idx}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="catpin-footer-actions">
        {workingFolder && (
          <div className="catpin-destination-hint" title={`Pasta de trabalho: ${workingFolder}`}>
            <Folder size={14} aria-hidden="true" />
            <span className="catpin-destination-label">Destino:</span>
            <span className="catpin-destination-path">{getFolderDisplayName(workingFolder)}</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary full-width-btn"
          onClick={onArrangeOnBed}
          disabled={isArranging}
          title="Gira as peças para minimizar suportes e organiza no grid da mesa"
        >
          <LayoutGrid size={16} aria-hidden="true" />
          <span>{isArranging ? 'Organizando...' : 'Organizar na Mesa (Auto)'}</span>
        </button>

        {isPlateMode && (
          <>
            <button
              type="button"
              className="btn full-width-btn"
              onClick={onOpenInSlicer}
              disabled={isExporting3mf}
              title="Abre todas as peças organizadas no fatiador em 1 clique"
            >
              <ExternalLink size={16} aria-hidden="true" />
              <span>Abrir Mesa no Fatiador</span>
            </button>

            <button
              type="button"
              className="btn full-width-btn"
              onClick={onSaveMultiPart3mf}
              disabled={isExporting3mf}
              title="Salva um arquivo 3MF contendo todas as peças dispostas na mesa"
            >
              <Package size={16} aria-hidden="true" />
              <span>{isExporting3mf ? 'Exportando...' : 'Salvar Projeto Mesa (.3MF)'}</span>
            </button>
          </>
        )}

        <button
          type="button"
          className="btn full-width-btn"
          onClick={onStartCutSelectedPart}
        >
          <Scissors size={16} aria-hidden="true" />
          <span>Cortar Novamente esta Peça</span>
        </button>

        <button
          type="button"
          className="btn full-width-btn"
          onClick={onSaveAllFiles}
          disabled={isSaving}
        >
          <Download size={16} aria-hidden="true" />
          <span>{isSaving ? 'Salvando...' : `Salvar Todas as ${parts.length} Peças (.STL)`}</span>
        </button>

        {parts.length > 1 && (
          <button
            type="button"
            className="btn full-width-btn"
            onClick={onSaveSelectedPart}
            disabled={isSaving}
          >
            <Download size={16} aria-hidden="true" />
            <span>Salvar Apenas Peça Selecionada</span>
          </button>
        )}
      </div>
    </aside>
  );
};
