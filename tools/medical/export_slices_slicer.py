"""Export real, radiologically oriented axial CT/MRI slices inside 3D Slicer.

Python Console: runpy.run_path(script_path)['export_slices'](output_directory)
Headless: call headless_export(scene_path, output_directory) using --python-code.
"""

import hashlib
import json
import math
from pathlib import Path
import runpy
import re
import tempfile
import traceback

import numpy as np
import slicer
import vtk
from vtk.util.numpy_support import numpy_to_vtk, vtk_to_numpy

DEFAULT_WINDOWS = {"ct": (150.0, 40.0), "mri": (5589.0, 2671.5)}
VOLUME_NAMES = {"ct": "CT Head", "mri": "MRI_Elastix"}


def matrix_values(matrix):
    return [[matrix.GetElement(row, column) for column in range(4)] for row in range(4)]


def image_fingerprint(node):
    """Hash the original voxel buffer without copying it or changing display settings."""
    values = vtk_to_numpy(node.GetImageData().GetPointData().GetScalars())
    matrix = vtk.vtkMatrix4x4()
    node.GetIJKToRASMatrix(matrix)
    chain = []
    parent = node.GetParentTransformNode()
    while parent:
        transform = parent.GetTransformToParent()
        record = {"id": parent.GetID(), "name": parent.GetName(),
                  "nodeClass": parent.GetClassName(), "transformClass": transform.GetClassName()}
        if transform.IsA("vtkLinearTransform"):
            record["matrixToParent"] = matrix_values(transform.GetMatrix())
        if hasattr(transform, "GetDisplacementGrid") and transform.GetDisplacementGrid():
            grid = transform.GetDisplacementGrid()
            data = vtk_to_numpy(grid.GetPointData().GetScalars())
            record["displacementGrid"] = {"dimensions": list(grid.GetDimensions()),
                                          "origin": list(grid.GetOrigin()), "spacing": list(grid.GetSpacing()),
                                          "sha256": hashlib.sha256(memoryview(data).cast("B")).hexdigest()}
        chain.append(record)
        parent = parent.GetParentTransformNode()
    return {
        "voxelSha256": hashlib.sha256(memoryview(values).cast("B")).hexdigest(),
        "ijkToRas": matrix_values(matrix),
        "parentTransformId": node.GetTransformNodeID(),
        "parentTransformChain": chain,
        "displayWindowLevel": [node.GetDisplayNode().GetWindow(), node.GetDisplayNode().GetLevel()],
        "autoWindowLevel": node.GetDisplayNode().GetAutoWindowLevel(),
    }


def transformed_bounds(node):
    """Sample every voxel on the six volume faces, including nonlinear acquisition corrections.

    Voxel boundary coordinates include the half-voxel margin. Unlike eight-corner
    bounds, sampling each face captures this dataset's nonlinear slice corrections.
    """
    dimensions = node.GetImageData().GetDimensions()
    axes = [np.arange(size + 1, dtype=np.float64) - 0.5 for size in dimensions]
    faces = []
    for fixed_axis in range(3):
        other = [axis for axis in range(3) if axis != fixed_axis]
        first, second = np.meshgrid(axes[other[0]], axes[other[1]], indexing="ij")
        for edge in (axes[fixed_axis][0], axes[fixed_axis][-1]):
            face = np.empty((first.size, 3))
            face[:, fixed_axis] = edge
            face[:, other[0]], face[:, other[1]] = first.ravel(), second.ravel()
            faces.append(face)
    points_array = np.concatenate(faces)
    ijk_to_ras = vtk.vtkMatrix4x4()
    node.GetIJKToRASMatrix(ijk_to_ras)
    volume_to_world = vtk.vtkGeneralTransform()
    slicer.vtkMRMLTransformNode.GetTransformBetweenNodes(node.GetParentTransformNode(), None, volume_to_world)
    transform = vtk.vtkGeneralTransform()
    transform.PostMultiply()
    transform.Concatenate(ijk_to_ras)
    transform.Concatenate(volume_to_world)
    source, result = vtk.vtkPoints(), vtk.vtkPoints()
    source.SetData(numpy_to_vtk(points_array, deep=True))
    transform.TransformPoints(source, result)
    transformed = vtk_to_numpy(result.GetData())
    if not np.isfinite(transformed).all():
        raise ValueError(f"Invalid transformed bounds: {node.GetName()}")
    minimum, maximum = transformed.min(axis=0), transformed.max(axis=0)
    return [float(value) for pair in zip(minimum, maximum) for value in pair]


def common_grid(bounds, count=80, resolution=512):
    if not 2 <= count <= 1000 or not 16 <= resolution <= 2048:
        raise ValueError("Expected 2–1000 slices and a 16–2048 pixel longest edge")
    combined = [min(item[index] for item in bounds) if index % 2 == 0
                else max(item[index] for item in bounds) for index in range(6)]
    spans = [combined[index + 1] - combined[index] for index in (0, 2, 4)]
    if not all(math.isfinite(value) and value > 0 for value in spans):
        raise ValueError("Degenerate volume bounds")
    spacing = max(spans[:2]) / (resolution - 1)
    width, height = [min(resolution, int(math.ceil(span / spacing)) + 1) for span in spans[:2]]
    # Pixel centres cover the full boundary box; shorter dimensions round outward.
    return {"boundsRasMm": combined, "imageDimensions": [width, height],
            "pixelSpacingMm": spacing,
            "positionsMm": np.linspace(combined[4], combined[5], count).tolist(),
            "pngTopLeftRasXYMm": [combined[1], combined[2] + (height - 1) * spacing],
            "pngColumnDirectionRas": [-1, 0, 0], "pngRowDirectionRas": [0, -1, 0]}


def reslice_image(node, grid, position):
    """Sample world RAS -> current parent frame -> volume IJK, exactly once."""
    world_to_volume = vtk.vtkGeneralTransform()
    slicer.vtkMRMLTransformNode.GetTransformBetweenNodes(None, node.GetParentTransformNode(), world_to_volume)
    ras_to_ijk = vtk.vtkMatrix4x4()
    node.GetRASToIJKMatrix(ras_to_ijk)
    world_to_ijk = vtk.vtkGeneralTransform()
    world_to_ijk.PostMultiply()
    world_to_ijk.Concatenate(world_to_volume)
    world_to_ijk.Concatenate(ras_to_ijk)

    # Normalize only a shallow image header copy; preserve the source voxel buffer.
    image = vtk.vtkImageData()
    image.ShallowCopy(node.GetImageData())
    image.SetOrigin(0, 0, 0)
    image.SetSpacing(1, 1, 1)
    image.SetDirectionMatrix(1, 0, 0, 0, 1, 0, 0, 0, 1)
    axes = vtk.vtkMatrix4x4()
    axes.Identity()
    axes.SetElement(0, 0, -1)  # Patient right at image left.
    axes.SetElement(0, 3, grid["boundsRasMm"][1])
    axes.SetElement(1, 3, grid["boundsRasMm"][2])
    axes.SetElement(2, 3, position)
    reslice = vtk.vtkImageReslice()
    reslice.SetInputData(image)
    reslice.SetResliceAxes(axes)
    reslice.SetResliceTransform(world_to_ijk)
    reslice.SetOutputDimensionality(2)
    reslice.SetOutputOrigin(0, 0, 0)
    reslice.SetOutputSpacing(grid["pixelSpacingMm"], grid["pixelSpacingMm"], 1)
    width, height = grid["imageDimensions"]
    reslice.SetOutputExtent(0, width - 1, 0, height - 1, 0, 0)
    reslice.SetInterpolationModeToLinear()
    reslice.SetBackgroundLevel(-32768)  # Maps outside-volume pixels to black for both modalities.
    reslice.Update()
    return reslice.GetOutput()


def grayscale_image(image, window, level):
    if not math.isfinite(window) or window <= 0 or not math.isfinite(level):
        raise ValueError("Window must be positive; window and level must be finite")
    mapper = vtk.vtkImageMapToWindowLevelColors()
    mapper.SetInputData(image)
    mapper.SetWindow(window)
    mapper.SetLevel(level)
    mapper.SetOutputFormatToLuminance()
    mapper.Update()
    result = vtk.vtkImageData()
    result.DeepCopy(mapper.GetOutput())
    return result


def export_slices(output_directory, count=80, resolution=512, windows=None, modalities=("mri", "ct"), source_scene=None):
    if not hasattr(slicer, "mrmlScene"):
        raise RuntimeError("Run this script inside 3D Slicer, not a standalone Python installation")
    if not modalities or len(set(modalities)) != len(modalities) or any(item not in VOLUME_NAMES for item in modalities):
        raise ValueError("Modalities must contain mri and/or ct, without duplicates")
    settings = {**DEFAULT_WINDOWS, **(windows or {})}
    nodes, originals = {}, {}
    # Always use both volumes for the common reference, even for an MRI-only trial.
    for modality, name in VOLUME_NAMES.items():
        try:
            node = slicer.util.getNode(name)
        except slicer.util.MRMLNodeNotFoundException as error:
            raise RuntimeError(f"Load the saved scene containing '{name}' first. Do not substitute the unregistered MRI.") from error
        if not node.IsA("vtkMRMLScalarVolumeNode") or not node.GetImageData() or node.GetImageData().GetNumberOfScalarComponents() != 1:
            raise ValueError(f"Expected a nonempty scalar volume: {name}")
        nodes[modality], originals[modality] = node, image_fingerprint(node)
    bounds = {modality: transformed_bounds(node) for modality, node in nodes.items()}
    grid = common_grid(list(bounds.values()), count, resolution)
    destination = Path(output_directory).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    # Finish and validate a staging dataset before replacing packaged output files.
    with tempfile.TemporaryDirectory(prefix="medical-export-", dir=destination.parent) as temporary:
        staging = Path(temporary)
        metadata = {"schemaVersion": 1, "coordinateSystem": "RAS mm", "grid": grid,
                    "provenance": {"collection": "NLM Visible Human Project — Additional Head Images",
                                   "sourceUrl": "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/",
                                   "attribution": "Courtesy of the U.S. National Library of Medicine; Brigham and Women's Hospital / Harvard Medical School, Peter Ratiu and colleagues.",
                                   "sourceScene": Path(source_scene).name if source_scene else "Owner-loaded Slicer scene",
                                   "slicerVersion": slicer.app.applicationVersion,
                                   "usage": "Educational visualization; panel is not registered to the packaged meshes."},
                    "series": [], "imageBytes": 0}
        if source_scene:
            with open(source_scene, "rb") as scene_file:
                metadata["provenance"]["sourceSceneSha256"] = hashlib.file_digest(scene_file, "sha256").hexdigest()
            metadata["provenance"]["sourceSceneBytes"] = Path(source_scene).stat().st_size
        for modality in modalities:
            node = nodes[modality]
            window, level = settings[modality]
            item = {"modality": modality, "orientation": "axial", "volumeName": node.GetName(),
                    "imageCount": count, "imageDimensions": grid["imageDimensions"],
                    "originalDimensions": list(node.GetImageData().GetDimensions()),
                    "originalVoxelSpacingMm": list(node.GetSpacing()), "geometry": originals[modality],
                    "worldBoundsRasMm": bounds[modality], "window": window, "level": level,
                    "resampling": "Linear interpolation on common world-RAS axial planes; current parent transform sampled once; no additional registration transform.",
                    "slices": [], "bytes": 0}
            for index, position in enumerate(grid["positionsMm"]):
                filename = f"{modality}_axial_{index:03d}.png"
                writer = vtk.vtkPNGWriter()
                writer.SetFileName(str(staging / filename))
                writer.SetCompressionLevel(9)
                writer.SetInputData(grayscale_image(reslice_image(node, grid, position), window, level))
                writer.Write()
                if writer.GetErrorCode():
                    raise RuntimeError(f"PNG export failed: {filename}")
                data = (staging / filename).read_bytes()
                item["slices"].append({"filename": filename, "positionMm": position,
                                       "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
                item["bytes"] += len(data)
                if index % 20 == 0:
                    print(f"{modality.upper()}: {index + 1}/{count}", flush=True)
            metadata["series"].append(item)
            metadata["imageBytes"] += item["bytes"]
        for modality, node in nodes.items():
            if originals[modality] != image_fingerprint(node):
                raise RuntimeError(f"Source volume changed during export: {node.GetName()}")
        (staging / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        generator = runpy.run_path(str(Path(__file__).with_name("generate_slice_manifest.py")))
        generator["generate_manifest"](staging)
        keep = {path.name for path in staging.iterdir()}
        for path in staging.iterdir():
            path.replace(destination / path.name)
        # Remove only obsolete PNGs owned by this exporter, never source volumes.
        for path in destination.iterdir():
            if path.name not in keep and re.fullmatch(r"(?:ct|mri)_axial_\d{3,}\.png", path.name):
                path.unlink()
    print(f"Export complete: {metadata['imageBytes']} PNG bytes in {destination}", flush=True)
    return metadata


def headless_export(scene_path, output_directory, result_file=None, **options):
    """Dedicated-process entrypoint; reports failures through the process exit code."""
    code = 1
    report = {"passed": False}
    try:
        if slicer.mrmlScene.GetNumberOfNodesByClass("vtkMRMLScalarVolumeNode"):
            raise RuntimeError("Headless export requires a fresh Slicer process")
        if not slicer.util.loadScene(str(scene_path)):
            raise RuntimeError(f"Could not load saved scene: {scene_path}")
        metadata = export_slices(output_directory, source_scene=scene_path, **options)
        report = {"passed": True, "imageBytes": metadata["imageBytes"],
                  "imageCount": sum(series["imageCount"] for series in metadata["series"]),
                  "sourceVolumesUnchanged": True}
        code = 0
    except Exception:
        report["error"] = traceback.format_exc()
        traceback.print_exc()
    finally:
        if result_file:
            path = Path(result_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        slicer.app.exit(code)
