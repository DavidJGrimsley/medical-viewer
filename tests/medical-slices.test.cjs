const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MedicalController,
  canManipulateMedical,
  canManipulateSlices,
  medicalStatus,
} = require('../src/features/medical-viewer/medical-controller.ts');
const {
  parseMedicalSliceDataset,
  SliceSelectionScheduler,
} = require('../src/features/medical-viewer/medical-slices.ts');
const metadata = require('../assets/medical/slices/metadata.json');

const dataset = parseMedicalSliceDataset(metadata);
const scope = (controller) => {
  const state = controller.getSnapshot();
  return {
    sessionId: state.sessionId,
    placementRevision: state.placementRevision,
    requestId: state.slices.requestId,
  };
};
const anatomyScope = (controller) => {
  const { sessionId, placementRevision, modelId, loadAttempt } = controller.getSnapshot();
  return { sessionId, placementRevision, modelId, loadAttempt };
};
function viewer(data = dataset) {
  const controller = new MedicalController(undefined, data);
  controller.attach(1);
  controller.setTracking(1, true);
  controller.selectPlane(1, controller.getSnapshot().placementRevision, 'table');
  return controller;
}
function slices() {
  const controller = viewer();
  controller.selectViewerMode(1, 'slices');
  controller.finishSliceLoad(scope(controller), true);
  return controller;
}

test('slice XYZ offsets retain their own pose, reject stale/loading callbacks, and reset with the panel', () => {
  const c = slices(),
    old = scope(c);
  c.setPanelPosition(old, 'x', 0.4);
  c.setPanelPosition(old, 'y', 0.8);
  c.setPanelPosition(old, 'z', -0.2);
  c.setPanelTransform(old, 'scale', 2);
  c.setPanelTransform(old, 'yaw', 90);
  assert.equal(c.getSnapshot().x, 0);
  assert.equal(c.getSnapshot().slices.x, 0.4);
  assert.equal(c.getSnapshot().slices.z, -0.2);
  c.selectModality(1, 'ct');
  const pending = c.getSnapshot();
  c.setPanelPosition(old, 'x', 1);
  c.setPanelPosition(scope(c), 'x', 1);
  assert.equal(c.getSnapshot(), pending);
  c.finishSliceLoad(scope(c), true);
  c.setPanelPosition(scope(c), 'x', 99);
  c.setPanelPosition(scope(c), 'z', -99);
  c.setPanelPosition(scope(c), 'y', -99);
  assert.equal(c.getSnapshot().slices.x, 1.524);
  assert.equal(c.getSnapshot().slices.z, -1.524);
  assert.equal(c.getSnapshot().slices.height, 0);
  const before = c.getSnapshot();
  c.setPanelPosition(scope(c), 'x', NaN);
  c.setPanelPosition(scope(c), 'invalid', 1);
  assert.equal(c.getSnapshot(), before);
  c.resetPanel(1);
  assert.equal(c.getSnapshot().slices.x, 0);
  assert.equal(c.getSnapshot().slices.z, 0);
  assert.equal(c.getSnapshot().slices.height, 0.6096);
});

test('real export contains two complete series at identical axial positions', () => {
  assert.equal(dataset.error, null);
  assert.equal(dataset.series.length, 2);
  const ct = dataset.series.find((series) => series.modality === 'ct');
  const mri = dataset.series.find((series) => series.modality === 'mri');
  assert.equal(ct.imageCount, 80);
  assert.equal(mri.imageCount, 80);
  assert.deepEqual(ct.imageDimensions, mri.imageDimensions);
  assert.deepEqual(
    ct.slices.map((slice) => slice.positionMm),
    mri.slices.map((slice) => slice.positionMm)
  );
});

test('malformed metadata fails recoverably, including counts, dimensions, traversal and coordinates', () => {
  for (const mutate of [
    (data) => {
      data.schemaVersion = 0;
    },
    (data) => {
      data.coordinateSystem = 'LPS';
    },
    (data) => {
      data.series.push(data.series[0]);
    },
    (data) => {
      data.series[0].imageCount++;
    },
    (data) => {
      data.series[0].imageDimensions[0] = 0;
    },
    (data) => {
      data.series[0].slices[0].filename = '../unsafe.png';
    },
    (data) => {
      data.series[0].slices[1].positionMm = data.series[0].slices[0].positionMm;
    },
    (data) => {
      data.series[0].slices[0].positionMm = NaN;
    },
  ]) {
    const data = structuredClone(metadata);
    mutate(data);
    const parsed = parseMedicalSliceDataset(data);
    assert.deepEqual(parsed.series, []);
    assert.ok(parsed.error);
  }
  assert.ok(parseMedicalSliceDataset(null).error);
});

test('default Anatomy/Both and middle MRI become slices in the same placement', () => {
  const c = viewer();
  const before = c.getSnapshot();
  assert.equal(before.mode, 'anatomy');
  assert.equal(before.modelId, 'both');
  assert.equal(before.slices.modality, 'mri');
  assert.equal(before.slices.index, 40);
  c.selectViewerMode(1, 'slices');
  assert.equal(c.getSnapshot().anchorId, before.anchorId);
  assert.equal(c.getSnapshot().placementRevision, before.placementRevision);
  assert.equal(c.getSessionId(), 1);
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  assert.equal(canManipulateMedical(c.getSnapshot()), false);
  assert.equal(canManipulateSlices(c.getSnapshot()), false);
  c.finishSliceLoad(scope(c), true);
  assert.equal(canManipulateSlices(c.getSnapshot()), true);
});

test('slice indices clamp and round; nonfinite, same selection and wrong session do nothing', () => {
  const c = slices();
  for (const [value, expected] of [
    [-20, 0],
    [999, 79],
    [7.7, 8],
  ]) {
    c.selectSlice(scope(c), value);
    assert.equal(c.getSnapshot().slices.index, expected);
  }
  const before = c.getSnapshot();
  c.selectSlice(scope(c), NaN);
  c.selectSlice(scope(c), Infinity);
  c.selectSlice(scope(c), 8);
  c.selectSlice({ ...scope(c), sessionId: 2 }, 0);
  assert.equal(c.getSnapshot(), before);
  c.resetSlice(1);
  assert.equal(c.getSnapshot().slices.index, 40);
});

test('modality switches map physical positions even when counts and spacing differ', () => {
  const shortCt = {
    ...dataset.series.find((series) => series.modality === 'ct'),
    imageCount: 3,
    slices: [-230, -112, 2].map((positionMm, i) => ({
      filename: `ct_axial_00${i}.png`,
      positionMm,
    })),
  };
  const c = viewer({ series: [dataset.series[0], shortCt], error: null });
  c.selectViewerMode(1, 'slices');
  c.selectModality(1, 'ct');
  assert.equal(c.getSnapshot().slices.index, 1);
  c.selectModality(1, 'mri');
  assert.equal(c.getSnapshot().slices.index, 40);
  c.selectModality(1, 'ct');
  c.selectSlice(scope(c), 2);
  c.selectModality(1, 'mri');
  assert.equal(c.getSnapshot().slices.index, 79);
});

test('rapid changes and retry reject success/error from earlier image requests', () => {
  const c = slices();
  const old = scope(c);
  c.selectSlice(scope(c), 10);
  const ten = scope(c);
  c.selectSlice(scope(c), 20);
  const twenty = scope(c);
  c.finishSliceLoad(old, false);
  c.finishSliceLoad(ten, true);
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  c.finishSliceLoad(twenty, false);
  assert.match(medicalStatus(c.getSnapshot()), /could not load/);
  c.retrySliceLoad(1);
  const retry = scope(c);
  assert.notEqual(retry.requestId, twenty.requestId);
  c.finishSliceLoad(twenty, true);
  c.finishSliceLoad(twenty, false);
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  c.finishSliceLoad(retry, true);
  assert.equal(c.getSnapshot().slices.loadStatus, 'ready');
  c.finishSliceLoad(retry, false);
  assert.equal(canManipulateSlices(c.getSnapshot()), false);
});

test('switching representations invalidates anatomy and slice loads without losing poses', () => {
  const c = viewer();
  const oldAnatomy = anatomyScope(c);
  c.finishLoad(oldAnatomy, 'half-skull', true);
  c.finishLoad(oldAnatomy, 'brain', true);
  c.setScale(oldAnatomy, 2);
  c.setYaw(oldAnatomy, 45);
  c.selectViewerMode(1, 'slices');
  const oldSlice = scope(c);
  c.finishSliceLoad(oldSlice, true);
  c.setPanelTransform(oldSlice, 'scale', 0.75);
  c.setPanelTransform(oldSlice, 'yaw', -90);
  assert.equal(c.getSnapshot().scale, 2);
  c.selectViewerMode(1, 'anatomy');
  c.finishLoad(oldAnatomy, 'brain', false);
  c.finishSliceLoad(oldSlice, false);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  assert.equal(c.getSnapshot().modelId, 'both');
  assert.equal(c.getSnapshot().scale, 2);
  assert.equal(c.getSnapshot().yaw, 45);
  c.selectViewerMode(1, 'slices');
  c.finishSliceLoad(oldSlice, true);
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  assert.equal(c.getSnapshot().slices.scale, 0.75);
  assert.equal(c.getSnapshot().slices.yaw, -90);
});

test('panel gestures, tracking loss and resets remain bounded and independent', () => {
  const c = slices();
  c.panelGesture(scope(c), 'pinch', 1, 1);
  c.panelGesture(scope(c), 'pinch', 3, 99);
  assert.equal(c.getSnapshot().slices.scale, 3);
  c.panelGesture(scope(c), 'rotate', 1, 0);
  c.panelGesture(scope(c), 'rotate', 3, 450);
  assert.equal(c.getSnapshot().slices.yaw, -90);
  c.setPanelTransform(scope(c), 'height', 99);
  assert.equal(c.getSnapshot().slices.height, 1.524);
  c.panelGesture(scope(c), 'pinch', 1, 1);
  c.setTracking(1, false);
  assert.equal(c.getSnapshot().slices.pinching, false);
  c.panelGesture(scope(c), 'pinch', 3, 2);
  assert.equal(c.getSnapshot().slices.scale, 3);
  c.resetPanel(1);
  assert.equal(c.getSnapshot().slices.scale, 1);
  assert.equal(c.getSnapshot().slices.yaw, 0);
  assert.equal(c.getSnapshot().slices.height, 0.6096);
  assert.equal(c.getSnapshot().height, 0.6096);
});

test('placement changes, restart and teardown invalidate old callbacks and keep valid selections', () => {
  const c = slices();
  c.selectSlice(scope(c), 8);
  c.selectModality(1, 'ct');
  const old = scope(c);
  c.reposition(1);
  c.finishSliceLoad(old, true);
  assert.equal(c.getSnapshot().slices.loadStatus, 'idle');
  c.selectPlane(1, c.getSnapshot().placementRevision, 'other');
  c.finishSliceLoad(old, false);
  assert.equal(c.getSnapshot().slices.loadStatus, 'loading');
  c.restart(1);
  c.attach(2);
  c.setTracking(2, true);
  c.selectPlane(2, c.getSnapshot().placementRevision, 'new');
  assert.equal(c.getSnapshot().slices.modality, 'ct');
  assert.equal(c.getSnapshot().slices.index, 8);
  c.detach(2);
  c.finishSliceLoad(scope(c), true);
  assert.equal(c.getSnapshot().sessionId, null);
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().slices.loadStatus, 'idle');
});

test('missing datasets and modalities are recoverable and retain anatomy', () => {
  const c = viewer({ series: [], error: 'Missing export' });
  c.selectViewerMode(1, 'slices');
  assert.equal(c.getSnapshot().slices.loadStatus, 'missing');
  c.selectModality(1, 'ct');
  c.selectSlice(scope(c), 99);
  c.resetSlice(1);
  c.retrySliceLoad(1);
  assert.equal(c.getSnapshot().slices.index, 0);
  c.selectViewerMode(1, 'anatomy');
  assert.equal(c.getSnapshot().modelId, 'both');
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  const mriOnly = viewer({ series: [dataset.series[0]], error: null });
  mriOnly.selectViewerMode(1, 'slices');
  mriOnly.selectModality(1, 'ct');
  assert.equal(mriOnly.getSnapshot().slices.modality, 'mri');
});

test('slider scheduler delivers the latest action once per frame and cancels on exit', () => {
  const frames = new Map();
  let next = 0;
  const scheduler = new SliceSelectionScheduler(
    (callback) => {
      frames.set(++next, callback);
      return next;
    },
    (id) => frames.delete(id)
  );
  const selected = [];
  for (let i = 0; i < 80; i++) scheduler.schedule(() => selected.push(i));
  assert.equal(frames.size, 1);
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  callback();
  assert.deepEqual(selected, [79]);
  scheduler.schedule(() => selected.push(10));
  scheduler.clear();
  assert.equal(frames.size, 0);
  assert.deepEqual(selected, [79]);
});
