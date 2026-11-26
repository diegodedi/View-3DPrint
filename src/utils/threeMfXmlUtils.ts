import * as THREE from 'three';

export interface RawMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

const FAST_VERT_RE = /<(?:[\w-]+:)?vertex\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bz="([^"]+)"/gi;
const ANY_VERT_RE = /<(?:[\w-]+:)?vertex\b([^>]*)\/?>/gi;
const FAST_TRI_RE = /<(?:[\w-]+:)?triangle\b[^>]*\bv1="(\d+)"[^>]*\bv2="(\d+)"[^>]*\bv3="(\d+)"/gi;
const ANY_TRI_RE = /<(?:[\w-]+:)?triangle\b([^>]*)\/?>/gi;

/**
 * Decodes XML bytes respecting UTF-16 LE/BE BOMs with UTF-8 default.
 */
export function decodeXmlBytes(bytes: Uint8Array, utf8Decoder: TextDecoder): string {
  if (bytes.byteLength >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
  }
  return utf8Decoder.decode(bytes);
}

/**
 * Normalizes a 3MF internal ZIP path (URL-decoding, slash normalization, and dot-segment resolution).
 */
export function norm3mfPath(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const segments = decoded.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') resolved.pop();
    else resolved.push(seg);
  }
  return resolved.join('/').toLowerCase();
}

/**
 * Extracts an XML attribute value supporting both double and single quotes and optional namespace prefixes.
 */
export function getXmlAttr(attrs: string, name: string): string | null {
  const exact = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (exact) return exact[1] ?? exact[2] ?? '';
  const prefixed = new RegExp(`(?:^|\\s)[\\w-]+:${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return prefixed ? (prefixed[1] ?? prefixed[2] ?? '') : null;
}

/**
 * Parses a 3MF 12-float affine transform string into a Three.js Matrix4 scaled to millimeters.
 */
export function parse3mfTransform(raw: string | null, unitScale: number): THREE.Matrix4 | null {
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

/**
 * Parses a <mesh> XML body into validated millimeter Float32Array vertices and Uint32Array indices.
 */
export function parse3mfMeshBlock(body: string, unitScale: number): RawMesh | null {
  const verts: number[] = [];
  const hasSingleQuotes = body.includes("'");
  let m: RegExpExecArray | null;

  if (!hasSingleQuotes) {
    FAST_VERT_RE.lastIndex = 0;
    while ((m = FAST_VERT_RE.exec(body)) !== null) {
      const x = Number(m[1]), y = Number(m[2]), z = Number(m[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        verts.push(x * unitScale, y * unitScale, z * unitScale);
      }
    }
  }
  const rawVertMatches = body.match(/<(?:[\w-]+:)?vertex\b/gi);
  const expectedVerts = rawVertMatches ? rawVertMatches.length : 0;
  if (verts.length === 0 || (expectedVerts > 0 && verts.length / 3 < expectedVerts)) {
    verts.length = 0;
    ANY_VERT_RE.lastIndex = 0;
    while ((m = ANY_VERT_RE.exec(body)) !== null) {
      const x = Number(getXmlAttr(m[1], 'x'));
      const y = Number(getXmlAttr(m[1], 'y'));
      const z = Number(getXmlAttr(m[1], 'z'));
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        verts.push(x * unitScale, y * unitScale, z * unitScale);
      }
    }
  }
  if (verts.length < 9) return null;

  const inds: number[] = [];
  if (!hasSingleQuotes) {
    FAST_TRI_RE.lastIndex = 0;
    while ((m = FAST_TRI_RE.exec(body)) !== null) inds.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  const rawTriMatches = body.match(/<(?:[\w-]+:)?triangle\b/gi);
  const expectedTris = rawTriMatches ? rawTriMatches.length : 0;
  if (inds.length === 0 || (expectedTris > 0 && inds.length / 3 < expectedTris)) {
    inds.length = 0;
    ANY_TRI_RE.lastIndex = 0;
    while ((m = ANY_TRI_RE.exec(body)) !== null) {
      const v1 = Number(getXmlAttr(m[1], 'v1'));
      const v2 = Number(getXmlAttr(m[1], 'v2'));
      const v3 = Number(getXmlAttr(m[1], 'v3'));
      if (Number.isInteger(v1) && Number.isInteger(v2) && Number.isInteger(v3)) inds.push(v1, v2, v3);
    }
  }
  return inds.length >= 3 ? { vertices: new Float32Array(verts), indices: new Uint32Array(inds) } : null;
}
