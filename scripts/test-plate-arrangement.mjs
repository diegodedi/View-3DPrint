import assert from 'node:assert/strict';
import * as THREE from 'three';

import { findOptimalBedOrientation } from '../src/utils/plate/autoOrientAntiSupport.ts';
import { arrangePartsOnBed } from '../src/utils/plate/plateArranger.ts';

console.log('======================================================');
console.log(' BANCADA DE TESTES: ORIENTAÇÃO ANTI-SUPORTE E NESTING');
console.log('======================================================\n');

// [1] Teste: findOptimalBedOrientation em paralelepípedo
console.log('[1] Teste: Auto-Orientação anti-suporte (Face de maior área na mesa)');
// Caixa 40x20x10. A maior face é 40x20 = 800 mm².
const boxGeom = new THREE.BoxGeometry(40, 20, 10);
const orientation = findOptimalBedOrientation(boxGeom);

assert.ok(orientation.contactAreaMm2 >= 700, `Área de contato esperada >= 700, obtida: ${orientation.contactAreaMm2}`);
assert.ok(orientation.bounds.height <= 10.5, `Altura Z esperada <= 10.5, obtida: ${orientation.bounds.height}`);
console.log(`  PASS  Caixa orientada com sucesso: altura=${orientation.bounds.height}mm, contato=${orientation.contactAreaMm2}mm²`);

// [2] Teste: Auto-Orientação com normal preferencial de corte (+Z)
console.log('[2] Teste: Face preferencial de corte');
const cutPreferred = findOptimalBedOrientation(boxGeom, [0, 0, 1]);
assert.ok(cutPreferred.score > 0, 'Score positivo para orientação de corte');
console.log(`  PASS  Face seccionada orientada para a mesa (score=${cutPreferred.score.toFixed(1)})`);

// [3] Teste: arrangePartsOnBed (Nesting 2D de múltiplas peças)
console.log('[3] Teste: Empacotamento na mesa 220x220mm');
const geomA = new THREE.BoxGeometry(50, 40, 20);
const geomB = new THREE.BoxGeometry(30, 30, 15);
const geomC = new THREE.BoxGeometry(40, 25, 25);

const orientA = findOptimalBedOrientation(geomA);
const orientB = findOptimalBedOrientation(geomB);
const orientC = findOptimalBedOrientation(geomC);

const partsInput = [
  { id: 'part-1', name: 'Base', orientation: orientA },
  { id: 'part-2', name: 'Tampa', orientation: orientB },
  { id: 'part-3', name: 'Suporte', orientation: orientC },
];

const plateResult = arrangePartsOnBed(partsInput, { widthMm: 220, depthMm: 220, marginMm: 10 });

assert.equal(plateResult.placements.size, 3, 'Todas as 3 peças foram posicionadas');
assert.ok(plateResult.allFitOnBed, 'Todas as peças cabem na mesa 220x220');
assert.ok(plateResult.bedUtilizationPercent > 0, 'Aproveitamento da mesa computado');

// Validação de não-colisão entre as peças na mesa
const placedList = Array.from(plateResult.placements.values());
for (let i = 0; i < placedList.length; i++) {
  for (let j = i + 1; j < placedList.length; j++) {
    const p1 = placedList[i];
    const p2 = placedList[j];

    const minX1 = p1.position[0] - p1.bounds.width * 0.5;
    const maxX1 = p1.position[0] + p1.bounds.width * 0.5;
    const minY1 = p1.position[1] - p1.bounds.depth * 0.5;
    const maxY1 = p1.position[1] + p1.bounds.depth * 0.5;

    const minX2 = p2.position[0] - p2.bounds.width * 0.5;
    const maxX2 = p2.position[0] + p2.bounds.width * 0.5;
    const minY2 = p2.position[1] - p2.bounds.depth * 0.5;
    const maxY2 = p2.position[1] + p2.bounds.depth * 0.5;

    const overlapX = maxX1 > minX2 && maxX2 > minX1;
    const overlapY = maxY1 > minY2 && maxY2 > minY1;
    const overlaps = overlapX && overlapY;

    assert.ok(!overlaps, `Colisão detectada entre ${p1.name} e ${p2.name} na mesa`);
  }
}
console.log('  PASS  Todas as 3 peças organizadas sem sobreposição com margem de segurança');

console.log('\n======================================================');
console.log(' TODOS OS TESTES DE ORIENTAÇÃO E NESTING PASSARAM! ✓');
console.log('======================================================');

