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
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  for (const atlas of ['high', 'low', 'validity']) {
    controller.finishVolumeAtlas(getVolumeScope(), atlas, true);
  }
  controller.finishVolumeBinding(getVolumeScope(), 'ready');
  assert.equal(canManipulateVolume(controller.getSnapshot()), true);

  // Configure quality
  controller.configureVolume(getVolumeScope(), { quality: 'fast' });
  assert.equal(controller.getSnapshot().volume.quality, 'fast');

  controller.configureVolume(getVolumeScope(), { quality: 'balanced' });
  assert.equal(controller.getSnapshot().volume.quality, 'balanced');

  // Switch to CT modality - preserves raymarch mode
  controller.selectVolumeModality(sessionId, 'ct');
  assert.equal(controller.getSnapshot().volume.modality, 'ct');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  for (const atlas of ['high', 'low', 'validity']) {
    controller.finishVolumeAtlas(getVolumeScope(), atlas, true);
  }
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
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);
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

// ---------------------------------------------------------------------------
// 7. Quest Raymarch Mode Defaults and Diagnostic Safeguards
// ---------------------------------------------------------------------------
test('Quest 3D Scan defaults to raymarch and maintains raymarch mode across modality changes and placement', () => {
  const { controller, sessionId } = createTestHarness({ defaultVolumeRenderer: 'shader' });
  controller.selectViewerMode(sessionId, 'volume');

  // Quest defaults
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  // Placement retains raymarch
  controller.selectPlane(sessionId, controller.getSnapshot().placementRevision, 'quest-floor-2');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  // Modality changes retain raymarch
  controller.selectVolumeModality(sessionId, 'ct');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  controller.selectVolumeModality(sessionId, 'mri');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  // Reposition retains raymarch
  controller.reposition(sessionId);
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  // Viewer mode toggles retain raymarch
  controller.selectViewerMode(sessionId, 'anatomy');
  controller.selectViewerMode(sessionId, 'volume');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(controller.getSnapshot().volume.magentaConfirmed, true);

  // Phone / iOS controller retains stack defaults and shader diagnostic safeguards
  const phoneCtrl = new MedicalController(undefined, sliceDataset, volumeDataset);
  phoneCtrl.attach(202);
  phoneCtrl.setTracking(202, true);
  assert.equal(phoneCtrl.getSnapshot().volume.renderer, 'stack');
  assert.equal(phoneCtrl.getSnapshot().volume.debugMode, 'magenta');
  assert.equal(phoneCtrl.getSnapshot().volume.magentaConfirmed, false);

  phoneCtrl.selectViewerMode(202, 'volume');
  phoneCtrl.selectPlane(202, phoneCtrl.getSnapshot().placementRevision, 'phone-table');
  phoneCtrl.setVolumeRenderer(202, 'shader');

  // Phone shader defaults to unconfirmed magenta diagnostic
  assert.equal(phoneCtrl.getSnapshot().volume.renderer, 'shader');
  assert.equal(phoneCtrl.getSnapshot().volume.debugMode, 'magenta');
  assert.equal(phoneCtrl.getSnapshot().volume.magentaConfirmed, false);

  const phoneScope = {
    sessionId: 202,
    placementRevision: phoneCtrl.getSnapshot().placementRevision,
    requestId: phoneCtrl.getSnapshot().volume.requestId,
  };

  // Cannot select raymarch on phone before human magenta confirmation
  phoneCtrl.setVolumeDebugMode(phoneScope, 'raymarch');
  assert.equal(phoneCtrl.getSnapshot().volume.debugMode, 'magenta');

  phoneCtrl.finishVolumeBinding(phoneScope, 'ready');
  phoneCtrl.confirmVolumeMagenta(phoneScope);
  assert.equal(phoneCtrl.getSnapshot().volume.magentaConfirmed, true);

  phoneCtrl.setVolumeDebugMode(phoneScope, 'raymarch');
  assert.equal(phoneCtrl.getSnapshot().volume.debugMode, 'raymarch');

  // Modality change on phone resets shader to magenta unconfirmed safeguard
  phoneCtrl.selectVolumeModality(202, 'ct');
  assert.equal(phoneCtrl.getSnapshot().volume.debugMode, 'magenta');
  assert.equal(phoneCtrl.getSnapshot().volume.magentaConfirmed, false);
});

test('Quest spatial controls renderer button toggles stack and raymarch and selects actual raymarch', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');

  // Simulate QuestSpatialButton toggle handler:
  const triggerToggle = () => {
    const s = controller.getSnapshot();
    if (s.volume.renderer === 'shader' && s.volume.debugMode === 'raymarch') {
      controller.setVolumeRenderer(sessionId, 'stack');
    } else {
      controller.setVolumeRenderer(sessionId, 'shader');
      if (controller.getSnapshot().volume.debugMode !== 'raymarch') {
        controller.setVolumeDebugMode(getVolumeScope(), 'raymarch');
      }
    }
  };

  // Initial state is raymarch
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');

  // Toggling while in raymarch switches to stack
  triggerToggle();
  assert.equal(controller.getSnapshot().volume.renderer, 'stack');

  // Toggling while in stack switches to raymarch
  triggerToggle();
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');

  // If in shader diagnostic mode (e.g. magenta), toggling selects actual raymarch
  controller.setVolumeDebugMode(getVolumeScope(), 'magenta');
  assert.equal(controller.getSnapshot().volume.debugMode, 'magenta');

  triggerToggle();
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');
});

test('showVolumeAnatomy atomically restores normal raymarch and retains modality, appearance, crop, transform', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');
  assert.equal(controller.getSnapshot().volume.renderer, 'shader');
  assert.equal(controller.getSnapshot().volume.debugMode, 'raymarch');

  for (const atlas of ['high', 'low', 'validity']) {
    controller.finishVolumeAtlas(getVolumeScope(), atlas, true);
  }
  controller.finishVolumeBinding(getVolumeScope(), 'ready');
  assert.equal(canManipulateVolume(controller.getSnapshot()), true);

  // Customize appearance, quality, transform, crop
  controller.configureVolume(getVolumeScope(), { quality: 'fast' });
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', 1.2);
  controller.setVolumeTransform(getVolumeScope(), 'scale', 1.8);
  controller.setVolumeTransform(getVolumeScope(), 'height', 0.9);
  controller.setVolumeTransform(getVolumeScope(), 'yaw', 45);

  const snapBefore = controller.getSnapshot();
  const reqBefore = snapBefore.volume.requestId;

  // No-op if already normal
  controller.showVolumeAnatomy(sessionId);
  assert.equal(controller.getSnapshot().volume.requestId, reqBefore, 'no-op when already normal');

  // Switch to diagnostic mode (e.g. samplers)
  controller.setVolumeDebugMode(getVolumeScope(), 'samplers');
  assert.equal(controller.getSnapshot().volume.debugMode, 'samplers');

  // showVolumeAnatomy atomically restores raymarch while retaining all settings
  controller.showVolumeAnatomy(sessionId);
  const snapAfter = controller.getSnapshot();
  assert.equal(snapAfter.volume.renderer, 'shader');
  assert.equal(snapAfter.volume.debugMode, 'raymarch');
  assert.equal(snapAfter.volume.quality, 'fast');
  assert.equal(snapAfter.volume.appearance.mri.opacity, 1.2);
  assert.equal(snapAfter.volume.scale, 1.8);
  assert.equal(snapAfter.volume.height, 0.9);
  assert.equal(snapAfter.volume.yaw, 45);

  // Switch to stack renderer
  controller.setVolumeRenderer(sessionId, 'stack');
  assert.equal(controller.getSnapshot().volume.renderer, 'stack');

  // showVolumeAnatomy atomically returns from stack to normal shader raymarch
  controller.showVolumeAnatomy(sessionId);
  const snapFromStack = controller.getSnapshot();
  assert.equal(snapFromStack.volume.renderer, 'shader');
  assert.equal(snapFromStack.volume.debugMode, 'raymarch');
  assert.equal(snapFromStack.volume.quality, 'fast');
  assert.equal(snapFromStack.volume.appearance.mri.opacity, 1.2);
});

test('Quest volume controls Visibility adjusts monotonically and clamps strictly between 0 and 100%', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');

  // Default opacity is 1.6 (visibility 80%)
  assert.equal(controller.getSnapshot().volume.appearance.mri.opacity, 1.6);
  assert.equal(Math.round(controller.getSnapshot().volume.appearance.mri.opacity * 50), 80);

  // Increment by +0.2 (+10 percentage points)
  let cur = controller.getSnapshot().volume.appearance.mri.opacity;
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', Math.min(2.0, cur + 0.2));
  assert.equal(controller.getSnapshot().volume.appearance.mri.opacity, 1.8);
  assert.equal(Math.round(controller.getSnapshot().volume.appearance.mri.opacity * 50), 90);

  // Increment again to 2.0 (100%)
  cur = controller.getSnapshot().volume.appearance.mri.opacity;
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', Math.min(2.0, cur + 0.2));
  assert.equal(controller.getSnapshot().volume.appearance.mri.opacity, 2.0);
  assert.equal(Math.round(controller.getSnapshot().volume.appearance.mri.opacity * 50), 100);

  // Increment beyond 2.0 clamps at 2.0
  cur = controller.getSnapshot().volume.appearance.mri.opacity;
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', Math.min(2.0, cur + 0.2));
  assert.equal(controller.getSnapshot().volume.appearance.mri.opacity, 2.0);

  // Decrement down to 0.0
  for (let i = 0; i < 15; i++) {
    cur = controller.getSnapshot().volume.appearance.mri.opacity;
    controller.setVolumeAppearance(getVolumeScope(), 'opacity', Math.max(0.0, cur - 0.2));
  }
  assert.equal(controller.getSnapshot().volume.appearance.mri.opacity, 0.0);
  assert.equal(Math.round(controller.getSnapshot().volume.appearance.mri.opacity * 50), 0);
});

test('CT preset switches preserve current visibility/opacity', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');
  controller.selectVolumeModality(sessionId, 'ct');

  // Set opacity to 0.6 (30% visibility)
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', 0.6);
  assert.equal(controller.getSnapshot().volume.appearance.ct.opacity, 0.6);

  // Switch to bone preset - opacity must be retained
  controller.setVolumePreset(getVolumeScope(), 'ct-bone');
  assert.equal(controller.getSnapshot().volume.appearance.ct.preset, 'ct-bone');
  assert.equal(controller.getSnapshot().volume.appearance.ct.opacity, 0.6);

  // Switch to soft-tissue preset - opacity must be retained
  controller.setVolumePreset(getVolumeScope(), 'ct-soft-tissue');
  assert.equal(controller.getSnapshot().volume.appearance.ct.preset, 'ct-soft-tissue');
  assert.equal(controller.getSnapshot().volume.appearance.ct.opacity, 0.6);

  // Selecting same preset is a no-op
  const reqBefore = controller.getSnapshot().volume.requestId;
  controller.setVolumePreset(getVolumeScope(), 'ct-soft-tissue');
  assert.equal(controller.getSnapshot().volume.requestId, reqBefore, 'same preset is no-op');
});

test('resetVolumeAppearance resets appearance without altering crop or transform', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');

  // Modify appearance, transform, crop
  controller.setVolumeAppearance(getVolumeScope(), 'opacity', 0.4);
  controller.setVolumeTransform(getVolumeScope(), 'scale', 2.2);
  controller.setVolumeCrop(getVolumeScope(), 0, 50);

  const scaleBefore = controller.getSnapshot().volume.scale;
  const crop0Before = controller.getSnapshot().volume.crop[0];

  controller.resetVolumeAppearance(sessionId);
  assert.equal(
    controller.getSnapshot().volume.appearance.mri.opacity,
    1.6,
    'resets opacity to default'
  );
  assert.equal(controller.getSnapshot().volume.scale, scaleBefore, 'preserves transform scale');
  assert.equal(controller.getSnapshot().volume.crop[0], crop0Before, 'preserves crop');
});

test('Quest volume diagnostic mode is retained across modality changes and retry', () => {
  const { controller, sessionId, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  controller.selectViewerMode(sessionId, 'volume');

  // Select diagnostic mode
  controller.setVolumeDebugMode(getVolumeScope(), 'samplers');
  assert.equal(controller.getSnapshot().volume.debugMode, 'samplers');

  // Switch modality to CT - diagnostic mode is retained on Quest
  controller.selectVolumeModality(sessionId, 'ct');
  assert.equal(controller.getSnapshot().volume.modality, 'ct');
  assert.equal(controller.getSnapshot().volume.debugMode, 'samplers');

  // Trigger error and retry - diagnostic mode is retained on retry
  controller.finishVolumeBinding(getVolumeScope(), 'error');
  assert.equal(controller.getSnapshot().volume.loadStatus, 'error');

  controller.retryVolumeLoad(sessionId);
  assert.equal(controller.getSnapshot().volume.debugMode, 'samplers');
  assert.equal(controller.getSnapshot().volume.loadStatus, 'loading');
});

// ---------------------------------------------------------------------------
// 8. Quest Scene Root ViroARScene Anchor Wiring and Selector Reset
// ---------------------------------------------------------------------------
test('QuestMedicalScene wires ViroARScene anchor callbacks to ViroARPlaneSelector and preserves selector reset and stale-session handling', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const vm = require('node:vm');

  const file = path.join(
    __dirname,
    '../src/features/medical-viewer/quest-medical-scene.native.tsx'
  );
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const element = (type, props, key) =>
    typeof type === 'function' ? type(props) : { type, props, key };
  const moduleObj = { exports: {} };

  const { controller, sessionId } = createTestHarness({ defaultVolumeRenderer: 'shader' });
  let readyCalls = 0;
  const session = {
    sessionId,
    context: {
      sessionId,
      onReady() {
        readyCalls++;
      },
      onError() {},
    },
    controller,
  };

  let registeredSelectorRef = null;
  let latestSceneContentProps = null;
  let latestControlsProps = null;
  const effectCallbacks = [];
  const stateCells = [];
  let stateCursor = 0;

  function collectNodes(node, out = []) {
    if (!node) return out;
    if (Array.isArray(node)) {
      for (const item of node) collectNodes(item, out);
      return out;
    }
    if (typeof node === 'object' && node.type) {
      out.push(node);
      if (node.props?.children) collectNodes(node.props.children, out);
    }
    return out;
  }

  vm.runInNewContext(source, {
    module: moduleObj,
    exports: moduleObj.exports,
    require(name) {
      if (name === 'react/jsx-runtime')
        return { jsx: element, jsxs: element, Fragment: 'Fragment' };
      if (name === 'react')
        return {
          useCallback: (cb) => cb,
          useState: (init) => {
            const idx = stateCursor++;
            if (!(idx in stateCells)) {
              stateCells[idx] = typeof init === 'function' ? init() : init;
            }
            const setState = (next) => {
              stateCells[idx] = typeof next === 'function' ? next(stateCells[idx]) : next;
            };
            return [stateCells[idx], setState];
          },
          useEffect: (cb) => {
            effectCallbacks.push(cb);
          },
          useRef: (init) => ({ current: init ?? null }),
          useSyncExternalStore: (_sub, snap) => snap(),
        };
      if (name === '@reactvision/react-viro')
        return {
          ViroARPlaneSelector: 'ViroARPlaneSelector',
          ViroARScene: 'ViroARScene',
          ViroController: 'ViroController',
          ViroNode: 'ViroNode',
          ViroTrackingStateConstants: { TRACKING_UNAVAILABLE: 1, TRACKING_NORMAL: 3 },
        };
      if (name.includes('VRQuestNavigatorBridge'))
        return {
          VRQuestNavigatorBridge: { onQuestError: () => () => {} },
        };
      if (name === '@/features/ar/quest-session-bridge')
        return {
          useQuestSession: () => session,
        };
      if (name === '@/features/ar/quest-spatial-math')
        return require('../src/features/ar/quest-spatial-math.ts');
      if (name === './medical-scene-content.native')
        return {
          QUEST_WORLD_ANCHOR_ID: 'quest-world-anchor',
          MedicalSceneContent: (props) => {
            registeredSelectorRef = props.selectorRef;
            latestSceneContentProps = props;
            return {
              type: 'MedicalSceneContent',
              props,
            };
          },
        };
      if (name === './quest-spatial-controls.native')
        return {
          QuestSpatialControls: (props) => {
            latestControlsProps = props;
            return { type: 'QuestSpatialControls', props };
          },
        };
      return {};
    },
  });

  stateCursor = 0;
  const sceneTree = moduleObj.exports.default();
  assert.equal(sceneTree.type, 'ViroARScene');
  const allNodes = collectNodes(sceneTree);
  assert.ok(
    !allNodes.some((node) => node.type === 'ViroController'),
    'Quest must not mount ViroController anywhere: its native delegate crashes during OpenXR startup'
  );

  // Verify 2-level static ViroNode isolation under ViroARScene so dynamic child mounts
  // never trigger VRTNode$AnchorAttempt -> ARScene.createAnchoredNode spam on OpenXR.
  const outerRoot = sceneTree.props.children;
  assert.equal(outerRoot.type, 'ViroNode');
  assert.deepEqual(Array.from(outerRoot.props.position), [0, 0, 0]);
  const innerRoot = outerRoot.props.children;
  assert.equal(innerRoot.type, 'ViroNode');
  assert.deepEqual(Array.from(innerRoot.props.position), [0, 0, 0]);

  assert.equal(typeof sceneTree.props.onAnchorFound, 'function');
  assert.equal(typeof sceneTree.props.onAnchorUpdated, 'function');
  assert.equal(typeof sceneTree.props.onAnchorRemoved, 'function');
  assert.ok(registeredSelectorRef, 'MedicalSceneContent must receive selectorRef');

  // Verify overlapping VRActivity mount/unmount refcount safety during VR re-entry
  const mountEffect = effectCallbacks[0];
  const cleanupFirst = mountEffect();
  assert.equal(moduleObj.exports.hasActiveQuestSceneMount(sessionId), true);
  assert.equal(controller.getSnapshot().sessionId, sessionId);
  const cleanupSecond = mountEffect();
  cleanupFirst();
  // First VRActivity unmounting after second VRActivity already mounted must NOT detach session!
  assert.equal(moduleObj.exports.hasActiveQuestSceneMount(sessionId), true);
  assert.equal(controller.getSnapshot().sessionId, sessionId);
  cleanupSecond();
  assert.equal(moduleObj.exports.hasActiveQuestSceneMount(sessionId), false);
  assert.equal(controller.getSnapshot().sessionId, null);

  // Re-attach for remaining scene interaction assertions
  controller.attach(sessionId);
  controller.setTracking(sessionId, true);
  controller.selectPlane(
    sessionId,
    controller.getSnapshot().placementRevision,
    'quest-floor-anchor'
  );

  // Quest can report unavailable at startup before supplying a valid pose.
  sceneTree.props.onTrackingUpdated(1);
  assert.equal(controller.getSnapshot().tracking, 'limited');
  sceneTree.props.onCameraTransformUpdate({ position: [0, 1.6, 0], forward: [0, 0, -1] });
  assert.equal(controller.getSnapshot().tracking, 'normal');
  assert.equal(readyCalls, 1);
  // Once tracking events are available, a limited event cannot be overwritten by poses.
  sceneTree.props.onTrackingUpdated(2);
  sceneTree.props.onCameraTransformUpdate({ position: [0, 1.6, 0], forward: [0, 0, -1] });
  assert.equal(controller.getSnapshot().tracking, 'limited');
  sceneTree.props.onTrackingUpdated(3);

  const foundAnchors = [];
  const updatedAnchors = [];
  const removedAnchors = [];
  let resets = 0;
  registeredSelectorRef.current = {
    handleAnchorFound: (a) => foundAnchors.push(a),
    handleAnchorUpdated: (a) => updatedAnchors.push(a),
    handleAnchorRemoved: (a) => {
      removedAnchors.push(a);
      controller.losePlane(sessionId, controller.getSnapshot().placementRevision, a.anchorId);
    },
    reset: () => {
      resets++;
    },
  };

  // 1. Anchor found forwards to selector
  sceneTree.props.onAnchorFound({ type: 'plane', anchorId: 'quest-plane-1' });
  assert.equal(foundAnchors.length, 1);
  assert.equal(foundAnchors[0].anchorId, 'quest-plane-1');

  // 2. Anchor updated forwards to selector
  sceneTree.props.onAnchorUpdated({ type: 'plane', anchorId: 'quest-plane-1' });
  assert.equal(updatedAnchors.length, 1);
  assert.equal(updatedAnchors[0].anchorId, 'quest-plane-1');

  // 3. Null anchor on remove is safely handled
  sceneTree.props.onAnchorRemoved(null);
  assert.equal(removedAnchors.length, 0);

  // 4. Removal of unrelated anchor does not clear placed anchor
  sceneTree.props.onAnchorRemoved({ type: 'plane', anchorId: 'other-plane' });
  assert.equal(removedAnchors.length, 1);
  assert.equal(controller.getSnapshot().anchorId, 'quest-floor-anchor');

  // 5. Removal of placed plane clears anchorId and increments placement revision
  const revBefore = controller.getSnapshot().placementRevision;
  sceneTree.props.onAnchorRemoved({ type: 'plane', anchorId: 'quest-floor-anchor' });
  assert.equal(removedAnchors.length, 2);
  assert.equal(controller.getSnapshot().anchorId, null);
  assert.equal(controller.getSnapshot().placementRevision, revBefore + 1);

  // 6. Room-model-free "Place In Front" places world anchor when no planes exist
  assert.equal(typeof latestControlsProps.onPlaceInFront, 'function');
  latestControlsProps.onPlaceInFront();
  assert.equal(controller.getSnapshot().anchorId, 'quest-world-anchor');
  assert.ok(resets >= 1);

  stateCursor = 0;
  moduleObj.exports.default();
  assert.ok(latestSceneContentProps.worldAnchorPose);
  assert.ok(Math.abs(latestSceneContentProps.worldAnchorPose.position[2] - -0.95) < 1e-4);

  // 7. Stale removal is ignored
  controller.losePlane(999, controller.getSnapshot().placementRevision, 'quest-world-anchor');
  assert.equal(controller.getSnapshot().anchorId, 'quest-world-anchor');
});

// ---------------------------------------------------------------------------
// 9. QuestSpatialControls Rendered Viro Tree, Hit-Testing, Typography & Layout
// ---------------------------------------------------------------------------
test('QuestSpatialControls renders supersampled crisp text, non-occluding quads, direct quad click targets, and zero layout overlaps across all modes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const vm = require('node:vm');

  const file = path.join(
    __dirname,
    '../src/features/medical-viewer/quest-spatial-controls.native.tsx'
  );
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  let transformOpenState = false;
  let hoveredState = false;
  let pressedState = false;
  let exitedVR = 0;
  let movedTo = null;
  const createdMaterials = {};

  const element = (type, props, key) =>
    typeof type === 'function' ? type(props) : { type, props, key };
  const moduleObj = { exports: {} };

  vm.runInNewContext(source, {
    module: moduleObj,
    exports: moduleObj.exports,
    setTimeout: () => 0,
    clearTimeout: () => {},
    require(name) {
      if (name === 'react/jsx-runtime')
        return { jsx: element, jsxs: element, Fragment: 'Fragment' };
      if (name === 'react')
        return {
          useState: () => [
            transformOpenState,
            (next) => {
              transformOpenState = typeof next === 'function' ? next(transformOpenState) : next;
            },
          ],
          useSyncExternalStore: (_sub, snap) => snap(),
          useRef: (init) => ({ current: init ?? null }),
          useEffect: () => {},
        };
      if (name === '@reactvision/react-viro')
        return {
          ViroPolygon: 'ViroPolygon',
          useAnySourceHover: () => [hoveredState, () => {}],
          useAnySourcePressed: () => [pressedState, () => {}],
          ViroMaterials: {
            createMaterials: (defs) => Object.assign(createdMaterials, defs),
          },
          ViroNode: 'ViroNode',
          ViroQuad: 'ViroQuad',
          ViroText: 'ViroText',
        };
      if (name === '@/features/ar/quest-spatial-math')
        return require('../src/features/ar/quest-spatial-math.ts');
      if (name === './medical-controller')
        return require('../src/features/medical-viewer/medical-controller.ts');
      if (name === './medical-models')
        return require('../src/features/medical-viewer/medical-models.ts');
      if (name === './medical-volumes')
        return require('../src/features/medical-viewer/medical-volumes.ts');
      if (name === './medical-slices')
        return require('../src/features/medical-viewer/medical-slices.ts');
      return {};
    },
  });

  const { QuestSpatialControls, QUEST_TEXT_SCALE } = moduleObj.exports;
  assert.equal(QUEST_TEXT_SCALE, 0.025);

  // All panel & button materials must write and read depth buffer using Constant lighting
  for (const [matName, matDef] of Object.entries(createdMaterials)) {
    assert.equal(matDef.lightingModel, 'Constant', `${matName} should use Constant lighting`);
    assert.equal(matDef.writesToDepthBuffer, true, `${matName} must write depth buffer`);
    assert.equal(matDef.readsFromDepthBuffer, true, `${matName} must read depth buffer`);
  }

  function inspectPanelTree(rootNode, modeName) {
    const interactiveQuads = [];
    const decorativeQuads = [];
    const layoutBoxes = [];
    const textEntries = [];

    function walk(node, offsetX, offsetY, parentScale) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, offsetX, offsetY, parentScale);
        return;
      }
      if (typeof node !== 'object' || !node.type) return;

      const pos = node.props?.position ?? [0, 0, 0];
      const scale = node.props?.scale ? node.props.scale[0] : 1;
      const x = offsetX + pos[0] * parentScale;
      const y = offsetY + pos[1] * parentScale;
      const nextScale = parentScale * scale;

      if (node.type === 'ViroQuad' || node.type === 'ViroPolygon') {
        let nodeW = node.props.width;
        let nodeH = node.props.height;
        if (node.type === 'ViroPolygon') {
          const xs = node.props.vertices.map((v) => v[0]);
          const ys = node.props.vertices.map((v) => v[1]);
          nodeW = Math.max(...xs) - Math.min(...xs);
          nodeH = Math.max(...ys) - Math.min(...ys);
        }
        const w = nodeW * nextScale;
        const h = nodeH * nextScale;
        if ((node.props.renderingOrder ?? 0) <= 0) {
          decorativeQuads.push(node);
          assert.equal(
            node.props.ignoreEventHandling,
            true,
            `[${modeName}] Decorative/background quad (${w}x${h}) must set ignoreEventHandling=true so rotated AABB never blocks pointer rays`
          );
        } else {
          interactiveQuads.push({ node, x, y, width: w, height: h });
          layoutBoxes.push({
            kind: 'button',
            label: `quad@${x.toFixed(3)},${y.toFixed(3)}`,
            x,
            y,
            width: w,
            height: h,
          });
          if (node.props.ignoreEventHandling) {
            assert.equal(node.props.onClick, undefined);
          } else {
            assert.equal(typeof node.props.onClick, 'function');
            assert.equal(typeof node.props.onHover, 'function');
            assert.equal(typeof node.props.onClickState, 'function');
          }
        }
      }

      if (node.type === 'ViroText') {
        assert.equal(
          Math.abs(parentScale - QUEST_TEXT_SCALE) < 1e-6,
          true,
          `[${modeName}] ViroText "${node.props.text}" must sit inside scaled ViroNode (${QUEST_TEXT_SCALE})`
        );
        assert.equal(node.props.ignoreEventHandling, true);
        assert.equal(node.props.textClipMode, 'None');
        const fontPx = node.props.style.fontSize;
        assert.ok(
          fontPx >= 44 && fontPx <= 96,
          `[${modeName}] ViroText "${node.props.text}" must rasterize at crisp high-DPI px (got ${fontPx})`
        );
        const worldCapM = fontPx * 0.01 * parentScale;
        assert.ok(
          worldCapM >= 0.011 && worldCapM <= 0.022,
          `[${modeName}] ViroText "${node.props.text}" physical height must be 1.1-2.2cm (got ${(worldCapM * 100).toFixed(2)}cm)`
        );
        const w = node.props.width * nextScale;
        const h = node.props.height * nextScale;
        textEntries.push({ text: node.props.text, x, y, width: w, height: h });

        // Standalone labels (outside button faces) also participate in non-overlap check
        const insideButton = interactiveQuads.some(
          (btn) =>
            Math.abs(btn.x - x) < 1e-3 &&
            Math.abs(btn.y - y) < 1e-3 &&
            w <= btn.width + 1e-3 &&
            h <= btn.height + 1e-3
        );
        if (!insideButton) {
          layoutBoxes.push({ kind: 'text', label: node.props.text, x, y, width: w, height: h });
        }
      }

      if (node.props?.children) {
        walk(node.props.children, x, y, nextScale);
      }
    }

    // Start inside the panel root node (ignore panel's world pose offset). When
    // the controls render drag handles the root is a fragment and the panel is last.
    const panelNode =
      rootNode.type === 'Fragment'
        ? rootNode.props.children[rootNode.props.children.length - 1]
        : rootNode;
    walk(panelNode.props.children, 0, 0, 1);

    assert.ok(decorativeQuads.length >= 4, `[${modeName}] Expected panel frame/surface quads`);
    assert.ok(interactiveQuads.length >= 5, `[${modeName}] Expected interactive button quads`);

    // Every layout box must fit inside the 0.92m x 0.48m panel and never overlap another box
    for (let i = 0; i < layoutBoxes.length; i++) {
      const a = layoutBoxes[i];
      assert.ok(
        a.x - a.width / 2 >= -0.455 && a.x + a.width / 2 <= 0.455,
        `[${modeName}] "${a.label}" exceeds panel width: [${a.x - a.width / 2}, ${a.x + a.width / 2}]`
      );
      assert.ok(
        a.y - a.height / 2 >= -0.235 && a.y + a.height / 2 <= 0.275,
        `[${modeName}] "${a.label}" exceeds panel height: [${a.y - a.height / 2}, ${a.y + a.height / 2}]`
      );
      for (let j = i + 1; j < layoutBoxes.length; j++) {
        const b = layoutBoxes[j];
        const overlapX =
          Math.min(a.x + a.width / 2, b.x + b.width / 2) -
          Math.max(a.x - a.width / 2, b.x - b.width / 2);
        const overlapY =
          Math.min(a.y + a.height / 2, b.y + b.height / 2) -
          Math.max(a.y - a.height / 2, b.y - b.height / 2);
        assert.ok(
          overlapX <= 1e-4 || overlapY <= 1e-4,
          `[${modeName}] Overlap between "${a.label}" and "${b.label}" (dx=${overlapX.toFixed(4)}m, dy=${overlapY.toFixed(4)}m)`
        );
      }
    }

    return { interactiveQuads, textEntries };
  }

  const { controller, sessionId, getScope, getSliceScope, getVolumeScope } = createTestHarness({
    defaultVolumeRenderer: 'shader',
  });
  const context = { sessionId, onReady() {}, onError() {}, onInstruction() {} };
  const panelPose = { position: [0, 1.14, -1.1], rotation: [0, 180, 0] };
  let recenterCount = 0;
  let placeInFrontCount = 0;

  const renderControls = () =>
    QuestSpatialControls({
      context,
      controller,
      panelPose,
      onRecenter: () => {
        recenterCount++;
      },
      onPlaceInFront: () => {
        placeInFrontCount++;
      },
      onExit: () => {
        exitedVR++;
      },
      onMoveRig: (pos) => {
        movedTo = pos;
      },
    });

  // 1. Unplaced state: only one large Place In Front button, nothing else interactive
  controller.reposition(sessionId);
  transformOpenState = false;
  controller.setTracking(sessionId, false);
  const unplaced = renderControls();
  assert.equal(unplaced.type, 'ViroNode', 'unplaced controls must not render drag handles');
  const unplacedPolys = [];
  (function collect(node) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node !== 'object') return;
    if (node.type === 'ViroPolygon' && node.props.onClick) unplacedPolys.push(node);
    if (node.type === 'ViroText')
      unplacedPolys.labels = [...(unplacedPolys.labels ?? []), node.props.text];
    collect(node.props?.children);
  })(unplaced);
  assert.equal(unplacedPolys.length, 0, 'tracking not normal yet: the big button is disabled');
  controller.setTracking(sessionId, true);
  const unplacedReady = renderControls();
  const bigButtons = [];
  (function collect(node) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(collect);
    if (typeof node !== 'object') return;
    if (node.type === 'ViroPolygon' && node.props.onClick) bigButtons.push(node);
    collect(node.props?.children);
  })(unplacedReady);
  assert.equal(bigButtons.length, 1, 'exactly one interactive control before placement');
  const bigXs = bigButtons[0].props.vertices.map((v) => v[0]);
  const bigYs = bigButtons[0].props.vertices.map((v) => v[1]);
  assert.ok(Math.max(...bigXs) - Math.min(...bigXs) >= 0.5, 'Place In Front must be large');
  assert.ok(Math.max(...bigYs) - Math.min(...bigYs) >= 0.15, 'Place In Front must be tall');
  bigButtons[0].props.onClick();
  assert.equal(placeInFrontCount, 1);
  assert.equal(controller.getSnapshot().sessionId, sessionId);

  // Place and verify Anatomy ready + error states
  controller.selectPlane(
    sessionId,
    controller.getSnapshot().placementRevision,
    'quest-world-anchor'
  );
  for (const assetId of ['half-skull', 'brain']) {
    controller.finishLoad(getScope(), assetId, true);
  }
  hoveredState = true;
  const readyInfo = inspectPanelTree(renderControls(), 'anatomy-ready');
  hoveredState = false;

  // Header buttons: Recenter and Exit VR are wired
  for (const q of readyInfo.interactiveQuads) {
    if (Math.abs(q.x - 0) < 1e-3 && Math.abs(q.y - 0.208) < 1e-3) q.node.props.onClick();
    if (Math.abs(q.x - 0.285) < 1e-3 && Math.abs(q.y - 0.208) < 1e-3) q.node.props.onClick();
  }
  assert.equal(recenterCount, 1);
  assert.equal(exitedVR, 1);

  // Placed state renders a move handle and a rotate handle beside the panel
  const placedTree = renderControls();
  assert.equal(placedTree.type, 'Fragment');
  const handles = placedTree.props.children.slice(0, 2);
  const draggable = (handle) =>
    handle.props.children.find((c) => c.type === 'ViroPolygon' && c.props.onDrag);
  const moveHandle = draggable(handles[0]);
  const rotateHandle = draggable(handles[1]);
  assert.ok(moveHandle && rotateHandle, 'both handles expose onDrag');
  assert.equal(moveHandle.props.dragType, 'FixedDistance');

  moveHandle.props.onDrag([0.4, 0.7, -1.2]);
  assert.deepEqual(Array.from(movedTo), [0.4, 0.7, -1.2]);

  const yawBefore = controller.getSnapshot().yaw;
  rotateHandle.props.onDrag([0, 1, -1]); // first sample only establishes the start
  assert.equal(controller.getSnapshot().yaw, yawBefore);
  rotateHandle.props.onDrag([-0.1, 1, -1]); // test panel is yawed 180deg: -0.1m world x is 0.1m to its right = 60 degrees
  assert.ok(Math.abs(controller.getSnapshot().yaw - (yawBefore + 60)) < 1e-3);

  controller.selectModel(sessionId, 'skull');
  controller.finishLoad(getScope(), 'skull', false);
  inspectPanelTree(renderControls(), 'anatomy-error');
  controller.retryLoad(sessionId);
  controller.finishLoad(getScope(), 'skull', true);

  // 2. Slices mode (ready + error)
  controller.selectViewerMode(sessionId, 'slices');
  controller.finishSliceLoad(getSliceScope(), true);
  inspectPanelTree(renderControls(), 'slices-ready');

  // Slider thumb: sits beside the panel and scrubs through the series when dragged
  const slicesTree = renderControls();
  assert.equal(slicesTree.type, 'Fragment');
  const thumb = slicesTree.props.children[2];
  assert.ok(thumb, 'slices mode renders a slider thumb');
  const thumbQuad = thumb.props.children.find((c) => c.type === 'ViroPolygon' && c.props.onDrag);
  const imageCount = controller.getSliceSeries().imageCount;
  // Test panel is yawed 180deg, so world x = -local x; far right of the track is world x -0.36
  thumbQuad.props.onDrag([-0.36, 1, -1]);
  assert.equal(controller.getSnapshot().slices.index, imageCount - 1);
  controller.finishSliceLoad(getSliceScope(), true);
  thumbQuad.props.onDrag([0.36, 1, -1]);
  assert.equal(controller.getSnapshot().slices.index, 0);
  controller.finishSliceLoad(getSliceScope(), true);
  controller.finishSliceLoad(getSliceScope(), false);
  inspectPanelTree(renderControls(), 'slices-error');
  controller.retrySliceLoad(sessionId);
  controller.finishSliceLoad(getSliceScope(), true);

  // 3. Volume mode (MRI + CT + error)
  controller.selectViewerMode(sessionId, 'volume');
  for (const atlas of ['high', 'low', 'validity']) {
    controller.finishVolumeAtlas(getVolumeScope(), atlas, true);
  }
  controller.finishVolumeBinding(getVolumeScope(), 'ready');
  inspectPanelTree(renderControls(), 'volume-mri');

  controller.selectVolumeModality(sessionId, 'ct');
  for (const atlas of ['high', 'low', 'validity']) {
    controller.finishVolumeAtlas(getVolumeScope(), atlas, true);
  }
  controller.finishVolumeBinding(getVolumeScope(), 'ready');
  inspectPanelTree(renderControls(), 'volume-ct');

  controller.finishVolumeBinding(getVolumeScope(), 'error');
  inspectPanelTree(renderControls(), 'volume-error');

  // 4. Transform sub-panel
  transformOpenState = true;
  const transformInfo = inspectPanelTree(renderControls(), 'transform');
  assert.ok(transformInfo.textEntries.some((t) => t.text === 'Move Here'));
  assert.ok(transformInfo.textEntries.some((t) => t.text === 'Reposition'));
  assert.ok(transformInfo.textEntries.some((t) => t.text === 'Reset Pose'));
  assert.ok(transformInfo.textEntries.some((t) => t.text === 'Done'));
});
