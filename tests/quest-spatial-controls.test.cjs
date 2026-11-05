const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MedicalController,
  canManipulateMedical,
  canManipulateSlices,
  canManipulateVolume,
} = require('../src/features/medical-viewer/medical-controller.ts');
const { parseMedicalSliceDataset } = require('../src/features/medical-viewer/medical-slices.ts');
const { parseMedicalVolumeDataset } = require('../src/features/medical-viewer/medical-volumes.ts');
const sliceMetadata = require('../assets/medical/slices/metadata.json');
const volumeMetadata = require('../assets/medical/volumes/metadata.json');

const sliceDataset = parseMedicalSliceDataset(sliceMetadata);
const volumeDataset = parseMedicalVolumeDataset(volumeMetadata);

function createTestHarness(options = {}) {
  const controller = new MedicalController(undefined, sliceDataset, volumeDataset, options);
  const sessionId = 101;
  controller.attach(sessionId);
  controller.setTracking(sessionId, true);
  controller.selectPlane(
    sessionId,
    controller.getSnapshot().placementRevision,
    'quest-floor-anchor'
  );

  const getScope = () => {
    const s = controller.getSnapshot();
    return {
      sessionId,
      modelId: s.modelId,
      placementRevision: s.placementRevision,
      loadAttempt: s.loadAttempt,
    };
  };

  const getSliceScope = () => {
    const s = controller.getSnapshot();
    return {
      sessionId,
      placementRevision: s.placementRevision,
      requestId: s.slices.requestId,
    };
  };

  const getVolumeScope = () => {
    const s = controller.getSnapshot();
    return {
      sessionId,
      placementRevision: s.placementRevision,
      requestId: s.volume.requestId,
    };
  };

  return { controller, sessionId, getScope, getSliceScope, getVolumeScope };
}

// ---------------------------------------------------------------------------
// 1. Controller initialization options
// ---------------------------------------------------------------------------
test('MedicalController defaults volume renderer to stack on phone, shader on Quest', () => {
  const defaultCtrl = new MedicalController();
  assert.equal(defaultCtrl.getSnapshot().volume.renderer, 'stack');

  const questCtrl = new MedicalController({ defaultVolumeRenderer: 'shader' });
  assert.equal(questCtrl.getSnapshot().volume.renderer, 'shader');

  const questFullCtrl = new MedicalController(undefined, sliceDataset, volumeDataset, {
    defaultVolumeRenderer: 'shader',
  });
  assert.equal(questFullCtrl.getSnapshot().volume.renderer, 'shader');
});

// ---------------------------------------------------------------------------
// 2. Viewer Modes and Model Selection
// ---------------------------------------------------------------------------
test('Quest mode switcher toggles between anatomy, slices, and volume', () => {
  const { controller, sessionId } = createTestHarness();
  assert.equal(controller.getSnapshot().mode, 'anatomy');

  controller.selectViewerMode(sessionId, 'slices');
  assert.equal(controller.getSnapshot().mode, 'slices');

  controller.selectViewerMode(sessionId, 'volume');
  assert.equal(controller.getSnapshot().mode, 'volume');

  controller.selectViewerMode(sessionId, 'anatomy');
  assert.equal(controller.getSnapshot().mode, 'anatomy');
});

test('Quest anatomy controls select models and toggle labels', () => {
  const { controller, sessionId, getScope } = createTestHarness();
  assert.equal(controller.getSnapshot().modelId, 'both');

  controller.selectModel(sessionId, 'skull');
  assert.equal(controller.getSnapshot().modelId, 'skull');

  // Finish load so model becomes manipulatable
  controller.finishLoad(getScope(), 'skull', true);
  assert.equal(canManipulateMedical(controller.getSnapshot()), true);

  const initialLabels = controller.getSnapshot().labelsVisible;
  controller.toggleLabels(sessionId);
  assert.equal(controller.getSnapshot().labelsVisible, !initialLabels);

  controller.selectModel(sessionId, 'brain');
  assert.equal(controller.getSnapshot().modelId, 'brain');
});

// ---------------------------------------------------------------------------
// 3. Slices Navigation and Modality
// ---------------------------------------------------------------------------
test('Quest slice controls allow stepping, index selection, and modality change', () => {
  const { controller, sessionId, getSliceScope } = createTestHarness();
  controller.selectViewerMode(sessionId, 'slices');
  controller.finishSliceLoad(getSliceScope(), true);
  assert.equal(canManipulateSlices(controller.getSnapshot()), true);

  const initialIndex = controller.getSnapshot().slices.index;
  controller.selectSlice(getSliceScope(), initialIndex + 2);
  assert.equal(controller.getSnapshot().slices.index, initialIndex + 2);

  controller.selectSlice(getSliceScope(), 10);
  assert.equal(controller.getSnapshot().slices.index, 10);

  controller.selectModality(sessionId, 'ct');
  assert.equal(controller.getSnapshot().slices.modality, 'ct');
});

// ---------------------------------------------------------------------------
// 4. Volume Controls on Quest
// ---------------------------------------------------------------------------
test('Quest volume controls adjust quality, preset, opacity, and renderer', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');
  controller.finishVolumeBinding(getVolumeScope(), 'ready');
  assert.equal(canManipulateVolume(controller.getSnapshot()), true);

  assert.equal(controller.getSnapshot().volume.renderer, 'shader');

  // Configure quality
  controller.configureVolume(getVolumeScope(), { quality: 'fast' });
  assert.equal(controller.getSnapshot().volume.quality, 'fast');

  controller.configureVolume(getVolumeScope(), { quality: 'balanced' });
  assert.equal(controller.getSnapshot().volume.quality, 'balanced');

  // Switch to CT modality
  controller.selectVolumeModality(sessionId, 'ct');
  assert.equal(controller.getSnapshot().volume.modality, 'ct');
  controller.finishVolumeBinding(getVolumeScope(), 'ready');

  // Configure CT preset
  controller.setVolumePreset(getVolumeScope(), 'ct-bone');
  assert.equal(controller.getSnapshot().volume.appearance.ct.preset, 'ct-bone');

  controller.setVolumePreset(getVolumeScope(), 'ct-soft-tissue');
  assert.equal(controller.getSnapshot().volume.appearance.ct.preset, 'ct-soft-tissue');

  // Adjust appearance opacity
  const prevOpacity = controller.getSnapshot().volume.appearance.ct.opacity;
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', Math.max(0.1, prevOpacity - 0.2));
  assert.ok(
    Math.abs(controller.getSnapshot().volume.appearance.ct.opacity - (prevOpacity - 0.2)) < 1e-4
  );

  // Switch renderer diagnostic toggle
  controller.setVolumeRenderer(sessionId, 'stack');
  assert.equal(controller.getSnapshot().volume.renderer, 'stack');

  controller.setVolumeRenderer(sessionId, 'shader');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
});

// ---------------------------------------------------------------------------
// 5. Transform Limits and Clamping
// ---------------------------------------------------------------------------
test('Quest transform controls clamp scale within bounds', () => {
  const { controller, sessionId, getScope } = createTestHarness();
  controller.selectModel(sessionId, 'skull');
  controller.finishLoad(getScope(), 'skull', true);

  // Try scaling below minimum
  controller.setScale(getScope(), 0.05);
  assert.ok(controller.getSnapshot().scale >= 0.5);

  // Try scaling above maximum
  controller.setScale(getScope(), 10.0);
  assert.ok(controller.getSnapshot().scale <= 3.0);
});

test('Quest transform reposition and reset restore correct states', () => {
  const { controller, sessionId, getScope } = createTestHarness();
  controller.selectModel(sessionId, 'skull');
  controller.finishLoad(getScope(), 'skull', true);

  controller.setScale(getScope(), 1.5);
  controller.setHeight(getScope(), 0.8);
  controller.setYaw(getScope(), 45);

  assert.equal(controller.getSnapshot().scale, 1.5);
  assert.equal(controller.getSnapshot().height, 0.8);
  assert.equal(controller.getSnapshot().yaw, 45);

  // Reposition clears anchor and allows re-placement
  controller.reposition(sessionId);
  assert.equal(controller.getSnapshot().anchorId, null);
});

// ---------------------------------------------------------------------------
// 6. Tracking Loss Safety and Stale Scope Rejection
// ---------------------------------------------------------------------------
test('clearGestures resets any active gestures on tracking loss', () => {
  const { controller } = createTestHarness();
  controller.clearGestures();
  controller.clearGestures();
  assert.equal(controller.getSnapshot().pinching, false);
  assert.equal(controller.getSnapshot().rotating, false);
});

test('stale callbacks with outdated revision or requestId are safely ignored', () => {
  const { controller, sessionId } = createTestHarness();
  const staleScope = {
    sessionId,
    modelId: 'skull',
    placementRevision: 9999, // stale revision
    loadAttempt: 1,
  };

  const scaleBefore = controller.getSnapshot().scale;
  controller.setScale(staleScope, 1.5);
  assert.equal(controller.getSnapshot().scale, scaleBefore);

  const staleSliceScope = {
    sessionId,
    placementRevision: 9999,
    requestId: 9999,
  };
  const sliceBefore = controller.getSnapshot().slices.index;
  controller.selectSlice(staleSliceScope, 25);
  assert.equal(controller.getSnapshot().slices.index, sliceBefore);
});
