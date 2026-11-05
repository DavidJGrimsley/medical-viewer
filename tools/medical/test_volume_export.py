"""Run in isolated Slicer: real 3D resampling plus alpha atlas/manifest failure fixtures."""
import copy
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
import numpy as np
import slicer
import vtk
from vtk.util.numpy_support import numpy_to_vtk

HERE = Path(__file__).parent
exporter = runpy.run_path(str(HERE/"export_volume_slicer.py"))
core = runpy.run_path(str(HERE/"volume_export_core.py"))
manifest = runpy.run_path(str(HERE/"generate_volume_manifest.py"))
slice_tests = runpy.run_path(str(HERE/"test_slicer_export.py"))
SpatialExportTests = slice_tests["SpatialExportTests"]

class VolumeSpatialTests(unittest.TestCase):
    setUp = SpatialExportTests.setUp
    tearDown = SpatialExportTests.tearDown

    def sample(self, bounds):
        before = exporter["slice_tools"]["image_fingerprint"](self.volume)
        values, validity = exporter["resample_volume"](self.volume, {"boundsRasMm": bounds, "spacingMm": 1, "dimensions": [3, 3, 3]})
        self.assertEqual(before, exporter["slice_tools"]["image_fingerprint"](self.volume))
        return values, validity

    def test_asymmetric_world_ras_and_validity(self):
        values, validity = self.sample([-1, 1, -1, 1, -1, 1])
        z, y, x = np.indices((3, 3, 3))
        np.testing.assert_array_equal(values, (x+2)+10*(y+1)+100*z)
        self.assertTrue(np.all(validity == 255))
        _, outside = self.sample([-8, -6, -1, 1, -1, 1])
        self.assertTrue(np.all(outside == 0))

    def test_oblique_ijk_is_resampled_into_ras(self):
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
        values, _ = self.sample([0, 2, 0, 2, -1, 1])
        z, y, x = np.indices((3, 3, 3))
        np.testing.assert_allclose(values, y+3+10*(3-x)+100*z)

    def test_parent_acquisition_correction_applied_once(self):
        displacement = vtk.vtkImageData()
        displacement.SetDimensions(3, 3, 3)
        displacement.SetOrigin(-4, -4, -4)
        displacement.SetSpacing(4, 4, 4)
        _, _, x = np.indices((3, 3, 3))
        displacement.GetPointData().SetScalars(numpy_to_vtk(np.column_stack((np.full(27, 2.), np.full(27, -1.), .04*np.abs(x.ravel()*4-4))), deep=True))
        transform = vtk.vtkGridTransform()
        transform.SetDisplacementGridData(displacement)
        transform.SetInterpolationModeToLinear()
        parent = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLTransformNode")
        self.nodes.append(parent)
        parent.SetAndObserveTransformToParent(transform)
        self.volume.SetAndObserveTransformNodeID(parent.GetID())
        values, _ = self.sample([0, 2, -1, 1, 0, 2])
        np.testing.assert_allclose(values[0], [[113, 118, 123], [123, 128, 133], [133, 138, 143]], atol=.002)

    def test_baked_mri_registration_is_not_reattached(self):
        parent = slicer.mrmlScene.AddNewNodeByClass("vtkMRMLLinearTransformNode", "MRI_Elastix_Transform")
        self.nodes.append(parent)
        matrix = vtk.vtkMatrix4x4()
        matrix.Identity()
        matrix.SetElement(0, 3, 100)
        parent.SetMatrixTransformToParent(matrix)
        self.volume.SetName("MRI_Elastix")
        values, _ = self.sample([-1, 1, -1, 1, -1, 1])
        self.assertEqual(values[1, 1, 1], 123)
        self.assertIsNone(self.volume.GetParentTransformNode())

class PackingTests(unittest.TestCase):
    def test_grid_preserves_proportions_and_covers_union(self):
        grid = core["common_volume_grid"]([[0, 10, 0, 6, 0, 2], [-2, 9, -1, 5, -1, 3]], 160)
        self.assertEqual(max(grid["dimensions"]), 160)
        for axis in range(3):
            self.assertGreaterEqual(grid["boundsRasMm"][2*axis+1], [10, 6, 3][axis])
            self.assertAlmostEqual(grid["boundsRasMm"][2*axis+1]-grid["boundsRasMm"][2*axis], (grid["dimensions"][axis]-1)*grid["spacingMm"])
        with self.assertRaises(ValueError):
            core["atlas_layout"]([500, 500, 500])

    def fixture(self, directory):
        z, y, x = np.indices((4, 5, 7))
        values = -100.2+x*2.13+y*20.01+z*300.37
        validity = np.full(values.shape, 255, dtype=np.uint8)
        validity[0, 0, 0] = 0
        codes, encoding = core["encode_volume"](values, validity)
        self.assertEqual(codes[0, 0, 0], 0)
        self.assertLessEqual(encoding["quantizationMaxError"], encoding["quantizationErrorBound"]+1e-10)
        layout = core["atlas_layout"]([7, 5, 4])
        records = {}
        for key, pixels in (("high", codes >> 8), ("low", codes & 255), ("validity", validity)):
            atlas = core["pack_atlas"](pixels.astype(np.uint8), layout)
            records[key] = core["write_alpha_png"](directory/f"mri_{key}.png", atlas)
            size, _, _, alpha = manifest["inspect_alpha_png"](directory/f"mri_{key}.png", True)
            np.testing.assert_array_equal(np.frombuffer(alpha, dtype=np.uint8).reshape(size[::-1]), atlas)
        data = {"schemaVersion": 1, "coordinateSystem": "RAS mm", "grid": {"dimensions": [7, 5, 4], "boundsRasMm": [0, 6, 0, 4, 0, 3], "spacingMm": 1}, "atlas": layout,
                "series": [{"modality": "mri", **encoding, "atlases": records}], "imageBytes": sum(r["bytes"] for r in records.values())}
        (directory/"metadata.json").write_text(json.dumps(data), encoding="utf-8")
        return data

    def test_alpha_bytes_orientation_gutters_and_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            data = self.fixture(directory)
            manifest["generate_manifest"](directory)
            self.assertEqual(manifest["validate_export"](directory), data)
            self.assertIn("require('./mri_validity.png')", (directory/"sources.native.ts").read_text())

    def test_manifest_rejects_geometry_hash_count_and_missing_atlas(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            original = self.fixture(directory)
            for mutate in (
                lambda d: d["grid"].update(spacingMm=2),
                lambda d: d["grid"]["boundsRasMm"].__setitem__(0, float('nan')),
                lambda d: d["series"].append(copy.deepcopy(d["series"][0])),
                lambda d: d["series"][0].update(quantizationMaxError=9),
                lambda d: d["series"][0].update(validVoxelCount=1),
                lambda d: d["series"][0]["atlases"]["high"].update(sha256="0"*64),
                lambda d: d["atlas"].update(gutter=0),
                lambda d: d.update(imageBytes=1),
            ):
                data = copy.deepcopy(original)
                mutate(data)
                (directory/"metadata.json").write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    manifest["validate_export"](directory)
            (directory/"metadata.json").write_text(json.dumps(original), encoding="utf-8")
            (directory/"mri_low.png").unlink()
            with self.assertRaises(FileNotFoundError):
                manifest["validate_export"](directory)

    def test_rejects_corrupt_pixels_and_invalid_validity(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.fixture(directory)
            png = directory/"mri_high.png"
            raw = bytearray(png.read_bytes())
            raw[-8] ^= 1
            png.write_bytes(raw)
            with self.assertRaises(ValueError):
                manifest["inspect_alpha_png"](png)
        layout = core["atlas_layout"]([7, 5, 4])
        atlas = core["pack_atlas"](np.full((4, 5, 7), 255, dtype=np.uint8), layout)
        atlas[2, 0] = 0
        with self.assertRaises(ValueError):
            manifest["validate_pixels"](atlas.tobytes(), [7, 5, 4], layout)
        atlas[2, 0] = 254
        with self.assertRaises(ValueError):
            manifest["validate_pixels"](atlas.tobytes(), [7, 5, 4], layout, True)

def run_tests(result_file):
    stream = io.StringIO()
    code = 1
    try:
        suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in (SpatialExportTests, VolumeSpatialTests, PackingTests))
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
        code = 0 if result.wasSuccessful() else 1
        path = Path(result_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"passed": result.wasSuccessful(), "testsRun": result.testsRun, "output": stream.getvalue()}, indent=2)+"\n", encoding="utf-8")
        print(stream.getvalue(), flush=True)
    finally:
        slicer.app.exit(code)
