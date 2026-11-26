export interface GroupCavityInput {
  triCount: number;
  vertexCount: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array | null;
  groupVertexOf: Int32Array;
  groupVertexCount: number;
  span: number;
}

const MAX_EDGE_SPAN_RATIO = 0.035;
const VALLEY_DEADZONE = 0.04;
const RIDGE_DEADZONE = 0.045;
const VALLEY_GAIN = 1.35;
const RIDGE_GAIN = 1.15;
const DIFFUSION_DECAY = 0.82;

/**
 * Computes edge-based curvature (`valleyTight`, `valleyWide`, `ridge`) per crease-separated
 * smooth group vertex (unified for indexed 3MF and non-indexed STL/OBJ meshes).
 */
export function computeGroupCavityAttribute(input: GroupCavityInput): Float32Array {
  const {
    triCount,
    vertexCount,
    positions,
    normals,
    indices,
    groupVertexOf,
    groupVertexCount,
    span,
  } = input;

  const valleySum = new Float32Array(groupVertexCount);
  const ridgeSum = new Float32Array(groupVertexCount);
  const edgeCnt = new Uint16Array(groupVertexCount);

  const maxDiffEdgeLen = Math.max(span * MAX_EDGE_SPAN_RATIO, 1e-4);
  const maxDiffEdgeSq = maxDiffEdgeLen * maxDiffEdgeLen;

  const accumEdge = (va: number, vb: number): void => {
    const ga = groupVertexOf[va];
    const gb = groupVertexOf[vb];
    if (ga === gb) return;

    const pa = va * 3;
    const pb = vb * 3;
    const dx = positions[pb] - positions[pa];
    const dy = positions[pb + 1] - positions[pa + 1];
    const dz = positions[pb + 2] - positions[pa + 2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 1e-12) return;

    const invDist = 1 / Math.sqrt(distSq);
    const dnx = normals[pb] - normals[pa];
    const dny = normals[pb + 1] - normals[pa + 1];
    const dnz = normals[pb + 2] - normals[pa + 2];

    const curv = (dnx * dx + dny * dy + dnz * dz) * invDist;
    if (curv < -VALLEY_DEADZONE) {
      const val = -curv - VALLEY_DEADZONE;
      valleySum[ga] += val;
      valleySum[gb] += val;
    } else if (curv > RIDGE_DEADZONE) {
      const val = curv - RIDGE_DEADZONE;
      ridgeSum[ga] += val;
      ridgeSum[gb] += val;
    }
    edgeCnt[ga]++;
    edgeCnt[gb]++;
  };

  for (let t = 0; t < triCount; t++) {
    const t3 = t * 3;
    const v0 = indices ? indices[t3] : t3;
    const v1 = indices ? indices[t3 + 1] : t3 + 1;
    const v2 = indices ? indices[t3 + 2] : t3 + 2;
    accumEdge(v0, v1);
    accumEdge(v1, v2);
    accumEdge(v2, v0);
  }

  const valleyTight = new Float32Array(groupVertexCount);
  const valleyWide = new Float32Array(groupVertexCount);
  const ridgeArr = new Float32Array(groupVertexCount);

  for (let g = 0; g < groupVertexCount; g++) {
    const cnt = Math.max(edgeCnt[g], 1);
    const vRaw = Math.min(1.0, (valleySum[g] / cnt) * VALLEY_GAIN);
    const rRaw = Math.min(1.0, (ridgeSum[g] / cnt) * RIDGE_GAIN);
    valleyTight[g] = vRaw;
    valleyWide[g] = vRaw;
    ridgeArr[g] = rRaw;
  }

  diffuseValleyWithLengthGuard(
    triCount,
    groupVertexCount,
    positions,
    indices,
    groupVertexOf,
    maxDiffEdgeSq,
    valleyTight,
    valleyWide
  );

  const outCavity = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const g = groupVertexOf[v];
    const v3 = v * 3;
    outCavity[v3] = valleyTight[g];
    outCavity[v3 + 1] = valleyWide[g];
    outCavity[v3 + 2] = ridgeArr[g];
  }
  return outCavity;
}

function diffuseValleyWithLengthGuard(
  triCount: number,
  groupVertexCount: number,
  positions: Float32Array,
  indices: Uint32Array | null,
  groupVertexOf: Int32Array,
  maxEdgeSq: number,
  valleyTight: Float32Array,
  valleyWide: Float32Array
): void {
  const passes = triCount > 250000 ? 2 : 3;
  const nextVal = new Float32Array(groupVertexCount);
  const weightSum = new Float32Array(groupVertexCount);

  const diffuseEdge = (va: number, vb: number): void => {
    const ga = groupVertexOf[va];
    const gb = groupVertexOf[vb];
    if (ga === gb) return;

    const pa = va * 3;
    const pb = vb * 3;
    const dx = positions[pb] - positions[pa];
    const dy = positions[pb + 1] - positions[pa + 1];
    const dz = positions[pb + 2] - positions[pa + 2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxEdgeSq || distSq < 1e-12) return;

    const w = 1.0 - Math.min(1.0, distSq / maxEdgeSq);
    nextVal[ga] += valleyWide[gb] * w;
    weightSum[ga] += w;
    nextVal[gb] += valleyWide[ga] * w;
    weightSum[gb] += w;
  };

  for (let pass = 0; pass < passes; pass++) {
    nextVal.fill(0);
    weightSum.fill(0);
    for (let t = 0; t < triCount; t++) {
      const t3 = t * 3;
      const v0 = indices ? indices[t3] : t3;
      const v1 = indices ? indices[t3 + 1] : t3 + 1;
      const v2 = indices ? indices[t3 + 2] : t3 + 2;
      diffuseEdge(v0, v1);
      diffuseEdge(v1, v2);
      diffuseEdge(v2, v0);
    }
    for (let g = 0; g < groupVertexCount; g++) {
      if (weightSum[g] > 0) {
        const diffused = (nextVal[g] / weightSum[g]) * DIFFUSION_DECAY;
        valleyWide[g] = Math.min(1.0, Math.max(valleyTight[g], diffused));
      }
    }
  }
}
