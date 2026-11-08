const assert = require('node:assert/strict');
const { test } = require('node:test');
const { MedicalController } = require('../src/features/medical-viewer/medical-controller.ts');
const { MEDICAL_MODEL_ASSETS } = require('../src/features/medical-viewer/medical-models.ts');
const { parseMedicalSliceDataset } = require('../src/features/medical-viewer/medical-slices.ts');
const {
  parseMedicalVolumeDataset,
  defaultVolumeAppearance,
} = require('../src/features/medical-viewer/medical-volumes.ts');
const {
  buildQuestCompositorPanel,
} = require('../src/features/medical-viewer/quest-compositor-panel.ts');
const {
  panelGeometry,
  panelItemLocal,
  panelImagePosition,
  sliderValueAtX,
  rotationSliderValue,
  QUEST_PANEL_BASE_Y,
} = require('../src/features/medical-viewer/quest-compositor-layout.ts');
const {
  computeSpecimenFromRig,
  rigForGrabBarFacing,
  rigLocalToWorld,
} = require('../src/features/ar/quest-spatial-math.ts');
const slices = parseMedicalSliceDataset(require('../assets/medical/slices/metadata.json'));
const volumes = parseMedicalVolumeDataset(require('../assets/medical/volumes/metadata.json'));

function harness() {
  const controller = new MedicalController({ isQuest: true }, slices, volumes);
  const sessionId = 41;
  controller.attach(sessionId);
  controller.setTracking(sessionId, true);
  controller.selectPlane(sessionId, controller.getSnapshot().placementRevision, 'quest-world');
  let page = 'main',
    diagnosticsEnabled = false;
  const scope = () => {
    const s = controller.getSnapshot();
    return {
      sessionId,
      modelId: s.modelId,
      placementRevision: s.placementRevision,
      loadAttempt: s.loadAttempt,
      requestId: s.mode === 'slices' ? s.slices.requestId : s.volume.requestId,
    };
  };
  const ready = () => {
    const s = controller.getSnapshot();
    if (s.mode === 'anatomy')
      for (const asset of MEDICAL_MODEL_ASSETS[s.modelId])
        controller.finishLoad(scope(), asset, true);
    else if (s.mode === 'slices') controller.finishSliceLoad(scope(), true);
    else {
      for (const atlas of ['high', 'low', 'validity'])
        controller.finishVolumeAtlas(scope(), atlas, true);
      controller.finishVolumeBinding(scope(), 'ready');
    }
  };
  const panel = (slicePreview = null) =>
    buildQuestCompositorPanel({
      controller,
      sessionId,
      page,
      setPage: (next) => {
        page = next;
      },
      diagnosticsEnabled,
      slicePreview,
      onRecenter() {},
      onPlaceInFront() {},
    });
  const click = (id) => {
    const item = panel().items.find((item) => item.id === id);
    assert.ok(item, `Missing ${id} on ${page}`);
    assert.equal(!!item.disabled, false, `Disabled ${id}`);
    assert.equal(typeof item.action, 'function');
    item.action();
  };
  ready();
  return {
    controller,
    sessionId,
    scope,
    panel,
    click,
    ready,
    page: () => page,
    diagnostics: () => {
      diagnosticsEnabled = true;
    },
  };
}

test('main panels contain size and height, with rotation only for anatomy and 3D scan', () => {
  const h = harness();
  for (const mode of ['anatomy', 'slices', 'volume']) {
    h.click(mode);
    h.ready();
    const p = h.panel();
    assert.ok(p.items.some((i) => i.id === 'scale-plus'));
    assert.ok(p.items.some((i) => i.id === 'height-plus'));
    assert.equal(
      p.sliders.some((i) => i.id === 'rotation' && !i.disabled),
      mode !== 'slices'
    );
    assert.equal(
      p.items.some((i) => ['recenter', 'move-here', 'quality'].includes(i.id)),
      false
    );
    assert.equal(
      p.items.some((i) =>
        /rotation-(minus|plus)|rotate-left|rotate-right|open-transform/.test(i.id)
      ),
      false
    );
    assert.equal(
      p.items.some((i) => i.label === 'More controls'),
      mode === 'volume'
    );
  }
});

test('size and height change the active model, slices or volume and reset on the main page', () => {
  for (const mode of ['anatomy', 'slices', 'volume']) {
    const h = harness();
    h.click(mode);
    h.ready();
    const value = () =>
      mode === 'anatomy' ? h.controller.getSnapshot() : h.controller.getSnapshot()[mode];
    const before = value();
    h.click('scale-plus');
    h.click('height-plus');
    if (mode !== 'slices')
      h.panel()
        .sliders.find((s) => s.id === 'rotation')
        .onChange(46);
    assert.ok(value().scale > before.scale);
    assert.ok(value().height > before.height);
    assert.equal(value().yaw, mode === 'slices' ? before.yaw : 46);
    h.click('reset-transform');
    assert.equal(value().scale, before.scale);
    assert.equal(value().height, before.height);
    assert.equal(value().yaw, before.yaw);
    assert.equal(h.page(), 'main');
  }
});

test('rotation sliders cover the full turn, clamp pointer travel and do not wrap the right thumb left', () => {
  const h = harness();
  const slider = h.panel().sliders.find((s) => s.id === 'rotation');
  assert.equal(sliderValueAtX(slider, -100), -180);
  assert.equal(sliderValueAtX(slider, 500), 0);
  assert.equal(sliderValueAtX(slider, 2000), 180);
  slider.onChange(sliderValueAtX(slider, 2000));
  assert.ok(h.controller.getSnapshot().yaw > 179);
  assert.ok(h.panel().items.find((i) => i.id === 'rotation-thumb').x > 919);
  assert.equal(rotationSliderValue(-1000), -180);
});

test('anatomy labels are on the main panel below transforms', () => {
  const h = harness();
  h.click('skull');
  h.ready();
  const p = h.panel();
  assert.ok(
    p.items.find((i) => i.id === 'labels').y > p.sliders.find((s) => s.id === 'rotation').y
  );
  const before = h.controller.getSnapshot().labelsVisible;
  h.click('labels');
  assert.equal(h.controller.getSnapshot().labelsVisible, !before);
});

test('slice slider and browsing actions live below transforms on the main panel', () => {
  const h = harness();
  h.click('slices');
  h.ready();
  const p = h.panel();
  const slider = p.sliders.find((s) => s.id === 'slice');
  assert.ok(slider.y > p.items.find((i) => i.id === 'height-value').y);
  assert.equal(
    p.sliders.some((s) => s.id === 'rotation'),
    false
  );
  slider.onChange(sliderValueAtX(slider, slider.x));
  assert.equal(h.controller.getSnapshot().slices.index, 0);
  h.click('slice-step-5');
  assert.equal(h.controller.getSnapshot().slices.index, 5);
  const refreshed = h.panel();
  const thumb = refreshed.items.find((i) => i.id === 'slice-thumb');
  assert.equal(
    thumb.x,
    slider.x + (h.controller.getSnapshot().slices.index / slider.max) * slider.width
  );
  h.click('reset-slice');
  assert.equal(h.page(), 'main');
});

test('slice preview moves continuously without changing the selected scan until applied', () => {
  const h = harness();
  h.click('slices');
  h.ready();
  const before = h.controller.getSnapshot().slices.index;
  const preview = h.panel(2.5);
  assert.equal(preview.sliders.find((slider) => slider.id === 'slice').value, 2.5);
  assert.equal(h.controller.getSnapshot().slices.index, before);
  assert.match(preview.items.find((item) => item.id === 'slice-value').label, /^Slice 4 of /);
});

test('3D Scan More controls opens appearance directly and Back returns to main', () => {
  const h = harness();
  h.click('volume');
  h.click('navigation');
  assert.equal(h.page(), 'appearance');
  assert.ok(h.panel().items.some((i) => i.id === 'reset-appearance'));
  assert.equal(
    h.panel().items.some((i) => i.id === 'open-appearance' || i.id === 'open-transform'),
    false
  );
  h.click('navigation');
  assert.equal(h.page(), 'main');
});

test('appearance controls preserve quality, presets and visibility actions', () => {
  const h = harness();
  h.click('volume');
  h.click('ct');
  h.click('navigation');
  assert.equal(h.controller.getSnapshot().volume.quality, 'fast');
  h.click('balanced');
  assert.equal(h.controller.getSnapshot().volume.quality, 'balanced');
  h.click('ct-soft-tissue');
  assert.equal(h.controller.getSnapshot().volume.appearance.ct.preset, 'ct-soft-tissue');
  const before = h.controller.getSnapshot().volume.appearance.ct.opacity;
  h.click('visibility-minus');
  assert.ok(h.controller.getSnapshot().volume.appearance.ct.opacity < before);
  h.click('reset-appearance');
  assert.deepEqual(h.controller.getSnapshot().volume.appearance.ct, defaultVolumeAppearance('ct'));
});

test('Fast is the Quest default and an explicit Balanced choice survives mode and modality changes', () => {
  const h = harness();
  assert.equal(h.controller.getSnapshot().volume.quality, 'fast');
  assert.equal(new MedicalController().getSnapshot().volume.quality, 'balanced');
  h.click('volume');
  h.click('ct');
  assert.equal(h.controller.getSnapshot().volume.quality, 'fast');
  h.click('navigation');
  h.click('balanced');
  h.click('navigation');
  h.click('anatomy');
  h.click('volume');
  h.click('mri');
  assert.equal(h.controller.getSnapshot().volume.quality, 'balanced');
});

test('grab bar is a centered, text-free white bar exactly 30 percent of controls width', () => {
  const p = harness().panel();
  assert.equal(p.grabBar.label, '');
  assert.equal(p.grabBar.fill, '#ffffff');
  assert.equal(p.grabBar.x, 500);
  assert.equal(p.grabBar.width, 1000 * 0.3);
  assert.ok(p.grabBar.y - p.grabBar.height / 2 > p.bodyHeight);
});

test('panel grows upward while its base, grab bar and model rig stay fixed', () => {
  const rig = { position: [1, 1.2, -2], rotation: [0, 37, 0] };
  const original = structuredClone(rig);
  const model = computeSpecimenFromRig(rig);
  const bars = [];
  for (const height of [625, 880]) {
    const g = panelGeometry(height);
    assert.ok(Math.abs(g.bodyCenterY - g.bodyHeightM / 2 - QUEST_PANEL_BASE_Y) < 1e-12);
    assert.ok(
      Math.abs(
        panelImagePosition(rig, height)[1] -
          g.heightM / 2 -
          (rig.position[1] + QUEST_PANEL_BASE_Y - (60 * 0.52) / 565)
      ) < 1e-12
    );
    bars.push(panelItemLocal({ x: 500, y: height - 24 }, height, 0.012));
  }
  assert.deepEqual(bars[0], bars[1]);
  assert.deepEqual(rig, original);
  assert.deepEqual(computeSpecimenFromRig(rig), model);
  const destination = [1.5, 0.8, -1.1];
  const moved = rigForGrabBarFacing(rig, destination, [0, 1.6, 0], bars[1]);
  const actual = rigLocalToWorld(moved, bars[1]);
  // The existing three-pass facing solver settles to sub-micrometre precision.
  actual.forEach((v, i) => assert.ok(Math.abs(v - destination[i]) < 1e-6));
});

test('main and appearance controls fit their backgrounds without overlapping buttons or slider tracks', () => {
  const h = harness();
  h.diagnostics();
  const check = () => {
    const p = h.panel();
    for (const i of p.items) {
      assert.ok(i.x - i.width / 2 >= 0 && i.x + i.width / 2 <= 1000, i.id);
      assert.ok(i.y - i.height / 2 >= 0 && i.y + i.height / 2 <= p.height, i.id);
      if (i.action) assert.ok(i.y + i.height / 2 <= p.bodyHeight, i.id);
    }
    const controls = p.items
      .filter((i) => i.action)
      .concat(
        p.sliders.map((s) => ({
          id: s.id,
          x: s.x + s.width / 2,
          y: s.y,
          width: s.width,
          height: 56,
        }))
      );
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i],
          b = controls[j];
        assert.equal(
          Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
            Math.abs(a.y - b.y) < (a.height + b.height) / 2,
          false,
          `${a.id} overlaps ${b.id}`
        );
      }
  };
  for (const mode of ['anatomy', 'slices', 'volume']) {
    h.click(mode);
    h.ready();
    check();
    if (mode === 'volume') {
      h.click('navigation');
      check();
      h.click('open-diagnostics');
      check();
      h.click('normal-volume');
    }
  }
});

test('diagnostic recovery remains accessible from the main volume panel when diagnostics are hidden', () => {
  const h = harness();
  h.click('volume');
  h.controller.setVolumeDebugMode(h.scope(), 'coordinates');
  h.click('normal-volume');
  assert.equal(h.controller.getSnapshot().volume.debugMode, 'raymarch');
  assert.equal(h.page(), 'main');
});
