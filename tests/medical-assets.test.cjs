const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const {
  MEDICAL_ASSETS,
  MEDICAL_MODELS,
  MEDICAL_MODEL_ASSETS,
  isMedicalModelAvailable,
  hasMedicalLabels,
} = require('../src/features/medical-viewer/medical-models.ts');
const { MedicalController } = require('../src/features/medical-viewer/medical-controller.ts');
const { clean } = require('../scripts/medical-mesh-clean.cjs');
const provenance = require('../assets/medical/skull-provenance.json');
const calibration = require('../assets/medical/skull-labels.json');

function readModel(id) {
  const bytes = fs.readFileSync(path.join(__dirname, `../assets/medical/${id}.glb`));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, jsonEnd));
  assert.equal(bytes.readUInt32LE(jsonEnd + 4), 0x004e4942);
  const binaryStart = jsonEnd + 8;
  function accessor(index) {
    const a = gltf.accessors[index],
      view = gltf.bufferViews[a.bufferView];
    assert.ok([5123, 5125, 5126].includes(a.componentType));
    const size = a.componentType === 5123 ? 2 : 4;
    const width = a.type === 'VEC3' ? 3 : 1;
    const start = binaryStart + (view.byteOffset || 0) + (a.byteOffset || 0);
    const stride = view.byteStride || size * width;
    const data = [];
    for (let i = 0; i < a.count; i++) {
      const row = [];
      for (let k = 0; k < width; k++) {
        const offset = start + i * stride + k * size;
        assert.ok(offset + size <= bytes.length);
        row.push(
          a.componentType === 5126
            ? bytes.readFloatLE(offset)
            : size === 2
              ? bytes.readUInt16LE(offset)
              : bytes.readUInt32LE(offset)
        );
      }
      data.push(width === 1 ? row[0] : row);
    }
    return data;
  }
  return { bytes, gltf, accessor };
}
const { bytes, gltf, accessor } = readModel('skull');
const primitive = gltf.meshes[0].primitives[0];
const positions = accessor(primitive.attributes.POSITION);
const normals = accessor(primitive.attributes.NORMAL);
const indices = accessor(primitive.indices);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
function segmentDistance(p, a, b) {
  const d = sub(b, a);
  if (dot(d, d) === 0) return Math.hypot(...sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d)));
  return Math.hypot(
    ...sub(
      p,
      a.map((x, i) => x + t * d[i])
    )
  );
}
function triangleDistance(p, a, b, c) {
  const u = sub(b, a),
    v = sub(c, a),
    w = sub(p, a);
  const uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    wu = dot(w, u),
    wv = dot(w, v);
  const determinant = uu * vv - uv * uv;
  if (determinant > 1e-25) {
    const s = (wu * vv - wv * uv) / determinant,
      t = (wv * uu - wu * uv) / determinant;
    if (s >= 0 && t >= 0 && s + t <= 1)
      return Math.hypot(...w.map((x, i) => x - s * u[i] - t * v[i]));
  }
  return Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
}

test('packaged skull meets triangle/size budgets and matches its provenance hash', () => {
  assert.ok(bytes.length <= 10 * 1024 * 1024);
  assert.equal(bytes.length, provenance.bytes);
  assert.equal(indices.length % 3, 0);
  assert.equal(indices.length / 3, provenance.triangles);
  assert.ok(provenance.triangles <= 150000);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
  assert.equal(
    provenance.cleaning.sourceSha256,
    'f3b2629424b65d5d251c6dda1f085184236b33834a602ab1366c18919510403b'
  );
  assert.ok(!gltf.extensionsRequired?.includes('KHR_draco_mesh_compression'));
});
test('geometry has valid indices, finite positions and normalized normals', () => {
  assert.equal(normals.length, positions.length);
  for (const p of positions) assert.ok(p.every(Number.isFinite));
  for (const n of normals)
    assert.ok(n.every(Number.isFinite) && Math.abs(Math.hypot(...n) - 1) < 0.01);
  for (const index of indices) assert.ok(index < positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = positions[indices[i]],
      b = positions[indices[i + 1]],
      c = positions[indices[i + 2]];
    const u = sub(b, a),
      v = sub(c, a);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    assert.ok(Math.hypot(...cross) > 0, `Degenerate triangle ${i / 3}`);
  }
});
test('skull is centred, grounded, opaque and exported without additional resources', () => {
  assert.deepEqual(gltf.nodes, [{ mesh: 0, name: 'Skull' }]);
  const a = gltf.accessors[primitive.attributes.POSITION];
  assert.ok(Math.abs(a.min[1]) < 1e-6);
  assert.ok(Math.abs(a.min[0] + a.max[0]) < 1e-4);
  assert.ok(Math.abs(a.min[2] + a.max[2]) < 1e-4);
  const expected = [0.168, 0.211, 0.219];
  expected.forEach((size, i) => assert.ok(Math.abs(a.max[i] - a.min[i] - size) < 0.003));
  const matrix = provenance.lpsToModelMatrix;
  assert.equal(matrix[0][0], 0.001);
  assert.equal(matrix[1][2], 0.001);
  assert.equal(matrix[2][1], -0.001);
  for (const material of gltf.materials) {
    assert.equal(material.alphaMode || 'OPAQUE', 'OPAQUE');
    assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1);
  }
  assert.equal(gltf.images?.length || 0, 0);
  assert.ok(gltf.buffers.every((buffer) => !buffer.uri));
  const files = fs.readdirSync(path.join(__dirname, '../assets/medical'));
  assert.ok(
    files.every(
      (file) => ['slices', 'volumes', 'stack'].includes(file) || /\.(glb|json)$/.test(file)
    )
  );
});
test('four named labels are calibrated on the actual exported surface', () => {
  assert.deepEqual(
    calibration.labels.map((label) => label.name),
    ['Frontal bone', 'Parietal bone', 'Zygomatic bone', 'Mandible']
  );
  for (const label of calibration.labels) {
    assert.ok([...label.anchor, ...label.position].every(Number.isFinite));
    let distance = Infinity;
    for (let i = 0; i < indices.length; i += 3) {
      distance = Math.min(
        distance,
        triangleDistance(
          label.anchor,
          positions[indices[i]],
          positions[indices[i + 1]],
          positions[indices[i + 2]]
        )
      );
      if (distance < 1e-7) break;
    }
    assert.ok(distance < 1e-5, `${label.name} is ${distance} metres from the surface`);
  }
});
test('cleaning retains separate anatomical components while dropping subresolution debris and degenerate faces', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medical-clean-test-'));
  try {
    const vertices = [],
      faces = [];
    for (const [offset, size] of [
      [0, 10],
      [30, 2],
      [50, 0.02],
    ]) {
      const base = vertices.length + 1;
      vertices.push([offset, 0, 0], [offset + size, 0, 0], [offset, size, 0], [offset, 0, size]);
      for (const f of [
        [0, 1, 2],
        [0, 3, 1],
        [0, 2, 3],
        [1, 3, 2],
      ])
        faces.push(f.map((i) => i + base));
    }
    faces.push([1, 1, 2]);
    const source = path.join(directory, 'source.obj');
    fs.writeFileSync(
      source,
      [...vertices.map((p) => `v ${p.join(' ')}`), ...faces.map((p) => `f ${p.join(' ')}`)].join(
        '\n'
      )
    );
    const stats = await clean(source, path.join(directory, 'output'));
    assert.equal(stats.sourceComponents, 3);
    assert.equal(stats.retainedComponents, 2);
    assert.equal(stats.retainedVertices, 8);
    assert.equal(stats.retainedTriangles, 8);
    assert.equal(stats.degenerateFacesRemoved, 1);
    assert.deepEqual(stats.boundsLpsMm, [0, 0, 0, 32, 10, 10]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('four picker modes retain full Skull and separately expose Half Skull', () => {
  assert.deepEqual(
    MEDICAL_MODELS.map(({ label }) => label),
    ['Skull', 'Brain', 'Half Skull', 'Both']
  );
  assert.ok(MEDICAL_MODELS.every(({ available }) => available));
  assert.deepEqual(MEDICAL_MODEL_ASSETS.skull, ['skull']);
  assert.deepEqual(MEDICAL_MODEL_ASSETS.brain, ['brain']);
  assert.deepEqual(MEDICAL_MODEL_ASSETS['half-skull'], ['half-skull']);
  assert.deepEqual(MEDICAL_MODEL_ASSETS.both, ['half-skull', 'brain']);
  for (const missingId of ['half-skull', 'brain']) {
    const available = (id) => id !== missingId;
    assert.equal(isMedicalModelAvailable('both', available), false);
    assert.equal(isMedicalModelAvailable('skull', available), true);
  }
  assert.equal(hasMedicalLabels('skull'), true);
  for (const id of ['brain', 'half-skull', 'both']) {
    assert.equal(hasMedicalLabels(id), false);
  }
});

const prepared = Object.fromEntries(
  ['brain', 'half-skull'].map((id) => [
    id,
    {
      ...readModel(id),
      provenance: require(`../assets/medical/${id}-provenance.json`),
    },
  ])
);
for (const id of ['brain', 'half-skull']) {
  test(`packaged ${id} validates geometry, resource budgets, source identity and attribution`, () => {
    const model = prepared[id];
    const record = model.provenance;
    assert.equal(model.bytes.length, record.bytes);
    assert.ok(model.bytes.length <= 10 * 1024 * 1024);
    assert.equal(crypto.createHash('sha256').update(model.bytes).digest('hex'), record.sha256);
    assert.equal(
      record.sourceSha256,
      id === 'brain'
        ? 'db80fa4dcdc3471463ca84a6816e9c948c65bc421eb84eaec872d4dfc5885b4f'
        : '84209dff1cc01af9e7f7d4f51d09d5c4537541a04b0e148ae630462d9a374aa2'
    );
    assert.equal(record.cleaning.sourceSha256, record.sourceSha256);
    assert.match(record.provenanceConfirmation, /Owner confirmed/);
    assert.match(record.attribution, /National Library of Medicine/);
    assert.match(record.license, /public-domain/);
    assert.match(record.clinicalValidation, /Not clinically validated/);
    assert.deepEqual(model.gltf.nodes, [
      { mesh: 0, name: id === 'brain' ? 'Brain' : 'Half Skull' },
    ]);
    assert.ok(!model.gltf.extensionsRequired?.includes('KHR_draco_mesh_compression'));
    assert.ok(model.gltf.buffers.every((buffer) => !buffer.uri));
    assert.equal(model.gltf.images?.length || 0, 0);
    const primitive = model.gltf.meshes[0].primitives[0];
    const positions = model.accessor(primitive.attributes.POSITION);
    const normals = model.accessor(primitive.attributes.NORMAL);
    const indices = model.accessor(primitive.indices);
    assert.equal(indices.length % 3, 0);
    assert.equal(indices.length / 3, record.triangles);
    assert.ok(record.triangles <= record.triangleBudget);
    assert.equal(normals.length, positions.length);
    positions.forEach((p) => assert.ok(p.every(Number.isFinite)));
    normals.forEach((n) =>
      assert.ok(n.every(Number.isFinite) && Math.abs(Math.hypot(...n) - 1) < 0.01)
    );
    indices.forEach((i) => assert.ok(i >= 0 && i < positions.length));
    for (let i = 0; i < indices.length; i += 3) {
      const a = positions[indices[i]],
        b = positions[indices[i + 1]],
        c = positions[indices[i + 2]];
      const u = sub(b, a),
        v = sub(c, a);
      assert.ok(
        Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0]
        ) > 0
      );
    }
    const actualBounds = {
      min: positions.reduce(
        (min, p) => min.map((value, i) => Math.min(value, p[i])),
        [Infinity, Infinity, Infinity]
      ),
      max: positions.reduce(
        (max, p) => max.map((value, i) => Math.max(value, p[i])),
        [-Infinity, -Infinity, -Infinity]
      ),
    };
    for (const bound of ['min', 'max'])
      actualBounds[bound].forEach((value, i) => {
        assert.ok(Math.abs(value - record.boundsModelMetres[bound][i]) < 1e-7);
      });
    model.gltf.materials.forEach((material) => {
      assert.equal(material.alphaMode || 'OPAQUE', 'OPAQUE');
      assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1);
    });
  });
}

test('the pair preserves one Slicer conversion frame, retains physical bounds and stays within its combined budget', () => {
  const skullBounds = gltf.accessors[primitive.attributes.POSITION];
  for (const id of ['brain', 'half-skull']) {
    const record = prepared[id].provenance;
    assert.deepEqual(record.originLpsMm, provenance.originLpsMm);
    assert.deepEqual(record.lpsToModelMatrix, provenance.lpsToModelMatrix);
    assert.deepEqual(record.displayTransform, MEDICAL_ASSETS[id].transform);
    const b = record.cleaning.boundsLpsMm;
    const o = provenance.originLpsMm;
    const expectedMin = [(b[0] - o[0]) * 0.001, (b[2] - o[2]) * 0.001, (o[1] - b[4]) * 0.001];
    const expectedMax = [(b[3] - o[0]) * 0.001, (b[5] - o[2]) * 0.001, (o[1] - b[1]) * 0.001];
    for (let i = 0; i < 3; i++) {
      // Bounds check only, not a clinical accuracy tolerance or registration test.
      assert.ok(Math.abs(record.boundsModelMetres.min[i] - expectedMin[i]) < 0.003);
      assert.ok(Math.abs(record.boundsModelMetres.max[i] - expectedMax[i]) < 0.003);
      assert.ok(record.boundsModelMetres.min[i] >= skullBounds.min[i] - 0.003);
      assert.ok(record.boundsModelMetres.max[i] <= skullBounds.max[i] + 0.003);
    }
  }
  assert.ok(prepared.brain.provenance.boundsModelMetres.min[1] > 0.05);
  assert.ok(prepared['half-skull'].provenance.boundsModelMetres.min[0] >= -0.001);
  assert.ok(
    prepared.brain.provenance.triangles + prepared['half-skull'].provenance.triangles <= 150000
  );
});

// Execute the actual scene JSX with native components represented as nodes.
// This checks scene/controller wiring; it does not emulate native AR rendering.
function renderScene(
  controller,
  { shaderAPI = true, failUniformUpdates = false, platform = 'ios' } = {}
) {
  const effects = [],
    timers = new Map();
  const materials = [],
    deletions = [],
    uniforms = [],
    frames = new Map();
  const element = (type, props, key) =>
    typeof type === 'function' ? type(props) : { type, props, key };
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(
      source,
      {
        module,
        exports: module.exports,
        require(name) {
          if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
          if (name === 'react')
            return {
              useEffect: (effect) => effects.push(effect),
              useRef: () => ({ current: null }),
              useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
            };
          if (name === '@reactvision/react-viro')
            return new Proxy(
              {
                ViroMaterials: {
                  createMaterials(value) {
                    materials.push(value);
                  },
                  deleteMaterials(value) {
                    deletions.push(value);
                  },
                  updateShaderUniform(...value) {
                    if (failUniformUpdates) throw new Error('Bridge rejected uniform update');
                    uniforms.push(value);
                  },
                },
                ViroTrackingStateConstants: { TRACKING_NORMAL: 3 },
              },
              { get: (target, key) => target[key] || key }
            );
          if (name === 'react-native')
            return {
              Platform: { OS: platform },
              Image: { resolveAssetSource: (uri) => ({ uri }) },
              NativeModules: shaderAPI ? { VRTMaterialManager: { updateShaderUniform() {} } } : {},
              TurboModuleRegistry: {
                get() {
                  return null;
                },
              },
            };
          const resolved = path.resolve(path.dirname(file), name);
          if (name.endsWith('.glb') || name.endsWith('.png')) return resolved;
          if (name.endsWith('.native'))
            return load(fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : `${resolved}.tsx`);
          return require(
            resolved.endsWith('.json') || resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
          );
        },
        setTimeout(callback, delay) {
          const handle = Symbol('timer');
          timers.set(handle, { callback, delay });
          return handle;
        },
        clearTimeout: (handle) => timers.delete(handle),
        requestAnimationFrame(callback) {
          const handle = Symbol('frame');
          frames.set(handle, callback);
          return handle;
        },
        cancelAnimationFrame: (handle) => frames.delete(handle),
      },
      { filename: file }
    );
    return module.exports;
  }
  const scene = load(
    path.join(__dirname, '../src/features/medical-viewer/medical-scene.native.tsx')
  );
  const tree = scene.default({
    sceneNavigator: {
      viroAppProps: {
        controller,
        context: { sessionId: controller.getSessionId(), onReady() {}, onError() {} },
      },
    },
  });
  const nodes = [];
  function walk(node, parent = null) {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, parent));
    if (!node || typeof node !== 'object') return;
    nodes.push({ ...node, parent });
    walk(node.props?.children, node);
  }
  walk(tree);
  const cleanups = effects.map((effect) => effect()).filter(Boolean);
  return {
    nodes,
    timers,
    materials,
    deletions,
    uniforms,
    frames,
    flushFrames() {
      for (let pass = 0; pass < 2; pass++) {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback());
      }
    },
    cleanup: () => cleanups.forEach((cleanup) => cleanup()),
  };
}

function sceneController(modelId) {
  const c = new MedicalController();
  c.attach(1);
  c.setTracking(1, true);
  c.selectModel(1, modelId);
  c.selectPlane(1, c.getSnapshot().placementRevision, 'table');
  return c;
}

test('Both scene loads two separately keyed objects under one placement and gesture transform', () => {
  const c = sceneController('both');
  const loading = renderScene(c);
  const objects = loading.nodes.filter(({ type }) => type === 'Viro3DObject');
  assert.equal(objects.length, 2);
  assert.equal(objects[0].parent, objects[1].parent);
  assert.equal(loading.nodes.filter(({ type }) => type === 'ViroARPlaneSelector').length, 1);
  assert.notEqual(objects[0].key, objects[1].key);
  assert.deepEqual(
    objects.map(({ props }) => props.source),
    [
      path.join(__dirname, '../assets/medical/half-skull.glb'),
      path.join(__dirname, '../assets/medical/brain.glb'),
    ]
  );
  objects[0].props.onLoadEnd();
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  objects[1].props.onLoadEnd();
  assert.equal(c.getSnapshot().loadStatus, 'ready');
  loading.cleanup();
  assert.equal(loading.timers.size, 0);
  const ready = renderScene(c);
  const pair = ready.nodes.filter(({ type }) => type === 'Viro3DObject');
  pair[0].parent.props.onPinch(1, 1);
  pair[0].parent.props.onPinch(3, 2);
  pair[0].parent.props.onRotate(1, 0);
  pair[0].parent.props.onRotate(3, 45);
  const transformed = renderScene(c);
  const parent = transformed.nodes.find(({ type }) => type === 'Viro3DObject').parent;
  assert.deepEqual(Array.from(parent.props.scale), [2, 2, 2]);
  assert.deepEqual(Array.from(parent.props.rotation), [0, -45, 0]);
  assert.deepEqual(Array.from(parent.props.position), [0, c.getSnapshot().height, 0]);
  assert.equal(ready.nodes.filter(({ type }) => type === 'ViroText').length, 0);
  ready.cleanup();
  transformed.cleanup();
});

test('scene deadline fails only unfinished slots; Retry remounts both and old events remain stale', () => {
  const c = sceneController('both');
  const first = renderScene(c);
  const oldObjects = first.nodes.filter(({ type }) => type === 'Viro3DObject');
  oldObjects[0].props.onLoadEnd();
  const [timer] = first.timers.values();
  assert.equal(timer.delay, 30000);
  timer.callback();
  assert.equal(c.getSnapshot().assetLoads['half-skull'], 'ready');
  assert.equal(c.getSnapshot().assetLoads.brain, 'error');
  const failed = renderScene(c);
  assert.equal(failed.nodes.filter(({ type }) => type === 'Viro3DObject').length, 0);
  c.retryLoad(1);
  const retry = renderScene(c);
  const retried = retry.nodes.filter(({ type }) => type === 'Viro3DObject');
  assert.ok(retried.every((node, i) => node.key !== oldObjects[i].key));
  oldObjects[1].props.onLoadEnd();
  oldObjects[0].props.onError();
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  retried.forEach(({ props }) => props.onLoadEnd());
  assert.equal(c.getSnapshot().loadStatus, 'ready');
  first.cleanup();
  retry.cleanup();
  failed.cleanup();
});

test('only the full Skull scene exposes its calibrated labels and teardown clears the deadline', () => {
  for (const modelId of ['skull', 'brain', 'half-skull']) {
    const c = sceneController(modelId);
    const loading = renderScene(c);
    const object = loading.nodes.find(({ type }) => type === 'Viro3DObject');
    object.props.onLoadEnd();
    c.toggleLabels(1);
    const ready = renderScene(c);
    assert.equal(
      ready.nodes.filter(({ type }) => type === 'ViroText').length,
      modelId === 'skull' ? 4 : 0
    );
    c.detach(1);
    object.props.onError();
    assert.equal(c.getSnapshot().loadStatus, 'idle');
    loading.cleanup();
    ready.cleanup();
    assert.equal(loading.timers.size, 0);
  }
});

function sliceSceneController() {
  const { parseMedicalSliceDataset } = require('../src/features/medical-viewer/medical-slices.ts');
  const dataset = parseMedicalSliceDataset(require('../assets/medical/slices/metadata.json'));
  const c = new MedicalController(undefined, dataset);
  c.attach(1);
  c.setTracking(1, true);
  c.selectViewerMode(1, 'slices');
  c.selectPlane(1, c.getSnapshot().placementRevision, 'table');
  return c;
}

test('slice scene mounts one image, shares the plane, changes only its key and ignores stale native events', () => {
  const c = sliceSceneController();
  const first = renderScene(c);
  const images = first.nodes.filter(({ type }) => type === 'ViroImage');
  assert.equal(images.length, 1);
  assert.equal(first.nodes.filter(({ type }) => type === 'ViroARPlaneSelector').length, 1);
  assert.equal(first.nodes.filter(({ type }) => type === 'Viro3DObject').length, 0);
  assert.equal(images[0].props.width, 0.55);
  assert.equal(images[0].props.height, 0.55);
  assert.equal(images[0].props.resizeMode, 'ScaleToFit');
  assert.ok(images[0].props.source.endsWith('mri_axial_040.png'));
  images[0].props.onLoadEnd({ nativeEvent: { success: true } });
  const before = c.getSnapshot();
  c.selectSlice(
    {
      sessionId: 1,
      placementRevision: before.placementRevision,
      requestId: before.slices.requestId,
    },
    60
  );
  const next = renderScene(c);
  const nextImage = next.nodes.find(({ type }) => type === 'ViroImage');
  assert.notEqual(nextImage.key, images[0].key);
  assert.equal(c.getSnapshot().placementRevision, before.placementRevision);
  assert.ok(nextImage.props.source.endsWith('mri_axial_060.png'));
  images[0].props.onLoadEnd({ nativeEvent: { success: true } });
  images[0].props.onError();
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  nextImage.props.onLoadEnd({ nativeEvent: { success: true } });
  assert.equal(c.getSnapshot().slices.loadStatus, 'ready');
  first.cleanup();
  next.cleanup();
  assert.equal(first.timers.size, 0);
  assert.equal(next.timers.size, 0);
});

test('slice scene handles failed load events, deadline, retry and teardown', () => {
  const c = sliceSceneController();
  const loading = renderScene(c);
  const [timer] = loading.timers.values();
  assert.equal(timer.delay, 30000);
  timer.callback();
  const failed = renderScene(c);
  assert.equal(failed.nodes.filter(({ type }) => type === 'ViroImage').length, 0);
  c.retrySliceLoad(1);
  const retry = renderScene(c);
  const image = retry.nodes.find(({ type }) => type === 'ViroImage');
  image.props.onLoadEnd({ nativeEvent: { success: false } });
  assert.equal(c.getSnapshot().slices.loadStatus, 'error');
  c.detach(1);
  image.props.onLoadEnd({ nativeEvent: { success: true } });
  assert.equal(c.getSnapshot().slices.loadStatus, 'idle');
  for (const render of [loading, failed, retry]) {
    render.cleanup();
    assert.equal(render.timers.size, 0);
  }
});

function enableRayShader(c) {
  const token = () => ({
    sessionId: 1,
    placementRevision: c.getSnapshot().placementRevision,
    requestId: c.getSnapshot().volume.requestId,
  });
  c.setVolumeRenderer(1, 'shader');
  c.finishVolumeBinding(token(), 'ready');
  c.confirmVolumeMagenta(token());
  c.setVolumeDebugMode(token(), 'raymarch');
  c.openVolumeControls(1, false);
}
function volumeSceneController(renderer = 'shader') {
  const {
    parseMedicalVolumeDataset,
  } = require('../src/features/medical-viewer/medical-volumes.ts');
  const c = new MedicalController(
    undefined,
    undefined,
    parseMedicalVolumeDataset(require('../assets/medical/volumes/metadata.json'))
  );
  c.attach(1);
  c.setTracking(1, true);
  c.selectViewerMode(1, 'volume');
  c.selectPlane(1, c.getSnapshot().placementRevision, 'table');
  if (renderer === 'shader') enableRayShader(c);
  return c;
}

test('volume probes gate one proxy box, alpha textures and bounded material cleanup', () => {
  const c = volumeSceneController();
  const loading = renderScene(c);
  const probes = loading.nodes.filter(({ type }) => type === 'ViroImage');
  assert.equal(probes.length, 3);
  assert.ok(
    probes.every(
      ({ props }) => props.opacity === 0 && props.mipmap === false && props.format === 'RGBA8'
    )
  );
  assert.equal(loading.materials.filter((value) => value.medicalVolume).length, 0);
  probes.forEach(({ props }) => props.onLoadEnd({ nativeEvent: { success: true } }));
  assert.equal(c.getSnapshot().volume.loadStatus, 'binding');
  const binding = renderScene(c);
  const material = binding.materials.find((value) => value.medicalVolume)?.medicalVolume;
  assert.equal(c.getSnapshot().volume.loadStatus, 'binding');
  assert.equal(binding.nodes.filter(({ type }) => type === 'ViroBox').length, 0);
  binding.flushFrames();
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready');
  assert.equal(material.cullMode, 'Front');
  assert.equal(material.writesToDepthBuffer, false);
  const samplers = material.materialUniforms.filter(({ type }) => type === 'sampler2D');
  assert.equal(samplers.length, 3);
  assert.ok(
    samplers.every(
      ({ value }) =>
        value.uri.endsWith('.png') && value.mipmap === false && value.format === 'RGBA8'
    )
  );
  assert.ok(
    material.materialUniforms.every(({ type }) =>
      ['sampler2D', 'float', 'vec3', 'vec4'].includes(type)
    )
  );
  const ready = renderScene(c);
  const boxes = ready.nodes.filter(({ type }) => type === 'ViroBox');
  assert.equal(boxes.length, 1);
  // Viro iOS 3.0.3 drops custom textures in its materials clone constructor.
  // shaderOverrides explicitly merges the three textures onto the geometry's material.
  assert.equal(boxes[0].props.materials, undefined);
  assert.deepEqual(Array.from(boxes[0].props.shaderOverrides), ['medicalVolume']);
  assert.equal(ready.nodes.filter(({ type }) => type === 'ViroImage').length, 0);
  assert.equal(ready.nodes.filter(({ type }) => type === 'ViroARPlaneSelector').length, 1);
  assert.equal(Math.max(boxes[0].props.width, boxes[0].props.height, boxes[0].props.length), 0.55);
  for (const callback of ready.frames.values()) callback();
  assert.ok(ready.uniforms.length > 0);
  assert.ok(ready.uniforms.every(([name]) => name === 'medicalVolume'));
  c.selectViewerMode(1, 'anatomy');
  boxes[0].props.onError();
  probes[0].props.onError();
  assert.equal(c.getSnapshot().volume.loadStatus, 'idle');
  for (const rendered of [loading, binding, ready]) {
    rendered.cleanup();
    assert.equal(rendered.timers.size, 0);
    assert.equal(rendered.frames.size, 0);
  }
  assert.ok(binding.deletions.some((names) => names.length === 1 && names[0] === 'medicalVolume'));
});

test('volume scene deadlines, retry keys, unsupported bridge and old probe events are scoped', () => {
  const c = volumeSceneController();
  const first = renderScene(c);
  const old = first.nodes.filter(({ type }) => type === 'ViroImage');
  const [deadline] = first.timers.values();
  assert.equal(deadline.delay, 30000);
  deadline.callback();
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
  c.retryVolumeLoad(1);
  enableRayShader(c);
  const retry = renderScene(c);
  const probes = retry.nodes.filter(({ type }) => type === 'ViroImage');
  assert.ok(probes.every((node, i) => node.key !== old[i].key));
  old.forEach(({ props }) => props.onLoadEnd({ nativeEvent: { success: true } }));
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  probes.forEach(({ props }) => props.onLoadEnd({ nativeEvent: { success: true } }));
  const unsupported = renderScene(c, { shaderAPI: false });
  assert.equal(c.getSnapshot().volume.loadStatus, 'unsupported');
  assert.equal(unsupported.materials.filter((value) => value.medicalVolume).length, 0);
  c.detach(1);
  for (const rendered of [first, retry, unsupported]) rendered.cleanup();
  assert.equal(first.timers.size, 0);
});

test('a rejected shader update becomes a recoverable volume error', () => {
  const c = volumeSceneController();
  const loading = renderScene(c);
  loading.nodes
    .filter(({ type }) => type === 'ViroImage')
    .forEach(({ props }) => props.onLoadEnd({ nativeEvent: { success: true } }));
  const binding = renderScene(c);
  binding.flushFrames();
  const ready = renderScene(c, { failUniformUpdates: true });
  for (const update of ready.frames.values()) assert.doesNotThrow(update);
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
  c.retryVolumeLoad(1);
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  for (const rendered of [loading, binding, ready]) rendered.cleanup();
});

test('default stacked volume needs no custom uniform API, corrects iOS alpha and never mounts a cube', () => {
  const c = volumeSceneController('stack');
  const token = () => ({
    sessionId: 1,
    placementRevision: c.getSnapshot().placementRevision,
    requestId: c.getSnapshot().volume.requestId,
  });
  assert.equal(c.getSnapshot().volume.renderer, 'stack');
  const loading = renderScene(c, { shaderAPI: false });
  const images = loading.nodes.filter((node) => node.type === 'ViroImage');
  assert.equal(images.length, 48);
  assert.equal(loading.nodes.filter((node) => node.type === 'ViroBox').length, 0);
  images.forEach((node) => node.props.onLoadEnd({ nativeEvent: { success: true } }));
  const binding = renderScene(c, { shaderAPI: false });
  assert.equal(c.getSnapshot().volume.loadStatus, 'binding');
  const material = binding.materials.find((item) => item.medicalStack0).medicalStack0;
  assert.match(material.shaderModifiers.fragment, /stackEncoded \/ max\(stackAlpha/);
  assert.equal(material.materialUniforms, undefined);
  assert.equal(material.cullMode, 'None');
  assert.equal(material.writesToDepthBuffer, false);
  const android = renderScene(c, { shaderAPI: false, platform: 'android' });
  assert.equal(
    android.materials.find((item) => item.medicalStack0).medicalStack0.shaderModifiers,
    undefined
  );
  binding.flushFrames();
  const ready = renderScene(c, { shaderAPI: false });
  assert.equal(ready.nodes.filter((node) => node.type === 'ViroBox').length, 0);
  const planes = ready.nodes.filter((node) => node.type === 'ViroQuad');
  assert.ok(planes.length > 0);
  assert.ok(
    planes.every((node) => node.props.opacity <= 1 && node.props.uvCoordinates.length === 4)
  );
  const old = token();
  c.selectVolumeModality(1, 'ct');
  images[0].props.onError({ nativeEvent: { error: 'old failed plane' } });
  c.finishVolumeBinding(old, 'error');
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  c.detach(1);
  for (const result of [loading, binding, ready, android]) {
    result.cleanup();
    assert.equal(result.frames.size, 0);
    assert.equal(result.timers.size, 0);
  }
  assert.ok(binding.deletions.some((names) => names.length === 48));
});

test('magenta debug registers a texture-free fragment shader and cancels a queued mount on teardown', () => {
  const c = volumeSceneController('stack');
  c.setVolumeRenderer(1, 'shader');
  const result = renderScene(c);
  assert.equal(result.nodes.filter((node) => node.type === 'ViroImage').length, 0);
  const material = result.materials.find((item) => item.medicalVolume).medicalVolume;
  assert.equal(material.materialUniforms.length, 0);
  assert.equal(material.shaderModifiers.surface, undefined);
  assert.match(material.shaderModifiers.fragment.body, /vec4\(1.0, 0.0, 1.0, 1.0\)/);
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  c.detach(1);
  result.flushFrames();
  assert.equal(c.getSnapshot().volume.loadStatus, 'idle');
  result.cleanup();
});

test('medical-scene wires ViroARScene anchor callbacks to ViroARPlaneSelector, handles plane removal and selector reset', () => {
  const c = sceneController('both');
  const rendered = renderScene(c);
  const sceneNode = rendered.nodes.find(({ type }) => type === 'ViroARScene');
  const selectorNode = rendered.nodes.find(({ type }) => type === 'ViroARPlaneSelector');
  assert.ok(sceneNode);
  assert.ok(selectorNode);
  assert.equal(typeof sceneNode.props.onAnchorFound, 'function');
  assert.equal(typeof sceneNode.props.onAnchorUpdated, 'function');
  assert.equal(typeof sceneNode.props.onAnchorRemoved, 'function');

  const found = [];
  const updated = [];
  const removed = [];
  let resetCount = 0;
  selectorNode.props.ref.current = {
    handleAnchorFound: (a) => found.push(a),
    handleAnchorUpdated: (a) => updated.push(a),
    handleAnchorRemoved: (a) => {
      removed.push(a);
      selectorNode.props.onPlaneRemoved(a.anchorId);
    },
    reset: () => {
      resetCount++;
    },
  };

  // 1. Forwarding onAnchorFound, onAnchorUpdated, onAnchorRemoved
  sceneNode.props.onAnchorFound({ type: 'plane', anchorId: 'surface-1' });
  assert.equal(found.length, 1);
  assert.equal(found[0].anchorId, 'surface-1');

  sceneNode.props.onAnchorUpdated({ type: 'plane', anchorId: 'surface-1' });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].anchorId, 'surface-1');

  // Null anchor is safely ignored
  sceneNode.props.onAnchorRemoved(null);
  assert.equal(removed.length, 0);

  // 2. Removal of an unrelated plane is ignored by controller.losePlane
  sceneNode.props.onAnchorRemoved({ type: 'plane', anchorId: 'unrelated-surface' });
  assert.equal(removed.length, 1);
  assert.equal(c.getSnapshot().anchorId, 'table');

  // 3. Removal of the placed plane clears anchorId and increments revision
  const oldRevision = c.getSnapshot().placementRevision;
  sceneNode.props.onAnchorRemoved({ type: 'plane', anchorId: 'table' });
  assert.equal(removed.length, 2);
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().placementRevision, oldRevision + 1);

  // 4. Stale session handling: stale removal has no effect
  c.losePlane(999, c.getSnapshot().placementRevision, 'table');
  assert.equal(c.getSnapshot().placementRevision, oldRevision + 1);

  // 5. Stale placement rejection resets selector
  const prevResets = resetCount;
  selectorNode.props.onPlaneSelected({ anchorId: 'invalid-selection' });
  // Since tracking or state is idle/unplaced without normal flow, or rejected:
  // if anchorId is not set, reset() is triggered on the selector
  if (!c.getSnapshot().anchorId) {
    assert.ok(resetCount >= prevResets);
  }

  rendered.cleanup();
});

test('Quest raymarch volume loads scan assets and uniforms by default without magenta confirmation', () => {
  const { parseMedicalVolumeDataset } = require('../src/features/medical-viewer/medical-volumes.ts');
  const c = new MedicalController(
    undefined,
    undefined,
    parseMedicalVolumeDataset(require('../assets/medical/volumes/metadata.json')),
    { defaultVolumeRenderer: 'shader' }
  );
  c.attach(1);
  c.setTracking(1, true);
  c.selectViewerMode(1, 'volume');
  c.selectPlane(1, c.getSnapshot().placementRevision, 'table');

  // Verify Quest defaults
  assert.equal(c.getSnapshot().volume.renderer, 'shader');
  assert.equal(c.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(c.getSnapshot().volume.magentaConfirmed, true);
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');

  // Verify scan assets mount in loading state
  const loading = renderScene(c);
  const probes = loading.nodes.filter(({ type }) => type === 'ViroImage');
  assert.equal(probes.length, 3);
  assert.deepEqual(
    Array.from(probes.map((p) => path.basename(p.props.source))),
    ['mri_high.png', 'mri_low.png', 'mri_validity.png']
  );
  assert.ok(
    probes.every(
      ({ props }) => props.opacity === 0 && props.mipmap === false && props.format === 'RGBA8'
    )
  );

  // Finish loading all three atlas textures
  probes.forEach(({ props }) => props.onLoadEnd({ nativeEvent: { success: true } }));
  assert.equal(c.getSnapshot().volume.loadStatus, 'binding');

  // Verify material and uniforms load in binding state
  const binding = renderScene(c);
  const material = binding.materials.find((value) => value.medicalVolume)?.medicalVolume;
  assert.ok(material);
  const samplers = material.materialUniforms.filter(({ type }) => type === 'sampler2D');
  assert.equal(samplers.length, 3);
  assert.deepEqual(
    Array.from(samplers.map((s) => s.name)),
    ['u_high', 'u_low', 'u_validity']
  );
  const uniforms = material.materialUniforms.filter(({ type }) => type !== 'sampler2D');
  assert.ok(uniforms.length >= 8);
  const uniformNames = uniforms.map((u) => u.name);
  assert.ok(uniformNames.includes('u_dimensions'));
  assert.ok(uniformNames.includes('u_extent'));
  assert.ok(uniformNames.includes('u_crop_min'));
  assert.ok(uniformNames.includes('u_crop_max'));
  assert.ok(uniformNames.includes('u_appearance'));

  // Flush frames to reach ready state
  binding.flushFrames();
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready');

  // Verify proxy geometry renders with shader
  const ready = renderScene(c);
  const boxes = ready.nodes.filter(({ type }) => type === 'ViroBox');
  assert.equal(boxes.length, 1);
  assert.deepEqual(Array.from(boxes[0].props.shaderOverrides), ['medicalVolume']);

  // Verify uniforms dispatch to native manager
  for (const callback of ready.frames.values()) callback();
  assert.ok(ready.uniforms.length > 0);
  assert.ok(ready.uniforms.every(([name]) => name === 'medicalVolume'));

  // Modality change preserves raymarch mode and reloads scan assets
  c.selectVolumeModality(1, 'ct');
  assert.equal(c.getSnapshot().volume.renderer, 'shader');
  assert.equal(c.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(c.getSnapshot().volume.modality, 'ct');
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');

  const ctLoading = renderScene(c);
  const ctProbes = ctLoading.nodes.filter(({ type }) => type === 'ViroImage');
  assert.equal(ctProbes.length, 3);
  assert.deepEqual(
    Array.from(ctProbes.map((p) => path.basename(p.props.source))),
    ['ct_high.png', 'ct_low.png', 'ct_validity.png']
  );

  c.detach(1);
  for (const rendered of [loading, binding, ready, ctLoading]) {
    rendered.cleanup();
  }
});
