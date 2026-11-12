import { useState, useCallback } from 'react';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { PlateArrangementResult } from '../../types/plateTypes';
import { findOptimalBedOrientation } from '../../utils/plate/autoOrientAntiSupport';
import { arrangePartsOnBed, type BedDimensions } from '../../utils/plate/plateArranger';
import { extractGeometryMeshData } from '../../utils/plate/geometryDataExtractor';

export function useCatPinPlateArrangement() {
  const [plateArrangement, setPlateArrangement] = useState<PlateArrangementResult | null>(null);
  const [isPlateMode, setIsPlateMode] = useState<boolean>(false);
  const [isArranging, setIsArranging] = useState<boolean>(false);
  const [isExporting3mf, setIsExporting3mf] = useState<boolean>(false);

  const arrangeOnBed = useCallback((parts: CatPinPart[], bedOptions?: BedDimensions) => {
    if (parts.length === 0) return null;
    setIsArranging(true);
    try {
      const inputs = parts.map((p) => ({
        id: p.id,
        name: p.name,
        orientation: findOptimalBedOrientation(p.geometry, p.explodeDir),
      }));

      const result = arrangePartsOnBed(inputs, bedOptions);
      setPlateArrangement(result);
      setIsPlateMode(true);
      return result;
    } finally {
      setIsArranging(false);
    }
  }, []);

  const togglePlateMode = useCallback(() => {
    setIsPlateMode((prev) => !prev);
  }, []);

  const saveMultiPart3mf = useCallback(
    async (
      projectName: string,
      parts: CatPinPart[],
      workingFolder?: string,
      onSaved?: (path: string) => void
    ) => {
      if (!window.electronAPI || parts.length === 0) return;
      setIsExporting3mf(true);
      try {
        let currentArrangement = plateArrangement;
        if (!currentArrangement) {
          currentArrangement = arrangeOnBed(parts);
        }
        if (!currentArrangement) return;

        const payloadParts = parts.map((part) => {
          const placement = currentArrangement!.placements.get(part.id);
          const { vertices, indices } = extractGeometryMeshData(part.geometry);
          return {
            name: part.name,
            vertices,
            indices,
            position: placement?.position ?? [0, 0, 0],
            rotation: placement?.rotation ?? [0, 0, 0, 1],
          };
        });

        const res = await window.electronAPI.saveMultiPart3mf({
          projectName,
          parts: payloadParts,
          defaultPath: workingFolder,
        });

        if (res.success && res.savedPath) {
          onSaved?.(res.savedPath);
        }
      } finally {
        setIsExporting3mf(false);
      }
    },
    [plateArrangement, arrangeOnBed]
  );

  const openInSlicer = useCallback(
    async (projectName: string, parts: CatPinPart[]) => {
      if (!window.electronAPI || parts.length === 0) return;
      setIsExporting3mf(true);
      try {
        let currentArrangement = plateArrangement;
        if (!currentArrangement) {
          currentArrangement = arrangeOnBed(parts);
        }
        if (!currentArrangement) return;

        const payloadParts = parts.map((part) => {
          const placement = currentArrangement!.placements.get(part.id);
          const { vertices, indices } = extractGeometryMeshData(part.geometry);
          return {
            name: part.name,
            vertices,
            indices,
            position: placement?.position ?? [0, 0, 0],
            rotation: placement?.rotation ?? [0, 0, 0, 1],
          };
        });

        await window.electronAPI.openMultiPartInSlicer({
          projectName,
          parts: payloadParts,
        });
      } finally {
        setIsExporting3mf(false);
      }
    },
    [plateArrangement, arrangeOnBed]
  );

  return {
    plateArrangement,
    isPlateMode,
    isArranging,
    isExporting3mf,
    arrangeOnBed,
    togglePlateMode,
    saveMultiPart3mf,
    openInSlicer,
  };
}

