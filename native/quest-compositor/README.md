# Quest UI compositor prototype

React supplies a panel description. The local `quest-panel` Expo module rasterizes it
with Android Canvas at 2048 pixels wide and a matching height. The patched Viro 3.0.3 OpenXR renderer submits the
result as an independent `XrCompositionLayerQuad`, between passthrough and the scene.
A Viro depth-only rectangle leaves a transparent hole for the panel, and Viro hit
targets use the same dimensions and pose. Content in front remains in the scene.

Size, height and a rotation slider are on every main panel. Anatomy labels and the
scan-slice slider sit directly below those transforms. Only 3D Scan has **More controls**,
which opens appearance/detail directly (quality, presets and visibility). Quest starts
at Fast quality; an explicit Balanced selection is retained. Reset, retry and placement
actions remain on the main panels. Developer diagnostics stay behind the existing flag.
**Back** returns through the same panel. The launcher also switches between
**Headset layer** and **Original controls**.
The new panel is selected automatically when the patched renderer is present.

The grab handle is a text-free white bar drawn by Canvas, centered under the controls
at 30% of their width. Only its invisible drag target uses Viro geometry. The controls'
bottom edge is anchored at the original rig height; the panel grows upward without
moving the specimen. Logical coordinates, native layer size and hit targets share
the same geometry helpers. Native bridge version 2 carries the physical panel height.

Build the native renderer once (JDK 17, Android SDK and NDK 27.1.12297006):

```powershell
npm run quest:build-ui
```

This downloads the matching MIT-licensed ViroCore revision into `.cache`, adds the
app-owned header, builds arm64, and replaces only `libviro_renderer.so` in the existing
renderer AAR. It preserves the bundled Java bridge and other native libraries.
On Windows, Gradle's renderer cache uses `<drive>:\mvq-ui-gradle` to keep Prefab
library paths within Windows' path limit; `QUEST_GRADLE_HOME` overrides this path.
The generated AAR is ignored by Git and copied into the installed Viro package.
After reinstalling dependencies, run the command again. For future Quest prebuilds,
set `QUEST_COMPOSITOR_UI=1` along with the project's existing Quest build variables;
the config plugin restores the generated AAR or fails if it has not been built.

Build the standalone APK from the existing Quest Android project:

```powershell
cd android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a -I ../tools/quest/short-cmake.gradle --max-workers=1
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk` and
includes the JavaScript and assets. It runs on its own without Metro or a USB
connection. This prototype still needs headset
validation for texture orientation, occlusion, pointer alignment and readability.
All normal and advanced panel pages now use the same native drawing path.
