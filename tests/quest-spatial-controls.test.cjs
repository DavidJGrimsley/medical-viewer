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
  const { controller, sessionId, getVolumeScope } = createTestHarness({ defaultVolumeRenderer: 'shader' });
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

// ---------------------------------------------------------------------------
// 8. Quest Scene Root ViroARScene Anchor Wiring and Selector Reset
// ---------------------------------------------------------------------------
test('QuestMedicalScene wires ViroARScene anchor callbacks to ViroARPlaneSelector and preserves selector reset and stale-session handling', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const vm = require('node:vm');

  const file = path.join(__dirname, '../src/features/medical-viewer/quest-medical-scene.native.tsx');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const element = (type, props, key) => (typeof type === 'function' ? type(props) : { type, props, key });
  const moduleObj = { exports: {} };

  const { controller, sessionId } = createTestHarness({ defaultVolumeRenderer: 'shader' });
  const session = {
    sessionId,
    context: { sessionId, onReady() {}, onError() {} },
    controller,
  };

  let registeredSelectorRef = null;
  vm.runInNewContext(source, {
    module: moduleObj,
    exports: moduleObj.exports,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === 'react')
        return {
          useCallback: (cb) => cb,
          useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
          useEffect: () => {},
          useRef: () => ({ current: null }),
          useSyncExternalStore: (_sub, snap) => snap(),
        };
      if (name === '@reactvision/react-viro')
        return {
          ViroARPlaneSelector: 'ViroARPlaneSelector',
          ViroARScene: 'ViroARScene',
          ViroController: 'ViroController',
          ViroTrackingStateConstants: { TRACKING_NORMAL: 3 },
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
        return {
          computeHeadLockedTransform: () => ({ position: [0, 0, 0], rotation: [0, 0, 0] }),
        };
      if (name === './medical-scene-content.native')
        return {
          MedicalSceneContent: (props) => {
            registeredSelectorRef = props.selectorRef;
            return {
              type: 'MedicalSceneContent',
              props,
            };
          },
        };
      if (name === './quest-spatial-controls.native')
        return {
          QuestSpatialControls: (props) => ({ type: 'QuestSpatialControls', props }),
        };
      return {};
    },
  });

  const sceneTree = moduleObj.exports.default();
  assert.equal(sceneTree.type, 'ViroARScene');
  assert.equal(typeof sceneTree.props.onAnchorFound, 'function');
  assert.equal(typeof sceneTree.props.onAnchorUpdated, 'function');
  assert.equal(typeof sceneTree.props.onAnchorRemoved, 'function');
  assert.ok(registeredSelectorRef, 'MedicalSceneContent must receive selectorRef');

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

  // 6. Stale removal is ignored
  controller.losePlane(999, controller.getSnapshot().placementRevision, 'quest-floor-anchor');
  assert.equal(controller.getSnapshot().placementRevision, revBefore + 1);
});
