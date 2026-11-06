const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MedicalController,
} = require('../src/features/medical-viewer/medical-controller.ts');
const {
  parseMedicalVolumeDataset,
  VOLUME_ATLASES,
} = require('../src/features/medical-viewer/medical-volumes.ts');
const {
  volumeExtent,
} = require('../src/features/medical-viewer/medical-volume-uniforms.ts');
const {
  volumeDiagnosticShader,
} = require('../src/features/medical-viewer/medical-volume-diagnostics.ts');
const {
  isViroImageLoadSuccess: isViroImageLoadSuccessCore,
} = require('../src/features/medical-viewer/medical-image-events-core.ts');
const {
  isViroImageLoadSuccess,
} = require('../src/features/medical-viewer/medical-image-events.ts');
const volumeMetadata = require('../assets/medical/volumes/metadata.json');
const stackMetadata = require('../assets/medical/stack/metadata.json');

// 1. OBJ proxy geometry, baked dimensions, outward winding, per-face normals and UVs
test('volume proxy OBJ mesh exists with baked metric dimensions, outward winding, per-face normals and 0-1 UVs', () => {
  const objPath = path.resolve(__dirname, '../assets/medical/volumes/volume-box.obj');
  assert.ok(fs.existsSync(objPath), 'volume-box.obj must exist');
  const text = fs.readFileSync(objPath, 'utf8');

  const vertices = [];
  const normals = [];
  const uvs = [];
  const faces = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'v') {
      vertices.push(parts.slice(1).map(Number));
    } else if (parts[0] === 'vn') {
      normals.push(parts.slice(1).map(Number));
    } else if (parts[0] === 'vt') {
      uvs.push(parts.slice(1).map(Number));
    } else if (parts[0] === 'f') {
      faces.push(
        parts.slice(1).map((token) => {
          const [v, vt, vn] = token.split('/').map(Number);
          return { v: v - 1, vt: vt - 1, vn: vn - 1 };
        })
      );
    }
  }

  assert.equal(vertices.length, 8, 'Box has 8 vertices');
  assert.equal(normals.length, 6, 'Box has 6 face normals');
  assert.equal(uvs.length, 4, 'Box has 4 UV texture coordinates');
  assert.equal(faces.length, 12, 'Box has 12 triangles (2 per face)');

  const dataset = parseMedicalVolumeDataset(volumeMetadata);
  const extent = volumeExtent(dataset);
  const expectedHx = extent[0] / 2;
  const expectedHy = extent[2] / 2;
  const expectedHz = extent[1] / 2;

  // Verify vertex bounds match extent
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of vertices) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    max[2] = Math.max(max[2], z);
  }

  assert.ok(Math.abs(min[0] - -expectedHx) < 1e-6);
  assert.ok(Math.abs(max[0] - expectedHx) < 1e-6);
  assert.ok(Math.abs(min[1] - -expectedHy) < 1e-6);
  assert.ok(Math.abs(max[1] - expectedHy) < 1e-6);
  assert.ok(Math.abs(min[2] - -expectedHz) < 1e-6);
  assert.ok(Math.abs(max[2] - expectedHz) < 1e-6);

  // Verify normals are unit length
  for (const n of normals) {
    const len = Math.hypot(...n);
    assert.ok(Math.abs(len - 1.0) < 1e-6, `Normal ${n} must be unit length`);
  }

  // Verify UV coordinates span [0, 1]
  for (const [u, v] of uvs) {
    assert.ok(u >= 0 && u <= 1, `UV u=${u} out of [0, 1]`);
    assert.ok(v >= 0 && v <= 1, `UV v=${v} out of [0, 1]`);
  }

  // Verify outward CCW winding: for each triangle, cross product of edges must point in normal direction
  for (let i = 0; i < faces.length; i++) {
    const [t0, t1, t2] = faces[i];
    const p0 = vertices[t0.v];
    const p1 = vertices[t1.v];
    const p2 = vertices[t2.v];
    const vn = normals[t0.vn];

    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cross = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const area = Math.hypot(...cross);
    assert.ok(area > 0, `Degenerate triangle ${i}`);
    const unitCross = cross.map((c) => c / area);
    const dot = unitCross[0] * vn[0] + unitCross[1] * vn[1] + unitCross[2] * vn[2];
    assert.ok(dot > 0.99, `Triangle ${i} winding does not match outward normal`);
  }
});

// 2. Shared image completion adapter contract
test('isViroImageLoadSuccess respects explicit boolean, tolerates Android null payload, rejects iOS unexpected shapes', () => {
  for (const fn of [isViroImageLoadSuccessCore, isViroImageLoadSuccess]) {
    // Explicit boolean contract on all platforms
    assert.equal(fn({ nativeEvent: { success: true } }, 'android'), true);
    assert.equal(fn({ nativeEvent: { success: false } }, 'android'), false);
    assert.equal(fn({ nativeEvent: { success: true } }, 'ios'), true);
    assert.equal(fn({ nativeEvent: { success: false } }, 'ios'), false);

    // Explicit boolean with target metadata
    assert.equal(fn({ target: 42, nativeEvent: { success: true, target: 42 } }, 'android'), true);
    assert.equal(fn({ target: 42, nativeEvent: { success: false, target: 42 } }, 'android'), false);
    assert.equal(fn({ target: 42, nativeEvent: { success: true, target: 42 } }, 'ios'), true);
    assert.equal(fn({ target: 42, nativeEvent: { success: false, target: 42 } }, 'ios'), false);

    // Android verified contract: absent or null/empty nativeEvent payload is tolerated as success
    assert.equal(fn({ nativeEvent: null }, 'android'), true);
    assert.equal(fn({ nativeEvent: undefined }, 'android'), true);
    assert.equal(fn({ nativeEvent: {} }, 'android'), true);
    assert.equal(fn(null, 'android'), true);
    assert.equal(fn(undefined, 'android'), true);
    assert.equal(fn({}, 'android'), true);

    // Android supported target metadata without success boolean is accepted as success
    assert.equal(fn({ target: 42 }, 'android'), true);
    assert.equal(fn({ target: 42, nativeEvent: null }, 'android'), true);
    assert.equal(fn({ target: 42, nativeEvent: {} }, 'android'), true);
    assert.equal(fn({ nativeEvent: { target: 42 } }, 'android'), true);
    assert.equal(fn({ nativeEvent: { target: 42, currentTarget: 42 } }, 'android'), true);

    // Non-boolean success on Android and iOS is rejected
    assert.equal(fn({ nativeEvent: { success: 'ok' } }, 'android'), false);
    assert.equal(fn({ nativeEvent: { success: 1 } }, 'android'), false);
    assert.equal(fn({ nativeEvent: { success: null } }, 'android'), false);
    assert.equal(fn({ nativeEvent: { success: 'true' } }, 'ios'), false);
    assert.equal(fn({ nativeEvent: { success: 1 } }, 'ios'), false);

    // Unexpected primitive events on all platforms are rejected
    assert.equal(fn('success', 'android'), false);
    assert.equal(fn(123, 'android'), false);
    assert.equal(fn(true, 'android'), false);
    assert.equal(fn(false, 'android'), false);
    assert.equal(fn('success', 'ios'), false);
    assert.equal(fn(123, 'ios'), false);
    assert.equal(fn(true, 'ios'), false);

    // Array events on all platforms are rejected
    assert.equal(fn([], 'android'), false);
    assert.equal(fn([1, 2, 3], 'android'), false);
    assert.equal(fn([], 'ios'), false);

    // Malformed nativeEvent (array or primitives) is rejected
    assert.equal(fn({ nativeEvent: [] }, 'android'), false);
    assert.equal(fn({ nativeEvent: [1, 2, 3] }, 'android'), false);
    assert.equal(fn({ nativeEvent: 'invalid' }, 'android'), false);
    assert.equal(fn({ nativeEvent: 123 }, 'android'), false);
    assert.equal(fn({ nativeEvent: true }, 'android'), false);
    assert.equal(fn({ nativeEvent: [] }, 'ios'), false);

    // Android payload keys are renderer metadata, never a failure signal: VRTImage emits
    // onLoadEndViro with a null map and reports failures only through onErrorViro.
    assert.equal(fn({ nativeEvent: { arbitrary: 123 } }, 'android'), true);
    assert.equal(fn({ nativeEvent: { target: 'invalid-tag' } }, 'android'), true);

    // Exact RN 0.86 Fabric runtime shape. Each layer adds keys a whitelist would reject:
    // - Viro: ViroEventEmitter.emit(ctx, tag, 'onLoadEndViro', null)
    // - Android Fabric: null WritableMap -> {} (EventEmitterWrapper.cpp)
    // - UIManagerBinding::dispatchEvent mixes in `target` (tag) and `timeStamp` (ms)
    // - ReactFabric SyntheticEvent: own keys incl. _targetInst (Fiber), dispatchConfig,
    //   target (public instance object), Interface fields and function props
    const fabricLoadEnd = (payload = {}) => ({
      dispatchConfig: { registrationName: 'onLoadEndViro' },
      _targetInst: { tag: 5, stateNode: {}, memoizedProps: {} },
      nativeEvent: { ...payload, target: 1126, timeStamp: 52474.318 },
      _dispatchInstances: null,
      _dispatchListeners: null,
      type: 'topLoadEndViro',
      target: { __nativeTag: 1126 },
      currentTarget: null,
      eventPhase: undefined,
      bubbles: undefined,
      cancelable: undefined,
      timeStamp: 52474.318,
      defaultPrevented: undefined,
      isTrusted: undefined,
      isDefaultPrevented: () => false,
      isPropagationStopped: () => false,
    });
    assert.equal(fn(fabricLoadEnd(), 'android'), true);
    assert.equal(fn(fabricLoadEnd({ success: false }), 'android'), false);
    assert.equal(fn(fabricLoadEnd({ success: true }), 'ios'), true);
    assert.equal(fn(fabricLoadEnd({ success: false }), 'ios'), false);
    assert.equal(fn(fabricLoadEnd(), 'ios'), false);

    // iOS contract: rejects absent/null/empty/target-only payload shapes as failure
    assert.equal(fn({ nativeEvent: null }, 'ios'), false);
    assert.equal(fn({ nativeEvent: undefined }, 'ios'), false);
    assert.equal(fn({ nativeEvent: {} }, 'ios'), false);
    assert.equal(fn(null, 'ios'), false);
    assert.equal(fn(undefined, 'ios'), false);
    assert.equal(fn({}, 'ios'), false);
    assert.equal(fn({ target: 42 }, 'ios'), false);
    assert.equal(fn({ nativeEvent: { target: 42 } }, 'ios'), false);
  }
});

// 3. Late current-request errors are authoritative while stale errors are ignored
test('controller accepts late current-request atlas errors after binding/ready while ignoring stale events', () => {
  const dataset = parseMedicalVolumeDataset(volumeMetadata);
  const c = new MedicalController(undefined, undefined, dataset, { defaultVolumeRenderer: 'shader' });
  const sessionId = 1;
  c.attach(sessionId);
  c.setTracking(sessionId, true);
  c.selectViewerMode(sessionId, 'volume');
  c.selectPlane(sessionId, c.getSnapshot().placementRevision, 'table');

  const getScope = () => ({
    sessionId,
    placementRevision: c.getSnapshot().placementRevision,
    requestId: c.getSnapshot().volume.requestId,
  });

  // Load all 3 atlases
  VOLUME_ATLASES.forEach((atlas) => c.finishVolumeAtlas(getScope(), atlas, true));
  assert.equal(c.getSnapshot().volume.loadStatus, 'binding');

  // Finish binding to reach ready
  c.finishVolumeBinding(getScope(), 'ready');
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready');

  // Stale event from outdated requestId should be ignored
  const staleScope = { ...getScope(), requestId: getScope().requestId - 1 };
  c.finishVolumeAtlas(staleScope, 'high', false);
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready', 'Stale error must be ignored');

  // Late failure on CURRENT request after ready is authoritative and transitions to error
  c.finishVolumeAtlas(getScope(), 'high', false);
  assert.equal(c.getSnapshot().volume.loadStatus, 'error', 'Late current-request error must transition to error');

  // Retry is recoverable
  c.retryVolumeLoad(sessionId);
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
});

// 4. Simultaneous 3-sampler diagnostic shader
test('volumeDiagnosticShader samplers mode binds high, low, and validity in one draw with GPU comparison', () => {
  const probe = stackMetadata.probes.mri;
  const shader = volumeDiagnosticShader('samplers', probe, [160, 160, 149]);

  assert.equal(shader.entry, 'surface');
  assert.deepEqual(shader.textures, ['high', 'low', 'validity']);
  assert.match(shader.uniforms, /u_high/);
  assert.match(shader.uniforms, /u_low/);
  assert.match(shader.uniforms, /u_validity/);

  // Verifies fixed probe, reference, empty UV sampling, asymmetric orientation marker and passAll comparison
  assert.match(shader.body, /probeUV/);
  assert.match(shader.body, /emptyUV/);
  assert.match(shader.body, /actualHigh/);
  assert.match(shader.body, /actualLow/);
  assert.match(shader.body, /actualVal/);
  assert.match(shader.body, /passAll/);
  assert.match(shader.body, /tol = 1.5 \/ 255.0/);
  // Asymmetric orientation marker: magenta with yellow corner
  assert.match(shader.body, /vec4\(1.0, 1.0, 0.0, 1.0\)/);
  assert.match(shader.body, /vec4\(1.0, 0.0, 1.0, 1.0\)/);
});

// 5. Quest diagnostic mode selection in controller
test('Quest controller validates and allows switching between all diagnostic modes', () => {
  const dataset = parseMedicalVolumeDataset(volumeMetadata);
  const c = new MedicalController(undefined, undefined, dataset, { defaultVolumeRenderer: 'shader' });
  const sessionId = 1;
  c.attach(sessionId);
  c.setTracking(sessionId, true);
  c.selectViewerMode(sessionId, 'volume');
  c.selectPlane(sessionId, c.getSnapshot().placementRevision, 'table');

  const getScope = () => ({
    sessionId,
    placementRevision: c.getSnapshot().placementRevision,
    requestId: c.getSnapshot().volume.requestId,
  });

  const modes = [
    'magenta',
    'samplers',
    'uniforms',
    'coordinates',
    'ray',
    'opacity',
    'raymarch',
  ];

  for (const mode of modes) {
    c.setVolumeDebugMode(getScope(), mode);
    assert.equal(c.getSnapshot().volume.debugMode, mode, `Debug mode ${mode} should be selected on Quest`);
  }
});
