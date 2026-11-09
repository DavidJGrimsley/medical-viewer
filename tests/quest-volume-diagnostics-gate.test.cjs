const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const { MedicalController } = require('../src/features/medical-viewer/medical-controller.ts');
const { parseMedicalSliceDataset } = require('../src/features/medical-viewer/medical-slices.ts');
const { parseMedicalVolumeDataset } = require('../src/features/medical-viewer/medical-volumes.ts');

const DIAGNOSTIC_LABELS = [
  'Magenta',
  '3-Sampler',
  'Uniforms',
  'Coords',
  'Ray',
  'Opacity Diag',
  'Normal Volume',
  'Stacked (Off)',
  'Raymarch',
];

function loadControls(diagnosticsEnabled) {
  const file = path.join(
    __dirname,
    '../src/features/medical-viewer/quest-spatial-controls.native.tsx'
  );
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const states = [];
  let slot = 0;
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
          useState: (initial) => {
            const index = slot++;
            if (!(index in states)) states[index] = initial;
            return [
              states[index],
              (next) => {
                states[index] = typeof next === 'function' ? next(states[index]) : next;
              },
            ];
          },
          useSyncExternalStore: (_sub, snap) => snap(),
          useRef: (init) => ({ current: init ?? null }),
          useEffect: () => {},
        };
      if (name === '@reactvision/react-viro')
        return {
          ViroPolygon: 'ViroPolygon',
          useAnySourceHover: () => [false, () => {}],
          useAnySourcePressed: () => [false, () => {}],
          ViroMaterials: { createMaterials: () => {} },
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
      if (name === './medical-diagnostics')
        return { MEDICAL_DIAGNOSTICS_ENABLED: diagnosticsEnabled };
      return {};
    },
  });

  const controller = new MedicalController(
    undefined,
    parseMedicalSliceDataset(require('../assets/medical/slices/metadata.json')),
    parseMedicalVolumeDataset(require('../assets/medical/volumes/metadata.json')),
    { defaultVolumeRenderer: 'shader' }
  );
  const sessionId = 7;
  controller.attach(sessionId);
  controller.setTracking(sessionId, true);
  controller.selectPlane(sessionId, controller.getSnapshot().placementRevision, 'quest-anchor');
  controller.selectViewerMode(sessionId, 'volume');
  const scope = () => ({
    sessionId,
    placementRevision: controller.getSnapshot().placementRevision,
    requestId: controller.getSnapshot().volume.requestId,
  });
  const ready = () => {
    for (const atlas of ['high', 'low', 'validity'])
      controller.finishVolumeAtlas(scope(), atlas, true);
    controller.finishVolumeBinding(scope(), 'ready');
  };
  ready();
  const render = () => {
    slot = 0;
    return moduleObj.exports.QuestSpatialControls({
      context: { sessionId, onReady() {}, onError() {}, onInstruction() {} },
      controller,
      panelPose: { position: [0, 1.14, -1.1], rotation: [0, 180, 0] },
      onRecenter() {},
      onPlaceInFront() {},
      onExit() {},
      onMoveRig() {},
    });
  };
  return { controller, sessionId, scope, ready, render };
}

function texts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => texts(child, out));
    return out;
  }
  if (node.type === 'ViroText') out.push(node.props.text);
  texts(node.props?.children, out);
  return out;
}

function clickTarget(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = clickTarget(child);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.props?.onClick === 'function') return node;
  return clickTarget(node.props?.children);
}

function pressLabel(node, label) {
  // A QuestSpatialButton is the smallest subtree whose only label is `label` and that has a click
  // target (its rounded-rect fill); the label itself sits in a scaled QuestText node.
  let pressed = false;
  (function walk(current) {
    if (pressed || !current || typeof current !== 'object') return;
    if (Array.isArray(current)) return current.forEach(walk);
    const own = texts(current);
    const target = clickTarget(current);
    if (own.length === 1 && own[0] === label && target) {
      target.props.onClick();
      pressed = true;
      return;
    }
    walk(current.props?.children);
  })(node);
  assert.ok(pressed, `button "${label}" must be pressable`);
}

test('normal Quest 3D Scan panel shows viewer settings only, with no Advanced or diagnostic controls', () => {
  const h = loadControls(false);
  const labels = texts(h.render());
  for (const label of ['MRI', 'CT', 'Balanced', 'Fast', 'Visibility -', 'Visibility +'])
    assert.ok(labels.includes(label), `missing viewer control ${label}`);
  assert.ok(labels.includes('Reset Appearance'));
  for (const label of ['Advanced', 'Diagnostics', 'Developer Diagnostics', ...DIAGNOSTIC_LABELS])
    assert.ok(!labels.includes(label), `"${label}" must not appear for normal viewers`);

  h.controller.finishVolumeBinding(h.scope(), 'error');
  const errorLabels = texts(h.render());
  assert.ok(errorLabels.includes('Retry Loading Volume'));
  assert.ok(!errorLabels.includes('Advanced') && !errorLabels.includes('Diagnostics'));
});

test('a diagnostic state still offers Return to 3D Scan when the Diagnostics entry is hidden', () => {
  const h = loadControls(false);
  h.controller.setVolumeDebugMode(h.scope(), 'samplers');
  const tree = h.render();
  assert.ok(texts(tree).includes('Return to 3D Scan'));
  pressLabel(tree, 'Return to 3D Scan');
  assert.equal(h.controller.getSnapshot().volume.debugMode, 'raymarch');
  h.ready();
  assert.ok(!texts(h.render()).includes('Return to 3D Scan'));
});

test('developer builds expose diagnostics behind an explicit Diagnostics button', () => {
  const h = loadControls(true);
  const tree = h.render();
  const labels = texts(tree);
  assert.ok(labels.includes('Diagnostics'));
  assert.ok(!labels.includes('Magenta'), 'patterns stay closed until requested');
  pressLabel(tree, 'Diagnostics');
  const developer = texts(h.render());
  assert.ok(developer.includes('Developer Diagnostics'));
  for (const label of ['Magenta', '3-Sampler', 'Uniforms', 'Coords', 'Ray', 'Opacity Diag'])
    assert.ok(developer.includes(label), `developer panel keeps ${label}`);
});
