// Used by prepare-medical-skull.py. All thresholds are in the source's millimetres.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');

async function clean(source, output) {
  let vertexCount = 0;
  let faceCount = 0;
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(source);
  input.on('data', (chunk) => hash.update(chunk));
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (line.startsWith('v ')) vertexCount++;
    if (line.startsWith('f ')) {
      if (line.trim().split(/\s+/).length !== 4) throw new Error('Expected triangulated OBJ');
      faceCount++;
    }
  }
  const positions = new Float32Array(vertexCount * 3);
  const triangles = new Uint32Array(faceCount * 3);
  const parents = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const root = (start) => {
    let i = start;
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  let vertex = 0;
  let face = 0;
  for await (const line of readline.createInterface({
    input: fs.createReadStream(source),
    crlfDelay: Infinity,
  })) {
    if (line.startsWith('v ')) {
      const values = line.trim().split(/\s+/).slice(1, 4).map(Number);
      if (!values.every(Number.isFinite)) throw new Error('Non-finite vertex');
      positions.set(values, vertex++ * 3);
    } else if (line.startsWith('f ')) {
      const values = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((s) => Number(s.split('/')[0]) - 1);
      if (!values.every((i) => Number.isInteger(i) && i >= 0 && i < vertexCount))
        throw new Error('Invalid vertex index');
      triangles.set(values, face++ * 3);
      for (const i of values.slice(1)) {
        const a = root(values[0]);
        const b = root(i);
        if (a !== b) parents[b] = a;
      }
    }
  }
  const components = new Map();
  for (let i = 0; i < vertexCount; i++) {
    const id = root(i);
    parents[i] = id;
    let bounds = components.get(id);
    if (!bounds) {
      bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      components.set(id, bounds);
    }
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k], positions[i * 3 + k]);
      bounds[k + 3] = Math.max(bounds[k + 3], positions[i * 3 + k]);
    }
  }
  const kept = new Set();
  for (const [id, b] of components) {
    if (Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) >= 0.1) kept.add(id);
  }
  const used = new Uint8Array(vertexCount);
  let retainedFaces = 0;
  let degenerateFaces = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.subarray(i, i + 3);
    if (!kept.has(parents[a])) continue;
    const ab = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const ac = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (cross.reduce((sum, x) => sum + x * x, 0) <= 1e-16) {
      degenerateFaces++;
      continue;
    }
    triangles.set([a, b, c], retainedFaces++ * 3);
    used[a] = used[b] = used[c] = 1;
  }
  const remap = new Int32Array(vertexCount).fill(-1);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let retainedVertices = 0;
  for (let i = 0; i < vertexCount; i++) {
    if (!used[i]) continue;
    remap[i] = retainedVertices;
    for (let k = 0; k < 3; k++) {
      const x = positions[i * 3 + k];
      positions[retainedVertices * 3 + k] = x;
      bounds[k] = Math.min(bounds[k], x);
      bounds[k + 3] = Math.max(bounds[k + 3], x);
    }
    retainedVertices++;
  }
  for (let i = 0; i < retainedFaces * 3; i++) triangles[i] = remap[triangles[i]];
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'positions.bin'), positions.subarray(0, retainedVertices * 3));
  fs.writeFileSync(path.join(output, 'triangles.bin'), triangles.subarray(0, retainedFaces * 3));
  const stats = {
    sourceSha256: hash.digest('hex'),
    sourceVertices: vertexCount,
    sourceTriangles: faceCount,
    sourceComponents: components.size,
    retainedComponents: kept.size,
    retainedVertices,
    retainedTriangles: retainedFaces,
    degenerateFacesRemoved: degenerateFaces,
    boundsLpsMm: bounds,
  };
  fs.writeFileSync(path.join(output, 'cleaning.json'), JSON.stringify(stats));
  return stats;
}

if (require.main === module) {
  clean(process.argv[2], process.argv[3])
    .then((stats) => console.log(JSON.stringify(stats)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { clean };
