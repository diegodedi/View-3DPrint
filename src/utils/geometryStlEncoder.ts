import type * as THREE from 'three';

const STL_HEADER_BYTES = 80;
const STL_TRIANGLE_BYTES = 50;

/**
 * Encodes a Three.js BufferGeometry (indexed or non-indexed) into a standard Binary STL ArrayBuffer.
 * Allows multi-part 3MF/OBJ geometries to operate identically to native STL parts inside CatPin.
 */
export function encodeGeometryToBinaryStl(geometry: THREE.BufferGeometry): ArrayBuffer {
  const posAttr = geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) return new ArrayBuffer(0);

  const pos = posAttr.array as ArrayLike<number>;
  const indexAttr = geometry.index;
  const indices = indexAttr ? (indexAttr.array as ArrayLike<number>) : null;
  const triCount = Math.floor((indices ? indices.length : posAttr.count) / 3);
  if (triCount <= 0) return new ArrayBuffer(0);

  const buffer = new ArrayBuffer(STL_HEADER_BYTES + 4 + triCount * STL_TRIANGLE_BYTES);
  const view = new DataView(buffer);
  const headerBytes = new Uint8Array(buffer, 0, STL_HEADER_BYTES);
  const label = 'View 3DPrint Binary STL';
  for (let i = 0; i < label.length; i++) {
    headerBytes[i] = label.charCodeAt(i);
  }

  view.setUint32(STL_HEADER_BYTES, triCount, true);

  let offset = STL_HEADER_BYTES + 4;
  for (let t = 0; t < triCount; t++) {
    const i0 = (indices ? indices[t * 3] : t * 3) * 3;
    const i1 = (indices ? indices[t * 3 + 1] : t * 3 + 1) * 3;
    const i2 = (indices ? indices[t * 3 + 2] : t * 3 + 2) * 3;

    const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
    const bx = pos[i1], by = pos[i1 + 1], bz = pos[i1 + 2];
    const cx = pos[i2], cy = pos[i2 + 1], cz = pos[i2 + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 0;
    }

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);

    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);

    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);

    view.setUint16(offset + 48, 0, true);
    offset += STL_TRIANGLE_BYTES;
  }

  return buffer;
}
