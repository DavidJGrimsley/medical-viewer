const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const {
  computeHeadLockedTransform,
  computeQuestPanelTransform,
  computeQuestSpecimenTransform,
} = require('../src/features/ar/quest-spatial-math.ts');
const { DEFAULT_AR_HEIGHT } = require('../src/features/ar/ar-transform.ts');
const { SLICE_PANEL_WIDTH_METRES } = require('../src/features/medical-viewer/medical-slices.ts');
const { questSessionBridge } = require('../src/features/ar/quest-session-bridge.ts');

function loadQuestModule(filePath, mockRN) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  const tsCode = fs.readFileSync(fullPath, 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === 'react-native') return mockRN;
      if (id === 'react') return { useEffect: () => {}, useState: (init) => [init, () => {}] };
      return require(id);
    },
    console,
  });
  return mod.exports;
}

// ---------------------------------------------------------------------------
// 1. Quest Device Detection
// ---------------------------------------------------------------------------
test('isQuestDevice returns false on non-Android platforms', () => {
  const { isQuestDevice } = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'ios', constants: { Brand: 'Meta', Model: 'Quest 3' } },
    NativeModules: {},
  });
  assert.equal(isQuestDevice(), false);
});

test('isQuestDevice detects Oculus Quest 1/2/Pro by manufacturer or brand', () => {
  const oculusManufacturer = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'android', constants: { Manufacturer: 'Oculus', Brand: 'oculus' } },
    NativeModules: {},
  });
  assert.equal(oculusManufacturer.isQuestDevice(), true);

  const oculusBrandOnly = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'android', constants: { Manufacturer: 'Unknown', Brand: 'Oculus' } },
    NativeModules: {},
  });
  assert.equal(oculusBrandOnly.isQuestDevice(), true);
});

test('isQuestDevice detects Meta Quest 3 and 3S by manufacturer, brand, or model', () => {
  const metaBrand = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'android', constants: { Manufacturer: 'Meta', Brand: 'meta' } },
    NativeModules: {},
  });
  assert.equal(metaBrand.isQuestDevice(), true);

  const questModel = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: {
      OS: 'android',
      constants: { Manufacturer: 'Other', Brand: 'other', Model: 'Quest 3S' },
    },
    NativeModules: {},
  });
  assert.equal(questModel.isQuestDevice(), true);
});

test('isQuestDevice returns false for standard non-Quest Android devices', () => {
  const galaxyPhone = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: {
      OS: 'android',
      constants: { Manufacturer: 'Samsung', Brand: 'samsung', Model: 'SM-S928B' },
    },
    NativeModules: {},
  });
  assert.equal(galaxyPhone.isQuestDevice(), false);

  const pixelPhone = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: {
      OS: 'android',
      constants: { Manufacturer: 'Google', Brand: 'google', Model: 'Pixel 9 Pro' },
    },
    NativeModules: {},
  });
  assert.equal(pixelPhone.isQuestDevice(), false);
});

test('hasOpenXRSupport detects presence of VRModuleOpenXR', () => {
  const withoutVR = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'android', constants: {} },
    NativeModules: {},
  });
  assert.equal(withoutVR.hasOpenXRSupport(), false);

  const withVR = loadQuestModule('src/features/ar/quest-device.ts', {
    Platform: { OS: 'android', constants: {} },
    NativeModules: { VRModuleOpenXR: {} },
  });
  assert.equal(withVR.hasOpenXRSupport(), true);
});

// ---------------------------------------------------------------------------
// 2. Quest Runtime and Permissions
// ---------------------------------------------------------------------------
test('nativeQuestRuntime checkSupport returns unsupported on non-Android', async () => {
  const { nativeQuestRuntime } = loadQuestModule('src/features/ar/quest-runtime.ts', {
    Platform: { OS: 'ios' },
    NativeModules: { VRModuleOpenXR: {} },
    PermissionsAndroid: {},
  });
  assert.equal(await nativeQuestRuntime.checkSupport(), 'unsupported');
});

test('nativeQuestRuntime checkSupport reports missing-native when OpenXR modules are missing', async () => {
  const { nativeQuestRuntime } = loadQuestModule('src/features/ar/quest-runtime.ts', {
    Platform: { OS: 'android' },
    NativeModules: {},
    PermissionsAndroid: {},
  });
  assert.equal(await nativeQuestRuntime.checkSupport(), 'missing-native');
});

test('nativeQuestRuntime checkSupport reports supported when VRModuleOpenXR is present', async () => {
  const { nativeQuestRuntime, questARRuntime } = loadQuestModule(
    'src/features/ar/quest-runtime.ts',
    {
      Platform: { OS: 'android' },
      NativeModules: { VRModuleOpenXR: {} },
      PermissionsAndroid: {},
    }
  );
  assert.equal(await nativeQuestRuntime.checkSupport(), 'supported');
  assert.equal(await questARRuntime.checkSupport(), 'supported');
});

test('nativeQuestRuntime hasSpatialPermission checks Horizon OS anchor and scene permissions without phone camera', async () => {
  const checkedPermissions = [];
  const mockRN = {
    Platform: { OS: 'android' },
    NativeModules: { VRModuleOpenXR: {} },
    PermissionsAndroid: {
      check: async (perm) => {
        checkedPermissions.push(perm);
        return perm === 'horizonos.permission.USE_ANCHOR_API';
      },
    },
  };

  const { nativeQuestRuntime } = loadQuestModule('src/features/ar/quest-runtime.ts', mockRN);
  const granted = await nativeQuestRuntime.hasSpatialPermission();
  assert.equal(granted, true);
  assert.ok(checkedPermissions.includes('horizonos.permission.USE_ANCHOR_API'));
  assert.ok(!checkedPermissions.includes('android.permission.CAMERA'));
});

test('nativeQuestRuntime requestSpatialPermission requests anchor and scene permissions', async () => {
  let requested = null;
  const mockRN = {
    Platform: { OS: 'android' },
    NativeModules: { VRModuleOpenXR: {} },
    PermissionsAndroid: {
      RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
      requestMultiple: async (perms) => {
        requested = perms;
        return {
          'horizonos.permission.USE_ANCHOR_API': 'granted',
          'com.oculus.permission.USE_SCENE': 'granted',
        };
      },
    },
  };

  const { questARRuntime } = loadQuestModule('src/features/ar/quest-runtime.ts', mockRN);
  const res = await questARRuntime.requestCameraPermission();
  assert.equal(res, true);
  assert.deepEqual(Array.from(requested), [
    'horizonos.permission.USE_ANCHOR_API',
    'com.oculus.permission.USE_SCENE',
  ]);
});

// ---------------------------------------------------------------------------
// 3. Quest Session Bridge
// ---------------------------------------------------------------------------
test('questSessionBridge manages active session and notifies subscribers', () => {
  questSessionBridge.clearSession();
  assert.equal(questSessionBridge.getSession(), null);

  const notifications = [];
  const unsubscribe = questSessionBridge.subscribe((session) => {
    notifications.push(session ? session.sessionId : null);
  });

  // Initial notification is null
  assert.deepEqual(notifications, [null]);

  // Register session 42
  const mockSession = { sessionId: 42, context: {}, controller: {} };
  questSessionBridge.registerSession(mockSession);
  assert.equal(questSessionBridge.getSession()?.sessionId, 42);
  assert.deepEqual(notifications, [null, 42]);

  // Clearing with a mismatched session ID does nothing (stale session safety)
  questSessionBridge.clearSession(99);
  assert.equal(questSessionBridge.getSession()?.sessionId, 42);
  assert.deepEqual(notifications, [null, 42]);

  // Clearing with matching ID clears active session
  questSessionBridge.clearSession(42);
  assert.equal(questSessionBridge.getSession(), null);
  assert.deepEqual(notifications, [null, 42, null]);

  unsubscribe();
});

// ---------------------------------------------------------------------------
// 4. Head-Locked Spatial Math
// ---------------------------------------------------------------------------
test('computeHeadLockedTransform places panel in front of camera with upright yaw-only rotation', () => {
  const cameraPose = {
    position: [0, 1.6, 0],
    forward: [0, 0, -1],
    up: [0, 1, 0],
  };

  const transform = computeHeadLockedTransform(cameraPose, {
    distanceM: 1.15,
    verticalOffsetM: -0.05,
  });

  // Position: forward by 1.15 along z=-1, down by 0.05 along y=1
  assert.ok(Math.abs(transform.position[0] - 0) < 1e-4);
  assert.ok(Math.abs(transform.position[1] - 1.55) < 1e-4);
  assert.ok(Math.abs(transform.position[2] - -1.15) < 1e-4);

  // Rotation: pitch=0, roll=0, yaw facing user
  assert.equal(transform.rotation[0], 0);
  assert.equal(transform.rotation[2], 0);
  // atan2(0, -1) is PI (180 deg); 180 + 180 = 360 deg
  assert.ok(
    Math.abs(transform.rotation[1] - 360) < 1e-4 || Math.abs(transform.rotation[1] - 0) < 1e-4
  );
});

test('computeHeadLockedTransform maintains upright panel when wearer looks diagonally', () => {
  const cameraPose = {
    position: [1, 1.7, 2],
    forward: [1 / Math.SQRT2, 0, -1 / Math.SQRT2],
    up: [0, 1, 0],
  };

  const transform = computeHeadLockedTransform(cameraPose, {
    distanceM: 1.0,
    verticalOffsetM: 0.0,
  });

  assert.ok(Math.abs(transform.position[0] - (1 + 1 / Math.SQRT2)) < 1e-4);
  assert.ok(Math.abs(transform.position[1] - 1.7) < 1e-4);
  assert.ok(Math.abs(transform.position[2] - (2 - 1 / Math.SQRT2)) < 1e-4);

  // Pitch and roll are strictly 0
  assert.equal(transform.rotation[0], 0);
  assert.equal(transform.rotation[2], 0);
});

test('computeQuestPanelTransform projects forward onto horizontal plane so head pitch never strands controls', () => {
  const pitchedDownPose = {
    position: [0, 1.6, 0],
    forward: [0, -Math.sin(Math.PI / 5), -Math.cos(Math.PI / 5)],
    up: [0, Math.cos(Math.PI / 5), -Math.sin(Math.PI / 5)],
  };
  const pitchedUpPose = {
    position: [0, 1.6, 0],
    forward: [0, Math.sin(Math.PI / 5), -Math.cos(Math.PI / 5)],
    up: [0, Math.cos(Math.PI / 5), Math.sin(Math.PI / 5)],
  };

  const downPanel = computeQuestPanelTransform(pitchedDownPose);
  const upPanel = computeQuestPanelTransform(pitchedUpPose);

  // Both place the console at the exact same horizontal distance (1.10m) and desk height (1.6 - 0.46 = 1.14m)
  assert.deepEqual(downPanel.position, upPanel.position);
  assert.ok(Math.abs(downPanel.position[0] - 0) < 1e-4);
  assert.ok(Math.abs(downPanel.position[1] - 1.14) < 1e-4);
  assert.ok(Math.abs(downPanel.position[2] - -1.1) < 1e-4);
  assert.equal(downPanel.rotation[0], 0);
  assert.equal(downPanel.rotation[2], 0);

  // Degenerate straight-up/down gaze falls back cleanly to -Z
  const zenithPanel = computeQuestPanelTransform({
    position: [1, 1.5, 2],
    forward: [0, 1, 0],
  });
  assert.ok(Math.abs(zenithPanel.position[0] - 1) < 1e-4);
  assert.ok(Math.abs(zenithPanel.position[2] - 0.9) < 1e-4);
});

test('computeQuestSpecimenTransform places specimen in clear view above console without overlapping slice panel', () => {
  const eyeY = 1.6;
  const pose = {
    position: [0, eyeY, 0],
    forward: [0, 0, -1],
    up: [0, 1, 0],
  };

  const panel = computeQuestPanelTransform(pose);
  const specimenAnchor = computeQuestSpecimenTransform(pose);

  // Effective specimen center in world space once MedicalSceneContent adds DEFAULT_AR_HEIGHT
  const specimenCenterY = specimenAnchor.position[1] + DEFAULT_AR_HEIGHT;
  assert.ok(Math.abs(specimenCenterY - (eyeY + 0.16)) < 1e-4);

  // Verify angular elevation of lowest slice caption edge is strictly above top edge of console panel
  const sliceBottomOffset = SLICE_PANEL_WIDTH_METRES / 2 + 0.065;
  const lowestSpecimenElevation =
    (specimenCenterY - sliceBottomOffset - eyeY) / Math.abs(specimenAnchor.position[2]);
  const panelTopElevation = (panel.position[1] + 0.24 - eyeY) / Math.abs(panel.position[2]);
  assert.ok(
    lowestSpecimenElevation > panelTopElevation,
    `Expected specimen bottom (${lowestSpecimenElevation.toFixed(3)}) above console top (${panelTopElevation.toFixed(3)})`
  );
});
