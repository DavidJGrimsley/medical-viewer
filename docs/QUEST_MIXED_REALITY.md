# Meta Quest Mixed Reality Support for Medical Viewer

This document records the implementation architecture, build configuration, sideloading instructions, local validation evidence, and external prerequisites for the Meta Quest 3 and Quest 3S mixed reality milestone in Medical Viewer.

---

## 1. Feature Overview

The standalone Medical Viewer (`medical-viewer-main`) has been extended to support Meta Quest 3 and Meta Quest 3S in mixed reality (MR with passthrough), bringing the full clinical dataset and interactive viewer capabilities into spatial computing while preserving the existing iOS and standard Android phone experiences:

1. **Viewer Modes Supported in Headset**:
   - **3D Anatomy**: Anatomical models (Skull, Brain, Half-Skull, Both) with spatial positioning, scale, yaw, height adjustments, and calibrated 3D labels toggle.
   - **Scan Slices**: Registered axial CT and MRI scan slices with slider browsing, slice-stepping buttons, modality toggle (CT/MRI), and transform controls.
   - **3D Scan (Volume)**: Experimental volumetric scanning. Defaults on Quest to the atlas-based raymarching shader (`renderer: 'shader'`) for clean per-eye stereoscopic rendering without depth sorting artifacts, with the transparent 48-plane stack renderer retained as a diagnostic fallback option (`renderer: 'stack'`). Includes quality selection (Balanced/Fast), CT presets (Bone, Soft Tissue), and opacity controls.

2. **Input & Interaction Parity**:
   - **Controllers**: Touch controller pointing rays with trigger click activation.
   - **Hands**: Bare hand tracking pointing rays with index-pinch gesture activation.
   - **Aggregated Interaction State**: Uses `@reactvision/react-viro`'s `useAnySourceHover` and `useAnySourcePressed` to seamlessly combine Touch controller rays and hand pinch clicks for all buttons and controls. Active gestures are automatically cleared on tracking loss or controller disconnection.

3. **In-Scene Stationary Spatial Controls**:
   - In Horizon OS `VRActivity`, 2D screen DOM/View overlays do not render into the OpenXR eye buffers.
   - All HUD controls are authored as 3D Viro scene nodes (`ViroQuad`, `ViroText`, `ViroNode`) situated in the immersive environment.
   - **Stationary Head-Locked Placement**: When the scene launches, the control panel is placed 1.15m directly in front of the wearer and aligned with their eye line, with pitch and roll locked to 0 for maximum legibility and comfort. Once positioned, it remains stationary in the world so the wearer can walk around the anatomical specimen.
   - **Recenter Button**: A persistent "Recenter" button summons the panel back to 1.15m directly in front of the wearer's current gaze whenever needed.
   - **Exit VR Button**: Calls `exitVRScene()` to cleanly return to 2D Horizon OS panel mode.

4. **Environment & Room Placement**:
   - **Passthrough Mixed Reality**: `passthroughEnabled={true}` shows the real-world room.
   - **Space Setup Planes**: Surfaces (floors, tables) are detected via Horizon OS Space Setup (`horizonos.permission.USE_ANCHOR_API`, `com.oculus.permission.USE_SCENE`). If the wearer has not performed Space Setup, the boundary screen provides actionable setup guidance and retry prompts.

---

## 2. Architecture & Session Management

- **Build-Variant Separation**:
  - Controlled by environment variables: `APP_VARIANT=quest` (or `QUEST_BUILD=1`, `BUILD_VARIANT=quest`, `QUEST=1`).
  - Standard phone builds configure `@reactvision/react-viro` with `xRMode: ['AR']`.
  - Quest builds configure `@reactvision/react-viro` with `xRMode: ['QUEST']`, target devices `'quest3|quest3s'`, disabled unused capabilities (`colocation: false`, `eyeTracking: false`, `passthroughCamera: false`), and validate numeric `META_QUEST_APP_ID`.
- **Dual-Activity React Architecture**:
  - `MainActivity`: Standard 2D Horizon OS windowed panel (mounts `App`).
  - `VRActivity`: Horizon OS OpenXR immersive compositor activity (mounts `"VRQuestScene"` registered via `ViroQuestEntryPoint`).
  - Both activities run inside the same Android process and share the same Hermes JavaScript engine and memory heap.
  - Because `ViroXRSceneNavigator` does not forward existing `viroAppProps` into its Quest root intent, `questSessionBridge` coordinates controller attachment, session context, camera updates, and teardown across activities.

---

## 3. Build & Packaging Instructions

### Prerequisites

1. **Node.js & npm**: Node.js 20+ installed.
2. **Meta Quest Application ID**: A numeric Meta Quest application ID string obtained from the Meta Horizon Developer Dashboard (`https://developer.oculus.com`).
3. **Android SDK**: `platform-tools` (adb) and Android SDK build tools.

### Environment Configuration

Set the following environment variables before building:

```bash
# In Bash:
export APP_VARIANT=quest
export META_QUEST_APP_ID=1234567890123456   # Replace with your numeric Meta Application ID

# In PowerShell:
$env:APP_VARIANT = "quest"
$env:META_QUEST_APP_ID = "1234567890123456" # Replace with your numeric Meta Application ID
```

### Building via EAS (Cloud or Local)

Profiles are configured in `eas.json`:

- `quest-standalone`: Produces an installable APK for test distribution:
  ```bash
  eas build --platform android --profile quest-standalone
  ```
- `quest-development`: Produces a development client APK with debugging enabled:
  ```bash
  eas build --platform android --profile quest-development
  ```

### Local Android Build

To generate the native Android project with Quest manifest and build locally:

```bash
# Ensure APP_VARIANT and META_QUEST_APP_ID are set in your shell
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease
# The output APK will be located at:
# android/app/build/outputs/apk/release/app-release.apk
```

---

## 4. Sideloading & Headset Setup

### Enabling Developer Mode on Meta Quest 3 / 3S

1. In the Meta Horizon mobile app (on your smartphone paired to the headset):
   - Go to **Devices** > select your Quest 3/3S.
   - Navigate to **Headset Settings** > **Developer Mode**.
   - Toggle **Developer Mode** to **ON**.
2. Put on the headset and connect it to your computer via USB-C.
3. In VR, accept the "Allow USB Debugging?" prompt (select "Always allow from this computer").

### Sideloading via ADB

Verify headset connection:

```bash
adb devices
# Output should list your device, e.g.:
# 1WMHHXXXXXXXXX    device
```

Install the generated APK:

```bash
adb install -r -d path/to/medical-viewer-quest.apk
```

### Space Setup (Physical Surfaces)

For physical plane detection (placing anatomy models on tables or floors):

1. In Quest Settings, go to **Physical Space** > **Space Setup**.
2. Scan your room to mark walls, floors, and tables.
3. Open Medical Viewer from **Unknown Sources** in the Quest App Library.

---

## 5. Verification Status & Test Evidence

### Local Automated Verification (Passed)

All automated tests across code style, type checking, unit tests, and native export builds passed with 0 errors:

| Check                                     | Command                                 | Result                             |
| :---------------------------------------- | :-------------------------------------- | :--------------------------------- |
| Code Formatting                           | `prettier -c`                           | Passed                             |
| Static Linting                            | `eslint`                                | Passed (0 errors)                  |
| TypeScript Types                          | `tsc --noEmit`                          | Passed (0 errors)                  |
| AR Session & Lifecycle                    | `npm run test:ar`                       | 14/14 passed                       |
| Medical Viewer & Assets                   | `npm run test:app`                      | 86/86 passed                       |
| **Quest Configuration & Detection**       | `tests/quest-build-config.test.cjs`     | 5/5 passed                         |
| **Quest Session & Spatial Permissions**   | `tests/quest-session.test.cjs`          | 13/13 passed                       |
| **Quest Spatial Controls & Interactions** | `tests/quest-spatial-controls.test.cjs` | 9/9 passed                         |
| UI & Button Layouts                       | `npm run test:ui`                       | 13/13 passed                       |
| Dependency Compatibility                  | `npm run test:dependencies`             | 3/3 passed                         |
| Shader Compilation & Sampling             | `npm run test:medical:shader`           | Passed (GL/sampling error < 0.002) |
| iOS Native Export Build                   | `npm run build:ios`                     | Passed (2506 modules bundled)      |
| Android Native Export Build               | `npm run build:android`                 | Passed (2513 modules bundled)      |
| **Total Test Suite**                      | `npm test`                              | **143/143 passed**                 |

### External Prerequisites & Hardware Acceptance (Pending)

Because physical Meta Quest 3 / 3S hardware and a live numeric Meta Quest Application ID from the Horizon Developer Dashboard were not attached to the local development environment, the following hardware acceptance items remain to be confirmed on physical headset hardware:

1. **Physical OpenXR Launch**: Verifying transition from 2D `MainActivity` panel to immersive 6DOF `VRActivity` upon clicking "Enter Immersive View".
2. **Physical Passthrough & Space Setup**: Validating that saved room mesh/planes from Horizon OS Space Setup surface as detected horizontal anchors for model grounding.
3. **Stereoscopic Volume Shader**: Validating that the atlas raymarching shader renders comfortably in stereo at 72 Hz without framerate drops or eye divergence.
4. **Physical Touch Controller & Bare-Hand Rays**: Validating ergonomic beam aiming and button click response across both controller triggers and bare-hand index pinches.
