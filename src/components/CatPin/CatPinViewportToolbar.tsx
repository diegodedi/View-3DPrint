import React from 'react';
import { Box, Crosshair, Move, Pin, RotateCcw, RotateCw } from 'lucide-react';
import type { CatpinToolMode } from './CatPinControls';

export type GizmoTarget = 'cutter' | 'pin';
export type GizmoMode = 'translate' | 'rotate';
export type CutAxisAlign = 'x' | 'y' | 'z';

interface CatPinViewportToolbarProps {
  visible: boolean;
  toolMode: CatpinToolMode;
  hasCutter: boolean;
  hasPin: boolean;
  hasManualPinOffset: boolean;
  gizmoTarget: GizmoTarget;
  gizmoMode: GizmoMode;
  onChangeTarget: (target: GizmoTarget) => void;
  onChangeMode: (mode: GizmoMode) => void;
  onAlignAxis: (axis: CutAxisAlign) => void;
  onInvertPin: () => void;
  onRecenterPin: () => void;
}

/**
 * Barra flutuante na Viewport 3D: alterna Gizmo (Mover/Rotacionar), Alinhar X/Y/Z, inverter pino e alvo.
 */
export const CatPinViewportToolbar: React.FC<CatPinViewportToolbarProps> = ({
  visible,
  toolMode,
  hasCutter,
  hasPin,
  hasManualPinOffset,
  gizmoTarget,
  gizmoMode,
  onChangeTarget,
  onChangeMode,
  onAlignAxis,
  onInvertPin,
  onRecenterPin,
}) => {
  if (!visible) return null;
  if (toolMode === 'straight' && !hasCutter) return null;
  if (toolMode !== 'straight' && !hasPin) return null;

  return (
    <div className="catpin-floating-toolbar" role="toolbar" aria-label="Controles do Gizmo 3D">
      {toolMode === 'straight' && (
        <button
          type="button"
          className="catpin-pill-btn"
          data-active={gizmoTarget === 'cutter'}
          onClick={() => onChangeTarget('cutter')}
        >
          <Box size={14} aria-hidden="true" />
          <span>Gizmo: Cortador</span>
        </button>
      )}

      {hasPin && (
        <>
          <button
            type="button"
            className="catpin-pill-btn"
            data-active={gizmoTarget === 'pin'}
            onClick={() => onChangeTarget('pin')}
          >
            <Pin size={14} aria-hidden="true" />
            <span>Gizmo: Pino</span>
          </button>
          <button
            type="button"
            className="catpin-pill-btn"
            onClick={onInvertPin}
            title="Inverter direção do pino (180°)"
          >
            <RotateCcw size={14} aria-hidden="true" />
            <span>Inverter Pino</span>
          </button>
        </>
      )}

      <button
        type="button"
        className="catpin-pill-btn"
        data-active={gizmoMode === 'translate'}
        onClick={() => onChangeMode('translate')}
      >
        <Move size={14} aria-hidden="true" />
        <span>Mover (Translate)</span>
      </button>

      <button
        type="button"
        className="catpin-pill-btn"
        data-active={gizmoMode === 'rotate'}
        onClick={() => onChangeMode('rotate')}
      >
        <RotateCw size={14} aria-hidden="true" />
        <span>Rotacionar (Rotate)</span>
      </button>

      {toolMode === 'straight' && (
        <>
          <button type="button" className="catpin-pill-btn" onClick={() => onAlignAxis('x')}>
            <span>Alinhar X</span>
          </button>
          <button type="button" className="catpin-pill-btn" onClick={() => onAlignAxis('y')}>
            <span>Alinhar Y</span>
          </button>
          <button type="button" className="catpin-pill-btn" onClick={() => onAlignAxis('z')}>
            <span>Alinhar Z</span>
          </button>
        </>
      )}

      {hasPin && hasManualPinOffset && (
        <button type="button" className="catpin-pill-btn" onClick={onRecenterPin}>
          <Crosshair size={14} aria-hidden="true" />
          <span>Centralizar Pino</span>
        </button>
      )}
    </div>
  );
};
