import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as THREE from 'three';

import { parse3mfBufferToParts, parse3mfBufferToObject3D } from '../src/utils/threeMfParser.ts';
import { encodeGeometryToBinaryStl } from '../src/utils/geometryStlEncoder.ts';
import { extractAllMeshParts } from '../src/utils/catpin/rootGeometryExtractor.ts';
import { getWasm, executeCut, suggestConnectorPose } from '../electron/catpin/engine.mjs';

const require = createRequire(import.meta.url);
const { createZipBuffer } = require('../electron/zipWriter.cjs');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

function boxMeshXml(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  return `<mesh>
    <vertices>
      <vertex x="${-hx}" y="${-hy}" z="${-hz}"/>
      <vertex x="${hx}" y="${-hy}" z="${-hz}"/>
      <vertex x="${hx}" y="${hy}" z="${-hz}"/>
      <vertex x="${-hx}" y="${hy}" z="${-hz}"/>
      <vertex x="${-hx}" y="${-hy}" z="${hz}"/>
      <vertex x="${hx}" y="${-hy}" z="${hz}"/>
      <vertex x="${hx}" y="${hy}" z="${hz}"/>
      <vertex x="${-hx}" y="${hy}" z="${hz}"/>
    </vertices>
    <triangles>
      <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/>
      <triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>
      <triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/>
      <triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/>
      <triangle v1="0" v2="4" v3="7"/><triangle v1="0" v2="7" v3="3"/>
      <triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>
    </triangles>
  </mesh>`;
}

function signedVolume(positions, indices) {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

function measurePositions(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  return { sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ, minX, maxX, minY, maxY, minZ, maxZ };
}

console.log('======================================================');
console.log(' BANCADA DE TESTES: PARSER 3MF (CORE + PRODUCTION) + CATPIN');
console.log('======================================================\n');

// [1] 3MF Core Simples
console.log('[1] Teste: 3MF Core simples (3D/3dmodel.model)');
const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model" name="CuboCore">${boxMeshXml(20, 30, 40)}</object></resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/></build>
</model>`;
const coreBuf = createZipBuffer([
  { path: '[Content_Types].xml', content: CONTENT_TYPES },
  { path: '_rels/.rels', content: ROOT_RELS },
  { path: '3D/3dmodel.model', content: coreXml },
]);
const coreParts = parse3mfBufferToParts(coreBuf);
assert.equal(coreParts.length, 1);
assert.equal(coreParts[0].name, 'CuboCore');
assert.equal(coreParts[0].indices.length, 36);
const coreBox = measurePositions(coreParts[0].positions);
assert.ok(Math.abs(coreBox.sx - 20) < 1e-4 && Math.abs(coreBox.sy - 30) < 1e-4 && Math.abs(coreBox.sz - 40) < 1e-4);
assert.ok(Math.abs(coreBox.minX - 0) < 1e-4 && Math.abs(coreBox.minY - 5) < 1e-4 && Math.abs(coreBox.minZ - 10) < 1e-4);
console.log('  PASS  3MF Core lido com transform aplicada e dimensões exatas (20x30x40mm)');

// [2] 3MF Production Extension (p:path -> 3D/Objects/object_1.model) - Padrão Bambu/Creality/Orca
console.log('[2] Teste: 3MF Production Extension com p:path (Bambu/Creality/Orca)');
const prodObjectXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources><object id="1" type="model" name="Personagem">${boxMeshXml(40, 24, 60)}</object></resources>
  <build/>
</model>`;
const prodRootXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="2" type="model">
      <components>
        <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
      </components>
    </object>
  </resources>
  <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 110 110 30" printable="1"/></build>
</model>`;
const prodBuf = createZipBuffer([
  { path: '[Content_Types].xml', content: CONTENT_TYPES },
  { path: '_rels/.rels', content: ROOT_RELS },
  { path: '3D/3dmodel.model', content: prodRootXml },
  { path: '3D/Objects/object_1.model', content: prodObjectXml },
]);
const prodParts = parse3mfBufferToParts(prodBuf);
assert.equal(prodParts.length, 1);
assert.equal(prodParts[0].name, 'Personagem');
const prodVol = signedVolume(prodParts[0].positions, prodParts[0].indices);
assert.ok(Math.abs(prodVol - 40 * 24 * 60) < 1e-2, `Volume esperado 57600, obtido ${prodVol}`);
console.log(`  PASS  3MF Production Extension (p:path) resolvido sem erro (volume=${prodVol.toFixed(1)}mm³)`);

// [3] 3MF Espelhado (determinante negativo) + Unidade em polegadas (inch -> mm)
console.log('[3] Teste: 3MF espelhado (det < 0) + unidade inch + filtro de suporte');
const mirrorXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model" name="PecaEspelhada">${boxMeshXml(1, 2, 1)}</object>
    <object id="2" type="support" name="BlocoSuporte">${boxMeshXml(5, 5, 5)}</object>
  </resources>
  <build>
    <item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  </build>
</model>`;
const mirrorBuf = createZipBuffer([
  { path: '[Content_Types].xml', content: CONTENT_TYPES },
  { path: '_rels/.rels', content: ROOT_RELS },
  { path: '3D/3dmodel.model', content: mirrorXml },
]);
const mirrorParts = parse3mfBufferToParts(mirrorBuf);
assert.equal(mirrorParts.length, 1, 'Objeto type=support deve ser filtrado');
const mirrorBox = measurePositions(mirrorParts[0].positions);
assert.ok(Math.abs(mirrorBox.sx - 25.4) < 1e-3 && Math.abs(mirrorBox.sy - 50.8) < 1e-3);
const mirrorVol = signedVolume(mirrorParts[0].positions, mirrorParts[0].indices);
assert.ok(mirrorVol > 0, `Volume assinado deve permanecer positivo após espelhamento, obtido ${mirrorVol}`);
console.log(`  PASS  Unidade inch->mm (${mirrorBox.sx.toFixed(1)}x${mirrorBox.sy.toFixed(1)}mm), winding invertido OK (vol=${mirrorVol.toFixed(1)}mm³) e suporte filtrado`);

// [4] 3MF Multi-Peças + extractAllMeshParts + encodeGeometryToBinaryStl (Plano B)
console.log('[4] Teste: 3MF Multi-Peças + extração para CatPin + encoder STL binário');
const multiXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model" name="Corpo">${boxMeshXml(30, 30, 50)}</object>
    <object id="2" type="model" name="Cabeca">${boxMeshXml(18, 18, 18)}</object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 25"/>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 59"/>
  </build>
</model>`;
const multiBuf = createZipBuffer([
  { path: '[Content_Types].xml', content: CONTENT_TYPES },
  { path: '_rels/.rels', content: ROOT_RELS },
  { path: '3D/3dmodel.model', content: multiXml },
]);
const multiObj = parse3mfBufferToObject3D(multiBuf);
const extracted = extractAllMeshParts(multiObj);
assert.equal(extracted.length, 2);
assert.equal(extracted[0].name, 'Corpo');
assert.equal(extracted[1].name, 'Cabeca');
for (const part of extracted) {
  const stlBuf = encodeGeometryToBinaryStl(part.geometry);
  assert.equal(stlBuf.byteLength, 84 + part.triangles * 50);
  const view = new DataView(stlBuf);
  assert.equal(view.getUint32(80, true), part.triangles);
}
console.log('  PASS  Multi-peças extraídas (Corpo + Cabeca) com buffers STL binários válidos');

// [5] Integração Ponta-a-Ponta: Corte Real + Conector no Motor CatPin a partir do 3MF Production Extension
console.log('[5] Teste: Corte CSG + Conector no motor CatPin a partir de 3MF Production Extension');
const wasm = await getWasm();
const cutSpec = { kind: 'plane', point: [110, 110, 30], normal: [0, 0, 1] };
const cylSpec = { type: 'cylinder', diameterMm: 6, heightMm: 7, clearanceMm: 0.25 };
const suggested = suggestConnectorPose(wasm, {
  positions: prodParts[0].positions,
  indices: prodParts[0].indices,
  cut: cutSpec,
  connector: cylSpec,
});
const cutResult = executeCut(wasm, {
  positions: prodParts[0].positions,
  indices: prodParts[0].indices,
  cut: cutSpec,
  cutGapMm: 0.2,
  connector: { ...cylSpec, point: suggested.point, axis: suggested.axis, pinSide: 'partA' },
});
assert.ok(cutResult.partA && cutResult.partA.stl.byteLength > 84, 'Part A STL válido');
assert.ok(cutResult.partB && cutResult.partB.stl.byteLength > 84, 'Part B STL válido');
assert.ok(cutResult.partA.triangles > 0 && cutResult.partB.triangles > 0);
console.log(`  PASS  Corte + conector em 3MF Production Extension OK (Parte A: ${cutResult.partA.triangles} tri, Parte B: ${cutResult.partB.triangles} tri)`);

console.log('\n======================================================');
console.log(' TODOS OS TESTES DE 3MF + CATPIN PASSARAM COM SUCESSO! ✓');
console.log('======================================================');
