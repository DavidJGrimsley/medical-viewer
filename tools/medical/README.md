# Medical scan exports

This pipeline exports real scalar CT and registered MRI voxel data inside **3D Slicer**. It does not capture the Slicer UI or render the skull/brain meshes. The current assets come from the owner-supplied NLM Visible Human Project Additional Head Images scene.

The slice commands below regenerate the existing upright panels. The **3D Scan volume pipeline** preserves scalar values for interactive window/level and cropping. Following failed physical iPhone shader trials, **3D Scan now defaults to a stacked-slice visualization**. The experimental ray marcher is available only through gated shader diagnostics. Current reproduction, device checks and fallback regeneration are documented below under **White-cube investigation and fallback**.

## Export the currently loaded scene on Windows

Open the saved scene in Slicer and confirm these exact scalar volume names appear in the Data module:

- `CT Head`
- `MRI_Elastix` (the registered output, not the original `MRI`, a segmentation, or the stripped volume)

Open **View â†’ Python Console** and paste:

```python
import runpy
medical_export = runpy.run_path(r"C:/path/to/medical-viewer/tools/medical/export_slices_slicer.py")
medical_export["export_slices"](r"C:/path/to/medical-viewer/assets/medical/slices")
```

If either node is missing, load `C:/path/to/registered-scene.mrb` using **File â†’ Add Data**, or load the equivalent complete scene for a replacement dataset. Do not rename an unregistered MRI volume to bypass the check. Keep the acquisition/registration transforms referenced by the saved scene. Do not attach `MRI_Elastix_Transform` to the already resampled output.

The exporter leaves source volumes, display settings, and segmentations intact. It checks source voxel hashes, geometry, and the parent-transform chain before and after exporting. It stages and validates the new PNGs/metadata before replacing generated assets. Only obsolete `ct_axial_*.png` and `mri_axial_*.png` files in the chosen export directory are removed.

## Export the saved bundle in a separate process

This runs against a fresh Slicer scene without changing an open Slicer window. From PowerShell:

```powershell
Set-Location "C:/path/to/medical-viewer"
$slicerExportArguments = '--no-splash --no-main-window --python-code "import runpy; runpy.run_path(r''C:/path/to/medical-viewer/tools/medical/export_slices_slicer.py'')[''headless_export''](r''C:/path/to/registered-scene.mrb'', r''C:/path/to/medical-viewer/assets/medical/slices'', result_file=r''C:/path/to/medical-viewer/.expo/medical-slices/export-result.json'')"'
$slicerExportProcess = Start-Process -FilePath 'C:/path/to/3D Slicer 5.12.4/Slicer.exe' -ArgumentList $slicerExportArguments -WindowStyle Hidden -PassThru -Wait
$slicerExportProcess.ExitCode
Get-Content .expo/medical-slices/export-result.json
```

Success is exit code `0` and `passed: true` in the result file. Loading this complete bundle uses several GB of memory. Use **Slicer.exe**, rather than PythonSlicer, for exporting: the export requires the running application's MRML scene. [Slicer's Python FAQ](https://slicer.readthedocs.io/en/latest/developer_guide/python_faq.html) documents this distinction and headless scripting.

## Customize or regenerate a dataset

The Python Console entrypoint accepts `output_directory`, `count`, `resolution`, `windows`, and `modalities`. For example:

```python
medical_export["export_slices"](
    r"C:/path/to/medical-viewer/assets/medical/slices",
    count=80,
    resolution=512,
    windows={"ct": (2000, 300), "mri": (5589, 2671.5)},
    modalities=("mri", "ct"),
)
```

Defaults are 80 slices per modality, a 512-pixel longest edge, CT window/level 150/40 (the scene's soft-tissue setting), and MRI 5589/2671.5. Window/level is fixed for the entire series; the original display nodes are not changed. `modalities=("mri",)` exports an MRI-only trial while retaining both volumes as the common reference. A later export replaces the packaged dataset, so include both modalities for the final demo.

Replace both named volumes with the next registered dataset, retain its transform references, and update the provenance fields in the exporter if its source collection differs. Keep `.mrb`, `.nrrd`, DICOM, and segmentation sources outside Git. Review generated PNG size totals in `metadata.json` before committing the compact exported assets.

## Spatial geometry and orientation

Each volume is sampled from world RAS millimetres into its current parent frame and then its IJK coordinates. The CT's nonlinear acquisition transform is included once. `MRI_Elastix` already has the registered geometry and no attached registration transform in this bundle; no separate Elastix transform is reapplied. [Slicer's volume scripting reference](https://slicer.readthedocs.io/en/latest/developer_guide/script_repository/volumes.html) documents parent-frame and IJK/RAS conversion.

The common grid covers the union of the transformed volumes' voxel-boundary bounds. Nonlinear bounds sample every voxel on each volume face, rather than only eight corners; this captures the saved CT acquisition correction. This is not a general bound guarantee for arbitrary folding/deforming transforms, which require independent validation. Axial planes run from inferior to superior. Linear interpolation and square output pixels preserve the physical aspect ratio; the shorter edge rounds outward. The first/last planes may be mostly background because the complete volume bounds are preserved.

PNG file orientation is radiological: patient **right at image left**, **anterior at top**. PNG columns advance along RAS `[-1,0,0]`; file rows advance along `[0,-1,0]`. `grid.pngTopLeftRasXYMm`, pixel spacing, and each slice's `positionMm` describe the physical pixel mapping. Metadata also records dimensions, original spacing, IJK-to-RAS matrices, transform details, voxel hashes, window/level, provenance, PNG checksums, and byte totals. Original MRI uses arbitrary signal intensity; CT uses the saved Hounsfield values.

The floating AR panel is an independent view. Its location and size in the room do not establish registration to the skull or brain meshes.

## Static assets and validation

Export automatically runs `generate_slice_manifest.py`. It validates PNG signatures, chunk CRCs, decoded grayscale length, dimensions, hashes, filenames, counts, and increasing physical positions before creating literal Metro references in `sources.native.ts`. To validate/regenerate only the mapping, use Slicer's bundled Python from the repository root:

```powershell
& 'C:/path/to/3D Slicer 5.12.4/bin/PythonSlicer.exe' tools/medical/generate_slice_manifest.py assets/medical/slices
npx prettier --write assets/medical/slices/metadata.json assets/medical/slices/sources.native.ts
```

Formatting generated text after export keeps it aligned with the project's checks. Restart Metro after replacing the dataset so its asset registry/cache includes the new files. The app validates metadata and mapping counts, displays a recoverable unavailable/error state, and offers Retry for texture failures. All static image references are registered, but only the selected image has an active `ViroImage` node; there is no bulk preloading.

Run the independent manifest failure tests:

```powershell
& 'C:/path/to/3D Slicer 5.12.4/bin/PythonSlicer.exe' tools/medical/test_manifest.py
```

Run spatial tests in the actual Slicer runtime:

```powershell
$slicerTestArguments = '--no-splash --no-main-window --python-code "import runpy; runpy.run_path(r''C:/path/to/medical-viewer/tools/medical/test_slicer_export.py'')[''run_tests''](r''C:/path/to/medical-viewer/.expo/medical-slices/slicer-tests.json'')"'
$slicerTestProcess = Start-Process -FilePath 'C:/path/to/3D Slicer 5.12.4/Slicer.exe' -ArgumentList $slicerTestArguments -WindowStyle Hidden -PassThru -Wait
$slicerTestProcess.ExitCode
Get-Content .expo/medical-slices/slicer-tests.json
npm run test:medical
```

The spatial fixtures are asymmetric test arrays, never packaged scan assets. They verify PNG row order, oblique IJK axes, linear registration exactly once, nonlinear grid inversion, fixed window/level, and unchanged source geometry/data.

## Device acceptance

Use the existing Expo development client with `npm start`; Viro requires the native runtime. Open Medical Viewer, confirm **3D Anatomy / Both**, tap a surface, then choose **Scan Slices**. Confirm middle MRI, CT â†’ MRI â†’ CT, dragging to both ends, fast drags, Previous/Next, and slice coordinates. The modality switch uses the nearest physical position. Reset Slice returns to the middle.

Test pinch/rotate, Transform's size/rotation/height sliders, Reset Panel, Reposition, Restart AR, and return to anatomy with its original pose. Confirm image error/Retry, background/resume, camera denial, tracking loss, Home teardown, and reopening Medical, Arena, and Qubit. Check large system text, VoiceOver, Android accessibility, and overlay reachability. A single keyed image node isolates old native load events; changing slices does not recreate the navigator, scene, or plane anchor.

Local tests, exported PNG inspection, and iOS JS bundling do not establish physical iPhone/Android rendering or texture performance. Record that acceptance separately.

## 3D Scan volume pipeline

The Slicer preview establishes the appearance: show the saved scalar volume in **Volume Rendering**, enable cropping, and remove the patient's left half at the RAS midpoint to expose internal scan detail. This implementation creates that reference automatically in a separate Slicer process. The user does not need to prepare another export. The three references use the same resampled, quantized voxels and grayscale/opacity mappings as the app; VTK lighting and the app's approximate gradient lighting differ, so these are visual references rather than pixel-identical renders.

The viewer still opens in **3D Anatomy â†’ Both**. **3D Scan** initially selects MRI Grayscale with a left-half cutaway, 135Â° yaw, and a 55 cm longest extent centred two feet above the selected surface. The existing scene and plane selector remain mounted when changing representations. CT and MRI share physical crop bounds and volume placement, while each keeps its own preset/window/level/opacity. Anatomy, slice panel, and volume have independent transforms.

### Volume export from the Python Console

With the complete scene loaded in Slicer, open **View â†’ Python Console**:

```python
import runpy
volume_export = runpy.run_path(r"C:/path/to/medical-viewer/tools/medical/export_volume_slicer.py")
volume_export["export_volumes"](
    r"C:/path/to/medical-viewer/assets/medical/volumes",
    resolution=160,
    source_scene=r"C:/path/to/registered-scene.mrb",
    preview_directory=r"C:/path/to/medical-viewer/.expo/medical-volumes/reference",
)
```

`source_scene` records the bundle's provenance; it does not load or save it in this console workflow. Use the isolated process below when regenerating the committed dataset from that bundle. The exporter checks source voxel hashes, geometry, parent-transform chains, display settings, and segmentation modification times. It resamples copies and never hardens transforms on the original nodes.

### Isolated volume export on Windows

```powershell
Set-Location "C:/path/to/medical-viewer"
$volumeExportArguments = '--no-splash --no-main-window --python-code "import runpy; runpy.run_path(r''C:/path/to/medical-viewer/tools/medical/export_volume_slicer.py'')[''headless_export''](r''C:/path/to/registered-scene.mrb'', r''C:/path/to/medical-viewer/assets/medical/volumes'', resolution=160, result_file=r''C:/path/to/medical-viewer/.expo/medical-volumes/export-result.json'', preview_directory=r''C:/path/to/medical-viewer/.expo/medical-volumes/reference'')"'
$volumeExportProcess = Start-Process -FilePath 'C:/path/to/3D Slicer 5.12.4/Slicer.exe' -ArgumentList $volumeExportArguments -WindowStyle Hidden -PassThru -Wait
$volumeExportProcess.ExitCode
Get-Content .expo/medical-volumes/export-result.json
npx prettier --write assets/medical/volumes/metadata.json assets/medical/volumes/sources.native.ts
```

Check that the result file has a fresh modification time, `passed: true`, and `sourceNodesUnchanged: true`. Keep the 1.32 GB source bundle and original volumes/segmentations outside Git. [Slicer's documented scripting entrypoints](https://slicer.readthedocs.io/en/latest/developer_guide/python_faq.html) support `--no-main-window --python-code`. These commands use the installed 5.12.4 application.

### Encoding, orientation and resolution

Both original volumes are 512 Ã— 512 Ã— 463 with approximately 0.489 Ã— 0.489 Ã— 0.503 mm spacing. The exported common grid is **160 Ã— 160 Ã— 149**, isotropic **1.574841145 mm**, with 3,814,400 samples (3.14% of the original voxel count per modality). Linear resampling preserves physical proportions; it reduces spatial detail. CT's nonlinear acquisition transform is inverted once when sampling world RAS. MRI_Elastix is already registered and receives no additional Elastix transform.

Volumes are encoded independently: `scalar = scalarOffset + scalarScale * uint16Code`. Round-to-nearest quantization has a maximum error of half `scalarScale`; measured maxima are **MRI 0.0711243 signal units** and **CT 0.0253285 HU**. Window/level is applied at render time. MRI uses 5589/2671.5, CT Bone uses 1800/400, and CT Soft Tissue uses 150/40. Normalized gray is `clamp((scalar-level)/window+0.5,0,1)`. Density is `0.65*smoothstep(threshold,1,gray)` per millimetre, with threshold 0.1 for MRI/soft tissue and 0.4 for bone. The ray step corrects opacity in both quality settings. Internal crop faces use unlit windowed gray and `1-exp(-4*opacityMultiplier)` alpha where valid density exceeds 0.001.

Each modality has high-byte, low-byte, and validity PNGs, all **RGBA8** with white RGB and numeric alpha. Installed Viro 3.0.3 creates custom sampler textures as sRGB; alpha remains linear. Shader decoding reads `high.a*65280 + low.a*255`. The samplers and sampled alpha temporaries explicitly use `highp`: GLSL's default low-precision sampler and arithmetic cannot guarantee a 16-bit scalar decode, even when the result is assigned to a high-precision variable. Invalid voxels have zero codes; trilinearly interpolated codes are divided by interpolated validity before decoding, avoiding background-value contamination. Validity controls opacity separately.

There are 149 axial tiles in increasing RAS S order. Each tile's columns increase R and PNG rows increase A, with one duplicated edge texel on all sides. This atlas layout is different from the radiological slice-panel PNG layout. The 13-column atlases are 2106 Ã— 1944, below the 4096 limit. Bilinear texture sampling plus interpolation between adjacent tiles gives trilinear volume sampling. No mipmaps are generated. Pixel centres are `(tileOrigin + 1.5 + IJK.xy)/atlasDimensions`; tile Z is `floor(IJK.z)`. Native iOS image upload retains PNG row order, so `u_flip_y=0`. Android orientation/native behavior needs independent acceptance.

World RAS maps to Viro **X=R, Y=S, Z=âˆ’A**, relative to the common-grid midpoint. Cropping remains in physical RAS millimetres with at least one exported voxel between each boundary pair. These volumes remain separate from mesh registration and fusion.

### Manifest and rendering checks

Export invokes the companion manifest generator automatically. It validates schema, isotropic geometry, tile layout, PNG CRCs/RGBA8 dimensions, white RGB, binary validity, duplicated gutters, scalar quantization, hashes, filenames, voxel count, and byte totals. It generates literal TypeScript `require()` references:

```powershell
& 'C:/path/to/3D Slicer 5.12.4/bin/PythonSlicer.exe' tools/medical/generate_volume_manifest.py assets/medical/volumes
npx prettier --write assets/medical/volumes/sources.native.ts
$volumeTestArguments = '--no-splash --no-main-window --python-code "import runpy; runpy.run_path(r''C:/path/to/medical-viewer/tools/medical/test_volume_export.py'')[''run_tests''](r''C:/path/to/medical-viewer/.expo/medical-volumes/export-tests.json'')"'
$volumeTestProcess = Start-Process -FilePath 'C:/path/to/3D Slicer 5.12.4/Slicer.exe' -ArgumentList $volumeTestArguments -WindowStyle Hidden -PassThru -Wait
Get-Content .expo/medical-volumes/export-tests.json
npm run test:medical:shader
npm run test:medical
```

The shader proof uses installed `playwright-core` and local Chrome/Edge with SwiftShader WebGL2; it adds no app dependency. Set `MEDICAL_TEST_BROWSER` to another Chromium executable if needed. Before GPU tests, it checks the production box's `shaderOverrides` prop against the installed iOS bridge's explicit sampler-copy and render-property merge code. It then injects the exact modifier body into the installed Viro iOS Constant shader and surface definition, retaining their material alpha/intensity pipeline. An asymmetric 0â€“65535 scalar fixture covers both encoded bytes and fractional interpolation. Tests also cover ray intersections, camera movement, model translation/yaw/scale, cropping, transparency, and step-corrected opacity against a CPU formula. It samples both real atlases against an independent eight-voxel CPU reference and writes real scan renders to `.expo/medical-volumes/*-shader.png`. These are source contract checks and desktop GPU tests; they do not execute native sampler binding, UIImage decoding or Apple's GPU. Slicer references are in `.expo/medical-volumes/reference/`; proof JSON and all preview images remain ignored.

The native mode creates one back-face proxy box, with front-to-back ray compositing, early termination, and approximate gradient lighting. Its uniforms use the automatically supplied camera/model transforms plus scalar, vec3 and vec4 updates. It does not use unsupported iOS vec2/matrix updates. Invisible keyed image probes establish atlas readiness; they do not prove GPU shader compilation or correct drawing. The load deadline covers the whole request for 30 seconds. Token guards reject events after selection, placement, mode/session changes, retries, backgrounding and teardown. Updates coalesce per animation frame; exit cancels pending updates and deletes the single bounded `medicalVolume` material.

The proxy uses **`shaderOverrides={[MATERIAL]}`**. In installed Viro iOS 3.0.3, the `materials` path clones `VROMaterial`, whose copy constructor omits custom sampler textures. The override path explicitly copies those textures after cloning, and merges the authored Constant lighting, Alpha blending, front-face culling and depth settings. Float/vec3/vec4 updates propagate through its override registry. A modality change remounts the box after new atlas readiness, so it does not depend on unsupported live sampler updates. This correction changes JavaScript only; a matching development client needs a full restart/reload, not another EAS build.

Native Viro's material-definition dictionary and UIImage cache are retained until bridge invalidation; material deletion is not an image-eviction API. One modality's three decoded RGBA atlases occupy approximately **46.85 MiB** before native caches/probes/other scene resources. GPU/CPU memory must be measured on device across repeated switches.

### Physical iOS acceptance

Run `npm start`, open the existing iOS development client, and reload this worktree. Open Medical Viewer, place Anatomy/Both, then select **3D Scan**. Confirm the MRI cut face, walk around the scan (including the back and inside its proxy bounds), and compare with the reference images. Test CT â†’ MRI â†’ CT, both CT presets, independent window/level sliders, transparency endpoints, Fast/Balanced, crop enable/box visibility and all six boundaries. Reset Crop shows the whole volume; Reset Scan restores the selected modality's defaults/cutaway; Reset Transform restores its pose.

Test pinch/rotate, all Transform sliders, Reposition, Restart AR, tracking loss, background/resume, Home, and reopening Medical/Arena/Qubit. Check that queued controls do not affect another modality or a reopened viewer. Check VoiceOver, large text, sheet scrolling and dismissal. Record **device model, iOS/client versions, sustained Fast FPS** (target â‰¥30 over a representative 60-second walk-around) and process/GPU memory after 1/10/30 CTâ€“MRI switches and Home/reopen. Assets loading and bundle export alone do not satisfy these checks. If native shader compilation or alpha decoding fails, capture the specific limitation before changing native rendering architecture.

## White-cube investigation and fallback

The third owner trial still showed a white cube. No native ray-march rendering fix is claimed. [project/agent/completions/medical-white-cube.md](https://github.com/DavidJGrimsley/xr-showcase/blob/e69ddae38ca6602ca5cd7ca844b9ae75b16767e2/project/agent/completions/medical-white-cube.md) records the native findings, actual runtime evidence, local results and staged device tests. Later owner screenshots show dark/faint fallback imagery; [project/agent/completions/medical-scan-visibility.md](https://github.com/DavidJGrimsley/xr-showcase/blob/e69ddae38ca6602ca5cd7ca844b9ae75b16767e2/project/agent/completions/medical-scan-visibility.md) records the controls and visibility correction. The default **3D Scan** route uses **48 scan-derived transparent axial planes**, explicitly labelled **Stacked-slice visualization Â· temporary fallback**. It uses ordinary diffuse textures, with a small iOS fragment color correction for premultiplied RGB; no custom samplers/uniforms or proxy box are used. MRI/CT, three presets, transparency, physical cropping and volume transforms are retained. Presets have baked W/L; the corresponding sliders and ray quality are disabled. Near edge-on views show bands; narrow Bottom/Top crops may contain no selected plane.

### Regenerate fallback planes from the validated atlases

No Slicer session or original bundle is loaded by this command. It validates the current six atlases, decodes scalar alpha bytes and writes 48 Ã— 160 Ã— 160 RGBA PNGs for each preset, metadata, static requires and known valid/invalid texel probes. Opacity is `min(0.40, density * 0.70)` multiplied by validity; air/invalid areas have zero alpha. Native global plane opacity multiplies this by `appearance.opacity / 2`, initially 0.8 (Transparency 20%).

```powershell
Set-Location 'C:/path/to/medical-viewer'
# Format source metadata first, because the fallback records its exact file hash.
npx prettier --write assets/medical/volumes/metadata.json assets/medical/volumes/sources.native.ts
& 'C:/Users/DJLeg/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' tools/medical/generate_volume_fallback.py --source assets/medical/volumes --output assets/medical/stack --count 48
npx prettier --write assets/medical/stack/metadata.json assets/medical/stack/sources.native.ts
npm run test:medical
npm run test:medical:shader
```

The checked installation's Python includes NumPy. Another Python installation can run the same script with NumPy installed. Keep **48** planes to match the app's readiness/registration limit. Regenerate these assets after replacing/re-exporting the volume atlases. The script does not clean unrelated destination files; use the dedicated `assets/medical/stack` directory. Current added PNG bytes: **1,235,361 (1.178 MiB)**. About **4.6875 MiB** decoded RGBA per preset is required before GPU/native/probe caches. Deleting bounded materials does not guarantee image eviction.

`test:medical:shader` also compiles all nine diagnostics in the installed Constant template and reads their output against real atlas probes. It checks valid/reference alpha bands, invalid black bands, magenta and positive/negative numeric uniforms. A 48-probe regression models iOS premultiplied sRGB uploads and validates the fallback color correction and node opacity. It produces desktop stacked-plane previews with transparent surrounding pixels using that upload/correction path. `.expo/medical-volumes/{diagnostics-proof,stack-proof,stack-color-proof}.json` and `*-stack.png` are ignored artifacts. These modeled WebGL bindings do not execute the phone's native registration, shader overrides, UIImage conversion or driver.

### Reload and verify the default fallback first

```powershell
Set-Location 'C:/path/to/medical-viewer'
npm start -- --clear
```

Fully close/reopen the installed development client and connect to this Metro instance. The owner identified build commit **839c8e3**, EAS build **02d480be-4fe7-468c-8be2-539da629e826**; its INSTALL_PODS log explicitly installed **ViroReact 3.0.3**. No native changes were made here; a new EAS build is not required for these JS/assets. The diagnostics show current JS/OS/native app identifiers and API presence, but Viro exposes no live native-version getter.

Open Medical Viewer, place Anatomy/Both, enter 3D Scan. Expected: a full head made of brighter MRI layers, visible axial bands, transparent camera imagery around tissue, **no opaque cube**. CT Bone should show a brighter skull. Scan Controls should open and Done should dismiss without a raw-text error. Initial Transparency is 20%; reduce toward 0% for denser layers. Test CTâ†’MRIâ†’CT, CT presets, transparency, six crop boundaries and all resets/transforms. Changing R/A bounds changes quad size/UVs; S bounds select planes. The UI shows visible-plane count. Full Scan restores all bounds; Reset Scan restores full bounds and selected modality appearance. Background/resume, Home, Restart AR and all experience reopens must retain single AR ownership.

### Isolate custom shader stages

1. Scan Controls â†’ **Shader diagnostics**, close sheet. Expect **uniform bright magenta**. No atlas loads or custom uniforms are used for this proof. A white/blank proxy means the modifier path has not passed; capture logs and return to Stacked slices.
2. Only after seeing magenta, reopen and select **I see magenta**. Test High byte, Low byte, Validity separately. A magenta edge must surround matching sampled/reference gray bands, with a **black invalid-texel band**. Known valid alpha bytes: MRI **68/190/255**, CT **108/171/255**. Sheet shows the exact IJK, UV and expected bytes. All-white/all-black samples with a differing reference point to binding/decoding/UV failure.
3. Coordinates should show R/A/S RGB gradients fixed to the box through transforms, with a camera-origin strip that responds as camera coordinates cross its axes. Numeric Uniforms should show green on the left, crop-min RGB on the right, and a grayscale strip that responds to Window. Red indicates a selected uniform check failed. Submitted numeric values are selectable in the sheet.
4. Ray intersections should show green/cyan hits and magenta misses, responsive to camera/crop. Accumulated Opacity should respond to transparency; at 100% it must be black. Only then test Ray marcher. Expected: actual MRI/CT tissue with transparent surroundings; a white cube remains failed acceptance.
5. Requests, placement, modality changes, mode changes, Retry, restart/background and exit invalidate old events and magenta confirmations. Two-frame geometry deferral reduces same-update registration/mounting; it does not acknowledge native completion. Visible readiness/probe success is never drawing confirmation.

The bounded diagnostic list captures supported Viro node errors, JS material/uniform exceptions and the 30-second deadline. Core renderer compile/link failures are logged through iOS `NSLog`, not all forwarded to JS. On a connected Mac, Console â†’ iPhone â†’ start streaming â†’ reproduce one mode â†’ filter app process. Search `Shader compile log`, `Failed to compile fragment shader`, `Program link log`, `Failed to link program`, `Material`, `medicalVolume`; save the relevant interval and mode/modality. Xcode's attached device console is another option. No such native log was captured in this Windows session.

Record the physical results separately: iPhone model/iOS/build, observed magenta/byte/uniform/ray/opacity stages, fallback appearance, sustained FPS and memory across 1/10/30 modality switches and Home/reopen. Desktop proofs, Expo export and EAS success do not verify those results.
