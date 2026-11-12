const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createZipBuffer } = require('./zipWriter.cjs');
const { openModelInSlicer } = require('./slicerService.cjs');

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converte quaternion e translação em string de matriz de transformação 3MF (3x4 coluna-maior / 12 floats).
 */
function build3mfTransformString(position, rotation) {
  const [px, py, pz] = position || [0, 0, 0];
  const [qx, qy, qz, qw] = rotation || [0, 0, 0, 1];

  const m00 = 1 - 2 * (qy * qy + qz * qz);
  const m01 = 2 * (qx * qy - qz * qw);
  const m02 = 2 * (qx * qz + qy * qw);

  const m10 = 2 * (qx * qy + qz * qw);
  const m11 = 1 - 2 * (qx * qx + qz * qz);
  const m12 = 2 * (qy * qz - qx * qw);

  const m20 = 2 * (qx * qz - qy * qw);
  const m21 = 2 * (qy * qz + qx * qw);
  const m22 = 1 - 2 * (qx * qx + qy * qy);

  // 3MF transform: m00 m01 m02 m10 m11 m12 m20 m21 m22 x y z
  return `${m00.toFixed(6)} ${m01.toFixed(6)} ${m02.toFixed(6)} ${m10.toFixed(6)} ${m11.toFixed(6)} ${m12.toFixed(6)} ${m20.toFixed(6)} ${m21.toFixed(6)} ${m22.toFixed(6)} ${px.toFixed(4)} ${py.toFixed(4)} ${pz.toFixed(4)}`;
}

function buildContentTypesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    '</Types>',
  ].join('\n');
}

function buildRootRelsXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');
}

/**
 * Constrói o modelo 3MF com múltiplos objetos e instâncias na mesa de impressão.
 */
function buildMultiPart3dModelXml(projectName, parts) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const objectNodes = [];
  const buildItems = [];

  parts.forEach((part, idx) => {
    const objId = idx + 1;
    const vLines = [];
    const verts = part.vertices;
    for (let i = 0; i < verts.length; i += 3) {
      vLines.push(`     <vertex x="${verts[i].toFixed(4)}" y="${verts[i + 1].toFixed(4)}" z="${verts[i + 2].toFixed(4)}"/>`);
    }

    const tLines = [];
    const inds = part.indices;
    for (let i = 0; i < inds.length; i += 3) {
      tLines.push(`     <triangle v1="${inds[i]}" v2="${inds[i + 1]}" v3="${inds[i + 2]}"/>`);
    }

    objectNodes.push([
      `  <object id="${objId}" type="model" name="${escapeXml(part.name)}">`,
      '   <mesh>',
      '    <vertices>',
      vLines.join('\n'),
      '    </vertices>',
      '    <triangles>',
      tLines.join('\n'),
      '    </triangles>',
      '   </mesh>',
      '  </object>',
    ].join('\n'));

    const transformStr = build3mfTransformString(part.position, part.rotation);
    buildItems.push(`  <item objectid="${objId}" transform="${transformStr}" printable="1"/>`);
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ' <metadata name="Application">View 3DPrint (Multi-Part Plate Nesting)</metadata>',
    ` <metadata name="CreationDate">${dateStr}</metadata>`,
    ` <metadata name="Title">${escapeXml(projectName)}</metadata>`,
    ' <resources>',
    objectNodes.join('\n'),
    ' </resources>',
    ' <build>',
    buildItems.join('\n'),
    ' </build>',
    '</model>',
  ].join('\n');
}

/**
 * Gera o buffer binário de um pacote 3MF com múltiplas peças distribuídas na mesa.
 */
function createMultiPart3mfBuffer(projectName, parts) {
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(buildContentTypesXml(), 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(buildRootRelsXml(), 'utf-8') },
    { name: '3D/3dmodel.model', data: Buffer.from(buildMultiPart3dModelXml(projectName, parts), 'utf-8') },
  ];
  return createZipBuffer(files);
}

/**
 * Salva o projeto multi-peças .3mf em disco.
 */
function saveMultiPart3mfFile(filePath, projectName, parts) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buf = createMultiPart3mfBuffer(projectName, parts);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

/**
 * Salva em pasta temporária e abre no fatiador ativo.
 */
async function openMultiPartProjectInSlicer(projectName, parts, slicerExecutablePath) {
  const tempBase = app && typeof app.getPath === 'function'
    ? app.getPath('temp')
    : process.env.TEMP || process.env.TMP || '.';
  const tempDir = path.join(tempBase, 'view3dprint-multipart');
  const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const outPath = path.join(tempDir, `${safeName}_MesaCompleta.3mf`);
  saveMultiPart3mfFile(outPath, projectName, parts);
  return openModelInSlicer(outPath, slicerExecutablePath);
}

module.exports = {
  createMultiPart3mfBuffer,
  saveMultiPart3mfFile,
  openMultiPartProjectInSlicer,
};

