const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  MedicalController,
  canManipulateVolume,
  medicalStatus,
} = require('../src/features/medical-viewer/medical-controller.ts');
const {
  parseMedicalVolumeDataset,
  VOLUME_ATLASES,
  VolumeControlScheduler,
  initialVolumeCrop,
} = require('../src/features/medical-viewer/medical-volumes.ts');
const {
  volumeUniforms,
  volumeExtent,
} = require('../src/features/medical-viewer/medical-volume-uniforms.ts');
const metadata = require('../assets/medical/volumes/metadata.json');
const stack = require('../assets/medical/stack/metadata.json');
const { stackPlaneGeometry } = require('../src/features/medical-viewer/medical-volume-stack.ts');
const {
  volumeDiagnosticShader,
} = require('../src/features/medical-viewer/medical-volume-diagnostics.ts');
const data = parseMedicalVolumeDataset(metadata);
const scope = (c) => ({
  sessionId: c.getSnapshot().sessionId,
  placementRevision: c.getSnapshot().placementRevision,
  requestId: c.getSnapshot().volume.requestId,
});
function viewer(dataset = data) {
  const c = new MedicalController(undefined, undefined, dataset);
  c.attach(1);
  c.setTracking(1, true);
  c.selectPlane(1, c.getSnapshot().placementRevision, 'table');
  return c;
}
function volume() {
  const c = viewer();
  c.selectViewerMode(1, 'volume');
  c.setVolumeRenderer(1, 'shader');
  ready(c);
  return c;
}
function ready(c) {
  if (c.getSnapshot().volume.renderer === 'stack') {
    for (let index = 0; index < 48; index++) c.finishVolumeStackImage(scope(c), index, true);
    c.finishVolumeBinding(scope(c), 'ready');
    return;
  }
  if (c.getSnapshot().volume.debugMode === 'magenta') {
    c.finishVolumeBinding(scope(c), 'ready');
    c.confirmVolumeMagenta(scope(c));
    c.setVolumeDebugMode(scope(c), 'raymarch');
  }
  VOLUME_ATLASES.forEach((key) => c.finishVolumeAtlas(scope(c), key, true));
  c.finishVolumeBinding(scope(c), 'ready');
  c.openVolumeControls(1, false);
}

test('volume XYZ position preserves scientific crop/appearance and pose through surface changes; stale callbacks cannot move it', () => {
  const c = volume(),
    token = scope(c);
  const crop = c.getSnapshot().volume.crop;
  const appearance = c.getSnapshot().volume.appearance;
  c.setVolumePosition(token, 'x', 0.4);
  c.setVolumePosition(token, 'z', -0.2);
  c.setVolumePosition(token, 'y', 0.8);
  c.setVolumeTransform(token, 'scale', 2);
  c.setVolumeTransform(token, 'yaw', 90);
  assert.equal(c.getSnapshot().volume.x, 0.4);
  assert.equal(c.getSnapshot().volume.z, -0.2);
  assert.equal(c.getSnapshot().volume.crop, crop);
  assert.equal(c.getSnapshot().volume.appearance, appearance);
  assert.equal(c.getSnapshot().x, 0);
  c.reposition(1);
  c.selectPlane(1, c.getSnapshot().placementRevision, 'floor');
  ready(c);
  const moved = c.getSnapshot();
  c.setVolumePosition(token, 'x', 1);
  assert.equal(c.getSnapshot(), moved);
  c.setVolumePosition(scope(c), 'x', 99);
  c.setVolumePosition(scope(c), 'z', -99);
  c.setVolumePosition(scope(c), 'y', 99);
  assert.equal(c.getSnapshot().volume.x, 1.524);
  assert.equal(c.getSnapshot().volume.z, -1.524);
  assert.equal(c.getSnapshot().volume.height, 1.524);
  const bounded = c.getSnapshot();
  c.setVolumePosition(scope(c), 'x', Infinity);
  c.setVolumePosition(scope(c), 'invalid', 1);
  assert.equal(c.getSnapshot(), bounded);
  c.resetVolumeTransform(1);
  assert.equal(c.getSnapshot().volume.x, 0);
  assert.equal(c.getSnapshot().volume.z, 0);
  assert.equal(c.getSnapshot().volume.height, 0.6096);
});

test('real volume assets retain source identity, scalar precision, geometry, and bounded atlas sizes', () => {
  assert.equal(data.error, null);
  assert.deepEqual(data.dimensions, [160, 160, 149]);
  assert.equal(data.series.length, 2);
  assert.equal(
    metadata.provenance.sourceSceneSha256,
    '998783662535ddd9619709cfce38b262da9bd3ca4ff588ad80f37b228d96d598'
  );
  assert.equal(metadata.provenance.sourceNodesUnchanged, true);
  let total = 0;
  for (const series of metadata.series) {
    assert.ok(series.quantizationMaxError <= series.scalarScale / 2 + 1e-6);
    assert.equal(series.geometry.parentTransformId === null, series.modality === 'mri');
    for (const key of VOLUME_ATLASES) {
      const image = series.atlases[key],
        bytes = fs.readFileSync(path.join(__dirname, '../assets/medical/volumes', image.filename));
      assert.equal(image.bytes, bytes.length);
      assert.equal(image.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], data.atlas.dimensions);
      assert.equal(bytes[25], 6);
      total += bytes.length;
    }
  }
  assert.equal(total, metadata.imageBytes);
  assert.ok(total < 20 * 1024 * 1024);
});
test('malformed volume metadata fails recoverably before native binding', () => {
  for (const mutate of [
    (d) => (d.schemaVersion = 0),
    (d) => (d.atlas.gutter = 0),
    (d) => (d.grid.spacingMm = 0),
    (d) => (d.grid.boundsRasMm[1] = d.grid.boundsRasMm[0]),
    (d) => d.series.push(d.series[0]),
    (d) => (d.series[0].atlases.high.filename = '../bad.png'),
    (d) => (d.series[0].scalarScale = 0),
    (d) => (d.atlas.dimensions[0] = 8192),
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.ok(parseMedicalVolumeDataset(copy).error);
  }
});
test('anatomy Both stays the opening default; 3D Scan starts with the full MRI at visible opacity', () => {
  const c = viewer();
  assert.equal(c.getSnapshot().mode, 'anatomy');
  assert.equal(c.getSnapshot().modelId, 'both');
  c.selectViewerMode(1, 'volume');
  assert.equal(c.getSnapshot().volume.modality, 'mri');
  assert.deepEqual(c.getSnapshot().volume.crop, initialVolumeCrop(data.boundsRasMm));
  assert.deepEqual(c.getSnapshot().volume.crop, data.boundsRasMm);
  assert.equal(c.getSnapshot().volume.appearance.mri.opacity, 1.6);
  assert.equal(c.getSnapshot().volume.appearance.ct.opacity, 1.6);
  assert.equal(c.getSnapshot().anchorId, 'table');
  assert.equal(c.getSnapshot().volume.appearance.mri.level, 2671.5);
  assert.equal(c.getSnapshot().volume.yaw, 135);
});
test('all three atlas successes precede binding; failures, deadlines, retry, and stale events stay scoped', () => {
  const c = viewer();
  c.selectViewerMode(1, 'volume');
  c.setVolumeRenderer(1, 'shader');
  c.finishVolumeBinding(scope(c), 'ready');
  c.confirmVolumeMagenta(scope(c));
  c.setVolumeDebugMode(scope(c), 'raymarch');
  const old = scope(c);
  c.finishVolumeBinding(old, 'ready');
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  c.finishVolumeAtlas(old, 'high', true);
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  c.finishVolumeAtlas(old, 'low', false);
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
  c.retryVolumeLoad(1);
  c.finishVolumeBinding(scope(c), 'ready');
  c.confirmVolumeMagenta(scope(c));
  c.setVolumeDebugMode(scope(c), 'raymarch');
  const retry = scope(c);
  assert.ok(retry.requestId > old.requestId);
  c.finishVolumeAtlas(old, 'validity', true);
  assert.deepEqual(c.getSnapshot().volume.atlasLoads, {});
  ready(c);
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready');
  c.finishVolumeBinding(old, 'error');
  assert.equal(c.getSnapshot().volume.loadStatus, 'ready');
  c.finishVolumeBinding(retry, 'error');
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
  c.retryVolumeLoad(1);
  c.finishVolumeBinding(scope(c), 'error');
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
});
test('CT MRI round trips preserve physical crop and transforms with independent appearance settings', () => {
  const c = volume();
  c.setVolumeTransform(scope(c), 'scale', 2);
  c.setVolumeCrop(scope(c), 2, -100);
  c.setVolumeAppearance(scope(c), 'window', 3000);
  const crop = c.getSnapshot().volume.crop;
  c.selectVolumeModality(1, 'ct');
  ready(c);
  assert.equal(c.getSnapshot().volume.appearance.ct.window, 1800);
  c.setVolumePreset(scope(c), 'ct-soft-tissue');
  assert.equal(c.getSnapshot().volume.appearance.ct.level, 40);
  c.setVolumeAppearance(scope(c), 'level', 60);
  c.selectVolumeModality(1, 'mri');
  ready(c);
  assert.equal(c.getSnapshot().volume.appearance.mri.window, 3000);
  assert.equal(c.getSnapshot().volume.scale, 2);
  assert.deepEqual(c.getSnapshot().volume.crop, crop);
  c.selectVolumeModality(1, 'ct');
  assert.equal(c.getSnapshot().volume.appearance.ct.level, 60);
});
test('all six crop boundaries clamp to physical bounds and a one-voxel separation', () => {
  const c = volume();
  c.resetVolumeCrop(1);
  for (let boundary = 0; boundary < 6; boundary++) {
    c.setVolumeCrop(scope(c), boundary, boundary % 2 ? -1e6 : 1e6);
    const b = c.getSnapshot().volume.crop,
      axis = Math.floor(boundary / 2);
    assert.ok(b[axis * 2 + 1] - b[axis * 2] >= data.spacingMm - 1e-8);
    assert.ok(b[axis * 2] >= data.boundsRasMm[axis * 2]);
    assert.ok(b[axis * 2 + 1] <= data.boundsRasMm[axis * 2 + 1]);
  }
  const before = c.getSnapshot();
  c.setVolumeCrop(scope(c), 99, 10);
  c.setVolumeCrop(scope(c), 0, NaN);
  assert.equal(c.getSnapshot(), before);
});
test('appearance bounds, preset isolation, transparency, quality and crop reset have defined defaults', () => {
  const c = volume();
  c.setVolumePreset(scope(c), 'ct-bone');
  assert.equal(c.getSnapshot().volume.appearance.mri.preset, 'mri-grayscale');
  c.setVolumeAppearance(scope(c), 'window', -1);
  assert.equal(c.getSnapshot().volume.appearance.mri.window, 1);
  c.setVolumeAppearance(scope(c), 'opacity', 10);
  assert.equal(c.getSnapshot().volume.appearance.mri.opacity, 2);
  c.configureVolume(scope(c), { cropping: false, quality: 'fast', cropBoxVisible: true });
  assert.deepEqual(
    volumeUniforms(data, c.getVolumeSeries(), c.getSnapshot().volume).u_crop_min,
    [0, 0, 0]
  );
  assert.equal(volumeUniforms(data, c.getVolumeSeries(), c.getSnapshot().volume).u_samples, 96);
  c.resetVolumeScan(1);
  assert.equal(c.getSnapshot().volume.appearance.mri.window, 5589);
  assert.equal(c.getSnapshot().volume.cropping, true);
  c.resetVolumeCrop(1);
  assert.deepEqual(c.getSnapshot().volume.crop, data.boundsRasMm);
});
test('mode switches isolate all transforms and reject callbacks from an earlier representation', () => {
  const c = volume(),
    old = scope(c);
  c.setVolumeTransform(old, 'height', 1);
  c.selectViewerMode(1, 'anatomy');
  c.setVolumeAppearance(old, 'window', 20);
  assert.equal(c.getSnapshot().height, 0.6096);
  c.selectViewerMode(1, 'slices');
  assert.equal(c.getSnapshot().slices.height, 0.6096);
  c.selectViewerMode(1, 'volume');
  ready(c);
  assert.equal(c.getSnapshot().volume.height, 1);
  assert.equal(c.getSnapshot().volume.appearance.mri.window, 5589);
  c.resetVolumeTransform(1);
  assert.equal(c.getSnapshot().volume.height, 0.6096);
});
test('controls sheet, tracking and lifecycle prevent gestures and invalidate pending requests', () => {
  const c = volume();
  assert.ok(canManipulateVolume(c.getSnapshot()));
  c.volumeGesture(scope(c), 'pinch', 1, 1);
  c.volumeGesture(scope(c), 'pinch', 2, 2);
  assert.equal(c.getSnapshot().volume.scale, 2);
  c.openVolumeControls(1, true);
  assert.equal(canManipulateVolume(c.getSnapshot()), false);
  assert.equal(c.getSnapshot().volume.pinching, false);
  c.openVolumeControls(1, false);
  c.setTracking(1, false);
  assert.equal(canManipulateVolume(c.getSnapshot()), false);
  c.setTracking(1, true);
  const old = scope(c);
  c.reposition(1);
  c.finishVolumeBinding(old, 'ready');
  assert.equal(c.getSnapshot().volume.loadStatus, 'idle');
  c.selectPlane(1, c.getSnapshot().placementRevision, 'new-table');
  ready(c);
  c.detach(1);
  c.setVolumeCrop(old, 0, 0);
  assert.equal(c.getSnapshot().sessionId, null);
  assert.equal(c.getSnapshot().volume.controlsOpen, false);
  c.attach(2);
  assert.ok(scope(c).requestId > old.requestId);
  c.restart(2);
  assert.equal(c.getSnapshot().volume.scale, 1);
});
test('missing and unsupported renderers preserve other modes', () => {
  const c = viewer({ ...data, series: [] });
  c.selectViewerMode(1, 'volume');
  assert.equal(c.getSnapshot().volume.loadStatus, 'missing');
  assert.match(medicalStatus(c.getSnapshot()), /unavailable/);
  c.selectViewerMode(1, 'anatomy');
  assert.equal(c.getSnapshot().modelId, 'both');
  const supported = viewer();
  supported.selectViewerMode(1, 'volume');
  supported.finishVolumeBinding(scope(supported), 'unsupported');
  assert.match(medicalStatus(supported.getSnapshot()), /Stacked slices/);
});

test('malformed gesture endings retain the other gesture; renderer failure releases both', () => {
  const c = volume(),
    token = scope(c);
  c.volumeGesture(token, 'pinch', 1, 1);
  c.volumeGesture(token, 'rotate', 1, 0);
  c.volumeGesture(token, 'pinch', 3, NaN);
  assert.equal(c.getSnapshot().volume.pinching, false);
  assert.equal(c.getSnapshot().volume.rotating, true);
  c.volumeGesture(token, 'rotate', 3, 30);
  assert.equal(c.getSnapshot().volume.yaw, 105);
  assert.equal(c.getSnapshot().volume.rotating, false);
  c.volumeGesture(token, 'pinch', 1, 1);
  c.volumeGesture(token, 'rotate', 1, 0);
  c.finishVolumeBinding(token, 'error');
  assert.equal(c.getSnapshot().volume.pinching, false);
  assert.equal(c.getSnapshot().volume.rotating, false);
  c.retryVolumeLoad(1);
  ready(c);
  c.volumeGesture(token, 'rotate', 3, 10);
  assert.equal(c.getSnapshot().volume.yaw, 105);
});
test('frame scheduling retains independent controls, coalesces repeats, and cancels on exit', () => {
  const callbacks = new Map(),
    updates = [];
  let next = 0;
  const scheduler = new VolumeControlScheduler(
    (cb) => {
      callbacks.set(++next, cb);
      return next;
    },
    (id) => callbacks.delete(id)
  );
  for (let n = 0; n < 100; n++) scheduler.select('window', () => updates.push(n));
  scheduler.select('crop', () => updates.push('crop'));
  assert.equal(callbacks.size, 1);
  const callback = callbacks.values().next().value;
  callbacks.clear();
  callback();
  assert.deepEqual(updates, [99, 'crop']);
  scheduler.select('level', () => updates.push('late'));
  scheduler.clear();
  assert.equal(callbacks.size, 0);
});
test('proxy box preserves anatomical proportions and the correct 55cm extent', () => {
  const extent = volumeExtent(data);
  assert.equal(Math.max(...extent), 0.55);
  const c = volume(),
    u = volumeUniforms(data, c.getVolumeSeries(), c.getSnapshot().volume);
  assert.deepEqual(u.u_crop_min, [0, 0, 0]);
  assert.deepEqual(u.u_crop_max, [1, 1, 1]);
  assert.equal(u.u_flip_y, 0);
});

test('stacked fallback has true transparent air, bounded opacity, real scan hashes and ordered planes', () => {
  const zlib = require('node:zlib');
  assert.equal(
    stack.sourceMetadataSha256,
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '../assets/medical/volumes/metadata.json')))
      .digest('hex')
  );
  for (const preset of Object.values(stack.presets)) {
    assert.equal(preset.planes.length, 48);
    let transparent = 0,
      anatomy = 0,
      last = -Infinity,
      maxAlpha = 0;
    for (const plane of preset.planes) {
      const bytes = fs.readFileSync(
        path.join(__dirname, '../assets/medical/stack', plane.filename)
      );
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), plane.sha256);
      assert.equal(bytes.length, plane.bytes);
      assert.equal(bytes.readUInt32BE(16), 160);
      assert.equal(bytes.readUInt32BE(20), 160);
      const parts = [];
      for (let offset = 8; offset < bytes.length;) {
        const size = bytes.readUInt32BE(offset);
        if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
          parts.push(bytes.subarray(offset + 8, offset + 8 + size));
        offset += 12 + size;
      }
      const pixels = zlib.inflateSync(Buffer.concat(parts));
      for (let row = 0; row < 160; row++) {
        assert.equal(pixels[row * 641], 0);
        for (let col = 0; col < 160; col++) {
          const alpha = pixels[row * 641 + 1 + col * 4 + 3];
          assert.ok(alpha <= 102);
          maxAlpha = Math.max(maxAlpha, alpha);
          if (alpha === 0) transparent++;
          else anatomy++;
        }
      }
      assert.ok(plane.positionRasMm > last);
      last = plane.positionRasMm;
    }
    assert.ok(transparent > 0 && anatomy > 0);
    assert.ok(maxAlpha > 56, 'Scan opacity must exceed the old faint export');
    assert.equal(preset.planes[0].ijkZ, 0);
    assert.equal(preset.planes.at(-1).ijkZ, data.dimensions[2] - 1);
  }
});

test('stack cropping preserves RAS UV orientation, physical proportions and camera-dependent depth order', () => {
  const c = viewer();
  c.selectViewerMode(1, 'volume');
  const state = c.getSnapshot().volume,
    planes = stack.presets['mri-grayscale'].planes;
  const geometry = stackPlaneGeometry(data, state, planes);
  assert.equal(geometry[0].width, 0.55);
  assert.deepEqual(geometry[0].uv, [0, 1, 1, 0]);
  assert.equal(geometry[0].position[0], 0);
  assert.equal(geometry[0].opacity, 0.8);
  assert.ok(geometry[0].position[1] < geometry.at(-1).position[1]);
  const ids = geometry.map((p) => p.renderingOrder);
  c.updateVolumeCamera(1, [0, 1, 0]);
  const reverse = stackPlaneGeometry(data, c.getSnapshot().volume, planes);
  assert.ok(reverse[0].renderingOrder > reverse.at(-1).renderingOrder);
  assert.ok(ids[0] < ids.at(-1));
  c.setVolumeCrop(scope(c), 0, (data.boundsRasMm[0] + data.boundsRasMm[1]) / 2);
  const half = stackPlaneGeometry(data, c.getSnapshot().volume, planes);
  assert.equal(half[0].width, 0.55 / 2);
  assert.deepEqual(half[0].uv, [0.5, 1, 1, 0]);
  assert.ok(half[0].position[0] > 0);
  c.setVolumeCrop(scope(c), 4, data.boundsRasMm[4] + 100);
  const cropped = stackPlaneGeometry(data, c.getSnapshot().volume, planes);
  assert.ok(!cropped[0].visible && cropped.some((p) => p.visible));
  c.resetVolumeCrop(1);
  assert.deepEqual(c.getSnapshot().volume.crop, data.boundsRasMm);
});

test('stack failures, presets, resets and old callbacks remain scoped and window/level stays baked', () => {
  const c = viewer();
  c.selectViewerMode(1, 'volume');
  const old = scope(c);
  c.finishVolumeStackImage(old, 0, false);
  assert.equal(c.getSnapshot().volume.loadStatus, 'error');
  c.retryVolumeLoad(1);
  c.finishVolumeStackImage(old, 1, true);
  assert.deepEqual(c.getSnapshot().volume.stackLoads, {});
  ready(c);
  const token = scope(c);
  c.setVolumeAppearance(token, 'window', 1);
  assert.equal(c.getSnapshot().volume.appearance.mri.window, 5589);
  c.setVolumeAppearance(token, 'opacity', 0);
  assert.equal(c.getSnapshot().volume.appearance.mri.opacity, 0);
  c.selectVolumeModality(1, 'ct');
  ready(c);
  c.setVolumePreset(scope(c), 'ct-soft-tissue');
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
  ready(c);
  c.resetVolumeScan(1);
  assert.equal(c.getSnapshot().volume.appearance.ct.preset, 'ct-bone');
  assert.equal(c.getSnapshot().volume.loadStatus, 'loading');
});

test('shader diagnostics cannot test atlases before human magenta confirmation and invalidate confirmations on placement', () => {
  const c = viewer();
  c.selectViewerMode(1, 'volume');
  c.setVolumeRenderer(1, 'shader');
  const old = scope(c);
  c.setVolumeDebugMode(old, 'high');
  assert.equal(c.getSnapshot().volume.debugMode, 'magenta');
  c.finishVolumeBinding(old, 'ready');
  c.confirmVolumeMagenta(old);
  c.setVolumeDebugMode(old, 'high');
  assert.equal(c.getSnapshot().volume.debugMode, 'high');
  assert.notEqual(scope(c).requestId, old.requestId);
  c.recordVolumeDiagnostic(old, 'stale');
  assert.deepEqual(c.getSnapshot().volume.diagnostics, []);
  for (let i = 0; i < 30; i++) c.recordVolumeDiagnostic(scope(c), `error ${i}`);
  assert.equal(c.getSnapshot().volume.diagnostics.length, 8);
  c.reposition(1);
  assert.equal(c.getSnapshot().volume.magentaConfirmed, false);
  assert.equal(c.getSnapshot().volume.debugMode, 'magenta');
  c.setVolumeRenderer(1, 'stack');
  assert.equal(c.getSnapshot().volume.renderer, 'stack');
  const magenta = volumeDiagnosticShader('magenta', stack.probes.mri);
  assert.equal(magenta.textures.length, 0);
  assert.equal(magenta.uniforms, '');
  for (const key of ['high', 'low', 'validity']) {
    const shader = volumeDiagnosticShader(key, stack.probes.mri);
    assert.deepEqual(shader.textures, [key]);
    assert.ok(shader.body.includes('expectedAlpha'));
  }
});
