import React from 'react';
import { Eye, EyeOff, Redo2, Scissors, Undo2 } from 'lucide-react';
import type { CatPinPart } from '../../types/catpinMultiParts';

interface CatPinPartsListProps {
  parts: CatPinPart[];
  selectedPartId: string;
  canUndo: boolean;
  canRedo: boolean;
  isDraftMode: boolean;
  onSelectPart: (partId: string) => void;
  onToggleVisibility: (partId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onStartCutSelectedPart: () => void;
}

/**
 * Painel de lista de peças multipartes com suporte a seleção, visibilidade e histórico.
 */
export const CatPinPartsList: React.FC<CatPinPartsListProps> = ({
  parts,
  selectedPartId,
  canUndo,
  canRedo,
  isDraftMode,
  onSelectPart,
  onToggleVisibility,
  onUndo,
  onRedo,
  onStartCutSelectedPart,
}) => {
  return (
    <div className="catpin-section-box">
      <div className="catpin-parts-header">
        <span className="catpin-section-title catpin-parts-title-no-margin">
          Peças ({parts.length})
        </span>
        <div className="catpin-parts-history-btns">
          <button
            type="button"
            className="btn catpin-touch-icon-btn"
            onClick={onUndo}
            disabled={!canUndo}
            title="Desfazer último corte (Ctrl+Z)"
            aria-label="Desfazer último corte"
          >
            <Undo2 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn catpin-touch-icon-btn"
            onClick={onRedo}
            disabled={!canRedo}
            title="Refazer corte (Ctrl+Y)"
            aria-label="Refazer corte"
          >
            <Redo2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="catpin-parts-scroll">
        {parts.map((part, index) => {
          const isSelected = part.id === selectedPartId;
          return (
            <div
              key={part.id}
              onClick={() => onSelectPart(part.id)}
              className={`catpin-part-row ${isSelected ? 'catpin-part-row-selected' : ''}`}
            >
              <span
                className="catpin-part-dot"
                data-color-idx={index % 10}
              />
              <div className="catpin-part-info">
                <div className={`catpin-part-title ${isSelected ? 'catpin-part-title-selected' : ''}`}>
                  {part.name}
                </div>
                <div className="catpin-part-triangles">
                  {part.triangles.toLocaleString('pt-BR')} tri
                </div>
              </div>

              <button
                type="button"
                className="btn catpin-part-vis-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(part.id);
                }}
                title={part.visible ? 'Ocultar peça' : 'Exibir peça'}
                aria-label={part.visible ? 'Ocultar peça' : 'Exibir peça'}
              >
                {part.visible ? (
                  <Eye size={13} color="var(--color-text-muted)" aria-hidden="true" />
                ) : (
                  <EyeOff size={13} color="var(--color-warning)" aria-hidden="true" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {!isDraftMode && (
        <button
          type="button"
          className="btn btn-primary full-width-btn catpin-btn-start-cut"
          onClick={onStartCutSelectedPart}
        >
          <Scissors size={15} aria-hidden="true" />
          <span>Cortar Peça Selecionada</span>
        </button>
      )}
    </div>
  );
};

