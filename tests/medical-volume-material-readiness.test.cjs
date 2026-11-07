const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const { MedicalController } = require('../src/features/medical-viewer/medical-controller.ts');
const {
  parseMedicalVolumeDataset,
  VOLUME_ATLASES,
} = require('../src/features/medical-viewer/medical-volumes.ts');
const volumeMetadata = require('../assets/medical/volumes/metadata.json');

const jsx = (type, props, key) => ({ type, props: props ?? {}, key });

/**
 * Models the installed Viro Android bridge. Every native module call runs in order on one queue.
 * The proxy's geometry enters the scene with the default white material as soon as it loads; only
 * then does onObject3DLoaded resolve shaderOverrides once (VRTNode.applyShaderOverridesRecursive)
 * and dispatch onLoadEnd. An unregistered material leaves the default white one for good.
 * Every render pass counts as one drawn frame for each proxy whose `visible` prop is not false.
 */
function viroAndroid({ appState = true } = {}) {
  const queue = [];
  const registered = new Set();
  const attachments = [];
  const calls = [];
  const proxies = new Map();
  const frames = [];
  const drain = () => {
    while (queue.length) queue.shift()();
  };
  const nativeModules = {
    VRTMaterialManager: { updateShaderUniform: () => {} },
    ...(appState
      ? {
          AppState: {
            getCurrentAppState: (success) => {
              calls.push('getCurrentAppState');
              queue.push(() => success({ app_state: 'active' }));
            },
          },
        }
      : {}),
  };
  const ViroMaterials = {
    createMaterials: (materials) => {
      calls.push('setJSMaterials');
      // Material creation decodes the atlases synchronously on the native queue, so it completes
      // after any mesh load that is already underway.
      queue.push(() => Object.keys(materials).forEach((name) => registered.add(name)));
    },
    deleteMaterials: (names) => {
      calls.push('deleteMaterials');
      queue.push(() => names.forEach((name) => registered.delete(name)));
    },
    updateShaderUniform: () => {},
  };
  const onMount = (element) =>
    proxies.set(element.key, { material: 'default-white', overrideResolved: false });
  const drawFrame = (elements) => {
    for (const element of elements) {
      if (element.props.visible === false) continue;
      frames.push({ key: element.key, material: proxies.get(element.key).material });
    }
  };
  /** Completes every pending OBJ load: resolve overrides once, then dispatch onLoadEnd. */
  const loadMeshes = (elements) => {
    for (const element of elements) {
      const proxy = proxies.get(element.key);
      if (proxy.overrideResolved) continue;
      proxy.overrideResolved = true;
      proxy.material = element.props.shaderOverrides.every((name) => registered.has(name))
        ? 'shader'
        : 'default-white';
      attachments.push({
        key: element.key,
        overrides: element.props.shaderOverrides,
        material: proxy.material,
      });
      element.props.onLoadEnd();
    }
  };
  return {
    queue,
    registered,
    attachments,
    calls,
    frames,
    drain,
    nativeModules,
    ViroMaterials,
    onMount,
    drawFrame,
    loadMeshes,
  };
}

function loadMedicalVolume(viro) {
  const hooks = [];
  let slot = 0;
  let dirty = false;
  let pending = [];
  const react = {
    useState: (initial) => {
      const index = slot++;
      if (!(index in hooks)) hooks[index] = { value: initial };
      const hook = hooks[index];
      return [
        hook.value,
        (value) => {
          const next = typeof value === 'function' ? value(hook.value) : value;
          if (!Object.is(next, hook.value)) dirty = true;
          hook.value = next;
        },
      ];
    },
    useEffect: (effect, deps) => {
      const index = slot++;
      const previous = hooks[index];
      if (previous && deps && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      hooks[index] = { deps, cleanup: previous?.cleanup };
      pending.push(() => {
        hooks[index].cleanup?.();
        const cleanup = effect();
        hooks[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      });
    },
    useSyncExternalStore: (_, get) => get(),
  };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': {
      Image: { resolveAssetSource: (source) => source },
      NativeModules: viro.nativeModules,
      TurboModuleRegistry: { get: () => null },
      Platform: { OS: 'android' },
    },
    '@reactvision/react-viro': {
      Viro3DObject: 'Viro3DObject',
      ViroImage: 'ViroImage',
      ViroMaterials: viro.ViroMaterials,
      ViroNode: 'ViroNode',
      ViroPolyline: 'ViroPolyline',
    },
    './medical-controller': require('../src/features/medical-viewer/medical-controller.ts'),
    './medical-volume-assets.native': {
      medicalVolumeSource: (modality, atlas) => ({ uri: `${modality}_${atlas}` }),
      MEDICAL_VOLUME_BOX_SOURCE: { uri: 'volume-box.obj' },
    },
    './medical-volumes': require('../src/features/medical-viewer/medical-volumes.ts'),
    './medical-volume-uniforms': require('../src/features/medical-viewer/medical-volume-uniforms.ts'),
    './medical-volume-diagnostics': require('../src/features/medical-viewer/medical-volume-diagnostics.ts'),
    './medical-image-events.native': require('../src/features/medical-viewer/medical-image-events-core.ts'),
    '../../../assets/medical/stack/metadata.json': require('../assets/medical/stack/metadata.json'),
    './medical-volume-stack.native': { default: 'MedicalVolumeStack' },
  };
  const module = { exports: {} };
  const file = path.resolve(__dirname, '../src/features/medical-viewer/medical-volume.native.tsx');
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (!(name in mocks)) throw new Error('Missing mock ' + name);
        return mocks[name];
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      requestAnimationFrame: () => 0,
      cancelAnimationFrame: () => {},
    }
  );
  const mounted = new Set();
  let tree = null;
  const render = (props) => {
    do {
      dirty = false;
      slot = 0;
      tree = module.exports.default(props);
      const effects = pending;
      pending = [];
      effects.forEach((effect) => effect());
      const proxies = find(tree, 'Viro3DObject');
      for (const proxy of proxies) {
        if (mounted.has(proxy.key)) continue;
        mounted.add(proxy.key);
        viro.onMount(proxy);
      }
      // The geometry is in the scene before its override is resolved: draw that frame.
      viro.drawFrame(proxies);
    } while (dirty);
    return tree;
  };
  /** OBJ load completes natively; Viro then resolves overrides and fires onLoadEnd. */
  const loadMeshes = (props) => {
    viro.loadMeshes(find(tree, 'Viro3DObject'));
    return render(props);
  };
  return { render, loadMeshes, tree: () => tree };
}

function find(node, type, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach((child) => find(child, type, result));
    return result;
  }
  if (node.type === type) result.push(node);
  find(node.props?.children, type, result);
  return result;
}

function questVolume() {
  const controller = new MedicalController(
    undefined,
    undefined,
    parseMedicalVolumeDataset(volumeMetadata),
    { defaultVolumeRenderer: 'shader' }
  );
  const sessionId = 1;
  controller.attach(sessionId);
  controller.setTracking(sessionId, true);
  controller.selectViewerMode(sessionId, 'volume');
  controller.selectPlane(sessionId, controller.getSnapshot().placementRevision, 'table');
  const scope = () => ({
    sessionId,
    placementRevision: controller.getSnapshot().placementRevision,
    requestId: controller.getSnapshot().volume.requestId,
  });
  return { controller, sessionId, scope, props: { context: { sessionId }, controller } };
}

function finishAtlases(h, viro, volume) {
  for (const preload of find(h.tree(), 'ViroImage'))
    preload.props.onLoadEnd({ nativeEvent: { target: 1 } });
  assert.equal(volume.controller.getSnapshot().volume.loadStatus, 'binding');
  h.render(volume.props);
}

const whiteFrames = (viro) => viro.frames.filter((frame) => frame.material !== 'shader');

test('without the material-queue barrier the override misses and the box stays white', () => {
  const viro = viroAndroid({ appState: false });
  const h = loadMedicalVolume(viro);
  const volume = questVolume();
  h.render(volume.props);
  finishAtlases(h, viro, volume);
  // Pre-barrier ordering: the proxy mounts in the same commit as createMaterials and its mesh
  // finishes loading before the native queue registers the material.
  h.loadMeshes(volume.props);
  assert.equal(viro.attachments.length, 1);
  assert.equal(viro.attachments[0].material, 'default-white');
});

test('MRI proxy mounts after material registration and draws no default-material frame', () => {
  const viro = viroAndroid();
  const h = loadMedicalVolume(viro);
  const volume = questVolume();
  h.render(volume.props);
  assert.equal(volume.controller.getSnapshot().volume.loadStatus, 'loading');
  // The atlas preload path is untouched: three ViroImage preloaders and no proxy yet.
  assert.deepEqual(
    find(h.tree(), 'ViroImage').map((image) => image.props.source.uri),
    VOLUME_ATLASES.map((atlas) => `mri_${atlas}`)
  );
  assert.equal(find(h.tree(), 'Viro3DObject').length, 0);

  finishAtlases(h, viro, volume);
  assert.deepEqual(viro.calls, ['setJSMaterials', 'getCurrentAppState']);
  assert.equal(find(h.tree(), 'Viro3DObject').length, 0, 'proxy waits for material registration');

  viro.drain();
  h.render(volume.props);
  const [hidden] = find(h.tree(), 'Viro3DObject');
  assert.equal(hidden.props.visible, false, 'mesh is hidden until Viro attaches the shader');
  assert.deepEqual([...hidden.props.shaderOverrides], ['medicalVolume']);
  assert.match(
    volume.controller.getSnapshot().volume.diagnostics.join('\n'),
    /Native material registered · raymarch/
  );

  h.loadMeshes(volume.props);
  assert.equal(viro.attachments.length, 1);
  assert.equal(viro.attachments[0].material, 'shader');
  assert.equal(volume.controller.getSnapshot().volume.loadStatus, 'ready');
  assert.equal(find(h.tree(), 'Viro3DObject')[0].props.visible, true);
  assert.ok(viro.frames.length > 0, 'anatomy frames are drawn');
  assert.deepEqual(whiteFrames(viro), []);
});

test('MRI to CT switch never shows a white frame and ignores the stale MRI callback', () => {
  const viro = viroAndroid();
  const h = loadMedicalVolume(viro);
  const volume = questVolume();
  h.render(volume.props);
  finishAtlases(h, viro, volume);
  viro.drain();
  h.render(volume.props);
  h.loadMeshes(volume.props);
  const firstRequest = volume.controller.getSnapshot().volume.requestId;

  volume.controller.selectVolumeModality(volume.sessionId, 'ct');
  h.render(volume.props);
  assert.notEqual(volume.controller.getSnapshot().volume.requestId, firstRequest);
  assert.equal(find(h.tree(), 'Viro3DObject').length, 0, 'MRI proxy leaves with its material');
  assert.deepEqual(
    find(h.tree(), 'ViroImage').map((image) => image.props.source.uri),
    VOLUME_ATLASES.map((atlas) => `ct_${atlas}`)
  );
  finishAtlases(h, viro, volume);
  viro.drain();
  h.render(volume.props);
  assert.equal(find(h.tree(), 'Viro3DObject')[0].props.visible, false);
  h.loadMeshes(volume.props);

  assert.deepEqual(
    viro.attachments.map((attachment) => attachment.material),
    ['shader', 'shader']
  );
  assert.match(viro.attachments[1].key, new RegExp(`:${volume.scope().requestId}:ct:raymarch$`));
  assert.deepEqual(whiteFrames(viro), []);
});

test('a stale registration callback cannot release the proxy for a newer material request', () => {
  const viro = viroAndroid();
  const h = loadMedicalVolume(viro);
  const volume = questVolume();
  h.render(volume.props);
  finishAtlases(h, viro, volume);

  // Switch modality before the first material's callback arrives.
  volume.controller.selectVolumeModality(volume.sessionId, 'ct');
  h.render(volume.props);
  finishAtlases(h, viro, volume);

  // Drain only the first material's tasks (create + callback). The CT material is still pending.
  viro.queue.shift()();
  viro.queue.shift()();
  h.render(volume.props);
  assert.equal(find(h.tree(), 'Viro3DObject').length, 0, 'old callback is ignored');

  viro.drain();
  h.render(volume.props);
  h.loadMeshes(volume.props);
  assert.equal(viro.attachments.length, 1);
  assert.equal(viro.attachments[0].material, 'shader');
  assert.deepEqual(whiteFrames(viro), []);
});

test('debug-mode changes wait for their own material and stay hidden until attached', () => {
  const viro = viroAndroid();
  const h = loadMedicalVolume(viro);
  const volume = questVolume();
  h.render(volume.props);
  finishAtlases(h, viro, volume);
  viro.drain();
  h.render(volume.props);
  h.loadMeshes(volume.props);

  volume.controller.setVolumeDebugMode(volume.scope(), 'samplers');
  h.render(volume.props);
  finishAtlases(h, viro, volume);
  assert.equal(find(h.tree(), 'Viro3DObject').length, 0);
  viro.drain();
  h.render(volume.props);
  h.loadMeshes(volume.props);
  assert.deepEqual(
    viro.attachments.map((attachment) => attachment.material),
    ['shader', 'shader']
  );
  assert.deepEqual(whiteFrames(viro), []);
});
