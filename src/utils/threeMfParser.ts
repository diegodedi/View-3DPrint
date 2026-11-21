import * as THREE from 'three';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

export interface Parsed3mfPart {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
}

interface RawMesh { vertices: Float32Array; indices: Uint32Array; }
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

const FAST_VERT_RE = /<(?:[\w-]+:)?vertex\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bz="([^"]+)"/gi;
const ANY_VERT_RE = /<(?:[\w-]+:)?vertex\b([^>]*)\/?>/gi;
const FAST_TRI_RE = /<(?:[\w-]+:)?triangle\b[^>]*\bv1="(\d+)"[^>]*\bv2="(\d+)"[^>]*\bv3="(\d+)"/gi;
const ANY_TRI_RE = /<(?:[\w-]+:)?triangle\b([^>]*)\/?>/gi;
const OBJ_RE = /<(?:[\w-]+:)?object\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?object>/gi;
const MESH_RE = /<(?:[\w-]+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?mesh>/i;
const COMP_RE = /<(?:[\w-]+:)?component\b([^>]*)\/?>/gi;
const BUILD_RE = /<(?:[\w-]+:)?build\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?build>/i;
const ITEM_RE = /<(?:[\w-]+:)?item\b([^>]*)\/?>/gi;
const REL_RE = /<Relationship\b([^>]*)\/?>/gi;

function normPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function getAttr(attrs: string, name: string): string | null {
  const exact = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  if (exact) return exact[1];
  const prefixed = new RegExp(`(?:^|\\s)[\\w-]+:${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return prefixed ? prefixed[1] : null;
}

function parseTransform(raw: string | null, unitScale: number): THREE.Matrix4 | null {
  if (!raw) return null;
  const t = raw.trim().split(/\s+/).map(Number);
  if (t.length < 12 || t.some((n) => !Number.isFinite(n))) return null;
  return new THREE.Matrix4().set(
    t[0], t[3], t[6], t[9] * unitScale,
    t[1], t[4], t[7], t[10] * unitScale,
    t[2], t[5], t[8], t[11] * unitScale,
    0, 0, 0, 1
  );
}

function parseMeshBlock(body: string, unitScale: number): RawMesh | null {
  const verts: number[] = [];
  FAST_VERT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FAST_VERT_RE.exec(body)) !== null) {
    verts.push(Number(m[1]) * unitScale, Number(m[2]) * unitScale, Number(m[3]) * unitScale);
  }
  if (verts.length === 0) {
    ANY_VERT_RE.lastIndex = 0;
    while ((m = ANY_VERT_RE.exec(body)) !== null) {
      const x = Number(getAttr(m[1], 'x')), y = Number(getAttr(m[1], 'y')), z = Number(getAttr(m[1], 'z'));
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) verts.push(x * unitScale, y * unitScale, z * unitScale);
    }
  }
  if (verts.length < 9) return null;

  const inds: number[] = [];
  FAST_TRI_RE.lastIndex = 0;
  while ((m = FAST_TRI_RE.exec(body)) !== null) inds.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (inds.length === 0) {
    ANY_TRI_RE.lastIndex = 0;
    while ((m = ANY_TRI_RE.exec(body)) !== null) {
      const v1 = Number(getAttr(m[1], 'v1')), v2 = Number(getAttr(m[1], 'v2')), v3 = Number(getAttr(m[1], 'v3'));
      if (Number.isInteger(v1) && Number.isInteger(v2) && Number.isInteger(v3)) inds.push(v1, v2, v3);
    }
  }
  return inds.length >= 3 ? { vertices: new Float32Array(verts), indices: new Uint32Array(inds) } : null;
}

function parseModelXml(xmlText: string): ModelDoc {
  const modelTag = /<(?:[\w-]+:)?model\b([^>]*)>/i.exec(xmlText);
  const rawUnit = modelTag ? (getAttr(modelTag[1], 'unit') || 'millimeter').toLowerCase() : 'millimeter';
  const unitScale = UNIT_TO_MM[rawUnit] ?? 1;

  const objects = new Map<string, RawObject>();
  OBJ_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = OBJ_RE.exec(xmlText)) !== null) {
    const id = getAttr(om[1], 'id');
    if (!id) continue;
    const meshMatch = MESH_RE.exec(om[2]);
    const components: RawComponent[] = [];
    COMP_RE.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = COMP_RE.exec(om[2])) !== null) {
      const objectId = getAttr(cm[1], 'objectid');
      if (!objectId) continue;
      const p = getAttr(cm[1], 'path');
      components.push({
        path: p ? normPath(p) : null,
        objectId,
        transform: parseTransform(getAttr(cm[1], 'transform'), unitScale),
      });
    }
    objects.set(id, {
      id,
      name: getAttr(om[1], 'name') || '',
      type: (getAttr(om[1], 'type') || 'model').toLowerCase(),
      mesh: meshMatch ? parseMeshBlock(meshMatch[1], unitScale) : null,
      components,
    });
  }

  const buildItems: RawBuildItem[] = [];
  const buildMatch = BUILD_RE.exec(xmlText);
  if (buildMatch) {
    ITEM_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = ITEM_RE.exec(buildMatch[1])) !== null) {
      const objectId = getAttr(im[1], 'objectid');
      if (!objectId) continue;
      const p = getAttr(im[1], 'path');
      const printableAttr = getAttr(im[1], 'printable');
      buildItems.push({
        path: p ? normPath(p) : null,
        objectId,
        transform: parseTransform(getAttr(im[1], 'transform'), unitScale),
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
    const relsXml = decoder.decode(relsBytes);
    while ((rm = REL_RE.exec(relsXml)) !== null) {
      const target = getAttr(rm[1], 'Target');
      if (target && target.toLowerCase().endsWith('.model')) {
        const key = normPath(target);
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
    acc.positions.push(
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14]
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
      modelPath: comp.path || ctx.modelPath,
      objectId: comp.objectId,
      matrix: comp.transform ? ctx.matrix.clone().multiply(comp.transform) : ctx.matrix,
      depth: ctx.depth + 1,
    });
  }
}

/**
 * Parses any 3MF archive (Core + Production Extension p:path) into millimeter-normalized parts
 * with build/component transforms baked into vertex positions and mirrored winding corrected.
 */
export function parse3mfBufferToParts(buffer: ArrayBuffer | Uint8Array): Parsed3mfPart[] {
  const rawBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zipMap = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(unzipSync(rawBytes))) zipMap.set(normPath(k), v);

  const decoder = new TextDecoder('utf-8');
  const models = new Map<string, ModelDoc>();
  for (const [entryPath, bytes] of zipMap.entries()) {
    if (entryPath.endsWith('.model')) models.set(entryPath, parseModelXml(decoder.decode(bytes)));
  }
  if (models.size === 0) throw new Error('Nenhum arquivo .model encontrado no .3mf');

  const rootPath = findRootModelPath(zipMap, decoder);
  const rootDoc = rootPath ? models.get(rootPath) : null;
  const parts: Parsed3mfPart[] = [];

  const extractBuild = (allowSkipped: boolean, includeNonPrintable: boolean) => {
    if (!rootPath || !rootDoc || rootDoc.buildItems.length === 0) return;
    rootDoc.buildItems.forEach((item, idx) => {
      if (!includeNonPrintable && !item.printable) return;
      const acc: MeshAcc = { positions: [], indices: [], firstName: '' };
      collectObject({
        modelPath: item.path || rootPath, objectId: item.objectId,
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
 * Parses a 3MF buffer into a Three.js Group of named Meshes ready for rendering or CatPin.
 */
export function parse3mfBufferToObject3D(buffer: ArrayBuffer | Uint8Array): THREE.Object3D {
  const parts = parse3mfBufferToParts(buffer);
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
