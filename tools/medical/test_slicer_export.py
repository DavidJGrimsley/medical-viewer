"""Meaningful spatial/orientation tests; run inside a dedicated Slicer process."""

import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
import zlib
import struct

import numpy as np
import slicer
import vtk
from vtk.util.numpy_support import vtk_to_numpy, numpy_to_vtk

exporter = runpy.run_path(str(Path(__file__).with_name("export_slices_slicer.py")))
generator = runpy.run_path(str(Path(__file__).with_name("generate_slice_manifest.py")))


def png_pixels(path):
    """Decode noninterlaced grayscale PNG in file row order, independent of VTK."""
    data, offset, compressed = path.read_bytes(), 8, bytearray()
    width, height = struct.unpack(">II", data[16:24])
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b"IDAT":
            compressed.extend(data[offset + 8:offset + 8 + length])
        offset += length + 12
    raw = zlib.decompress(compressed)
    rows, previous = [], [0] * width
    for y in range(height):
        start = y * (width + 1)
        filtering, row = raw[start], list(raw[start + 1:start + 1 + width])
        for x in range(width):
            left, up, diagonal = row[x - 1] if x else 0, previous[x], previous[x - 1] if x else 0
            if filtering == 1:
                predictor = left
            elif filtering == 2:
                predictor = up
            elif filtering == 3:
                predictor = (left + up) // 2
            elif filtering == 4:
                p = left + up - diagonal
                a, b, c = abs(p - left), abs(p - up), abs(p - diagonal)
                predictor = left if a <= b and a <= c else up if b <= c else diagonal
            else:
                predictor = 0
            row[x] = (row[x] + predictor) % 256
        rows.append(row)
        previous = row
    return np.asarray(rows)


class SpatialExportTests(unittest.TestCase):
    def setUp(self):
        self.nodes = []
        self.volume = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLScalarVolumeNode", "Asymmetric fixture")
        self.nodes.append(self.volume)
        z, y, x = np.indices((4, 5, 7))
        slicer.util.updateVolumeFromArray(self.volume, (x + 10 * y + 100 * z).astype(np.float64))
        self.volume.SetOrigin(-3, -2, -1)
        self.volume.SetSpacing(1, 1, 1)
        self.volume.CreateDefaultDisplayNodes()

    def tearDown(self):
        for node in reversed(self.nodes):
            slicer.mrmlScene.RemoveNode(node)

    def sample(self, bounds):
        grid = {"boundsRasMm": bounds, "pixelSpacingMm": 1, "imageDimensions": [3, 3]}
        image = exporter["reslice_image"](self.volume, grid, 0)
        return image, vtk_to_numpy(image.GetPointData().GetScalars()).reshape(3, 3)

    def test_axis_geometry_and_png_anatomical_orientation(self):
        original = exporter["image_fingerprint"](self.volume)
        image, pixels = self.sample([-1, 1, -1, 1, 0, 0])
        np.testing.assert_allclose(pixels, [[114, 113, 112], [124, 123, 122], [134, 133, 132]])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.png"
            writer = vtk.vtkPNGWriter()
            writer.SetFileName(str(path))
            writer.SetInputData(exporter["grayscale_image"](image, 255, 127.5))
            writer.Write()
            expected = np.flipud(pixels)
            np.testing.assert_allclose(png_pixels(path), expected, atol=1)
            self.assertEqual(generator["inspect_png"](path)[0], (3, 3))
        self.assertEqual(original, exporter["image_fingerprint"](self.volume))

    def test_oblique_ijk_axes_are_reformatted_in_world_ras(self):
        matrix = vtk.vtkMatrix4x4()
        matrix.Identity()
        matrix.SetElement(0, 0, 0)
        matrix.SetElement(0, 1, -1)
        matrix.SetElement(1, 0, 1)
        matrix.SetElement(1, 1, 0)
        matrix.SetElement(0, 3, 3)
        matrix.SetElement(1, 3, -3)
        matrix.SetElement(2, 3, -1)
        self.volume.SetIJKToRASMatrix(matrix)
        _, pixels = self.sample([0, 2, 0, 2, 0, 0])
        np.testing.assert_allclose(pixels, [[113, 123, 133], [114, 124, 134], [115, 125, 135]])

    def test_linear_parent_registration_is_applied_once(self):
        parent = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLLinearTransformNode")
        self.nodes.append(parent)
        matrix = vtk.vtkMatrix4x4()
        matrix.Identity()
        matrix.SetElement(0, 3, 2)
        matrix.SetElement(1, 3, -1)
        parent.SetMatrixTransformToParent(matrix)
        self.volume.SetAndObserveTransformNodeID(parent.GetID())
        original = exporter["image_fingerprint"](self.volume)
        _, pixels = self.sample([0, 2, -1, 1, 0, 0])
        np.testing.assert_allclose(pixels, [[123, 122, 121], [133, 132, 131], [143, 142, 141]])
        self.assertEqual(original, exporter["image_fingerprint"](self.volume))
        np.testing.assert_allclose(exporter["transformed_bounds"](self.volume), [-1.5, 5.5, -3.5, 1.5, -1.5, 2.5])

    def test_nonlinear_grid_parent_is_supported(self):
        displacement = vtk.vtkImageData()
        displacement.SetDimensions(3, 3, 3)
        displacement.SetOrigin(-4, -4, -4)
        displacement.SetSpacing(4, 4, 4)
        _, _, grid_x = np.indices((3, 3, 3))
        values = np.column_stack((np.full(27, 2.0), np.full(27, -1.0), 0.04 * np.abs(grid_x.ravel() * 4 - 4)))
        displacement.GetPointData().SetScalars(numpy_to_vtk(values, deep=True))
        transform = vtk.vtkGridTransform()
        transform.SetDisplacementGridData(displacement)
        transform.SetInterpolationModeToLinear()
        parent = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLTransformNode")
        self.nodes.append(parent)
        parent.SetAndObserveTransformToParent(transform)
        self.volume.SetAndObserveTransformNodeID(parent.GetID())
        _, pixels = self.sample([0, 2, -1, 1, 0, 0])
        # Nonlinear Z displacement varies with X; it is inverted before sampling.
        np.testing.assert_allclose(pixels, [[123, 118, 113], [133, 128, 123], [143, 138, 133]], atol=0.002)

    def test_common_grid_covers_union_with_square_pixels(self):
        grid = exporter["common_grid"]([[-1, 3, -2, 2, 0, 4], [-2, 2, -3, 1, -1, 3]], 80, 512)
        self.assertEqual(grid["boundsRasMm"], [-2, 3, -3, 2, -1, 4])
        self.assertEqual(grid["imageDimensions"], [512, 512])
        self.assertEqual(len(grid["positionsMm"]), 80)
        self.assertAlmostEqual(grid["pixelSpacingMm"], 5 / 511)
        self.assertEqual(grid["pngColumnDirectionRas"], [-1, 0, 0])
        self.assertEqual(grid["pngRowDirectionRas"], [0, -1, 0])

    def test_window_level_is_fixed_and_invalid_values_fail(self):
        image, _ = self.sample([-1, 1, -1, 1, 0, 0])
        a = vtk_to_numpy(exporter["grayscale_image"](image, 150, 40).GetPointData().GetScalars()).copy()
        b = vtk_to_numpy(exporter["grayscale_image"](image, 150, 40).GetPointData().GetScalars()).copy()
        np.testing.assert_array_equal(a, b)
        with self.assertRaises(ValueError):
            exporter["grayscale_image"](image, 0, 40)


def run_tests(result_file):
    stream = io.StringIO()
    code = 1
    try:
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SpatialExportTests))
        code = 0 if result.wasSuccessful() else 1
        path = Path(result_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"passed": result.wasSuccessful(), "testsRun": result.testsRun, "output": stream.getvalue()}, indent=2) + "\n", encoding="utf-8")
        print(stream.getvalue(), flush=True)
    finally:
        slicer.app.exit(code)
