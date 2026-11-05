const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MedicalController,
  canManipulateMedical,
  medicalStatus,
  DEFAULT_MODEL_HEIGHT,
  MAX_MODEL_HEIGHT,
} = require('../src/features/medical-viewer/medical-controller.ts');

const scope = (controller) => {
  const { sessionId, modelId, placementRevision, loadAttempt } = controller.getSnapshot();
  return { sessionId, modelId, placementRevision, loadAttempt };
};
function placed() {
  const controller = new MedicalController();
  controller.attach(1);
  controller.selectModel(1, 'skull');
  controller.setTracking(1, true);
  controller.selectPlane(1, scope(controller).placementRevision, 'table');
  controller.finishLoad(scope(controller), 'skull', true);
  return controller;
}

test('falls back to Skull when default Both is missing; unavailable modes cannot be selected', () => {
  const c = new MedicalController((id) => id === 'skull');
  c.attach(1);
  c.selectModel(1, 'brain');
  c.selectModel(1, 'half-skull');
  c.selectModel(1, 'both');
  assert.equal(c.getSnapshot().modelId, 'skull');
  assert.equal(c.getSnapshot().labelsVisible, false);
  assert.equal(c.getSnapshot().height, 0.6096);
  assert.equal(canManipulateMedical(c.getSnapshot()), false);
});

test('defaults to Both and all four modes can be selected without placement; same mode does not reload', () => {
  const c = new MedicalController();
  assert.equal(c.getSnapshot().modelId, 'both');
  assert.equal(c.getSnapshot().labelsVisible, false);
  c.attach(1);
  for (const modelId of ['skull', 'brain', 'half-skull', 'both']) {
    c.selectModel(1, modelId);
    assert.equal(c.getSnapshot().modelId, modelId);
    assert.equal(c.getSnapshot().loadStatus, 'idle');
    assert.deepEqual(c.getSnapshot().assetLoads, {});
    const selected = c.getSnapshot();
    c.selectModel(1, modelId);
    c.selectModel(99, 'skull');
    assert.equal(c.getSnapshot(), selected);
  }
});

test('changing modes preserves placement and pose, clears gestures and invalidates older callbacks', () => {
  const c = placed();
  const skull = scope(c);
  c.setScale(skull, 1.8);
  c.setYaw(skull, 65);
  c.setHeight(skull, 0.9);
  c.toggleLabels(1);
  c.pinch(skull, 1, 1);
  c.rotate(skull, 1, 0);
  c.selectModel(1, 'brain');
  assert.equal(c.getSnapshot().labelsVisible, false);
  assert.equal(c.getSnapshot().pinching, false);
  assert.equal(c.getSnapshot().rotating, false);
  assert.equal(c.getSnapshot().anchorId, 'table');
  assert.equal(c.getSnapshot().placementRevision, skull.placementRevision);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  assert.match(medicalStatus(c.getSnapshot()), /Loading brain/);
  c.finishLoad(skull, 'skull', false);
  c.finishLoad(scope(c), 'skull', true);
  c.pinch(skull, 3, 3);
  c.rotate(skull, 3, 180);
  c.setHeight(skull, 1.4);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'brain', true);
  c.toggleLabels(1);
  assert.equal(c.getSnapshot().labelsVisible, false);
  const brain = scope(c);
  c.selectModel(1, 'skull');
  c.finishLoad(brain, 'brain', false);
  c.finishLoad(skull, 'skull', true);
  c.setScale(skull, 3);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(c.getSnapshot().scale, 1.8);
  assert.equal(c.getSnapshot().yaw, 65);
  assert.equal(c.getSnapshot().height, 0.9);
});

test('Half Skull is a single-asset mode and switching to Both rejects its earlier load and errors', () => {
  const c = placed();
  c.selectModel(1, 'half-skull');
  assert.match(medicalStatus(c.getSnapshot()), /Loading half skull/);
  assert.deepEqual(c.getSnapshot().assetLoads, { 'half-skull': 'loading' });
  const half = scope(c);
  c.finishLoad(half, 'half-skull', true);
  assert.equal(canManipulateMedical(c.getSnapshot()), true);
  c.toggleLabels(1);
  assert.equal(c.getSnapshot().labelsVisible, false);
  c.selectModel(1, 'both');
  c.finishLoad(half, 'half-skull', true);
  c.finishLoad(half, 'half-skull', false);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  assert.deepEqual(c.getSnapshot().assetLoads, { 'half-skull': 'loading', brain: 'loading' });
  c.finishLoad(scope(c), 'half-skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'brain', true);
  assert.equal(c.getSnapshot().loadStatus, 'ready');
});

test('fresh default Both waits for both loads and returns as default after Home teardown', () => {
  const c = new MedicalController();
  c.attach(1);
  c.setTracking(1, true);
  c.selectPlane(1, scope(c).placementRevision, 'table');
  c.finishLoad(scope(c), 'brain', true);
  assert.equal(canManipulateMedical(c.getSnapshot()), false);
  c.finishLoad(scope(c), 'half-skull', true);
  assert.equal(canManipulateMedical(c.getSnapshot()), true);
  c.selectModel(1, 'half-skull');
  c.detach(1);
  assert.equal(new MedicalController().getSnapshot().modelId, 'both');
});

test('Both requires two distinct load completions in either order and blocks partial readiness', () => {
  for (const order of [
    ['half-skull', 'brain'],
    ['brain', 'half-skull'],
  ]) {
    const c = placed();
    c.selectModel(1, 'both');
    const token = scope(c);
    c.finishLoad(token, order[0], true);
    c.finishLoad(token, order[0], true);
    assert.equal(c.getSnapshot().loadStatus, 'loading');
    assert.equal(canManipulateMedical(c.getSnapshot()), false);
    c.setScale(token, 2);
    assert.equal(c.getSnapshot().scale, 1);
    c.finishLoad(token, order[1], true);
    assert.equal(c.getSnapshot().loadStatus, 'ready');
    assert.equal(canManipulateMedical(c.getSnapshot()), true);
    c.toggleLabels(1);
    assert.equal(c.getSnapshot().labelsVisible, false);
  }
});

test('Either Both asset can fail, Retry reloads the pair and ignores callbacks from the failed attempt', () => {
  for (const failedId of ['brain', 'half-skull']) {
    const c = placed();
    c.selectModel(1, 'both');
    const token = scope(c);
    const otherId = failedId === 'brain' ? 'half-skull' : 'brain';
    c.finishLoad(token, otherId, true);
    c.finishLoad(token, failedId, false);
    assert.equal(c.getSnapshot().loadStatus, 'error');
    assert.equal(c.getSnapshot().assetLoads[otherId], 'ready');
    assert.equal(c.getSnapshot().assetLoads[failedId], 'error');
    assert.match(medicalStatus(c.getSnapshot()), /could not load/);
    c.finishLoad(token, failedId, true);
    assert.equal(c.getSnapshot().loadStatus, 'error');
    c.retryLoad(1);
    assert.deepEqual(c.getSnapshot().assetLoads, { 'half-skull': 'loading', brain: 'loading' });
    assert.equal(c.getSnapshot().anchorId, 'table');
    c.finishLoad(token, failedId, true);
    c.finishLoad(token, otherId, false);
    assert.equal(c.getSnapshot().loadStatus, 'loading');
    c.finishLoad(scope(c), otherId, true);
    assert.equal(c.getSnapshot().loadStatus, 'loading');
    c.finishLoad(scope(c), failedId, true);
    assert.equal(c.getSnapshot().loadStatus, 'ready');
  }
});

test('failure before either completion remains an error and switching mode recovers in place', () => {
  const c = placed();
  c.selectModel(1, 'both');
  const token = scope(c);
  c.finishLoad(token, 'brain', false);
  c.finishLoad(token, 'half-skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'error');
  c.finishLoad(token, 'half-skull', false);
  assert.match(medicalStatus(c.getSnapshot()), /Half Skull and Brain could not load/);
  c.selectModel(1, 'brain');
  c.finishLoad(token, 'half-skull', false);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'brain', true);
  assert.equal(c.getSnapshot().loadStatus, 'ready');
  assert.equal(c.getSnapshot().anchorId, 'table');
});

test('Both shares one pose, repositions together, and retains mode across restart and resume', () => {
  const c = placed();
  c.selectModel(1, 'both');
  c.finishLoad(scope(c), 'half-skull', true);
  c.finishLoad(scope(c), 'brain', true);
  const token = scope(c);
  c.setScale(token, 2);
  c.setYaw(token, 90);
  c.setHeight(token, 1);
  c.pinch(token, 1, 1);
  c.pinch(token, 3, 0.75);
  c.rotate(token, 1, 0);
  c.rotate(token, 3, 45);
  c.reposition(1);
  assert.equal(c.getSnapshot().scale, 1.5);
  assert.equal(c.getSnapshot().yaw, 45);
  assert.equal(c.getSnapshot().height, 1);
  assert.deepEqual(c.getSnapshot().assetLoads, {});
  c.selectPlane(1, scope(c).placementRevision, 'floor');
  c.finishLoad(token, 'brain', false);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'brain', true);
  c.finishLoad(scope(c), 'half-skull', true);
  const beforeRestart = scope(c);
  c.restart(1);
  c.attach(2);
  c.finishLoad(beforeRestart, 'brain', true);
  assert.equal(c.getSnapshot().modelId, 'both');
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().yaw, 0);
  assert.equal(c.getSnapshot().height, DEFAULT_MODEL_HEIGHT);
  c.detach(2);
  c.attach(3);
  assert.equal(c.getSnapshot().modelId, 'both');
  assert.deepEqual(c.getSnapshot().assetLoads, {});
  assert.equal(new MedicalController().getSnapshot().modelId, 'both');
});
test('requires normal tracking, selected plane and finished loading', () => {
  const c = new MedicalController();
  c.attach(1);
  c.selectModel(1, 'skull');
  const revision = scope(c).placementRevision;
  c.selectPlane(1, revision, 'table');
  assert.equal(c.getSnapshot().anchorId, null);
  c.setTracking(1, true);
  c.selectPlane(1, revision, 'table');
  c.setScale(scope(c), 2);
  c.setYaw(scope(c), 90);
  c.setHeight(scope(c), 1);
  c.toggleLabels(1);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().yaw, 0);
  assert.equal(c.getSnapshot().height, DEFAULT_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().labelsVisible, false);
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(canManipulateMedical(c.getSnapshot()), true);
  assert.equal(medicalStatus(c.getSnapshot()), '');
});
test('transform sliders use absolute values, clamp size and height, and wrap yaw', () => {
  const c = placed();
  const token = scope(c);
  c.setScale(token, 1.5);
  c.setScale(token, 1.6);
  assert.equal(c.getSnapshot().scale, 1.6);
  c.setScale(token, 100);
  assert.equal(c.getSnapshot().scale, 3);
  c.setScale(token, -1);
  assert.equal(c.getSnapshot().scale, 0.5);
  c.setHeight(token, -1);
  assert.equal(c.getSnapshot().height, 0);
  c.setHeight(token, 100);
  assert.equal(c.getSnapshot().height, MAX_MODEL_HEIGHT);
  c.setHeight(token, 0.7);
  assert.equal(c.getSnapshot().height, 0.7);
  c.setYaw(token, 450);
  assert.equal(c.getSnapshot().yaw, 90);
  c.setYaw(token, -900);
  assert.equal(c.getSnapshot().yaw, -180);
  c.setYaw(token, 360);
  assert.equal(c.getSnapshot().yaw, 0);
  const before = c.getSnapshot();
  for (const invalid of [NaN, Infinity, -Infinity]) {
    c.setScale(token, invalid);
    c.setYaw(token, invalid);
    c.setHeight(token, invalid);
  }
  assert.equal(c.getSnapshot(), before);
});
test('pinch uses the start baseline, including the final factor and subsequent gestures', () => {
  const c = placed(),
    token = scope(c);
  c.pinch(token, 1, 1);
  c.pinch(token, 2, 1.5);
  c.pinch(token, 2, 1.6);
  assert.equal(c.getSnapshot().scale, 1.6);
  c.setScale(token, 3);
  assert.equal(c.getSnapshot().scale, 1.6);
  c.pinch(token, 3, 2);
  c.pinch(token, 1, 1);
  c.pinch(token, 3, 0.5);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().pinching, false);
  c.pinch(token, 1, 1);
  c.pinch(token, 3, 100);
  assert.equal(c.getSnapshot().scale, 3);
});
test('rotation is cumulative within a gesture and wraps across full turns', () => {
  const c = placed(),
    token = scope(c);
  c.rotate(token, 1, 0);
  c.rotate(token, 2, 45);
  c.rotate(token, 3, 90);
  assert.equal(c.getSnapshot().yaw, -90);
  c.rotate(token, 1, 0);
  c.rotate(token, 3, 450);
  assert.equal(c.getSnapshot().yaw, -180);
  c.rotate(token, 1, 0);
  c.rotate(token, 3, -900);
  assert.equal(c.getSnapshot().yaw, 0);
});
test('invalid and out-of-order gestures do not alter the model', () => {
  const c = placed(),
    token = scope(c);
  c.pinch(token, 2, 2);
  c.rotate(token, 3, 90);
  for (const bad of [NaN, Infinity, -1, 0]) c.pinch(token, 1, bad);
  c.rotate(token, 1, NaN);
  c.pinch(token, 4, 2);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().yaw, 0);
});
test('Reposition preserves pose and labels, invalidating previous placement callbacks', () => {
  const c = placed(),
    old = scope(c);
  c.setScale(old, 1.1);
  c.setHeight(old, 0.8);
  c.rotate(old, 1, 0);
  c.rotate(old, 3, 45);
  c.toggleLabels(1);
  c.reposition(1);
  c.selectPlane(1, old.placementRevision, 'old');
  c.finishLoad(old, 'skull', true);
  c.pinch(old, 1, 2);
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().scale, 1.1);
  assert.equal(c.getSnapshot().yaw, -45);
  assert.equal(c.getSnapshot().height, 0.8);
  assert.equal(c.getSnapshot().labelsVisible, true);
  c.selectPlane(1, scope(c).placementRevision, 'new-table');
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(c.getSnapshot().anchorId, 'new-table');
});
test('removing an unrelated plane is harmless; selected-plane loss allows reselecting', () => {
  const c = placed(),
    token = scope(c);
  c.losePlane(1, token.placementRevision, 'other');
  assert.equal(c.getSnapshot().anchorId, 'table');
  c.losePlane(1, token.placementRevision, 'table');
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().loadStatus, 'idle');
  c.selectPlane(1, scope(c).placementRevision, 'floor');
  c.finishLoad(token, 'skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
});
test('retry keeps placement and ignores success from a failed or older load', () => {
  const c = new MedicalController();
  c.attach(1);
  c.selectModel(1, 'skull');
  c.setTracking(1, true);
  c.selectPlane(1, scope(c).placementRevision, 'table');
  const failed = scope(c);
  c.finishLoad(failed, 'skull', false);
  c.finishLoad(failed, 'skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'error');
  assert.equal(medicalStatus(c.getSnapshot()), 'Skull could not load.');
  c.retryLoad(1);
  c.finishLoad(failed, 'skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  assert.equal(c.getSnapshot().anchorId, 'table');
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'ready');
});
test('tracking loss interrupts gestures and blocks manipulation until normal tracking', () => {
  const c = placed(),
    token = scope(c);
  c.pinch(token, 1, 1);
  c.rotate(token, 1, 0);
  c.setTracking(1, false);
  c.setScale(token, 2);
  c.setYaw(token, 90);
  c.setHeight(token, 1);
  c.toggleLabels(1);
  c.pinch(token, 2, 2);
  c.rotate(token, 2, 90);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().yaw, 0);
  assert.equal(c.getSnapshot().height, DEFAULT_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().pinching, false);
  c.setTracking(1, true);
  c.pinch(token, 3, 2);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(medicalStatus(c.getSnapshot()), '');
});
test('background/resume retains preferences, clears placement and ignores stale callbacks', () => {
  const c = placed(),
    old = scope(c);
  c.setScale(old, 1.1);
  c.setHeight(old, 0.6);
  c.rotate(old, 1, 0);
  c.rotate(old, 3, 45);
  c.toggleLabels(1);
  c.detach(1);
  c.attach(2);
  c.detach(1);
  c.setTracking(1, true);
  c.finishLoad(old, 'skull', true);
  c.rotate(old, 1, 90);
  assert.equal(c.getSnapshot().sessionId, 2);
  assert.equal(c.getSnapshot().scale, 1.1);
  assert.equal(c.getSnapshot().yaw, -45);
  assert.equal(c.getSnapshot().height, 0.6);
  assert.equal(c.getSnapshot().labelsVisible, true);
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().tracking, 'initializing');
  assert.equal(new MedicalController().getSnapshot().labelsVisible, false);
});
test('Restart AR resets pose and placement while retaining labels; returning later has fresh defaults', () => {
  const c = placed(),
    old = scope(c);
  c.setScale(old, 1.1);
  c.setHeight(old, 1);
  c.rotate(old, 1, 0);
  c.rotate(old, 3, 90);
  c.toggleLabels(1);
  c.restart(1);
  c.attach(2);
  c.restart(1);
  c.pinch(old, 1, 3);
  assert.equal(c.getSnapshot().sessionId, 2);
  assert.equal(c.getSnapshot().scale, 1);
  assert.equal(c.getSnapshot().yaw, 0);
  assert.equal(c.getSnapshot().height, DEFAULT_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().anchorId, null);
  assert.equal(c.getSnapshot().labelsVisible, true);
  const fresh = new MedicalController().getSnapshot();
  assert.equal(fresh.modelId, 'both');
  assert.equal(fresh.scale, 1);
  assert.equal(fresh.yaw, 0);
  assert.equal(fresh.height, DEFAULT_MODEL_HEIGHT);
  assert.equal(fresh.labelsVisible, false);
});
test('malformed gesture ends release their baselines and controls', () => {
  const c = placed(),
    token = scope(c);
  c.pinch(token, 1, 1);
  c.rotate(token, 1, 0);
  c.pinch(token, 3, NaN);
  c.rotate(token, 3, Infinity);
  assert.equal(c.getSnapshot().pinching, false);
  assert.equal(c.getSnapshot().rotating, false);
  c.setScale(token, 1.1);
  assert.equal(c.getSnapshot().scale, 1.1);
});
test('a model error interrupts active gestures and Retry restores usable transform controls', () => {
  const c = placed(),
    token = scope(c);
  c.pinch(token, 1, 1);
  c.rotate(token, 1, 0);
  c.setHeight(token, 0.8);
  c.finishLoad(token, 'skull', false);
  assert.equal(c.getSnapshot().loadStatus, 'error');
  assert.equal(c.getSnapshot().pinching, false);
  assert.equal(c.getSnapshot().rotating, false);
  c.retryLoad(1);
  c.finishLoad(token, 'skull', true);
  assert.equal(c.getSnapshot().loadStatus, 'loading');
  c.finishLoad(scope(c), 'skull', true);
  c.setScale(scope(c), 2);
  c.setYaw(scope(c), 45);
  c.pinch(token, 3, 3);
  c.rotate(token, 3, 90);
  assert.equal(c.getSnapshot().scale, 2);
  assert.equal(c.getSnapshot().yaw, 45);
  assert.equal(c.getSnapshot().height, 0.8);
});

test('height stays independent of pinch size and yaw, including placement loss', () => {
  const c = placed();
  const token = scope(c);
  c.setHeight(token, 0.9);
  c.pinch(token, 1, 1);
  c.pinch(token, 3, 3);
  c.rotate(token, 1, 0);
  c.rotate(token, 3, 120);
  assert.equal(c.getSnapshot().height, 0.9);
  c.losePlane(1, token.placementRevision, 'table');
  c.selectPlane(1, scope(c).placementRevision, 'floor');
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(c.getSnapshot().height, 0.9);
  assert.equal(c.getSnapshot().scale, 3);
  assert.equal(c.getSnapshot().yaw, -120);
});

test('sliders and consecutive native gestures share pose without baseline jumps', () => {
  const c = placed();
  const token = scope(c);
  c.setScale(token, 2);
  c.setYaw(token, 90);
  c.pinch(token, 1, 1);
  c.rotate(token, 1, 0);
  c.setScale(token, 0.5);
  c.setYaw(token, 0);
  assert.equal(c.getSnapshot().scale, 2);
  assert.equal(c.getSnapshot().yaw, 90);
  c.pinch(token, 3, 0.75);
  c.rotate(token, 3, 45);
  assert.equal(c.getSnapshot().scale, 1.5);
  assert.equal(c.getSnapshot().yaw, 45);
  c.setScale(token, 1);
  c.setYaw(token, 270);
  c.pinch(token, 1, 1);
  c.pinch(token, 3, 2);
  c.rotate(token, 1, 0);
  c.rotate(token, 3, 90);
  assert.equal(c.getSnapshot().scale, 2);
  assert.equal(c.getSnapshot().yaw, -180);
});

test('transform callbacks ignore earlier load attempts, placements and sessions after teardown', () => {
  const c = placed();
  const mutate = (token) => {
    c.setScale(token, 3);
    c.setYaw(token, 123);
    c.setHeight(token, 1.4);
    c.setPosition(token, 'x', 1);
    c.setPosition(token, 'z', 1);
  };
  const oldLoad = scope(c);
  c.finishLoad(oldLoad, 'skull', false);
  c.retryLoad(1);
  c.finishLoad(scope(c), 'skull', true);
  const before = c.getSnapshot();
  mutate(oldLoad);
  assert.equal(c.getSnapshot(), before);
  const oldPlacement = scope(c);
  c.reposition(1);
  c.selectPlane(1, scope(c).placementRevision, 'floor');
  c.finishLoad(scope(c), 'skull', true);
  const reselected = c.getSnapshot();
  mutate(oldPlacement);
  assert.equal(c.getSnapshot(), reselected);
  const oldSession = scope(c);
  c.detach(1);
  const detached = c.getSnapshot();
  mutate(oldSession);
  assert.equal(c.getSnapshot(), detached);
  c.attach(2);
  c.setTracking(2, true);
  c.selectPlane(2, scope(c).placementRevision, 'floor');
  c.finishLoad(scope(c), 'skull', true);
  const resumed = c.getSnapshot();
  mutate(oldSession);
  assert.equal(c.getSnapshot(), resumed);
});

test('anatomy XYZ position is bounded, independent of size/yaw, and preserved through reposition but reset by Restart AR', () => {
  const c = placed(),
    token = scope(c);
  c.setPosition(token, 'x', 99);
  c.setPosition(token, 'z', -99);
  c.setPosition(token, 'y', 0.8);
  c.setScale(token, 2);
  c.setYaw(token, 90);
  assert.equal(c.getSnapshot().x, MAX_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().z, -MAX_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().height, 0.8);
  const before = c.getSnapshot();
  for (const value of [NaN, Infinity, -Infinity]) c.setPosition(token, 'x', value);
  c.setPosition(token, 'invalid', 1);
  assert.equal(c.getSnapshot(), before);
  c.setTracking(1, false);
  const limited = c.getSnapshot();
  c.setPosition(token, 'z', 0);
  assert.equal(c.getSnapshot(), limited);
  c.setTracking(1, true);
  c.reposition(1);
  c.selectPlane(1, scope(c).placementRevision, 'floor');
  c.finishLoad(scope(c), 'skull', true);
  assert.equal(c.getSnapshot().x, MAX_MODEL_HEIGHT);
  assert.equal(c.getSnapshot().z, -MAX_MODEL_HEIGHT);
  c.restart(1);
  assert.equal(c.getSnapshot().x, 0);
  assert.equal(c.getSnapshot().z, 0);
  assert.equal(c.getSnapshot().height, DEFAULT_MODEL_HEIGHT);
});
test('subscription emits changed snapshots and unsubscribes cleanly', () => {
  const c = new MedicalController();
  let changes = 0;
  const unsubscribe = c.subscribe(() => changes++);
  c.attach(1);
  c.attach(1);
  assert.equal(changes, 1);
  unsubscribe();
  c.setTracking(1, true);
  assert.equal(changes, 1);
});
