const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const jsx = (type, props) => ({ type, props: props ?? {} });
const ui = Object.fromEntries(
  [
    'Host',
    'Button',
    'Icon',
    'Column',
    'Row',
    'Spacer',
    'Text',
    'ScrollView',
    'RNHostView',
    'BottomSheet',
    'TextInput',
  ].map((name) => [name, name])
);
const colors = {
  primary: '#60a5fa',
  secondary: '#a78bfa',
  background: '#09090b',
  surface: '#18181b',
  text: '#fafafa',
};
function load(file, overrides = {}, expose = '') {
  const mocks = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    react: {
      ...require('react'),
      lazy: () => 'Lazy',
      Suspense: 'Suspense',
      useState: () => [320, () => {}],
    },
    '@expo/ui': ui,
    'react-native': {
      StyleSheet: { create: (styles) => styles },
      Platform: { OS: 'ios' },
      View: 'View',
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    },
    '@/theme/provider': { useAppTheme: () => ({ activeColors: colors }) },
    './use-game-window-dimensions': {
      useGameWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    },
    'react-native-safe-area-context': {
      useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
    },
    ...overrides,
  };
  const output = ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8') + expose,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in mocks)) throw new Error('Missing mock: ' + name);
      return mocks[name];
    },
  });
  return module.exports;
}
function nodes(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    result.push(node);
    visit(node.props?.children);
  }
  visit(root);
  return result;
}

for (const platform of ['ios', 'android', 'web']) {
  test(`${platform}: universal buttons expose enabled actions, selected state and disable both touch and accessibility activation`, () => {
    let calls = 0;
    const { GameButton } = load('ui/game-button.tsx', {
      'react-native': {
        Platform: { OS: platform },
        View: 'View',
        useWindowDimensions: () => ({ fontScale: 1.8 }),
      },
    });
    for (const disabled of [false, true]) {
      const root = GameButton({
        label: 'Best of 3',
        onPress: () => calls++,
        color: colors.secondary,
        textColor: colors.background,
        disabled,
        selected: true,
        nativeIcon: platform === 'ios' ? 'arrow.left' : undefined,
      });
      const button = nodes(root).find((node) => node.type === 'Button');
      if (platform === 'web') {
        // The universal web button owns its semantics: no nested button role.
        assert.equal(root.props.accessibilityRole, undefined);
        assert.equal(root.props.accessibilityState, undefined);
      } else {
        assert.equal(root.props.accessibilityState.selected, true);
        assert.equal(root.props.accessibilityState.disabled, disabled);
      }
      assert.equal(button.props.disabled, disabled);
      assert.ok(button.props.style.height >= 48);
      assert.equal(button.props.style.backgroundColor, colors.secondary);
      const before = calls;
      button.props.onPress?.();
      root.props.onAccessibilityTap?.();
      root.props.onAccessibilityAction?.({ nativeEvent: { actionName: 'activate' } });
      assert.equal(calls - before, disabled ? 0 : platform === 'web' ? 1 : 3);
      assert.equal(
        nodes(root).find((node) => node.type === 'Host').props.accessibilityElementsHidden,
        platform !== 'web'
      );
    }
  });
}

test('home actions retain the standalone app route and follow the measured viewport through rotation before window dimensions update', () => {
  const routes = [];
  let measuredWidth = null;
  const catalog = load('features/experiences/experience-catalog.ts').experiences;
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].route, "medical-viewer");
  const Home = load('features/home/home-screen.tsx', {
    react: { useState: () => [measuredWidth, (value) => (measuredWidth = value)] },
    'expo-router': { router: { navigate: (route) => routes.push(route) } },
    '@/features/experiences/experience-catalog': {
      experiences: catalog,
      showcase: { name: 'XR Showcase', description: 'AR experiences' },
    },
    '@/ui/game-button': { GameButton: 'GameButton' },
    '@/ui/game-text': { GameText: 'GameText' },
    '@/ui/use-game-window-dimensions': { useGameWindowDimensions: () => ({ width: 320 }) },
    'react-native': { View: 'View', ScrollView: 'ScrollView' },
  }).default;
  const buttons = nodes(Home()).filter((node) => node.type === 'GameButton');
  assert.equal(buttons.length, 1);
  for (const button of buttons) {
    assert.equal(button.props.color, colors.primary);
    assert.equal(button.props.width, 280);
    button.props.onPress();
  }
  assert.deepEqual(
    routes,
    [...catalog].map((item) => item.href)
  );
  for (const width of [720, 354, 0, 280]) {
    const content = nodes(Home()).find((node) => node.props.testID === 'home-content');
    content.props.onLayout({ nativeEvent: { layout: { width } } });
    assert.equal(measuredWidth, width || 354);
    const rotated = Home();
    assert.equal(rotated.type, 'ScrollView');
    const actions = nodes(rotated).filter((node) => node.type === 'GameButton');
    assert.equal(actions.length, 1);
    for (const button of actions) {
      assert.equal(button.props.width, measuredWidth);
      button.props.onPress();
    }
  }
  assert.equal(routes.length, 5);
});

test('compact buttons retain 44-point touch targets and grow for large or wrapped text without shrinking default game buttons', () => {
  for (const platform of ['ios', 'android', 'web']) {
    let fontScale = 1;
    const { GameButton } = load('ui/game-button.tsx', {
      'react-native': {
        Platform: { OS: platform },
        View: 'View',
        useWindowDimensions: () => ({ fontScale }),
      },
    });
    const props = {
      label: 'Done',
      fontSize: 15,
      width: 64,
      onPress: () => {},
      color: colors.primary,
      textColor: colors.background,
    };
    assert.equal(GameButton({ ...props, compact: true }).props.style.minHeight, 44);
    const outlined = GameButton({ ...props, compact: true, variant: 'outlined', width: 44 });
    const nativeButton = nodes(outlined).find((node) => node.type === 'Button');
    assert.ok(nativeButton.props.style.height >= 44);
    assert.ok(nativeButton.props.style.width >= 44);
    assert.equal(GameButton(props).props.style.minWidth, 48);
    assert.equal(
      nodes(GameButton(props)).find((node) => node.type === 'Text').props.numberOfLines,
      undefined
    );
    fontScale = 1.8;
    const choice = GameButton({
      ...props,
      label: 'Anatomy',
      width: 160,
      compact: true,
      singleLine: true,
    });
    const choiceText = nodes(choice).find((node) => node.type === 'Text');
    assert.equal(choiceText.props.children, 'Anatomy');
    assert.equal(choiceText.props.numberOfLines, 1);
    assert.ok(choice.props.style.minHeight >= 49 && choice.props.style.minHeight < 80);
    const wrapped = GameButton({ ...props, width: 56, label: 'Reset Panel', compact: true });
    assert.ok(wrapped.props.style.minHeight >= 80);
    assert.equal(wrapped.props.style.width, 56);
    const iconOnly = GameButton({ ...props, iconOnly: true, compact: true });
    assert.equal(iconOnly.props.style.width, 44);
  }
});

test('game AR status actions stay centered in a row and preserve Retry and Home callbacks', () => {
  const calls = [];
  const { GameStatusPanel } = load('ui/game-status-panel.tsx', {
    './game-button': { GameButton: 'GameButton' },
    './game-text': { GameText: 'GameText' },
    './game-progress': { GameProgress: 'Progress' },
  });
  for (const actions of [
    [{ label: 'Home', onPress: () => calls.push('Home') }],
    [
      { label: 'Retry', onPress: () => calls.push('Retry') },
      { label: 'Home', onPress: () => calls.push('Home') },
    ],
  ]) {
    const rendered = nodes(
      GameStatusPanel({ title: 'AR needs another try', message: 'Try again.', actions })
    );
    const row = rendered.find((node) => node.props.testID === 'game-status-actions');
    assert.equal(row.props.style.flexDirection, 'row');
    assert.equal(row.props.style.justifyContent, 'center');
    rendered.filter((node) => node.type === 'GameButton').forEach((node) => node.props.onPress());
  }
  assert.deepEqual(calls, ['Home', 'Retry', 'Home']);
});

test('medical permission/retry actions keep compact primary actions and outlined Home without changing game defaults', () => {
  const { GameStatusPanel } = load('ui/game-status-panel.tsx', {
    './game-button': { GameButton: 'GameButton' },
    './game-text': { GameText: 'GameText' },
    './game-progress': { GameProgress: 'Progress' },
  });
  const props = {
    title: 'AR needs another try',
    message: 'Try again.',
    actions: [
      { label: 'Retry', onPress: () => {} },
      { label: 'Home', onPress: () => {} },
    ],
  };
  const medical = nodes(
    GameStatusPanel({ ...props, compact: true, outlinedActions: ['Home'] })
  ).filter((n) => n.type === 'GameButton');
  assert.equal(medical[0].props.variant, 'filled');
  assert.equal(medical[1].props.variant, 'outlined');
  assert.equal(medical[1].props.textColor, colors.text);
  assert.ok(medical.every((n) => n.props.compact));
  const game = nodes(GameStatusPanel(props)).filter((n) => n.type === 'GameButton');
  assert.ok(game.every((n) => !n.props.compact && n.props.variant === 'filled'));
});

test('web viewport sizing matches static markup through hydration, then follows real dimensions; native sizing is immediate', () => {
  for (const platform of ['ios', 'android', 'web']) {
    let hydrated = false;
    const actual = { width: 320, height: 720, scale: 2, fontScale: 1.4 };
    const { useGameWindowDimensions } = load('ui/use-game-window-dimensions.ts', {
      react: { useSyncExternalStore: (_, client, server) => (hydrated ? client() : server()) },
      'react-native': { Platform: { OS: platform }, useWindowDimensions: () => actual },
    });
    const first = useGameWindowDimensions();
    assert.equal(first.width, platform === 'web' ? 390 : 320);
    assert.equal(first.fontScale, platform === 'web' ? 1 : 1.4);
    hydrated = true;
    assert.equal(useGameWindowDimensions(), actual);
  }
});

test('Android invitation host lets the outer keyboard avoidance own keyboard insets', () => {
  const { GameInputHost } = load('ui/game-input-host.android.tsx');
  for (const ignoreSafeArea of ['all', 'keyboard', undefined]) {
    const host = GameInputHost({ ignoreSafeArea, children: 'Input' });
    assert.equal(host.props.ignoreSafeAreaKeyboardInsets, ignoreSafeArea !== undefined);
    assert.equal(host.props.children, 'Input');
    assert.equal(host.props.ignoreSafeArea, undefined);
  }
});

test('custom iOS game fonts scale once while fixed system sizes receive RN accessibility scaling', () => {
  const overrides = {
    'react-native': {
      Platform: { OS: 'ios' },
      View: 'View',
      useWindowDimensions: () => ({ fontScale: 1.8 }),
    },
  };
  const { GameButton } = load('ui/game-button.tsx', overrides);
  const { GameText } = load('ui/game-text.tsx', overrides);
  for (const fontFamily of ['ArenaNotoSans', undefined]) {
    const button = GameButton({
      label: 'Ready',
      fontFamily,
      fontSize: 16,
      color: colors.primary,
      textColor: colors.background,
      onPress: () => {},
    });
    const text = nodes(button).find((node) => node.type === 'Text');
    assert.equal(text.props.textStyle.fontSize, fontFamily ? 16 : 28.8);
    assert.ok(button.props.style.minHeight >= 59);
    const paragraph = nodes(
      GameText({ children: 'Place the arena.', fontFamily, fontSize: 16, lineHeight: 24 })
    ).find((node) => node.type === 'Text');
    assert.equal(paragraph.props.textStyle.fontSize, fontFamily ? 16 : 28.8);
    assert.equal(paragraph.props.textStyle.lineHeight, fontFamily ? 30.4 : 43.2);
  }
});

test('native game copy waits for content width, measures inside padding, and gives text and Host the same width through relayout', () => {
  for (const platform of ['ios', 'android', 'web']) {
    let measuredWidth = 0;
    const { GameText } = load('ui/game-text.tsx', {
      react: { useState: () => [measuredWidth, (value) => (measuredWidth = value)] },
      'react-native': {
        View: 'View',
        Platform: { OS: platform },
        useWindowDimensions: () => ({ fontScale: 1.8 }),
      },
    });
    const render = () =>
      GameText({ children: 'Same table · Share one arena', style: { padding: 12 }, fontSize: 16 });
    const initial = render();
    assert.equal(initial.props.accessibilityLabel, 'Same table · Share one arena');
    assert.equal(
      nodes(initial).some((node) => node.type === 'Text'),
      platform === 'web'
    );
    const measurement = initial.props.children;
    if (platform === 'web') {
      // Static web copy remains visible without waiting for a browser layout event.
      assert.equal(measurement.props.onLayout, undefined);
      continue;
    }
    assert.notEqual(measurement.props.onLayout, undefined);
    assert.ok(measurement.props.style.minHeight >= 16 * 1.8);
    for (const width of [0, 480, 260, 0, 720]) {
      measurement.props.onLayout({ nativeEvent: { layout: { width } } });
      const rendered = nodes(render());
      const host = rendered.find((node) => node.type === 'Host');
      const text = rendered.find((node) => node.type === 'Text');
      assert.equal(!!text, width > 0);
      if (width > 0) {
        assert.equal(host.props.style.width, width);
        assert.equal(text.props.style.width, width);
        assert.equal(host.props.matchContents.vertical, true);
        assert.equal(text.props.children, 'Same table · Share one arena');
      }
    }
  }
});

test('native invitation input never overwrites newer keystrokes with a delayed JS echo, but applies a new invite', () => {
  let textValue = 'AB',
    refIndex = 0;
  const refs = [],
    writes = [],
    effects = [],
    changes = [],
    submissions = [];
  const state = {
    get: () => textValue,
    set: (value) => {
      writes.push(value);
      textValue = value;
    },
  };
  const { GameInviteField } = load('ui/game-invite-field.tsx', {
    '@expo/ui': { ...ui, useNativeState: () => state },
    './game-input-host': { GameInputHost: 'Host' },
    react: {
      useEffect: (effect) => effects.push(effect),
      useRef: (current) => (refs[refIndex++] ??= { current }),
    },
  });
  function render(value) {
    refIndex = 0;
    const field = nodes(
      GameInviteField({
        value,
        onChange: (current) => changes.push(current),
        onSubmit: (current) => submissions.push(current),
        maxLength: 16,
        color: colors.text,
        backgroundColor: colors.background,
        fontFamily: 'ArenaNotoMono',
      })
    ).find((node) => node.type === 'TextInput');
    effects.splice(0).forEach((effect) => effect());
    return field;
  }
  let field = render('AB');
  textValue = 'ABCD'; // Native typing has already advanced beyond this JS event.
  field.props.onChangeText('ABC');
  field = render('ABC');
  assert.equal(textValue, 'ABCD');
  assert.equal(writes.length, 0);
  field = render('550E-8400-E29B');
  assert.equal(textValue, '550E-8400-E29B');
  let blurs = 0;
  field.props.ref.current = { blur: () => blurs++ };
  field.props.onSubmitEditing('LATEST-CODE');
  assert.deepEqual(submissions, ['LATEST-CODE']);
  assert.equal(blurs, 1);
  assert.deepEqual(changes, ['ABC']);
  assert.equal(field.props.maxLength, 16);
  assert.equal(field.props.autoCorrect, false);
});

test('game AR customization is opt-in and preserves the default medical status panel', () => {
  const Wrapper = load('ui/game-ar-boundary.native.tsx', {
    '@/features/ar/ar-session-boundary': { __esModule: true, default: 'ARBoundary' },
    './game-status-panel': { GameStatusPanel: 'GameStatusPanel' },
  }).default;
  const marker = () => {};
  const boundary = Wrapper({ onExit: marker });
  assert.equal(boundary.props.onExit, marker);
  const model = {
    title: 'Camera access',
    message: 'Allow camera',
    actions: [{ label: 'Home', onPress: marker }],
  };
  const panel = boundary.props.renderStatusPanel(model);
  assert.equal(panel.type, 'GameStatusPanel');
  assert.equal(panel.props.actions[0].onPress, marker);
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'permission', sessionId: 1, instruction: 'Allow camera' }),
  };
  const Boundary = load('features/ar/ar-session-boundary.native.tsx', {
    react: {
      Component: class {},
      lazy: () => 'Lazy',
      useEffect: () => {},
      useMemo: (factory) => factory(),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useSyncExternalStore: (_, get) => get(),
    },
    'expo-router': { router: {} },
    'expo-router/react-navigation': { useIsFocused: () => true },
    'react-native': {
      View: 'View',
      ScrollView: 'ScrollView',
      StyleSheet: { create: (styles) => styles },
      AppState: { currentState: 'active' },
    },
    './ar-runtime.native': {},
    './ar-activation': { shouldActivateAR: () => true },
    './ar-session-controller': {
      ARSessionController: class {
        constructor() {
          return controller;
        }
      },
    },
    './ar-status-panel': { __esModule: true, default: 'MedicalStatusPanel' },
  }).default;
  const medical = nodes(Boundary({})).find((node) => node.type === 'MedicalStatusPanel');
  const game = nodes(
    Boundary({ renderStatusPanel: (model) => jsx('GameStatusPanel', model) })
  ).find((node) => node.type === 'GameStatusPanel');
  assert.equal(medical.props.title, 'Camera access');
  assert.equal(medical.props.message, 'Allow camera');
  assert.equal(game.props.message, medical.props.message);
  assert.deepEqual(
    [...game.props.actions].map((action) => action.label),
    [...medical.props.actions].map((action) => action.label)
  );
});
