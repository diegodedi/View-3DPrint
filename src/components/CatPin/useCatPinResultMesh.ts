import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CatPinPart } from '../../types/catpinMultiParts';
import type { CatpinCutResult } from '../../types/models';
import type { PlateArrangementResult } from '../../types/plateTypes';
import { createPartStudioMaterial } from '../../utils/studioResinMaterial';
import { disposeObjectGeometries } from '../../utils/threeHelpers';

function disposeGroupMaterials(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
    }
  });
}

interface UseCatPinResultMeshParams {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  mainMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  cutterMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  pinMeshRef: React.MutableRefObject<THREE.Mesh | null>;
  cutNormalRef: React.MutableRefObject<THREE.Vector3>;
  result: CatpinCutResult | null;
  explodeDistance: number;
  parts: CatPinPart[];
  selectedPartId: string;
  isDraftMode: boolean;
  isPlateMode?: boolean;
  plateArrangement?: PlateArrangementResult | null;
  renderScene: () => void;
}

/**
 * Gerencia a renderização de peças pós-corte e fantasmas de contexto (Etapa 5).
 * Alinha as peças ao matrixWorld de mainMesh + Explode View ou Modo Mesa (Plate Nesting).
 */
export function useCatPinResultMesh({
  sceneRef,
  mainMeshRef,
  cutterMeshRef,
  pinMeshRef,
  cutNormalRef,
  result,
  explodeDistance,
  parts,
  selectedPartId,
  isDraftMode,
  isPlateMode = false,
  plateArrangement = null,
  renderScene,
}: UseCatPinResultMeshParams): React.MutableRefObject<THREE.Group> {
  const resultGroupRef = useRef<THREE.Group>(new THREE.Group());
  const explodedMeshesRef = useRef<Map<string, { mesh: THREE.Mesh; basePos: THREE.Vector3; dir: THREE.Vector3 }>>(new Map());

  useEffect(() => {
    const scene = sceneRef.current;
    const mainMesh = mainMeshRef.current;
    if (!scene || !mainMesh) return;

    if (!scene.children.includes(resultGroupRef.current)) {
      scene.add(resultGroupRef.current);
    }
    disposeGroupMaterials(resultGroupRef.current);
    disposeObjectGeometries(resultGroupRef.current);
    resultGroupRef.current.clear();
    explodedMeshesRef.current.clear();

    const hasMultiParts = parts.length > 1;

    if (result && hasMultiParts && !isDraftMode) {
      mainMesh.visible = false;
      if (cutterMeshRef.current) cutterMeshRef.current.visible = false;
      if (pinMeshRef.current) pinMeshRef.current.visible = false;

      if (isPlateMode && plateArrangement) {
        const plateGroup = new THREE.Group();
        plateGroup.rotation.x = -Math.PI / 2;

        const grid = new THREE.GridHelper(plateArrangement.bedWidthMm, 22, 0x475569, 0x1e293b);
        grid.rotation.x = Math.PI / 2;
        grid.position.set(plateArrangement.bedCenterX, plateArrangement.bedCenterY, -0.1);
        plateGroup.add(grid);

        parts.forEach((part, idx) => {
          if (!part.visible) return;
          const placement = plateArrangement.placements.get(part.id);
          const isSelected = part.id === selectedPartId;
          const mat = createPartStudioMaterial(part.color, {
            isPrimaryPart: idx === 0,
            isSelected,
          });

          const mesh = new THREE.Mesh(part.geometry, mat);
          mesh.userData.partId = part.id;
          if (placement) {
            mesh.quaternion.set(
              placement.rotation[0],
              placement.rotation[1],
              placement.rotation[2],
              placement.rotation[3]
            );
            mesh.position.set(
              placement.position[0],
              placement.position[1],
              placement.position[2]
            );
          }
          plateGroup.add(mesh);
        });

        resultGroupRef.current.add(plateGroup);
        renderScene();
        return;
      }

      mainMesh.updateMatrixWorld(true);
      if (result.explodeDirStl) {
        const worldExplodeDir = new THREE.Vector3(...result.explodeDirStl)
          .transformDirection(mainMesh.matrixWorld)
          .normalize();
        cutNormalRef.current.copy(worldExplodeDir);
      }

      const explodeDir = cutNormalRef.current.clone().normalize();
      const assemblyBox = new THREE.Box3();
      const partCenters: THREE.Vector3[] = [];

      parts.forEach((part) => {
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        const bb = part.geometry.boundingBox!.clone().applyMatrix4(mainMesh.matrixWorld);
        assemblyBox.union(bb);
        partCenters.push(bb.getCenter(new THREE.Vector3()));
      });
      const assemblyCenter = assemblyBox.getCenter(new THREE.Vector3());

      parts.forEach((part, idx) => {
        if (!part.visible) return;
        const isSelected = part.id === selectedPartId;
        const mat = createPartStudioMaterial(part.color, {
          isPrimaryPart: idx === 0,
          isSelected,
        });

        const mesh = new THREE.Mesh(part.geometry, mat);
        mesh.applyMatrix4(mainMesh.matrixWorld);
        mesh.userData.partId = part.id;

        let partDir = new THREE.Vector3(0, 0, 0);
        if (idx > 0) {
          if (part.explodeDir) {
            partDir = new THREE.Vector3(...part.explodeDir)
              .transformDirection(mainMesh.matrixWorld)
              .normalize();
          } else if (parts.length === 2) {
            partDir = explodeDir.clone();
          } else {
            const radial = new THREE.Vector3().subVectors(partCenters[idx], assemblyCenter);
            partDir = radial.lengthSq() > 1e-3 ? radial.normalize() : explodeDir.clone();
          }
        }

        explodedMeshesRef.current.set(part.id, {
          mesh,
          basePos: mesh.position.clone(),
          dir: partDir,
        });

        resultGroupRef.current.add(mesh);
      });
    } else if (hasMultiParts && isDraftMode) {
      mainMesh.visible = true;
      if (cutterMeshRef.current) cutterMeshRef.current.visible = true;
      if (pinMeshRef.current) pinMeshRef.current.visible = true;

      mainMesh.updateMatrixWorld(true);

      parts.forEach((part, idx) => {
        if (part.id === selectedPartId || !part.visible) return;
        const ghostMat = createPartStudioMaterial(part.color, {
          isPrimaryPart: idx === 0,
          opacity: 0.25,
        });

        const ghostMesh = new THREE.Mesh(part.geometry, ghostMat);
        ghostMesh.applyMatrix4(mainMesh.matrixWorld);
        ghostMesh.userData.partId = part.id;
        resultGroupRef.current.add(ghostMesh);
      });
    } else {
      mainMesh.visible = true;
      if (cutterMeshRef.current) cutterMeshRef.current.visible = true;
      if (pinMeshRef.current) pinMeshRef.current.visible = true;
    }

    renderScene();
  }, [result, parts, selectedPartId, isDraftMode, isPlateMode, plateArrangement, sceneRef, mainMeshRef, cutterMeshRef, pinMeshRef, cutNormalRef, renderScene]);

  useEffect(() => {
    if (isPlateMode) return;
    explodedMeshesRef.current.forEach(({ mesh, basePos, dir }) => {
      mesh.position.copy(basePos).addScaledVector(dir, explodeDistance);
    });
    renderScene();
  }, [explodeDistance, isPlateMode, renderScene]);

  return resultGroupRef;
}
