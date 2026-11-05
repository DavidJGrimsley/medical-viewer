"""Validate manifest failure cases using tiny test-only PNG fixtures (stdlib only)."""

import copy
import hashlib
import json
from pathlib import Path
import runpy
import struct
import tempfile
import unittest
import zlib

generator = runpy.run_path(str(Path(__file__).with_name("generate_slice_manifest.py")))


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 1, 8, 0, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(b"\x00\x10\x80")) + chunk(b"IEND", b""))
        self.images = []
        for index in range(2):
            filename = f"mri_axial_{index:03d}.png"
            (self.directory / filename).write_bytes(png)
            self.images.append({"filename": filename, "positionMm": float(index), "bytes": len(png), "sha256": hashlib.sha256(png).hexdigest()})
        self.metadata = {"schemaVersion": 1, "coordinateSystem": "RAS mm", "imageBytes": len(png) * 2,
                         "series": [{"modality": "mri", "orientation": "axial", "imageCount": 2,
                                     "imageDimensions": [2, 1], "slices": self.images, "bytes": len(png) * 2}]}
        self.write_metadata()

    def tearDown(self):
        self.temporary.cleanup()

    def write_metadata(self, metadata=None):
        (self.directory / "metadata.json").write_text(json.dumps(metadata or self.metadata), encoding="utf-8")

    def test_complete_dataset_generates_static_metro_references(self):
        generator["generate_manifest"](self.directory)
        source = (self.directory / "sources.native.ts").read_text()
        self.assertIn("require('./mri_axial_000.png')", source)
        self.assertIn("require('./mri_axial_001.png')", source)
        self.assertIn("'mri:axial'", source)
        self.assertNotIn(b"\r\n", (self.directory / "sources.native.ts").read_bytes())

    def test_missing_image_does_not_replace_previous_manifest(self):
        generator["generate_manifest"](self.directory)
        original = (self.directory / "sources.native.ts").read_bytes()
        (self.directory / "mri_axial_001.png").unlink()
        with self.assertRaises(FileNotFoundError):
            generator["generate_manifest"](self.directory)
        self.assertEqual(original, (self.directory / "sources.native.ts").read_bytes())

    def test_invalid_metadata_is_rejected(self):
        for mutation in ("count", "filename", "position", "duplicate", "dimensions", "bytes", "hash", "version"):
            data = copy.deepcopy(self.metadata)
            item = data["series"][0]
            if mutation == "count":
                item["imageCount"] += 1
            elif mutation == "filename":
                item["slices"][0]["filename"] = "../unsafe.png"
            elif mutation == "position":
                item["slices"][1]["positionMm"] = 0
            elif mutation == "duplicate":
                data["series"].append(copy.deepcopy(item))
            elif mutation == "dimensions":
                item["imageDimensions"] = [3, 1]
            elif mutation == "bytes":
                data["imageBytes"] += 1
            elif mutation == "hash":
                item["slices"][0]["sha256"] = "incorrect"
            else:
                data["schemaVersion"] = 0
            self.write_metadata(data)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                generator["generate_manifest"](self.directory)

    def test_corrupted_png_is_rejected(self):
        path = self.directory / "mri_axial_000.png"
        data = bytearray(path.read_bytes())
        data[40] ^= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            generator["generate_manifest"](self.directory)


if __name__ == "__main__":
    unittest.main(verbosity=2)
