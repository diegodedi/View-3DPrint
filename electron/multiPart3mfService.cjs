const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createZipBufferAsync } = require('./zipWriter.cjs');
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
 * Especificação 3MF Core: m00 m10 m20 m01 m11 m21 m02 m12 m22 tx ty tz
 */
function build3mfTransformString(part, bedCenter = { x: 110, y: 110 }) {
  const [px, py, pz] = part?.position || [0, 0, 0];
  const [qx, qy, qz, qw] = part?.rotation || [0, 0, 0, 1];

  const m00 = 1 - 2 * (qy * qy + qz * qz);
  const m01 = 2 * (qx * qy - qz * qw);
  const m02 = 2 * (qx * qz + qy * qw);

  const m10 = 2 * (qx * qy + qz * qw);
  const m11 = 1 - 2 * (qx * qx + qz * qz);
  const m12 = 2 * (qy * qz - qx * qw);

  const m20 = 2 * (qx * qz - qy * qw);
  const m21 = 2 * (qy * qz + qx * qw);
  const m22 = 1 - 2 * (qx * qx + qy * qy);

  const tx = bedCenter.x + px;
  const ty = bedCenter.y + py;
  const tz = pz;

  return `${m00.toFixed(6)} ${m10.toFixed(6)} ${m20.toFixed(6)} ${m01.toFixed(6)} ${m11.toFixed(6)} ${m21.toFixed(6)} ${m02.toFixed(6)} ${m12.toFixed(6)} ${m22.toFixed(6)} ${tx.toFixed(4)} ${ty.toFixed(4)} ${tz.toFixed(4)}`;
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
 * Constrói o XML 3MF com múltiplos objetos independentes (type="model") e instâncias posicionadas na mesa.
 */
function buildMultiPart3dModelXml(projectName, parts, options = {}) {
  const bedWidthMm = Number(options.bedWidthMm) > 0 ? Number(options.bedWidthMm) : 220;
  const bedDepthMm = Number(options.bedDepthMm) > 0 ? Number(options.bedDepthMm) : 220;
  const bedCenterX = bedWidthMm * 0.5;
  const bedCenterY = bedDepthMm * 0.5;

  const dateStr = new Date().toISOString().slice(0, 10);
  const objectNodes = [];
  const buildItems = [];
  const CHUNK_STRIDE = 4096 * 3;

  parts.forEach((part, idx) => {
    const objId = idx + 1;
    const verts = part.vertices || [];
    const inds = part.indices || [];

    const vChunks = [];
    for (let start = 0; start < verts.length; start += CHUNK_STRIDE) {
      const end = Math.min(start + CHUNK_STRIDE, verts.length);
      let block = '';
      for (let i = start; i < end; i += 3) {
        block += `     <vertex x="${Number(verts[i]).toFixed(4)}" y="${Number(verts[i + 1]).toFixed(4)}" z="${Number(verts[i + 2]).toFixed(4)}"/>\n`;
      }
      vChunks.push(block);
    }

    const tChunks = [];
    for (let start = 0; start < inds.length; start += CHUNK_STRIDE) {
      const end = Math.min(start + CHUNK_STRIDE, inds.length);
      let block = '';
      for (let i = start; i < end; i += 3) {
        block += `     <triangle v1="${inds[i]}" v2="${inds[i + 1]}" v3="${inds[i + 2]}"/>\n`;
      }
      tChunks.push(block);
    }

    objectNodes.push(
      [
        `  <object id="${objId}" type="model" name="${escapeXml(part.name || `Peca_${objId}`)}">\n`,
        '   <mesh>\n',
        '    <vertices>\n',
        ...vChunks,
        '    </vertices>\n',
        '    <triangles>\n',
        ...tChunks,
        '    </triangles>\n',
        '   </mesh>\n',
        '  </object>',
      ].join('')
    );

    const transformStr = build3mfTransformString(part, { x: bedCenterX, y: bedCenterY });
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

function build3mfEntries(projectName, parts, options = {}) {
  return [
    { path: '[Content_Types].xml', content: buildContentTypesXml() },
    { path: '_rels/.rels', content: buildRootRelsXml() },
    { path: '3D/3dmodel.model', content: buildMultiPart3dModelXml(projectName, parts, options) },
  ];
}

/**
 * Salva o projeto multi-peças .3mf em disco de forma assíncrona (não bloqueia a UI).
 */
async function saveMultiPart3mfFileAsync(params) {
  const { filePath, projectName, parts, options = {} } = params;
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const entries = build3mfEntries(projectName, parts, options);
  const buf = await createZipBufferAsync(entries);
  await fs.promises.writeFile(filePath, buf);
  return filePath;
}

/**
 * Salva em pasta temporária e abre no fatiador ativo como objetos independentes na mesa.
 */
async function openMultiPartProjectInSlicer(params) {
  const { projectName, parts, slicerExecutablePath, options = {} } = params;
  const tempBase = app && typeof app.getPath === 'function'
    ? app.getPath('temp')
    : process.env.TEMP || process.env.TMP || '.';
  const tempDir = path.join(tempBase, 'view3dprint-multipart');
  const cleanBase = String(projectName || 'Projeto').replace(/\.[^/.]+$/, '');
  const safeName = cleanBase.replace(/[^a-zA-Z0-9_-]/g, '_');
  const outPath = path.join(tempDir, `${safeName}_MesaCompleta.3mf`);
  await saveMultiPart3mfFileAsync({ filePath: outPath, projectName: cleanBase, parts, options });
  return openModelInSlicer(outPath, slicerExecutablePath);
}

module.exports = {
  saveMultiPart3mfFileAsync,
  openMultiPartProjectInSlicer,
};
