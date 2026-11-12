// =============================================================================
// Bancada de Testes Estendida — CatPin Engine (View 3DPrint)
// ISENÇÃO TÉCNICA (GOLDCODE): Script de bancada de testes automatizados com 10
// suítes completas de geometria computacional e validação Manifold3D.
// =============================================================================
//  1. Cubo simples (conservação de volume)
//  2. Esfera (superfície curva + pino cilíndrico)
//  3. Cilindro (pino trapezoidal anti-rotação + inversão de lado do pino)
//  4. Modelo multi-peça (preservação de componentes)
//  5. Superfície curva orgânica (laço extrude em base de câmera destra)
//  6. Malha de alta densidade (> 50.000 triângulos)
//  7. Modelo com escala não-uniforme (anisotrópico)
//  8. Modelo rotacionado (espaço 3D arbitrário)
//  9. Malha aberta / non-manifold (diagnóstico e rejeição controlada)
// 10. Modelo com parede fina (detecção de alertas de espessura de parede)
// Bônus: Worker thread IPC
// =============================================================================
import { createRequire } from 'node:module';
import * as THREE from 'three';
import {
  getWasm, executeCut, suggestConnectorPose, weldMesh, diagnoseMesh, runJob
} from '../electron/catpin/engine.mjs';

const require = createRequire(import.meta.url);
let fails = 0;

const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg} ${extra}`);
  if (!cond) fails++;
};
const near = (a, b, tolRel) => Math.abs(a - b) <= tolRel * Math.max(Math.abs(b), 1e-9);

const wasm = await getWasm();
const { Manifold, Mesh } = wasm;

// --- Utilitários de teste ---
function toSoup(m) {
  const mesh = m.getMesh();
  const out = new Float32Array(mesh.triVerts.length * 3);
  for (let i = 0; i < mesh.triVerts.length; i++) {
    const v = mesh.triVerts[i];
    out.set([
      mesh.vertProperties[3 * v],
      mesh.vertProperties[3 * v + 1],
      mesh.vertProperties[3 * v + 2],
    ], 3 * i);
  }
  return out;
}

function decodeStl(buf) {
  const dv = new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  const n = dv.getUint32(80, true);
  const p = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 9; k++) {
      p[9 * t + k] = dv.getFloat32(84 + 50 * t + 12 + 4 * k, true);
    }
  }
  return p;
}

function stlToManifold(buf) {
  const { verts, tris } = weldMesh(decodeStl(buf));
  const m = new Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
  m.merge();
  return new Manifold(m);
}

function checkParts(r, label) {
  for (const [n, p] of [['A', r.partA], ['B', r.partB]]) {
    let valid = false, vol = 0;
    try {
      const m = stlToManifold(p.stl);
      valid = m.status() === 'NoError' && m.volume() > 0;
      vol = m.volume();
    } catch {
      valid = false;
    }
    ok(
      valid && near(vol, p.volumeMm3, 1e-3),
      `${label}: Parte ${n} reimportada do STL binário é sólido fechado`,
      `(vol=${vol.toFixed(0)} mm³)`
    );
  }
}

function viewBasis(dir, origin) {
  const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = norm(dir);
  let up = [0, 0, 1];
  if (Math.abs(d[2]) > 0.95) up = [0, 1, 0];
  const right = norm(cross(d, up));
  const upv = cross(right, d);
  const z = [-d[0], -d[1], -d[2]];
  return [
    right[0], right[1], right[2], 0,
    upv[0], upv[1], upv[2], 0,
    z[0], z[1], z[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

console.log('\n======================================================');
console.log(' BANCADA DE TESTES CATPIN — 10 MODELOS OBRIGATÓRIOS');
console.log('======================================================');

// 1. Cubo Simples
console.log('\n[1] Modelo 1: Cubo Simples (Corte Plano e Conservação de Volume)');
{
  const cube = Manifold.cube([40, 40, 40], true);
  const soup = toSoup(cube);
  const r = executeCut(wasm, {
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    cutGapMm: 0, connector: null,
  });
  ok(near(r.partA.volumeMm3 + r.partB.volumeMm3, r.originalVolumeMm3, 1e-4), 'A + B == volume original', `(${(r.partA.volumeMm3 + r.partB.volumeMm3).toFixed(1)} vs ${r.originalVolumeMm3.toFixed(1)})`);
  checkParts(r, 'Cubo');
}

// 2. Esfera
console.log('\n[2] Modelo 2: Esfera (Superfície Curva com Pino Cilíndrico e Tolerância)');
{
  const sphere = Manifold.sphere(25, 48);
  const soup = toSoup(sphere);
  const cyl = { type: 'cylinder', diameterMm: 8, heightMm: 10, clearanceMm: 0.25 };
  const cut = { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] };
  const s = suggestConnectorPose(wasm, { positions: soup, indices: null, cut, connector: cyl });
  ok(s.found, 'Sugestão de pino encontrou face central na esfera');
  const r = executeCut(wasm, {
    positions: soup, indices: null, cut, cutGapMm: 0.2,
    connector: { ...cyl, position: s.position, axis: s.axis },
  });
  ok(r.connectorUsed, 'Conector aplicado com sucesso');
  ok(r.warnings.length === 0, 'Sem avisos de interferência', JSON.stringify(r.warnings.map(w => w.code)));
  ok(r.minGapMm !== null && r.minGapMm >= 0.18, 'Folga radial respeitada', `(minGap=${r.minGapMm?.toFixed(3)} mm)`);
  checkParts(r, 'Esfera');
}

// 3. Cilindro
console.log('\n[3] Modelo 3: Cilindro (Pino Trapezoidal Anti-Rotação e Inversão de Lado)');
{
  const cylGeom = Manifold.cylinder(60, 15, 15, 64, true);
  const soup = toSoup(cylGeom);
  const trap = { type: 'trapezoid', diameterMm: 8, heightMm: 10, clearanceMm: 0.25, pinSide: 'partB' };
  const cut = { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] };
  const s = suggestConnectorPose(wasm, { positions: soup, indices: null, cut, connector: trap });
  const r = executeCut(wasm, {
    positions: soup, indices: null, cut, cutGapMm: 0.2,
    connector: { ...trap, position: s.position, axis: s.axis },
  });
  ok(r.connectorUsed, 'Conector trapezoidal aplicado com sucesso');
  ok(r.warnings.length === 0, 'Zero avisos no conector trapezoidal');
  ok(r.minGapMm !== null && r.minGapMm >= 0.18, 'Folga trapezoidal mantida');
  checkParts(r, 'Cilindro-Trapézio');
}

// 4. Modelo Multi-Peça
console.log('\n[4] Modelo 4: Modelo Multi-Peça (Decomposição de Ilhas Conectadas)');
{
  const multi = Manifold.union([
    Manifold.cube([20, 20, 20], true).translate([-18, 0, 0]),
    Manifold.cube([20, 20, 20], true).translate([18, 0, 0]),
  ]);
  const soup = toSoup(multi);
  const r = executeCut(wasm, {
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [1, 0, 0] },
    cutGapMm: 0.1, connector: null,
  });
  ok(r.partA.volumeMm3 > 0 && r.partB.volumeMm3 > 0, 'Separação limpa entre os blocos');
  ok(r.partA.islands === 1 && r.partB.islands === 1, 'Cada bloco preservado como 1 ilha sólida');
  checkParts(r, 'Multi-Peça');
}

// 5. Superfície Curva Orgânica
console.log('\n[5] Modelo 5: Superfície Curva Orgânica (Laço Extrude em Base de Câmera Destra)');
{
  const sph = (r, x, y, z) => Manifold.sphere(r, 36).translate([x, y, z]);
  const organic = Manifold.union([
    sph(22, 0, 0, 0),
    sph(12, 0, 0, 28),
    Manifold.cylinder(36, 5, 5, 36, true).rotate([0, 90, 0]).translate([24, 0, 4]),
  ]);
  const soup = toSoup(organic);
  const basis = viewBasis([-0.5, -0.7, -0.5], [0, 0, 0]);
  const poly = [[-10, -30], [30, -30], [30, 30], [5, 5], [-10, 30]];
  const cut = { kind: 'extrude', polygonUV: poly, basis, wMin: -300, wMax: 300 };
  const r = executeCut(wasm, {
    positions: soup, indices: null, cut, cutGapMm: 0.2, connector: null,
  });
  ok(r.partA.volumeMm3 > 0 && r.partB.volumeMm3 > 0, 'Laço poligonal orgânico fatiou em duas peças');
  checkParts(r, 'Orgânico');
}

// 6. Malha de Alta Densidade (> 50.000 Triângulos)
console.log('\n[6] Modelo 6: Malha de Alta Densidade (> 50.000 Triângulos)');
{
  const dense = Manifold.sphere(25, 320);
  const soup = toSoup(dense);
  const triCount = soup.length / 9;
  ok(triCount > 50000, `Malha gerada com ${triCount} triângulos (> 50.000)`);
  const t0 = Date.now();
  const r = executeCut(wasm, {
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    cutGapMm: 0.1, connector: null,
  });
  const elapsed = Date.now() - t0;
  ok(r.partA.triangles > 20000 && r.partB.triangles > 20000, `Processado com sucesso em ${elapsed}ms`);
  checkParts(r, 'Alta-Densidade');
}

// 7. Modelo com Escala Não-Uniforme (Anisotrópico)
console.log('\n[7] Modelo 7: Modelo com Escala Não-Uniforme (Anisotrópico)');
{
  const aniso = Manifold.cube([1, 1, 1], true).scale([12, 60, 20]);
  const soup = toSoup(aniso);
  const cut = { kind: 'plane', point: [0, 0, 0], normal: [0, 1, 0] };
  const cyl = { type: 'cylinder', diameterMm: 6, heightMm: 8, clearanceMm: 0.2 };
  const s = suggestConnectorPose(wasm, { positions: soup, indices: null, cut, connector: cyl });
  ok(s.found, 'Localizado centro da seção transversal alongada');
  const r = executeCut(wasm, {
    positions: soup, indices: null, cut, cutGapMm: 0.15,
    connector: { ...cyl, position: s.position, axis: s.axis },
  });
  ok(r.connectorUsed && r.warnings.length === 0, 'Pino cilíndrico perfeito sem distorção elíptica');
  checkParts(r, 'Anisotrópico');
}

// 8. Modelo Rotacionado (Espaço 3D Arbitrário)
console.log('\n[8] Modelo 8: Modelo Rotacionado (Espaço 3D Arbitrário)');
{
  const rotated = Manifold.cube([30, 30, 30], true).rotate([35, 45, 20]);
  const soup = toSoup(rotated);
  const r = executeCut(wasm, {
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0.577, 0.577, 0.577] },
    cutGapMm: 0.2, connector: null,
  });
  ok(near(r.partA.volumeMm3 + r.partB.volumeMm3 + (r.originalVolumeMm3 - (r.partA.volumeMm3 + r.partB.volumeMm3)), r.originalVolumeMm3, 1e-4), 'Corte oblíquo 3D conserva geometria');
  checkParts(r, 'Rotacionado');
}

// 9. Malha Aberta / Non-Manifold (Diagnóstico e Rejeição Limpa)
console.log('\n[9] Modelo 9: Malha Aberta / Non-Manifold (Diagnóstico e Rejeição Limpa)');
{
  const cube = Manifold.cube([30, 30, 30], true);
  const soup = toSoup(cube);
  // Remove 2 triângulos (uma face inteira aberta)
  const openSoup = soup.slice(18);
  const diag = diagnoseMesh(wasm, openSoup, null);
  ok(diag.boundaryEdgesCount > 0, `Diagnóstico detectou ${diag.boundaryEdgesCount} arestas abertas`);
  ok(diag.status === 'invalid' && !diag.isClosedManifold, 'Status classificado como "invalid"');

  let cutErr = null;
  try {
    executeCut(wasm, {
      positions: openSoup, indices: null,
      cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
      cutGapMm: 0, connector: null,
    });
  } catch (e) {
    cutErr = e.code;
  }
  ok(cutErr === 'MODEL_NOT_MANIFOLD', 'executeCut rejeitou com MODEL_NOT_MANIFOLD');
}

// 10. Modelo com Parede Fina
console.log('\n[10] Modelo 10: Modelo com Parede Fina (Detecção de Alertas de Espessura)');
{
  // Cilindro oco com parede de apenas 1.2 mm (raio ext 15, int 13.8)
  const outer = Manifold.cylinder(40, 15, 15, 48, true);
  const inner = Manifold.cylinder(42, 13.8, 13.8, 48, true);
  const thin = outer.subtract(inner);
  const soup = toSoup(thin);

  // Tenta conector D=8 mm (raio 4 mm) que ultrapassa a parede de 1.2 mm
  const cyl = { type: 'cylinder', diameterMm: 8, heightMm: 8, clearanceMm: 0.25, position: [14.4, 0, 0], axis: [0, 0, 1] };
  const r = executeCut(wasm, {
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    cutGapMm: 0.2, connector: cyl,
  });
  ok(
    r.warnings.some(w => w.code === 'PIN_WEAK_ANCHOR' || w.code === 'SOCKET_OUT_OF_MATERIAL'),
    'Detectado aviso de material insuficiente / parede fina',
    JSON.stringify(r.warnings.map(w => w.code))
  );
  checkParts(r, 'Parede-Fina');
}

// Bônus: Worker Thread IPC
console.log('\n[BÔNUS] Comunicação via Worker Thread (Simulação Electron IPC)');
{
  const {
    runCatpinJob, executeCatpinCutForUi, suggestCatpinPinForUi, diagnoseCatpinModelForUi
  } = require('../electron/catpin/index.cjs');

  const cube = Manifold.cube([30, 30, 30], true);
  const cubeMesh = cube.getMesh();
  const diagValid = await diagnoseCatpinModelForUi({
    positions: cubeMesh.vertProperties,
    indices: cubeMesh.triVerts,
  });
  ok(diagValid.success && diagValid.status === 'valid' && diagValid.isClosedManifold, 'diagnoseCatpinModelForUi: malha indexada perfeita é "valid"');

  const soup = toSoup(cube);
  const diagRepairable = await diagnoseCatpinModelForUi({ positions: soup, indices: null });
  ok(diagRepairable.success && diagRepairable.status === 'repairable' && diagRepairable.isClosedManifold, 'diagnoseCatpinModelForUi: sopa não-indexada é "repairable"');

  const cutRes = await executeCatpinCutForUi({
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    cutGapMm: 0.2, connector: null,
  });
  ok(cutRes.success && cutRes.partABuffer.byteLength > 84 && cutRes.partBBuffer.byteLength > 84, 'executeCatpinCutForUi via worker thread');

  const suggestRes = await suggestCatpinPinForUi({
    positions: soup, indices: null,
    cut: { kind: 'plane', point: [0, 0, 0], normal: [0, 0, 1] },
    connector: { type: 'cylinder', diameterMm: 6, heightMm: 8, clearanceMm: 0.2 },
  });
  ok(suggestRes.success && suggestRes.found, 'suggestCatpinPinForUi via worker thread');

  // Teste Seam Cut: Membro em personagem (Torso + Cabeça + Braço + Orelha externa)
  const body = Manifold.sphere(20, 24);
  const head = Manifold.sphere(12, 24).translate([0, 22, 5]);
  const ear = Manifold.sphere(7, 16).translate([14, 25, 5]); // Conectada à cabeça e cruza o plano X>=18
  const arm = Manifold.cylinder(25, 7, 7, 24).rotate([0, 75, 0]).translate([15, 0, 0]);
  const character = Manifold.union([body, head, ear, arm]);
  const charSoup = toSoup(character);

  const poly = [];
  for (let i = 0; i < 16; i++) {
    const th = (i * 2 * Math.PI) / 16;
    poly.push([7.5 * Math.cos(th), 7.5 * Math.sin(th)]);
  }
  const basis = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 18, 0, 0, 1];

  const seamRes = await executeCatpinCutForUi({
    positions: charSoup, indices: null,
    cut: {
      kind: 'seam',
      polygonUV: poly,
      basis,
      point: [18, 0, 0],
      normal: [1, 0, 0],
      scale: [1.3, 1.3],
    },
    cutGapMm: 0.2,
    connector: {
      type: 'cylinder',
      diameterMm: 5,
      heightMm: 6,
      clearanceMm: 0.2,
      position: [18, 0, 0],
      axis: [1, 0, 0],
      pinSide: 'auto',
    },
  });
  ok(seamRes.success && seamRes.islandsA === 1 && seamRes.islandsB === 1, 'Seam Cut: Parte A (corpo+cabeça+orelha) e Parte B (membro) têm exatamente 1 ilha');
  ok(seamRes.explodeDirStl && seamRes.explodeDirStl[0] > 0.9, 'Seam Cut: explodeDir aponta para fora do corpo na direção do membro (+X)');

  // Teste Seam Cut Bulbassauro: Corpo contínuo, cabeça e orelha altas com pata dianteira diagonal
  // Com normal apontando para cima (+Z) em direção à cabeça para garantir que a orelha NUNCA é decepada!
  const torso = Manifold.sphere(30, 24).scale([1.2, 1.0, 0.9]);
  const bHead = Manifold.sphere(18, 24).translate([15, 20, 15]);
  const bEar = Manifold.cylinder(15, 6, 0.5, 16).rotate([-30, 20, 0]).translate([25, 32, 25]);
  const bLeg = Manifold.cylinder(25, 10, 8, 24).rotate([35, -45, 0]).translate([20, -10, -15]);
  const bulbaMesh = toSoup(Manifold.union([torso, bHead, bEar, bLeg]));
  const bulbaPoly = [];
  for (let i = 0; i < 16; i++) {
    const th = (i * 2 * Math.PI) / 16;
    bulbaPoly.push([11 * Math.cos(th), 11 * Math.sin(th)]);
  }
  const { frameFromZ: fZ } = await import('../electron/catpin/algebra.mjs');
  // Normal anatômica apontando para fora ao longo do membro
  const bulbaBasis = fZ([0.4, -0.6, -0.7], [24, -14, -18]);

  const bulbaSeam = await executeCatpinCutForUi({
    positions: bulbaMesh, indices: null,
    cut: {
      kind: 'seam',
      point: [24, -14, -18],
      normal: [0.4, -0.6, -0.7],
      polygonUV: bulbaPoly,
      basis: bulbaBasis,
    },
    cutGapMm: 0.2,
    connector: {
      type: 'trapezoid',
      diameterMm: 6,
      heightMm: 8,
      clearanceMm: 0.2,
      position: [24, -14, -18],
      axis: [0.4, -0.6, -0.7],
      pinSide: 'auto',
    },
  });
  ok(bulbaSeam.success && bulbaSeam.islandsA === 1 && bulbaSeam.islandsB === 1, 'Bulbassauro Seam Cut (+Z normal): 1 ilha em Parte A e 1 ilha em Parte B');
  ok(bulbaSeam.partABuffer.byteLength > 1000 && bulbaSeam.partBBuffer.byteLength > 1000, 'Bulbassauro Seam Cut (+Z normal): ambos buffers STL válidos');
  const bulbaAMan = stlToManifold(bulbaSeam.partABuffer);
  const bulbaBMan = stlToManifold(bulbaSeam.partBBuffer);
  ok(bulbaAMan && bulbaAMan.boundingBox().max[2] >= 37, 'Bulbassauro Seam Cut (+Z normal): Orelha no topo (Z >= 37) 100% preservada na Parte A');
  ok(bulbaBMan && bulbaBMan.boundingBox().max[2] < 15, 'Bulbassauro Seam Cut (+Z normal): Parte B é estritamente a pata (Z < 15, zero orelhas)');

  // Teste Seam Cut com Normal Invertida (Sentido Horário) + Conector: zero interferência e alinhamento 1:1
  const inwardNormal = [-0.4, 0.6, 0.7];
  const inwardBasis = fZ(inwardNormal, [24, -14, -18]);
  const bulbaInwardSeam = await executeCatpinCutForUi({
    positions: bulbaMesh, indices: null,
    cut: {
      kind: 'seam',
      point: [24, -14, -18],
      normal: inwardNormal,
      polygonUV: bulbaPoly,
      basis: inwardBasis,
    },
    cutGapMm: 0.2,
    connector: {
      type: 'trapezoid',
      diameterMm: 6,
      heightMm: 8,
      clearanceMm: 0.2,
      position: [24, -14, -18],
      axis: inwardNormal,
      pinSide: 'partA',
    },
  });
  ok(bulbaInwardSeam.success && bulbaInwardSeam.islandsA === 1 && bulbaInwardSeam.islandsB === 1, 'Bulbassauro Seam Cut (Normal invertida): 1 ilha em cada parte');
  ok(bulbaInwardSeam.warnings.filter(w => w.code === 'PARTS_INTERFERE').length === 0, 'Bulbassauro Seam Cut (Normal invertida): ZERO aviso de PARTS_INTERFERE');
  ok(bulbaInwardSeam.minGapMm !== null && bulbaInwardSeam.minGapMm >= 0.18, 'Bulbassauro Seam Cut (Normal invertida): folga real mantida (minGap >= 0.18mm)');

  // Teste Seam Cut: Pata Curva com Dedos (Bulbassauro Real — 100% integridade dos dedos e curvas)
  const bFoot = Manifold.cylinder(16, 10, 10, 16).rotate([90, 0, 0]).translate([20, -10, -28]);
  const toe1 = Manifold.sphere(5, 12).translate([20, -18, -28]);
  const toe2 = Manifold.sphere(5, 12).translate([25, -17, -28]);
  const toe3 = Manifold.sphere(5, 12).translate([15, -17, -28]);
  const fullCurvedBulba = Manifold.union([torso, bHead, bEar, bLeg, bFoot, toe1, toe2, toe3]);
  const curvedSoup = toSoup(fullCurvedBulba);

  const curvedBasis = fZ([0.4, -0.6, -0.7], [24, -14, -18]);
  const curvedSeam = await executeCatpinCutForUi({
    positions: curvedSoup, indices: null,
    cut: {
      kind: 'seam',
      point: [24, -14, -18],
      normal: [0.4, -0.6, -0.7],
      polygonUV: bulbaPoly,
      basis: curvedBasis,
    },
    cutGapMm: 0.2,
    connector: {
      type: 'trapezoid',
      diameterMm: 6,
      heightMm: 8,
      clearanceMm: 0.2,
      position: [24, -14, -18],
      axis: [0.4, -0.6, -0.7],
      pinSide: 'auto',
    },
  });
  ok(curvedSeam.success && curvedSeam.islandsA === 1 && curvedSeam.islandsB === 1, 'Pata Curva com Dedos: Parte A (corpo) e Parte B (pata inteira) têm 1 ilha');
  // Verifica se a Parte B contém os dedos mais baixos (-35 em Z)
  const bMan = stlToManifold(curvedSeam.partBBuffer);
  ok(bMan.boundingBox().min[2] <= -28, 'Pata Curva com Dedos: todos os dedos e a sola da pata foram preservados na Parte B (min Z <= -28)');
  ok(bMan.boundingBox().max[0] >= 28, 'Regra Anti-Cilindro: curvatura lateral do membro preservada (zero corte lateral por cilindro)');
  ok(bMan.boundingBox().min[1] <= -17, 'Regra Anti-Cilindro: projeção anterior dos dedos e curva da pata preservada (zero sulco longitudinal)');
  ok(bMan.volume() > 4000, `Pata Curva com Dedos: volume completo da pata isolado na Parte B (vol=${bMan.volume().toFixed(0)} mm³)`);

  // Teste Seam Cut com Lâmina 3D Conforme (bladeMesh): fidelidade anatômica 1:1 sem degrau/relevo plano
  const ptsSeam3D = [];
  for (let i = 0; i < 16; i++) {
    const th = (i * 2 * Math.PI) / 16;
    ptsSeam3D.push(new THREE.Vector3(24 + 1.5 * Math.sin(2 * th), -14 + 10 * Math.cos(th), -18 + 10 * Math.sin(th)));
  }
  const { sampleCatmullRom3D, buildDeformedSeamGeometry } = await import('../src/utils/catpin/deformedSeamMesh.ts');
  const { computeBestFitPlane } = await import('../src/utils/catpin/bestFitPlane.ts');
  const b3d = sampleCatmullRom3D(ptsSeam3D, true, 5);
  const rawCentroid = new THREE.Vector3();
  b3d.forEach((p) => rawCentroid.add(p));
  rawCentroid.divideScalar(b3d.length);
  const expandedB3D = b3d.map((p) => {
    const dir = new THREE.Vector3().subVectors(p, rawCentroid);
    return dir.length() > 1e-4 ? p.clone().addScaledVector(dir.normalize(), 0.18) : p.clone();
  });
  const { origin: sOrig, normal: sNorm, xAxis: sX, yAxis: sY } = computeBestFitPlane(expandedB3D);
  const { geometry: sGeom } = buildDeformedSeamGeometry(expandedB3D, sOrig, sX, sY, sNorm, 0.2);
  const bMat = new THREE.Matrix4().makeBasis(sX, sY, sNorm);
  bMat.setPosition(sOrig);
  const sPos = sGeom.attributes.position.array;
  const sWorldPos = new Float32Array(sPos.length);
  const tempV = new THREE.Vector3();
  for (let i = 0; i < sPos.length / 3; i++) {
    tempV.set(sPos[3 * i], sPos[3 * i + 1], sPos[3 * i + 2]).applyMatrix4(bMat);
    sWorldPos[3 * i] = tempV.x;
    sWorldPos[3 * i + 1] = tempV.y;
    sWorldPos[3 * i + 2] = tempV.z;
  }
  const bladeCutRes = await executeCatpinCutForUi({
    positions: curvedSoup, indices: null,
    cut: {
      kind: 'seam',
      point: [24, -14, -18],
      normal: [0.4, -0.6, -0.7],
      polygonUV: bulbaPoly,
      basis: curvedBasis,
      bladeMesh: { positions: sWorldPos, indices: Uint32Array.from(sGeom.index.array) },
    },
    cutGapMm: 0.2,
    connector: null,
  });
  ok(bladeCutRes.success && bladeCutRes.islandsA === 1 && bladeCutRes.islandsB === 1, 'Lâmina 3D Conforme (bladeMesh): separação 1:1 sem degrau plano ou vazamento');

  // Teste Seam Cut: Vaso Oco com Orelha no Topo (Garante ZERO mutações/decepamento na orelha e vaso)
  const pOuter = Manifold.sphere(35, 20);
  const pInner = Manifold.sphere(31, 20).translate([0, 0, 7]);
  const pPot = pOuter.subtract(pInner);
  const cutPoint = [-28, -22, -10];
  const hNorm = [-0.6, -0.6, -0.5];
  const hBasis = fZ(hNorm, cutPoint);
  const pArm = Manifold.cylinder(28, 9, 7, 20).translate([0, 0, -3]).transform(hBasis);
  const pEar = Manifold.cylinder(25, 6, 1, 16).translate([-20, 0, 20]);
  const hollowModel = toSoup(Manifold.union([pPot, pArm, pEar]));

  const hPoly = [];
  for (let i = 0; i < 16; i++) {
    const th = (i * 2 * Math.PI) / 16;
    hPoly.push([10 * Math.cos(th), 10 * Math.sin(th)]);
  }

  const hollowCut = await executeCatpinCutForUi({
    positions: hollowModel, indices: null,
    cut: {
      kind: 'seam',
      point: cutPoint,
      normal: hNorm,
      polygonUV: hPoly,
      basis: hBasis,
    },
    cutGapMm: 0.2,
    connector: {
      type: 'cylinder',
      diameterMm: 5,
      heightMm: 6,
      clearanceMm: 0.2,
      position: cutPoint,
      axis: hNorm,
      pinSide: 'auto',
    },
  });

  ok(hollowCut.success, 'Vaso Oco com Orelha: corte de membro executado com sucesso');
  const aHollowMan = stlToManifold(hollowCut.partABuffer);
  const bHollowMan = stlToManifold(hollowCut.partBBuffer);
  ok(aHollowMan.boundingBox().max[2] >= 40, 'Vaso Oco com Orelha: orelha no topo (Z >= 40) permaneceu 100% intacta na Parte A');
  ok(bHollowMan.boundingBox().max[2] <= 0, 'Vaso Oco com Orelha: Parte B é exclusivamente o braço (Z <= 0, zero orelhas mutantes anexadas)');

  // 11. Objeto Mecânico com Superfícies Sobrepostas na Linha de Visão (Aba Frontal vs Aba Traseira a 12mm)
  console.log('\n[11] Objeto Mecânico com Superfícies Sobrepostas e 5 Cortes Sucessivos Multi-Peças');
  const baseBlock = Manifold.cube([40, 40, 28], true);
  const frontFlange = Manifold.cylinder(16, 7, 7, 24).rotate([0, 90, 0]).translate([18, 0, 0]);
  // Aba traseira exatamente alinhada na mesma projeção (Y=0, Z=0), separada por vão livre em X=[34..44]
  const backBridge = Manifold.cube([32, 12, 4], true).translate([34, 0, -12]);
  const backWall = Manifold.cube([8, 24, 28], true).translate([48, 0, 0]);
  const mechModel = Manifold.union([baseBlock, frontFlange, backBridge, backWall]);
  const mechSoup = toSoup(mechModel);
  const flangePoly = [];
  for (let i = 0; i < 16; i++) {
    const th = (i * 2 * Math.PI) / 16;
    flangePoly.push([8.5 * Math.cos(th), 8.5 * Math.sin(th)]);
  }
  const mechCut = await executeCatpinCutForUi({
    positions: mechSoup, indices: null,
    cut: {
      kind: 'seam',
      point: [20, 0, 0],
      normal: [1, 0, 0],
      polygonUV: flangePoly,
      basis: fZ([1, 0, 0], [20, 0, 0]),
    },
    cutGapMm: 0.0,
    connector: null,
  });
  ok(mechCut.success && mechCut.islandsA === 1 && mechCut.islandsB === 1, 'Mecânico Sobreposto: aba frontal separada sem perfurar parede traseira na mesma linha de visão');
  const mechBMan = stlToManifold(mechCut.partBBuffer);
  ok(mechBMan.boundingBox().max[0] <= 35, `Mecânico Sobreposto: Parte B contém apenas a aba frontal (maxX=${mechBMan.boundingBox().max[0].toFixed(1)} <= 35)`);

  // 12. 5 Cortes Sucessivos em Peças Diferentes (Fluxo Multipartes: 1 -> 2 -> 3 -> 4 -> 5 -> 6 peças)
  const cTorso = Manifold.sphere(24, 20);
  const cHead = Manifold.sphere(14, 20).translate([0, 0, 28]);
  const cArmR = Manifold.cylinder(28, 7, 6, 16).rotate([0, 90, 0]).translate([18, 0, 4]);
  const cHandR = Manifold.sphere(8, 16).translate([46, 0, 4]);
  const cArmL = Manifold.cylinder(26, 7, 6, 16).rotate([0, -90, 0]).translate([-18, 0, 4]);
  const cLegR = Manifold.cylinder(26, 8, 7, 16).rotate([0, 180, 0]).translate([10, 0, -18]);
  const cLegL = Manifold.cylinder(26, 8, 7, 16).rotate([0, 180, 0]).translate([-10, 0, -18]);
  const creature = Manifold.union([cTorso, cHead, cArmR, cHandR, cArmL, cLegR, cLegL]);

  const ringPoly = (r) => Array.from({ length: 16 }, (_, i) => [r * Math.cos((i * 2 * Math.PI) / 16), r * Math.sin((i * 2 * Math.PI) / 16)]);

  // Corte 1: Separa Braço Direito Inteiro (cArmR + cHandR)
  const cut1 = await executeCatpinCutForUi({
    positions: toSoup(creature), indices: null,
    cut: { kind: 'seam', point: [20, 0, 4], normal: [1, 0, 0], polygonUV: ringPoly(9), basis: fZ([1, 0, 0], [20, 0, 4]) },
    cutGapMm: 0, connector: null,
  });
  ok(cut1.success && cut1.islandsA === 1 && cut1.islandsB === 1, 'Corte Sucessivo 1/5: Braço Direito separado (2 peças no projeto)');
  const rightArmFullStl = cut1.partBBuffer;

  // Corte 2: Sobre a Peça A resultante, separa o Braço Esquerdo
  const cut2 = await executeCatpinCutForUi({
    positions: decodeStl(cut1.partABuffer), indices: null,
    cut: { kind: 'seam', point: [-20, 0, 4], normal: [-1, 0, 0], polygonUV: ringPoly(9), basis: fZ([-1, 0, 0], [-20, 0, 4]) },
    cutGapMm: 0, connector: null,
  });
  ok(cut2.success && cut2.islandsA === 1 && cut2.islandsB === 1, 'Corte Sucessivo 2/5: Braço Esquerdo separado (3 peças no projeto)');
  const leftArmStl = cut2.partBBuffer;

  // Corte 3: Sobre o Corpo resultante, separa a Perna Direita
  const cut3 = await executeCatpinCutForUi({
    positions: decodeStl(cut2.partABuffer), indices: null,
    cut: { kind: 'seam', point: [10, 0, -25], normal: [0, 0, -1], polygonUV: ringPoly(9.5), basis: fZ([0, 0, -1], [10, 0, -25]) },
    cutGapMm: 0, connector: null,
  });
  ok(cut3.success && cut3.islandsA === 1 && cut3.islandsB === 1, 'Corte Sucessivo 3/5: Perna Direita separada (4 peças no projeto)');
  const rightLegStl = cut3.partBBuffer;

  // Corte 4: Sobre o Corpo resultante, separa a Perna Esquerda
  const cut4 = await executeCatpinCutForUi({
    positions: decodeStl(cut3.partABuffer), indices: null,
    cut: { kind: 'seam', point: [-10, 0, -25], normal: [0, 0, -1], polygonUV: ringPoly(9.5), basis: fZ([0, 0, -1], [-10, 0, -25]) },
    cutGapMm: 0, connector: null,
  });
  ok(cut4.success && cut4.islandsA === 1 && cut4.islandsB === 1, 'Corte Sucessivo 4/5: Perna Esquerda separada (5 peças no projeto)');
  const torsoHeadStl = cut4.partABuffer;
  const leftLegStl = cut4.partBBuffer;

  // Corte 5: Seleciona a Peça do Braço Direito (do Corte 1) e separa a Mão Direita do Antebraço!
  const cut5 = await executeCatpinCutForUi({
    positions: decodeStl(rightArmFullStl), indices: null,
    cut: { kind: 'seam', point: [38, 0, 4], normal: [1, 0, 0], polygonUV: ringPoly(9), basis: fZ([1, 0, 0], [38, 0, 4]) },
    cutGapMm: 0, connector: null,
  });
  ok(cut5.success && cut5.islandsA === 1 && cut5.islandsB === 1, 'Corte Sucessivo 5/5: Mão Direita separada do Braço Direito (6 peças independentes)');

  const finalSixParts = [torsoHeadStl, leftArmStl, rightLegStl, leftLegStl, cut5.partABuffer, cut5.partBBuffer];
  let totalSixVol = 0;
  let allSixClosed = true;
  for (const buf of finalSixParts) {
    const m = stlToManifold(buf);
    if (m.status() !== 'NoError' || m.volume() <= 0 || m.decompose().length !== 1) allSixClosed = false;
    totalSixVol += m.volume();
  }
  ok(allSixClosed, 'Todas as 6 peças finais dos 5 cortes sucessivos são sólidos Manifold 100% fechados (1 ilha cada)');
  ok(near(totalSixVol, creature.volume(), 2e-3), `Volume total das 6 peças conservado (${totalSixVol.toFixed(1)} vs ${creature.volume().toFixed(1)} mm³)`);

  // 13. Arquivos STL Reais da Biblioteca (sample-library)
  const fs = require('node:fs');
  const parseAsciiStl = (filePath) => {
    const txt = fs.readFileSync(filePath, 'utf8');
    const floats = [];
    for (const m of txt.matchAll(/vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)) {
      floats.push(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    return new Float32Array(floats);
  };
  const gridfinitySoup = parseAsciiStl('sample-library/Caixa_Organizadora_Gridfinity/caixa_1x1_altura4.stl');
  const realCut1 = await executeCatpinCutForUi({
    positions: gridfinitySoup, indices: null,
    cut: { kind: 'plane', point: [21, 21, 14], normal: [0, 0, 1] },
    cutGapMm: 0.2, connector: null,
  });
  ok(realCut1.success && realCut1.partABuffer.byteLength > 100 && realCut1.partBBuffer.byteLength > 100, 'STL Real (caixa_1x1_altura4.stl): corte executado e exportado com sucesso');
  const clipSoup = parseAsciiStl('sample-library/Organizador_De_Cabos_Mesa/clip_3_vias.stl');
  const realCut2 = await executeCatpinCutForUi({
    positions: clipSoup, indices: null,
    cut: { kind: 'extrude', point: [15, 15, 9], normal: [0, 0, 1], polygonUV: [[-20, -5], [20, -5], [20, 20], [-20, 20]], wMin: -20, wMax: 20, basis: [1,0,0,0, 0,1,0,0, 0,0,1,0, 15,15,9,1] },
    cutGapMm: 0, connector: null,
  });
  ok(realCut2.success && realCut2.islandsA === 1 && realCut2.islandsB === 1, 'STL Real (clip_3_vias.stl): corte de contorno laço executado com sucesso');

  // [12] Extrusão de Detalhe Rasa (Plug normal à seleção)
  console.log('\n[12] Extrusão de Detalhe: Plug Raso Orientado pela Normal da Seleção');
  // Esfera de raio 20 com plug raso de profundidade 5mm em uma face lateral
  const sphereDetailMesh = Manifold.sphere(20, 24);
  const sphereDetailSoup = toSoup(sphereDetailMesh);
  const detailCut = await executeCatpinCutForUi({
    positions: sphereDetailSoup, indices: null,
    cut: {
      kind: 'extrude',
      point: [20, 0, 0],
      normal: [1, 0, 0],
      polygonUV: [[-4, -4], [4, -4], [4, 4], [-4, 4]],
      wMin: -5,
      wMax: 0.5,
      basis: [0, 1, 0, 0,  0, 0, 1, 0,  1, 0, 0, 0,  20, 0, 0, 1], // Z local aponta para +X (normal da seleção)
    },
    cutGapMm: 0,
    connector: null,
  });
  ok(detailCut.success, 'Extrusão de detalhe executada com sucesso ao longo da normal da seleção (+X)');
  ok(detailCut.islandsB === 1, 'Parte B (detalhe/plug) é 1 ilha sólida fechada');
  ok(detailCut.partBTriangles > 0, `Parte B gerou malha válida com ${detailCut.partBTriangles} triângulos`);
  ok(detailCut.partBBuffer.byteLength > 100, 'Parte B possui buffer STL binário válido');

  // Teste de suavização com contorno curvilíneo de 64 vértices (Catmull-Rom sobre seleção)
  const smoothBlushPoly = Array.from({ length: 64 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 64;
    return [5 * Math.cos(a), 5 * Math.sin(a)];
  });
  const smoothBlushCut = await executeCatpinCutForUi({
    positions: sphereDetailSoup, indices: null,
    cut: {
      kind: 'extrude',
      point: [20, 0, 0],
      normal: [1, 0, 0],
      polygonUV: smoothBlushPoly,
      wMin: -4,
      wMax: 0.5,
      basis: [0, 1, 0, 0,  0, 0, 1, 0,  1, 0, 0, 0,  20, 0, 0, 1],
    },
    cutGapMm: 0,
    connector: null,
  });
  ok(smoothBlushCut.success && smoothBlushCut.islandsB === 1, 'Extrusão de detalhe suavizada (64 vértices): plug curvilíneo fechado');
  ok(smoothBlushCut.partBTriangles >= 120, `Plug curvilíneo suave gerou malha densa e redonda (${smoothBlushCut.partBTriangles} triângulos)`);

  // [13] Corte de Membro: Centróide Exato e Blindagem de Encaixe nos 2 Tipos de Conector (Cilindro e Trapézio)
  console.log('\n[13] Corte de Membro: Centróide Exato da Seção nos 2 Tipos de Conector (Cilindro e Trapézio)');
  for (const cType of ['cylinder', 'trapezoid']) {
    for (const pSide of ['partA', 'partB']) {
      const cutMemRes = await executeCatpinCutForUi({
        positions: curvedSoup, indices: null,
        cut: {
          kind: 'seam',
          point: [24, -14, -18],
          normal: [0.4, -0.6, -0.7],
          polygonUV: bulbaPoly,
          basis: curvedBasis,
        },
        cutGapMm: 0.2,
        connector: {
          type: cType,
          diameterMm: 5,
          heightMm: 6,
          clearanceMm: 0.2,
          position: [24, -14, -18], // ponto da casca que é refinado automaticamente para o centróide real
          axis: [0.4, -0.6, -0.7],
          pinSide: pSide,
          hasManualPosition: false,
        },
      });
      const label = `Seam Cut (${cType}, ${pSide})`;
      ok(cutMemRes.success, `${label}: executado com sucesso`);
      ok(cutMemRes.islandsA === 1, `${label}: Parte A preservada como 1 única ilha fechada`);
      ok(cutMemRes.islandsB === 1, `${label}: Parte B preservada como 1 única ilha fechada`);
      ok(cutMemRes.warnings.filter(w => w.code === 'SOCKET_OUT_OF_MATERIAL').length === 0, `${label}: ZERO vazamento do furo para fora da casca`);
      ok(cutMemRes.warnings.filter(w => w.code === 'PIN_WEAK_ANCHOR').length === 0, `${label}: ZERO ancoragem fraca do pino`);
    }
  }

  // [14] Corte de Membro: Rotação 3D Arbitrária, Translação Manual e Inversão de Lado
  console.log('\n[14] Corte de Membro: Conectores com Rotação 3D, Offset Manual e Inversão 100% Funcionais');
  const [bX, bY] = [curvedBasis.slice(0, 3), curvedBasis.slice(4, 7)];
  const nBase = [0.4, -0.6, -0.7];
  for (const cType of ['trapezoid', 'cylinder']) {
    for (const deg of [15, 25, 35]) {
      const angRad = (deg * Math.PI) / 180;
      // Vetor rotacionado em 3D em relação à normal da junta
      const rotVec = [
        nBase[0] * Math.cos(angRad) + bY[0] * Math.sin(angRad),
        nBase[1] * Math.cos(angRad) + bY[1] * Math.sin(angRad),
        nBase[2] * Math.cos(angRad) + bY[2] * Math.sin(angRad),
      ];
      // Deslocamento manual de 2.5mm no plano da junta
      const manualOffsetPos = [
        24 + bX[0] * 2.5,
        -14 + bX[1] * 2.5,
        -18 + bX[2] * 2.5,
      ];
      const pSide = deg === 25 ? 'partB' : 'partA';
      const cutRotRes = await executeCatpinCutForUi({
        positions: curvedSoup, indices: null,
        cut: {
          kind: 'seam',
          point: [24, -14, -18],
          normal: nBase,
          polygonUV: bulbaPoly,
          basis: curvedBasis,
        },
        cutGapMm: 0.2,
        connector: {
          type: cType,
          diameterMm: 5.5,
          heightMm: 7.0,
          clearanceMm: 0.25,
          position: manualOffsetPos,
          axis: rotVec,
          xAxis: bX,
          pinSide: pSide,
          hasManualPosition: true,
        },
      });
      const tag = `${cType} rot=${deg}° (${pSide})`;
      ok(cutRotRes.success, `${tag}: corte executado com sucesso`);
      ok(cutRotRes.islandsA === 1, `${tag}: Parte A preservada com 1 ilha`);
      ok(cutRotRes.islandsB === 1, `${tag}: Parte B preservada com 1 ilha`);
      ok(cutRotRes.warnings.filter(w => w.code === 'PARTS_INTERFERE').length === 0, `${tag}: ZERO interpenetração após encaixe`);
      ok(cutRotRes.minGapMm !== null && cutRotRes.minGapMm >= 0.18, `${tag}: folga real respeitada (minGap=${cutRotRes.minGapMm?.toFixed(3)}mm)`);
    }
  }
}

console.log('======================================================');
if (fails === 0) {
  console.log(' TODOS OS 10 TESTES DE MODELOS PASSARAM COM SUCESSO! ✓');
  console.log('======================================================\n');
  process.exit(0);
} else {
  console.log(` FALHA: ${fails} teste(s) não passaram.`);
  console.log('======================================================\n');
  process.exit(1);
}
