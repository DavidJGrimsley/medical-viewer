import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.resolve(process.argv[2] || path.join(root, '.cache/virocore-compositor'));
// Prefab's native library paths exceed Windows MAX_PATH beneath the repository.
const gradleHome =
  process.env.QUEST_GRADLE_HOME ||
  (process.platform === 'win32'
    ? path.join(path.parse(root).root, 'mvq-ui-gradle')
    : path.join(root, '.cache/quest-gradle'));
const revision = '23710240d2cab5d4e866f3dba44ef568d8e563b4'; // upstream v3.0.3
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
if (!existsSync(source)) {
  mkdirSync(path.dirname(source), { recursive: true });
  run(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      'v3.0.3',
      'https://github.com/ReactVision/virocore.git',
      source,
    ],
    root
  );
}
const actual = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: source,
  encoding: 'utf8',
}).stdout.trim();
if (actual !== revision) throw new Error(`Expected ViroCore ${revision}, got ${actual}`);
function patch(file, before, after) {
  const target = path.join(source, file);
  const text = readFileSync(target, 'utf8');
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`Patch context missing: ${file}`);
  writeFileSync(target, text.replace(before, after));
}
const cpp = 'android/sharedCode/src/main/cpp/';
copyFileSync(
  path.join(root, 'native/quest-compositor/MedicalQuestPanel.h'),
  path.join(source, cpp, 'MedicalQuestPanel.h')
);
patch(
  cpp + 'VROSceneRendererOpenXR.h',
  'class VRONode;',
  'class VRONode;\nclass MedicalQuestPanel;'
);
patch(
  cpp + 'VROSceneRendererOpenXR.h',
  '    // Per-eye swapchains (index 0 = left, 1 = right)',
  '    std::unique_ptr<MedicalQuestPanel> _medicalPanel;\n\n    // Per-eye swapchains (index 0 = left, 1 = right)'
);
patch(
  cpp + 'VROSceneRendererOpenXR.cpp',
  '#include "VROSceneRendererOpenXR.h"',
  '#include "VROSceneRendererOpenXR.h"\n#include "MedicalQuestPanel.h"'
);
patch(
  cpp + 'VROSceneRendererOpenXR.cpp',
  '    // Projection layer (3D scene)',
  `    // App UI underlay: the Viro depth-only panel mask leaves transparent pixels here,
    // while hands, rays and scan geometry in front remain in the projection layer.
    if (viewsValid && frameState.shouldRender) {
        if (!_medicalPanel) _medicalPanel.reset(new MedicalQuestPanel());
        const auto *panel = _medicalPanel->prepare(_session, _stageSpace);
        if (panel) layers.push_back(panel);
    }

    // Projection layer (3D scene)`
);
patch(
  cpp + 'VROSceneRendererOpenXR.cpp',
  'void VROSceneRendererOpenXR::destroySwapchains() {',
  'void VROSceneRendererOpenXR::destroySwapchains() {\n    _medicalPanel.reset();'
);
patch(
  'android/viroreact/build.gradle',
  'abiFilters "arm64-v8a", "armeabi-v7a"',
  'abiFilters "arm64-v8a"'
);
// Only the renderer target is needed; the test app has unrelated build dependencies.
patch('android/settings.gradle', ", ':openxrtest'", ' // app-only OpenXR sample omitted');
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk');
writeFileSync(
  path.join(source, 'android/local.properties'),
  `sdk.dir=${sdk.replaceAll('\\', '/')}\n`
);
run(
  'java',
  [
    `-Dgradle.user.home=${gradleHome}`,
    '-classpath',
    path.join(source, 'android/gradle/wrapper/gradle-wrapper.jar'),
    'org.gradle.wrapper.GradleWrapperMain',
    ':viroreact:externalNativeBuildRelease',
    '--max-workers=4',
  ],
  path.join(source, 'android')
);
function find(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? find(file) : [file];
  });
}
const libraries = find(path.join(source, 'android/viroreact/build')).filter(
  (file) =>
    file.endsWith('arm64-v8a/libviro_renderer.so') ||
    file.endsWith('arm64-v8a\\libviro_renderer.so')
);
if (!libraries.length) throw new Error('Compiled arm64 renderer was not found');
const stage = path.join(root, '.cache/quest-compositor-aar');
mkdirSync(path.join(stage, 'jni/arm64-v8a'), { recursive: true });
copyFileSync(libraries[0], path.join(stage, 'jni/arm64-v8a/libviro_renderer.so'));
const stock = path.join(
  root,
  'node_modules/@reactvision/react-viro/android/viro_renderer/viro_renderer-release.aar'
);
const output = path.join(root, 'native/quest-compositor/viro_renderer-release.aar');
copyFileSync(stock, output);
run('jar', ['uf', output, '-C', stage, 'jni/arm64-v8a/libviro_renderer.so'], root);
copyFileSync(output, stock);
console.log(`Built and installed ${output} for the next Android build.`);
