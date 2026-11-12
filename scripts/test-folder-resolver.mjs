import assert from 'node:assert/strict';
import path from 'node:path';

// Importa funções do resolver
import {
  normalizeFolderPath,
  extractDirectoryFromPath,
  resolveWorkingObjectFolder,
  getFolderDisplayName,
} from '../src/utils/modelFolderResolver.ts';

console.log('======================================================');
console.log(' BANCADA DE TESTES: ROTINA DE RESOLUÇÃO DE PASTA 3D');
console.log('======================================================\n');

// [1] Normalização de caminhos
console.log('[1] Teste: normalizeFolderPath');
assert.equal(normalizeFolderPath('C:\\Users\\diego\\modelos\\\\dragon\\'), 'C:\\Users\\diego\\modelos\\dragon');
assert.equal(normalizeFolderPath('C:/Users/diego/modelos/dragon/'), 'C:\\Users\\diego\\modelos\\dragon');
assert.equal(normalizeFolderPath('C:\\'), 'C:\\');
assert.equal(normalizeFolderPath('D:'), 'D:\\');
assert.equal(normalizeFolderPath(''), '');
console.log('  PASS  Normalização de caminhos e separadores multiplos');

// [2] Extração de diretório a partir de modelPath
console.log('[2] Teste: extractDirectoryFromPath');
assert.equal(
  extractDirectoryFromPath('E:\\3DModels\\Marvel\\IronMan\\torso.stl'),
  'E:\\3DModels\\Marvel\\IronMan'
);
assert.equal(
  extractDirectoryFromPath('E:/3DModels/Marvel/IronMan/arm.3mf'),
  'E:\\3DModels\\Marvel\\IronMan'
);
assert.equal(extractDirectoryFromPath('torso.stl'), '');
console.log('  PASS  Extração precisa do diretório pai a partir do arquivo 3D');

// [3] Prioridade na resolução de pasta de trabalho
console.log('[3] Teste: resolveWorkingObjectFolder');
// Caso 1: folderPath direto disponível
assert.equal(
  resolveWorkingObjectFolder({
    folderPath: 'E:\\3DModels\\StarWars\\Yoda',
    modelPath: 'E:\\3DModels\\StarWars\\Yoda\\head.stl',
  }),
  'E:\\3DModels\\StarWars\\Yoda'
);

// Caso 2: folderPath ausente, modelPath presente
assert.equal(
  resolveWorkingObjectFolder({
    folderPath: '',
    modelPath: 'D:\\Downloads\\Pokemon\\Pikachu\\body.stl',
  }),
  'D:\\Downloads\\Pokemon\\Pikachu'
);

// Caso 3: fallbackPath utilizado quando ambos ausentes
assert.equal(
  resolveWorkingObjectFolder({
    folderPath: null,
    modelPath: null,
    fallbackPath: 'C:\\Users\\diego\\Documents\\3DModels',
  }),
  'C:\\Users\\diego\\Documents\\3DModels'
);
console.log('  PASS  Prioridade hierárquica (folderPath > modelPath > fallback)');

// [4] Nome amigável de exibição na UI
console.log('[4] Teste: getFolderDisplayName');
assert.equal(getFolderDisplayName('E:\\3DModels\\Marvel\\IronMan'), 'IronMan');
assert.equal(getFolderDisplayName('E:/3DModels/Marvel/Hulk/'), 'Hulk');
assert.equal(getFolderDisplayName(''), '');
console.log('  PASS  Extração do nome folha do diretório para display na interface');

console.log('\n======================================================');
console.log(' TODOS OS TESTES DE RESOLUÇÃO DE PASTA PASSARAM! ✓');
console.log('======================================================');

