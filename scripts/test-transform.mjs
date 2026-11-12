import Module from 'manifold-3d';
const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;

// In Three.js: Matrix4.elements is COLUMN-MAJOR:
// [
//   m00, m10, m20, m30,  // col 0
//   m01, m11, m21, m31,  // col 1
//   m02, m12, m22, m32,  // col 2
//   m03, m13, m23, m33   // col 3 (translation: tx, ty, tz, 1)
// ]
// Position is at elements[12], elements[13], elements[14]!

// In Manifold-3D C++ / WASM:
// What does Manifold.transform accept?
// A 4x3 matrix or 3x4 or 4x4?
// Let's test a translation of [10, 20, 30] using elements array:
const matColMajor = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  10, 20, 30, 1
];

try {
  const c1 = Manifold.cube([1, 1, 1], true).transform(matColMajor);
  const bb1 = c1.boundingBox();
  console.log('Transform with 16 elements (col-major): min =', bb1.min, 'max =', bb1.max);
} catch (e) {
  console.log('16 elements failed:', e.message);
}

// What if it expects 3x4 (12 elements) or 4x3? Or row-major?
// In glm / C++: mat4x3 or mat3x4?
// Let's test with [10, 20, 30] in row-major 16 elements:
const matRowMajor = [
  1, 0, 0, 10,
  0, 1, 0, 20,
  0, 0, 1, 30,
  0, 0, 0, 1
];
const c2 = Manifold.cube([1, 1, 1], true).transform(matRowMajor);
const bb2 = c2.boundingBox();
console.log('Transform with 16 elements (row-major): min =', bb2.min, 'max =', bb2.max);
