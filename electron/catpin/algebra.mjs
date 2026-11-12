// =============================================================================
// CatPin Engine — Módulo de Álgebra Vetorial e Matricial 3D/4D
// Puro Node/ESM: sem DOM, sem Three.js.
// Matrizes em ordem coluna-maior compatíveis com Manifold.transform.
// =============================================================================

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 1] : mul(a, 1 / l);
};

// Matriz 4x4 em ordem COLUNA-MAIOR
export const mat4 = (x, y, z, o) => [
  x[0], x[1], x[2], 0,
  y[0], y[1], y[2], 0,
  z[0], z[1], z[2], 0,
  o[0], o[1], o[2], 1,
];

export const applyPoint = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

export const applyDir = (m, d) => [
  m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
  m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
  m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
];

// Inversa de matriz rígida (rotação + translação com colunas ortonormais)
export function invRigid(m) {
  const x = [m[0], m[1], m[2]];
  const y = [m[4], m[5], m[6]];
  const z = [m[8], m[9], m[10]];
  const o = [m[12], m[13], m[14]];
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, o), -dot(y, o), -dot(z, o), 1,
  ];
}

export function perpendicularPair(z) {
  const h = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = norm(cross(h, z));
  const y = cross(z, x);
  return [x, y];
}

// Cria quadro destro cujo eixo +Z é `axis` e a origem é `origin`
export function frameFromZ(axis, origin) {
  const z = norm(axis);
  const [x, y] = perpendicularPair(z);
  return mat4(x, y, z, origin);
}

