import { useCallback, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CatpinCutResult } from '../../types/models';
import {
  type CatPinCutHistoryEntry,
  type CatPinPart,
  getPartColor,
} from '../../types/catpinMultiParts';
import { computeCreasedNormalsInPlace } from '../../utils/normalSmoother';
import { encodeGeometryToBinaryStl } from '../../utils/geometryStlEncoder';

export interface InitialCatPinPartInput {
  name: string;
  geometry: THREE.BufferGeometry;
  stlBuffer?: ArrayBuffer;
}

function buildInitialCatPinPart(input: InitialCatPinPartInput, idx: number): CatPinPart {
  const cloned = input.geometry.clone();
  if (!cloned.attributes.aCavity) computeCreasedNormalsInPlace(cloned);
  const pos = cloned.attributes.position;
  const triCount = Math.round(cloned.index ? cloned.index.count / 3 : (pos ? pos.count / 3 : 0));
  const stlBuffer = input.stlBuffer && input.stlBuffer.byteLength > 84
    ? input.stlBuffer
    : encodeGeometryToBinaryStl(cloned);
  return {
    id: idx === 0 ? 'part_root' : `part_root_${idx}`,
    name: input.name,
    geometry: cloned,
    stlBuffer,
    color: getPartColor(idx),
    triangles: triCount,
    volumeMm3: 0,
    parentPartId: null,
    cutLevel: 0,
    visible: true,
  };
}

/** Converte com segurança qualquer formato de buffer (Uint8Array, Buffer, ArrayBuffer) em ArrayBuffer */
export function toArrayBuffer(buf: unknown): ArrayBuffer {
  if (!buf) return new ArrayBuffer(0);
  if (buf instanceof ArrayBuffer) return buf;
  if (ArrayBuffer.isView(buf)) {
    const b = buf.buffer as ArrayBuffer;
    return b.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const anyBuf = buf as { buffer?: ArrayBuffer; byteOffset?: number; byteLength?: number; length?: number };
  if (anyBuf.buffer && typeof anyBuf.buffer.slice === 'function') {
    const offset = anyBuf.byteOffset ?? 0;
    const len = anyBuf.byteLength ?? anyBuf.length ?? 0;
    return anyBuf.buffer.slice(offset, offset + len);
  }
  return buf as ArrayBuffer;
}

/** Converte buffer de STL binário em THREE.BufferGeometry soldada com normais suaves */
export function parseStlToGeometry(rawBuffer: ArrayBuffer | Uint8Array): THREE.BufferGeometry {
  const buffer = toArrayBuffer(rawBuffer);
  const loader = new STLLoader();
  const rawGeom = loader.parse(buffer);
  const weldedGeom = mergeVertices(rawGeom, 1e-4);
  rawGeom.dispose();
  computeCreasedNormalsInPlace(weldedGeom);
  return weldedGeom;
}

/** Decodifica STL binário diretamente em Float32Array de posições sem distorção ou perda de fechamento */
export function decodeBinaryStlToPositions(rawBuffer: ArrayBuffer | Uint8Array): Float32Array | null {
  const buffer = toArrayBuffer(rawBuffer);
  if (!buffer || buffer.byteLength < 84) return null;
  const view = new DataView(buffer);
  const numTriangles = view.getUint32(80, true);
  if (numTriangles === 0 || buffer.byteLength < 84 + numTriangles * 50) return null;

  const positions = new Float32Array(numTriangles * 9);
  let srcOffset = 84;
  let dstIdx = 0;

  for (let i = 0; i < numTriangles; i++) {
    srcOffset += 12; // pula normal
    for (let v = 0; v < 9; v++) {
      positions[dstIdx++] = view.getFloat32(srcOffset, true);
      srcOffset += 4;
    }
    srcOffset += 2; // pula attribute byte count
  }
  return positions;
}

/**
 * Hook de gerenciamento de multipartes, cortes sucessivos, histórico Desfazer/Refazer e exportação STL.
 */
export function useCatPinMultiParts(
  initialModelName: string,
  onSavedParts?: (folderPath: string) => void,
  workingFolder?: string
) {
  const [parts, setParts] = useState<CatPinPart[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string>('');
  const [undoStack, setUndoStack] = useState<CatPinCutHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<CatPinCutHistoryEntry[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const initFromGeometry = useCallback(
    (geom: THREE.BufferGeometry, rawBuffer?: ArrayBuffer) => {
      const cleanName = initialModelName.replace(/\.[^/.]+$/, '');
      const initialPart = buildInitialCatPinPart(
        { name: `${cleanName} (Original)`, geometry: geom, stlBuffer: rawBuffer },
        0
      );
      setParts([initialPart]);
      setSelectedPartId(initialPart.id);
      setUndoStack([]);
      setRedoStack([]);
    },
    [initialModelName]
  );

  const initFromParts = useCallback((inputParts: InitialCatPinPartInput[]) => {
    if (inputParts.length === 0) return;
    const built = inputParts.map((p, idx) => buildInitialCatPinPart(p, idx));
    let primary = built[0];
    for (const part of built) {
      if (part.triangles > primary.triangles) primary = part;
    }
    setParts(built);
    setSelectedPartId(primary.id);
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const applyCutResult = useCallback(
    (targetPartId: string, cutResult: CatpinCutResult, mirrorCutResult?: CatpinCutResult | null) => {
      if (!cutResult.partABuffer || !cutResult.partBBuffer) return;

      setParts((prevParts) => {
        const targetIdx = prevParts.findIndex((p) => p.id === targetPartId);
        const targetPart = targetIdx >= 0 ? prevParts[targetIdx] : prevParts[0];
        if (!targetPart) return prevParts;

        const hasMirror = Boolean(mirrorCutResult?.partABuffer && mirrorCutResult?.partBBuffer);
        const bodyBuffer = hasMirror ? mirrorCutResult!.partABuffer! : cutResult.partABuffer!;
        const bodyTriHint = hasMirror ? mirrorCutResult!.partATriangles : cutResult.partATriangles;

        setUndoStack((prev) => [
          ...prev,
          {
            parts: prevParts,
            selectedPartId: targetPartId,
            description: `${hasMirror ? 'Mirror Cut' : 'Corte'} em ${targetPart.name}`,
          },
        ]);
        setRedoStack([]);

        const geomA = parseStlToGeometry(bodyBuffer);
        const geomB = parseStlToGeometry(cutResult.partBBuffer!);
        const baseLevel = targetPart.cutLevel + 1;
        const baseName = targetPart.name.replace(/ \(Original\)$/, '');
        const stamp = Date.now();

        const trisA = bodyTriHint ?? (geomA.index ? geomA.index.count / 3 : geomA.attributes.position.count / 3);
        const trisB = cutResult.partBTriangles ?? (geomB.index ? geomB.index.count / 3 : geomB.attributes.position.count / 3);

        const partA: CatPinPart = {
          id: `${targetPart.id}_A_${stamp}`, name: `${baseName} · Peça A`,
          geometry: geomA, stlBuffer: bodyBuffer, color: targetPart.color,
          triangles: trisA, volumeMm3: 0, parentPartId: targetPart.id,
          cutLevel: baseLevel, visible: true, explodeDir: targetPart.explodeDir,
        };
        const partB: CatPinPart = {
          id: `${targetPart.id}_B_${stamp}`, name: `${baseName} · Peça B`,
          geometry: geomB, stlBuffer: cutResult.partBBuffer!, color: getPartColor(prevParts.length),
          triangles: trisB, volumeMm3: 0, parentPartId: targetPart.id,
          cutLevel: baseLevel, visible: true, explodeDir: cutResult.explodeDirStl,
        };
        const createdParts: CatPinPart[] = [partA, partB];
        if (hasMirror && mirrorCutResult?.partBBuffer) {
          const geomC = parseStlToGeometry(mirrorCutResult.partBBuffer);
          const trisC = mirrorCutResult.partBTriangles ?? (geomC.index ? geomC.index.count / 3 : geomC.attributes.position.count / 3);
          createdParts.push({
            id: `${targetPart.id}_C_${stamp}`, name: `${baseName} · Peça C (Mirror)`,
            geometry: geomC, stlBuffer: mirrorCutResult.partBBuffer, color: getPartColor(prevParts.length + 1),
            triangles: trisC, volumeMm3: 0, parentPartId: targetPart.id,
            cutLevel: baseLevel, visible: true, explodeDir: mirrorCutResult.explodeDirStl,
          });
        }

        const nextParts = [...prevParts];
        if (targetIdx >= 0) nextParts.splice(targetIdx, 1, ...createdParts);
        else nextParts.push(...createdParts);

        setSelectedPartId(trisA >= trisB ? partA.id : partB.id);
        return nextParts;
      });
    },
    []
  );

  const undo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const last = prevUndo[prevUndo.length - 1];
      setParts((currentParts) => {
        setRedoStack((prevRedo) => [...prevRedo, { parts: currentParts, selectedPartId, description: 'Redo' }]);
        return last.parts;
      });
      setSelectedPartId(last.selectedPartId);
      return prevUndo.slice(0, -1);
    });
  }, [selectedPartId]);

  const redo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const next = prevRedo[prevRedo.length - 1];
      setParts((currentParts) => {
        setUndoStack((prevUndo) => [...prevUndo, { parts: currentParts, selectedPartId, description: 'Undo' }]);
        return next.parts;
      });
      setSelectedPartId(next.selectedPartId);
      return prevRedo.slice(0, -1);
    });
  }, [selectedPartId]);

  const togglePartVisibility = useCallback((partId: string) => {
    setParts((prev) => prev.map((p) => (p.id === partId ? { ...p, visible: !p.visible } : p)));
  }, []);

  const activePart = parts.find((p) => p.id === selectedPartId) || parts[0] || null;

  const saveAllParts = useCallback(async (fallbackResult?: CatpinCutResult | null) => {
    if (!window.electronAPI) return;
    try {
      setIsSaving(true);
      const cleanBase = initialModelName.replace(/\.[^/.]+$/, '');
      const exportable = parts.filter((p) => p.stlBuffer && p.stlBuffer.byteLength > 0);
      const files = exportable.length > 0
        ? exportable.map((p, idx) => ({
            name: `${cleanBase}_Peca${idx + 1}_${p.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.stl`,
            buffer: p.stlBuffer,
          }))
        : fallbackResult?.partABuffer && fallbackResult?.partBBuffer
          ? [
              { name: `${cleanBase}_ParteA.stl`, buffer: fallbackResult.partABuffer },
              { name: `${cleanBase}_ParteB.stl`, buffer: fallbackResult.partBBuffer },
            ]
          : [];
      if (files.length === 0) return;
      const saveRes = await window.electronAPI.saveCatpinFiles({
        files,
        targetFolder: workingFolder,
        defaultPath: workingFolder,
        openFolderAfter: true,
      });
      if (saveRes.success) onSavedParts?.(saveRes.folder);
    } finally {
      setIsSaving(false);
    }
  }, [initialModelName, parts, onSavedParts, workingFolder]);

  const saveSelectedPart = useCallback(async () => {
    if (!window.electronAPI || !activePart || !activePart.stlBuffer.byteLength) return;
    try {
      setIsSaving(true);
      const cleanBase = initialModelName.replace(/\.[^/.]+$/, '');
      const safeName = activePart.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const saveRes = await window.electronAPI.saveCatpinFiles({
        files: [{ name: `${cleanBase}_${safeName}.stl`, buffer: activePart.stlBuffer }],
        targetFolder: workingFolder,
        defaultPath: workingFolder,
        openFolderAfter: true,
      });
      if (saveRes.success) onSavedParts?.(saveRes.folder);
    } finally {
      setIsSaving(false);
    }
  }, [initialModelName, activePart, onSavedParts, workingFolder]);

  return {
    parts, activePart, selectedPartId, isSaving,
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
    setSelectedPartId, initFromGeometry, initFromParts, applyCutResult, undo, redo,
    togglePartVisibility, saveAllParts, saveSelectedPart,
  };
}
