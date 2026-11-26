import * as THREE from 'three';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import {
  decodeXmlBytes,
  getXmlAttr,
  norm3mfPath,
  parse3mfMeshBlock,
  parse3mfTransform,
  type RawMesh,
} from './threeMfXmlUtils';

export interface Viewer3mfPart {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
}

interface RawComponent { path: string | null; objectId: string; transform: THREE.Matrix4 | null; }
interface RawObject { id: string; name: string; type: string; mesh: RawMesh | null; components: RawComponent[]; }
interface RawBuildItem { path: string | null; objectId: string; transform: THREE.Matrix4 | null; printable: boolean; }
interface ModelDoc { unitScale: number; objects: Map<string, RawObject>; buildItems: RawBuildItem[]; }
interface MeshAcc { positions: number[]; indices: number[]; firstName: string; }

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};
const SKIPPED_TYPES = new Set(['support', 'solidsupport', 'surface', 'other']);
const MAX_DEPTH = 32;

const OBJ_RE = /<(?:[\w-]+:)?object\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?object>)/gi;
const MESH_RE = /<(?:[\w-]+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?mesh>/i;
const COMP_RE = /<(?:[\w-]+:)?component\b([^>]*)\/?>/gi;
const BUILD_RE = /<(?:[\w-]+:)?build\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?build>/i;
const ITEM_RE = /<(?:[\w-]+:)?item\b([^>]*)\/?>/gi;
const REL_RE = /<Relationship\b([^>]*)\/?>/gi;

function resolveModelRef(raw: string | null, baseModelPath: string, models: Map<string, ModelDoc>): string {
  if (!raw) return baseModelPath;
  const direct = norm3mfPath(raw);
  if (models.has(direct)) return direct;
  if (!raw.startsWith('/') && !raw.startsWith('\\')) {
    const slashIdx = baseModelPath.lastIndexOf('/');
    const baseDir = slashIdx >= 0 ? baseModelPath.slice(0, slashIdx) : '';
    if (baseDir) {
      const relative = norm3mfPath(`${baseDir}/${raw}`);
      if (models.has(relative)) return relative;
    }
  }
  return direct;
}

function parseModelXml(rawXml: string): ModelDoc {
  const xmlText = rawXml.includes('<!--') ? rawXml.replace(/<!--[\s\S]*?-->/g, '') : rawXml;
  const modelTag = /<(?:[\w-]+:)?model\b([^>]*)>/i.exec(xmlText);
  const rawUnit = modelTag ? (getXmlAttr(modelTag[1], 'unit') || 'millimeter').toLowerCase() : 'millimeter';
  const unitScale = UNIT_TO_MM[rawUnit] ?? 1;

  const objects = new Map<string, RawObject>();
  OBJ_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = OBJ_RE.exec(xmlText)) !== null) {
    const id = getXmlAttr(om[1], 'id');
    const objBody = om[2];
    if (!id || !objBody) continue;
    const meshMatch = MESH_RE.exec(objBody);
    const components: RawComponent[] = [];
    COMP_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = COMP_RE.exec(objBody)) !== null) {
      const objectId = getXmlAttr(cm[1], 'objectid');
      if (!objectId) continue;
      components.push({
        path: getXmlAttr(cm[1], 'path'),
        objectId,
        transform: parse3mfTransform(getXmlAttr(cm[1], 'transform'), unitScale),
      });
    }
    objects.set(id, {
      id,
      name: getXmlAttr(om[1], 'name') || '',
      type: (getXmlAttr(om[1], 'type') || 'model').toLowerCase(),
      mesh: meshMatch ? parse3mfMeshBlock(meshMatch[1], unitScale) : null,
      components,
    });
  }

  const buildItems: RawBuildItem[] = [];
  const buildMatch = BUILD_RE.exec(xmlText);
  if (buildMatch) {
    ITEM_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = ITEM_RE.exec(buildMatch[1])) !== null) {
      const objectId = getXmlAttr(im[1], 'objectid');
      if (!objectId) continue;
      const printableAttr = getXmlAttr(im[1], 'printable');
      buildItems.push({
        path: getXmlAttr(im[1], 'path'),
        objectId,
        transform: parse3mfTransform(getXmlAttr(im[1], 'transform'), unitScale),
        printable: printableAttr !== '0' && printableAttr?.toLowerCase() !== 'false',
      });
    }
  }
  return { unitScale, objects, buildItems };
}

function findRootModelPath(zipMap: Map<string, Uint8Array>, decoder: TextDecoder): string | null {
  const relsBytes = zipMap.get('_rels/.rels');
  if (relsBytes) {
    REL_RE.lastIndex = 0;
    let rm: RegExpExecArray | null;
    const relsXml = decodeXmlBytes(relsBytes, decoder);
    while ((rm = REL_RE.exec(relsXml)) !== null) {
      const target = getXmlAttr(rm[1], 'Target');
      if (target && target.toLowerCase().endsWith('.model')) {
        const key = norm3mfPath(target);
        if (zipMap.has(key)) return key;
      }
    }
  }
  if (zipMap.has('3d/3dmodel.model')) return '3d/3dmodel.model';
  for (const key of zipMap.keys()) {
    if (key.endsWith('.model')) return key;
  }
  return null;
}

function appendMesh(mesh: RawMesh, matrix: THREE.Matrix4, acc: MeshAcc): void {
  const baseVert = acc.positions.length / 3;
  const e = matrix.elements;
  const isMirrored = matrix.determinant() < 0;
  const verts = mesh.vertices;
  const inds = mesh.indices;
  const vCount = verts.length / 3;

  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i], y = verts[i + 1], z = verts[i + 2];
    const tx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ty = e[1] * x + e[5] * y + e[9] * z + e[13];
    const tz = e[2] * x + e[6] * y + e[10] * z + e[14];
    acc.positions.push(
      Number.isFinite(tx) ? tx : 0,
      Number.isFinite(ty) ? ty : 0,
      Number.isFinite(tz) ? tz : 0
    );
  }
  for (let i = 0; i + 2 < inds.length; i += 3) {
    const v1 = inds[i], v2 = inds[i + 1], v3 = inds[i + 2];
    if (v1 >= vCount || v2 >= vCount || v3 >= vCount) continue;
    if (isMirrored) acc.indices.push(baseVert + v1, baseVert + v3, baseVert + v2);
    else acc.indices.push(baseVert + v1, baseVert + v2, baseVert + v3);
  }
}

function collectObject(ctx: {
  modelPath: string;
  objectId: string;
  matrix: THREE.Matrix4;
  models: Map<string, ModelDoc>;
  acc: MeshAcc;
  allowSkipped: boolean;
  depth: number;
}): void {
  if (ctx.depth > MAX_DEPTH) return;
  const obj = ctx.models.get(ctx.modelPath)?.objects.get(ctx.objectId);
  if (!obj || (!ctx.allowSkipped && SKIPPED_TYPES.has(obj.type))) return;
  if (!ctx.acc.firstName && obj.name) ctx.acc.firstName = obj.name;
  if (obj.mesh) appendMesh(obj.mesh, ctx.matrix, ctx.acc);

  for (const comp of obj.components) {
    collectObject({
      ...ctx,
      modelPath: resolveModelRef(comp.path, ctx.modelPath, ctx.models),
      objectId: comp.objectId,
      matrix: comp.transform ? ctx.matrix.clone().multiply(comp.transform) : ctx.matrix,
      depth: ctx.depth + 1,
    });
  }
}

/**
 * Isolated 3MF parser exclusive to Viewer3D and Thumbnail Worker (never shared with CatPin).
 * Filters ZIP entries to .model/.rels only, supports UTF-16, single quotes, and URL-encoded/relative p:path.
 */
export function parseViewer3mfBufferToParts(buffer: ArrayBuffer | Uint8Array): Viewer3mfPart[] {
  const rawBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(rawBytes, {
      filter: (file) => {
        const lower = file.name.toLowerCase();
        return lower.endsWith('.model') || lower.endsWith('.rels');
      },
    });
  } catch (err) {
    const msg = (err as Error)?.message || '';
    if (/compression/i.test(msg)) {
      throw new Error('Arquivo .3mf usa método de compressão ZIP não suportado (use Deflate/Store).');
    }
    throw new Error('Arquivo .3mf inválido ou corrompido (falha ao abrir pacote ZIP).');
  }

  const zipMap = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(unzipped)) zipMap.set(norm3mfPath(k), v);

  const decoder = new TextDecoder('utf-8');
  const models = new Map<string, ModelDoc>();
  for (const [entryPath, bytes] of zipMap.entries()) {
    if (entryPath.endsWith('.model')) models.set(entryPath, parseModelXml(decodeXmlBytes(bytes, decoder)));
  }
  if (models.size === 0) throw new Error('Nenhum arquivo .model encontrado no .3mf');

  const rootPath = findRootModelPath(zipMap, decoder);
  const rootDoc = rootPath ? models.get(rootPath) : null;
  const parts: Viewer3mfPart[] = [];

  const extractBuild = (allowSkipped: boolean, includeNonPrintable: boolean) => {
    if (!rootPath || !rootDoc || rootDoc.buildItems.length === 0) return;
    rootDoc.buildItems.forEach((item, idx) => {
      if (!includeNonPrintable && !item.printable) return;
      const acc: MeshAcc = { positions: [], indices: [], firstName: '' };
      collectObject({
        modelPath: resolveModelRef(item.path, rootPath, models),
        objectId: item.objectId,
        matrix: item.transform ? item.transform.clone() : new THREE.Matrix4(),
        models, acc, allowSkipped, depth: 0,
      });
      if (acc.positions.length >= 9 && acc.indices.length >= 3) {
        parts.push({ name: acc.firstName || `Peca_${idx + 1}`, positions: new Float32Array(acc.positions), indices: new Uint32Array(acc.indices) });
      }
    });
  };

  extractBuild(false, false);
  if (parts.length === 0) extractBuild(true, true);

  if (parts.length === 0) {
    let idx = 0;
    for (const doc of models.values()) {
      for (const obj of doc.objects.values()) {
        if (!obj.mesh) continue;
        const acc: MeshAcc = { positions: [], indices: [], firstName: obj.name };
        appendMesh(obj.mesh, new THREE.Matrix4(), acc);
        if (acc.positions.length >= 9 && acc.indices.length >= 3) {
          parts.push({ name: acc.firstName || `Peca_${++idx}`, positions: new Float32Array(acc.positions), indices: new Uint32Array(acc.indices) });
        }
      }
    }
  }

  if (parts.length === 0) throw new Error('Nenhuma malha 3D válida encontrada no arquivo .3mf');
  return parts;
}

/**
 * Converts parsed Viewer3D 3MF parts into a Three.js Group of Meshes.
 */
export function parseViewer3mfBufferToObject3D(buffer: ArrayBuffer | Uint8Array): THREE.Object3D {
  const parts = parseViewer3mfBufferToParts(buffer);
  const group = new THREE.Group();
  for (const part of parts) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(part.indices, 1));
    const mesh = new THREE.Mesh(geom);
    mesh.name = part.name;
    group.add(mesh);
  }
  return group;
}
