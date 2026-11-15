import { useState, useCallback } from 'react';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { PlateArrangementResult } from '../../types/plateTypes';
import { findOptimalBedOrientation } from '../../utils/plate/autoOrientAntiSupport';
import { arrangePartsOnBed, type BedDimensions } from '../../utils/plate/plateArranger';
import { extractOrientedPartMeshData } from '../../utils/plate/geometryDataExtractor';

export function useCatPinPlateArrangement(
  defaultBedOptions?: BedDimensions,
  slicerExecutablePath?: string
) {
  const [plateArrangement, setPlateArrangement] = useState<PlateArrangementResult | null>(null);
  const [isPlateMode, setIsPlateMode] = useState<boolean>(false);
  const [isArranging, setIsArranging] = useState<boolean>(false);
  const [isExporting3mf, setIsExporting3mf] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const arrangeOnBed = useCallback(
    (parts: CatPinPart[], bedOptions?: BedDimensions) => {
      if (parts.length === 0) return null;
      setIsArranging(true);
      setSavedNotice(null);
      try {
        const inputs = parts.map((p) => ({
          id: p.id,
          name: p.name,
          orientation: findOptimalBedOrientation(p.geometry, p.explodeDir),
        }));

        const result = arrangePartsOnBed(inputs, bedOptions ?? defaultBedOptions);
        setPlateArrangement(result);
        setIsPlateMode(true);
        return result;
      } finally {
        setIsArranging(false);
      }
    },
    [defaultBedOptions]
  );

  const togglePlateMode = useCallback(() => {
    setIsPlateMode((prev) => !prev);
  }, []);

  const resetPlateArrangement = useCallback(() => {
    setPlateArrangement(null);
    setIsPlateMode(false);
    setSavedNotice(null);
  }, []);

  const buildPayloadParts = useCallback(
    (parts: CatPinPart[], arrangement: PlateArrangementResult) => {
      return parts.map((part) => {
        const placement = arrangement.placements.get(part.id);
        const oriented = extractOrientedPartMeshData(part.geometry, placement);
        return {
          name: part.name,
          vertices: oriented.vertices,
          indices: oriented.indices,
          position: oriented.position,
          rotation: oriented.rotation,
        };
      });
    },
    []
  );

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
        if (!currentArrangement || currentArrangement.placements.size !== parts.length) {
          currentArrangement = arrangeOnBed(parts, defaultBedOptions);
        }
        if (!currentArrangement) return;

        const payloadParts = buildPayloadParts(parts, currentArrangement);
        const res = await window.electronAPI.saveMultiPart3mf({
          projectName,
          parts: payloadParts,
          targetFolder: workingFolder,
          defaultPath: workingFolder,
          bedWidthMm: currentArrangement.bedWidthMm,
          bedDepthMm: currentArrangement.bedDepthMm,
        });

        if (res.success && res.savedPath) {
          setSavedNotice('Mesa completa (.3MF) salva na pasta do projeto!');
          onSaved?.(res.folder || res.savedPath);
        }
      } finally {
        setIsExporting3mf(false);
      }
    },
    [plateArrangement, arrangeOnBed, defaultBedOptions, buildPayloadParts]
  );

  const openInSlicer = useCallback(
    async (projectName: string, parts: CatPinPart[]) => {
      if (!window.electronAPI || parts.length === 0) return;
      setIsExporting3mf(true);
      try {
        let currentArrangement = plateArrangement;
        if (!currentArrangement || currentArrangement.placements.size !== parts.length) {
          currentArrangement = arrangeOnBed(parts, defaultBedOptions);
        }
        if (!currentArrangement) return;

        const payloadParts = buildPayloadParts(parts, currentArrangement);
        await window.electronAPI.openMultiPartInSlicer({
          projectName,
          parts: payloadParts,
          slicerExecutablePath,
          bedWidthMm: currentArrangement.bedWidthMm,
          bedDepthMm: currentArrangement.bedDepthMm,
        });
      } finally {
        setIsExporting3mf(false);
      }
    },
    [plateArrangement, arrangeOnBed, defaultBedOptions, buildPayloadParts, slicerExecutablePath]
  );

  return {
    plateArrangement,
    isPlateMode,
    isArranging,
    isExporting3mf,
    savedNotice,
    arrangeOnBed,
    togglePlateMode,
    resetPlateArrangement,
    saveMultiPart3mf,
    openInSlicer,
  };
}
