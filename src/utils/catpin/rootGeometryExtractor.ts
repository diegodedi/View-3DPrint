import * as THREE from 'three';

export interface RootGeometryExtraction {
  geometry: THREE.BufferGeometry | null;
  warning: string | null;
}

export interface ExtractedMeshPart {
  name: string;
  geometry: THREE.BufferGeometry;
  triangles: number;
}

/**
 * Inspeciona a árvore de objetos 3D carregada e seleciona a malha principal para corte,
 * emitindo um alerta informativo caso o arquivo contenha múltiplos objetos independentes.
 */
export function extractRootGeometry(sourceObject3D: THREE.Object3D | null): RootGeometryExtraction {
  if (!sourceObject3D) return { geometry: null, warning: null };

  let bestGeom: THREE.BufferGeometry | null = null;
  let maxTriCount = -1;
  let bestMeshName = '';
  let meshCount = 0;

  sourceObject3D.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshCount++;
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry;
      const triCount = geom.index
        ? geom.index.count / 3
        : geom.attributes.position
          ? geom.attributes.position.count / 3
          : 0;
      if (triCount > maxTriCount) {
        maxTriCount = triCount;
        bestGeom = geom;
        bestMeshName = mesh.name || '';
      }
    }
  });

  let warning: string | null = null;
  if (meshCount > 1) {
    const label = bestMeshName ? `"${bestMeshName}"` : 'principal';
    warning = `Este arquivo tem ${meshCount} objetos; a geometria ${label} (${Math.round(maxTriCount)} triângulos) foi selecionada para corte.`;
  }

  return { geometry: bestGeom, warning };
}

/**
 * Extrai todas as malhas independentes válidas de um Object3D preservando seus nomes e contagem de triângulos.
 */
export function extractAllMeshParts(sourceObject3D: THREE.Object3D | null): ExtractedMeshPart[] {
  if (!sourceObject3D) return [];
  const parts: ExtractedMeshPart[] = [];
  sourceObject3D.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const geom = mesh.geometry;
    if (!geom?.attributes?.position) return;
    const triCount = Math.round(
      geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3
    );
    if (triCount <= 0) return;
    parts.push({
      name: mesh.name || `Peça ${parts.length + 1}`,
      geometry: geom,
      triangles: triCount,
    });
  });
  return parts;
}

