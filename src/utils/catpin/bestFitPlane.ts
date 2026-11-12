import * as THREE from 'three';

/**
 * Calcula o plano de referência ótimo a partir de um contorno 3D fechado.
 * Pelo Teorema de Stokes, a Normal de Newell maximiza a área projetada 2D
 * do contorno fechado e evita que laços estreitos girem 90° de lado.
 */
export function computeBestFitPlane(points: THREE.Vector3[]): {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
} {
  const n = points.length;
  if (n === 0) {
    return {
      origin: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      xAxis: new THREE.Vector3(1, 0, 0),
      yAxis: new THREE.Vector3(0, 1, 0),
    };
  }

  // 1. Centróide exato dos pontos
  const origin = new THREE.Vector3();
  for (const p of points) origin.add(p);
  origin.divideScalar(n);

  if (n < 3) {
    return {
      origin,
      normal: new THREE.Vector3(0, 0, 1),
      xAxis: new THREE.Vector3(1, 0, 0),
      yAxis: new THREE.Vector3(0, 1, 0),
    };
  }

  // 2. Normal de Newell exata do contorno
  const newell = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const nxt = points[(i + 1) % n];
    newell.x += (cur.y - nxt.y) * (cur.z + nxt.z);
    newell.y += (cur.z - nxt.z) * (cur.x + nxt.x);
    newell.z += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  const hasNewell = newell.lengthSq() > 1e-6;
  const newellDir = hasNewell ? newell.normalize() : new THREE.Vector3(0, 0, 1);

  // 3. Normal analítica do plano pelo Teorema de Stokes (Newell)
  const normal = newellDir.clone();

  let refAxis = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.x) > 0.85) refAxis = new THREE.Vector3(0, 1, 0);

  const xAxis = new THREE.Vector3().crossVectors(refAxis, normal).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();

  return { origin, normal, xAxis, yAxis };
}
