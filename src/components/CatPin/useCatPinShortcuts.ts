import { useEffect } from 'react';
import type { CatpinCutResult } from '../../types/models';

interface UseCatPinShortcutsParams {
  isOpen: boolean;
  isBuilding: boolean;
  isSaving: boolean;
  result: CatpinCutResult | null;
  cutPointsCount: number;
  canUndo: boolean;
  canRedo: boolean;
  partsCount: number;
  onPopCutPoint: () => void;
  onUndoCut: () => void;
  onRedoCut: () => void;
  onClearPoints: () => void;
  onExitResult: () => void;
}

/**
 * Hook para atalhos globais de teclado no CatPin:
 * - Ctrl+Z: Desfaz o último ponto desenhado ou o último corte realizado
 * - Ctrl+Y ou Ctrl+Shift+Z: Refaz o corte desfeito
 */
export function useCatPinShortcuts({
  isOpen,
  isBuilding,
  isSaving,
  result,
  cutPointsCount,
  canUndo,
  canRedo,
  partsCount,
  onPopCutPoint,
  onUndoCut,
  onRedoCut,
  onClearPoints,
  onExitResult,
}: UseCatPinShortcutsParams): void {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isBuilding || isSaving) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (!result && cutPointsCount > 0) {
          onPopCutPoint();
          return;
        }
        if (canUndo) {
          const shouldExitResult = Boolean(result) && partsCount <= 2;
          onUndoCut();
          if (shouldExitResult) onExitResult();
          onClearPoints();
        }
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        if (canRedo) {
          onRedoCut();
          onClearPoints();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    isBuilding,
    isSaving,
    result,
    cutPointsCount,
    canUndo,
    canRedo,
    partsCount,
    onPopCutPoint,
    onUndoCut,
    onRedoCut,
    onClearPoints,
    onExitResult,
  ]);
}

