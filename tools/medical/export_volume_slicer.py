"""Real CT/MRI volume export; run inside Slicer, using an isolated process for saved scenes."""
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import traceback
import numpy as np
import slicer
import vtk
from vtk.util.numpy_support import vtk_to_numpy, numpy_to_vtk

HERE = Path(__file__).parent
slice_tools = runpy.run_path(str(HERE/"export_slices_slicer.py"))
core = runpy.run_path(str(HERE/"volume_export_core.py"))

def resample_volume(node, grid):
    """One world-RAS resampling; transform source coordinates without hardening source nodes."""
    inverse_parent = vtk.vtkGeneralTransform()
    slicer.vtkMRMLTransformNode.GetTransformBetweenNodes(None, node.GetParentTransformNode(), inverse_parent)
    ras_to_ijk = vtk.vtkMatrix4x4()
    node.GetRASToIJKMatrix(ras_to_ijk)
    transform = vtk.vtkGeneralTransform()
    transform.PostMultiply()
    transform.Concatenate(inverse_parent)
    transform.Concatenate(ras_to_ijk)
    image = vtk.vtkImageData()
    image.ShallowCopy(node.GetImageData())
    image.SetOrigin(0, 0, 0)
    image.SetSpacing(1, 1, 1)
    image.SetDirectionMatrix(1, 0, 0, 0, 1, 0, 0, 0, 1)
    reslice = vtk.vtkImageReslice()
    reslice.SetInputData(image)
    reslice.SetResliceTransform(transform)
    reslice.SetOutputScalarType(vtk.VTK_DOUBLE)
    reslice.SetOutputDimensionality(3)
    reslice.SetOutputOrigin(*grid["boundsRasMm"][::2])
    reslice.SetOutputSpacing(*([grid["spacingMm"]]*3))
    x, y, z = grid["dimensions"]
    reslice.SetOutputExtent(0, x-1, 0, y-1, 0, z-1)
    reslice.SetInterpolationModeToLinear()
    reslice.SetBackgroundLevel(0)
    reslice.GenerateStencilOutputOn()
    reslice.Update()
    values = vtk_to_numpy(reslice.GetOutput().GetPointData().GetScalars()).reshape(z, y, x).copy()
    stencil = vtk.vtkImageStencilToImage()
    stencil.SetInputData(reslice.GetStencilOutput())
    stencil.SetInsideValue(255)
    stencil.SetOutsideValue(0)
    stencil.SetOutputScalarTypeToUnsignedChar()
    stencil.Update()
    validity = vtk_to_numpy(stencil.GetOutput().GetPointData().GetScalars()).reshape(z, y, x).copy()
    return values, validity

def reference_preview(values, validity, grid, preset, output):
    """VTK ray cast the same exported values and opacity mapping, in a dedicated scene."""
    item = core["PRESETS"][preset]
    data = values.copy()
    data[validity == 0] = item["level"]-item["window"]
    image = vtk.vtkImageData()
    image.SetDimensions(*grid["dimensions"])
    image.SetOrigin(*grid["boundsRasMm"][::2])
    image.SetSpacing(*([grid["spacingMm"]]*3))
    image.GetPointData().SetScalars(numpy_to_vtk(data.ravel(), deep=True))
    color, opacity = vtk.vtkColorTransferFunction(), vtk.vtkPiecewiseFunction()
    samples = np.linspace(item["level"]-item["window"]/2, item["level"]+item["window"]/2, 256)
    gray, alpha = core["transfer_function"](samples, preset)
    for scalar, luminance, density in zip(samples, gray, alpha):
        color.AddRGBPoint(scalar, luminance, luminance, luminance)
        opacity.AddPoint(scalar, density)
    prop = vtk.vtkVolumeProperty()
    prop.SetColor(color)
    prop.SetScalarOpacity(opacity)
    prop.SetScalarOpacityUnitDistance(1)
    prop.SetInterpolationTypeToLinear()
    prop.ShadeOn()
    prop.SetAmbient(0.35)
    prop.SetDiffuse(0.65)
    mapper = vtk.vtkFixedPointVolumeRayCastMapper()
    mapper.SetInputData(image)
    mapper.SetSampleDistance(grid["spacingMm"])
    b = list(grid["boundsRasMm"])
    b[0] = (b[0]+b[1])/2
    mapper.CroppingOn()
    mapper.SetCroppingRegionPlanes(*b)
    mapper.SetCroppingRegionFlagsToSubVolume()
    volume = vtk.vtkVolume()
    volume.SetMapper(mapper)
    volume.SetProperty(prop)
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.035, 0.055, 0.075)
    renderer.AddVolume(volume)
    # Match the app's windowed grayscale internal cut face, without lighting it.
    # NumPy [S,A] rows map to the plane's +S texture coordinate; no radiological flip.
    midpoint_index = (grid["dimensions"][0]-1)/2
    lower = int(np.floor(midpoint_index))
    weight = midpoint_index-lower
    cut_values = values[:, :, lower]*(1-weight)+values[:, :, lower+1]*weight
    cut_valid = (validity[:, :, lower]*(1-weight)+validity[:, :, lower+1]*weight)/255
    cut_gray, cut_density = core["transfer_function"](cut_values, preset)
    rgba = np.zeros((*cut_gray.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.rint(cut_gray[:, :, None]*255).astype(np.uint8)
    rgba[:, :, 3] = np.rint((1-np.exp(-4))*cut_valid*(cut_density*cut_valid > 0.001)*255).astype(np.uint8)
    cut_image = vtk.vtkImageData()
    cut_image.SetDimensions(grid["dimensions"][1], grid["dimensions"][2], 1)
    cut_image.GetPointData().SetScalars(numpy_to_vtk(rgba.reshape(-1, 4), deep=True))
    texture = vtk.vtkTexture()
    texture.SetInputData(cut_image)
    texture.InterpolateOn()
    plane = vtk.vtkPlaneSource()
    plane.SetOrigin(b[0], b[2], b[4])
    plane.SetPoint1(b[0], b[3], b[4])
    plane.SetPoint2(b[0], b[2], b[5])
    cut_mapper = vtk.vtkPolyDataMapper()
    cut_mapper.SetInputConnection(plane.GetOutputPort())
    cut_actor = vtk.vtkActor()
    cut_actor.SetMapper(cut_mapper)
    cut_actor.SetTexture(texture)
    cut_actor.GetProperty().LightingOff()
    # Draw the internal face after the volume. VTK's fixed-point volume pass does
    # not reliably composite a translucent textured actor at the clipping plane.
    cut_renderer = vtk.vtkRenderer()
    cut_renderer.SetLayer(1)
    cut_renderer.AddActor(cut_actor)
    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetSize(512, 512)
    window.SetNumberOfLayers(2)
    window.AddRenderer(renderer)
    window.AddRenderer(cut_renderer)
    center = [(b[2*a]+b[2*a+1])/2 for a in range(3)]
    camera = renderer.GetActiveCamera()
    camera.SetFocalPoint(*center)
    camera.SetPosition(center[0]-450, center[1]+450, center[2]+80)
    camera.SetViewUp(0, 0, 1)
    renderer.ResetCamera()
    cut_renderer.SetActiveCamera(camera)
    window.Render()
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.Update()
    writer = vtk.vtkPNGWriter()
    writer.SetFileName(str(output))
    writer.SetInputConnection(capture.GetOutputPort())
    writer.Write()
    window.Finalize()

def export_volumes(output_directory, resolution=160, source_scene=None, preview_directory=None):
    if not hasattr(slicer, "mrmlScene"):
        raise RuntimeError("Run inside 3D Slicer")
    nodes = {modality: slicer.util.getNode(name) for modality, name in slice_tools["VOLUME_NAMES"].items()}
    for node in nodes.values():
        if not node.IsA("vtkMRMLScalarVolumeNode") or not node.GetImageData() or node.GetImageData().GetNumberOfScalarComponents() != 1:
            raise ValueError("Expected CT Head and registered MRI_Elastix scalar volumes")
    before = {key: slice_tools["image_fingerprint"](node) for key, node in nodes.items()}
    segmentations = {node.GetID(): node.GetMTime() for node in slicer.util.getNodesByClass("vtkMRMLSegmentationNode")}
    grid = core["common_volume_grid"]([slice_tools["transformed_bounds"](node) for node in nodes.values()], resolution)
    layout = core["atlas_layout"](grid["dimensions"])
    destination = Path(output_directory).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    metadata = {"schemaVersion": 1, "coordinateSystem": "RAS mm", "grid": grid, "atlas": layout,
                "presets": core["PRESETS"], "series": [], "imageBytes": 0,
                "defaults": {"modality": "mri", "crop": "R minimum at grid midpoint; other boundaries at full extent", "opacityMultiplier": 1, "quality": "balanced", "samples": {"balanced": 192, "fast": 96}},
                "sampling": {"interpolation": "Trilinear: bilinear alpha texels plus adjacent axial tile interpolation", "validity": "255 inside source reslice stencil, 0 outside; invalid scalar codes zero; normalize interpolated codes by interpolated validity", "opacity": "smoothstep(preset threshold,1,windowed gray)*0.65 per mm; corrected by actual ray step in mm", "cropFace": "Exact entry position, unlit windowed grayscale; alpha=(1-exp(-4*opacityMultiplier))*validity above density 0.001"},
                "provenance": {"sourceScene": Path(source_scene).name if source_scene else "Owner-loaded Slicer scene",
                 "slicerVersion": slicer.app.applicationVersion, "collection": "NLM Visible Human Project — Additional Head Images",
                 "sourceUrl": "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/",
                 "attribution": "Courtesy of the U.S. National Library of Medicine; Brigham and Women's Hospital / Harvard Medical School, Peter Ratiu and colleagues.",
                 "resampling": "VTK linear interpolation, common isotropic world RAS; parent transform applied once; registered MRI has no additional Elastix transform",
                 "usage": "Educational visualization; separate from mesh registration; original volumes remain outside Git"}}
    if source_scene:
        with open(source_scene, "rb") as stream:
            metadata["provenance"]["sourceSceneSha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        metadata["provenance"]["sourceSceneBytes"] = Path(source_scene).stat().st_size
    with tempfile.TemporaryDirectory(prefix="medical-volume-", dir=destination.parent) as temporary:
        staging = Path(temporary)
        for modality in ("mri", "ct"):
            node = nodes[modality]
            values, validity = resample_volume(node, grid)
            codes, encoding = core["encode_volume"](values, validity)
            item = {"modality": modality, "volumeName": node.GetName(), **encoding, "geometry": before[modality],
                    "originalDimensions": list(node.GetImageData().GetDimensions()), "originalSpacingMm": list(node.GetSpacing()), "atlases": {}}
            for key, channel in (("high", (codes >> 8).astype(np.uint8)), ("low", (codes & 255).astype(np.uint8)), ("validity", validity)):
                item["atlases"][key] = core["write_alpha_png"](staging/f"{modality}_{key}.png", core["pack_atlas"](channel, layout))
                metadata["imageBytes"] += item["atlases"][key]["bytes"]
            metadata["series"].append(item)
            if preview_directory:
                preview = Path(preview_directory)
                preview.mkdir(parents=True, exist_ok=True)
                reconstructed = encoding["scalarOffset"]+codes.astype(np.float64)*encoding["scalarScale"]
                for preset, settings in core["PRESETS"].items():
                    if settings["modality"] == modality:
                        reference_preview(reconstructed, validity, grid, preset, preview/f"{preset}.png")
            print(f"Exported {modality.upper()}: {grid['dimensions']}, scalar range {item['scalarRange']}", flush=True)
        if any(before[key] != slice_tools["image_fingerprint"](node) for key, node in nodes.items()):
            raise RuntimeError("Source volume changed")
        if segmentations != {node.GetID(): node.GetMTime() for node in slicer.util.getNodesByClass("vtkMRMLSegmentationNode")}:
            raise RuntimeError("Source segmentation changed")
        metadata["provenance"]["sourceNodesUnchanged"] = True
        (staging/"metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
        runpy.run_path(str(HERE/"generate_volume_manifest.py"))["generate_manifest"](staging)
        for file in staging.iterdir():
            file.replace(destination/file.name)
    return metadata

def regenerate_reference_previews(asset_directory, preview_directory):
    """Rebuild Slicer/VTK references from exactly the packaged quantized voxels."""
    generator = runpy.run_path(str(HERE/"generate_volume_manifest.py"))
    metadata = generator["validate_export"](asset_directory)
    output = Path(preview_directory)
    output.mkdir(parents=True, exist_ok=True)
    x, y, z = metadata["grid"]["dimensions"]
    layout = metadata["atlas"]
    for series in metadata["series"]:
        channels = {}
        for key, record in series["atlases"].items():
            size, _, _, alpha = generator["inspect_alpha_png"](Path(asset_directory)/record["filename"], True)
            atlas = np.frombuffer(alpha, dtype=np.uint8).reshape(size[::-1])
            values = np.empty((z, y, x), dtype=np.uint8)
            for index in range(z):
                row, col = divmod(index, layout["columns"])
                start_y, start_x = row*layout["tileDimensions"][1]+1, col*layout["tileDimensions"][0]+1
                values[index] = atlas[start_y:start_y+y, start_x:start_x+x]
            channels[key] = values
        codes = channels["high"].astype(np.uint16)*256+channels["low"]
        values = series["scalarOffset"]+codes.astype(np.float64)*series["scalarScale"]
        for preset, settings in core["PRESETS"].items():
            if settings["modality"] == series["modality"]:
                reference_preview(values, channels["validity"], metadata["grid"], preset, output/f"{preset}.png")

def headless_export(scene_path, output_directory, result_file=None, **options):
    code, result = 1, {"passed": False}
    try:
        if slicer.mrmlScene.GetNumberOfNodesByClass("vtkMRMLScalarVolumeNode"):
            raise RuntimeError("Headless export requires a fresh Slicer process")
        if not slicer.util.loadScene(str(scene_path)):
            raise RuntimeError("Scene failed to load")
        data = export_volumes(output_directory, source_scene=scene_path, **options)
        result = {"passed": True, "imageBytes": data["imageBytes"], "dimensions": data["grid"]["dimensions"], "sourceNodesUnchanged": True}
        code = 0
    except Exception:
        result["error"] = traceback.format_exc()
        traceback.print_exc()
    finally:
        if result_file:
            path = Path(result_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
        slicer.app.exit(code)
