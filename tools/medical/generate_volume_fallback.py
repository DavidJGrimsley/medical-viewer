"""Generate transparent axial planes and known texel probes from validated scan atlases.

No Slicer input is loaded or changed. Window/level is baked per preset for this fallback.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib
import numpy as np
from generate_volume_manifest import inspect_alpha_png, validate_export
from volume_export_core import PRESETS, transfer_function


def write_rgba(path, rgba):
    height, width, _ = rgba.shape
    rows = np.zeros((height, width * 4 + 1), dtype=np.uint8)
    rows[:, 1:] = rgba.reshape(height, width * 4)
    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(rows.tobytes(), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    return {"filename": path.name, "bytes": len(png), "sha256": hashlib.sha256(png).hexdigest()}


def unpack(alpha, dimensions, atlas):
    width, height = atlas["dimensions"]
    tiled = np.frombuffer(alpha, np.uint8).reshape(height, width)
    tx, ty = atlas["tileDimensions"]
    x, y, z = dimensions
    return np.stack([tiled[(i // atlas["columns"]) * ty + 1:(i // atlas["columns"]) * ty + 1 + y,
                           (i % atlas["columns"]) * tx + 1:(i % atlas["columns"]) * tx + 1 + x] for i in range(z)])


def generate(source, destination, count=48):
    if not 8 <= count <= 64:
        raise ValueError("Plane count must be 8..64")
    data = validate_export(source)
    dimensions, atlas = data["grid"]["dimensions"], data["atlas"]
    indices = np.unique(np.rint(np.linspace(0, dimensions[2] - 1, count)).astype(int))
    destination.mkdir(parents=True, exist_ok=True)
    output = {"schemaVersion": 1, "kind": "stacked-slice visualization", "grid": data["grid"],
              "sourceMetadataSha256": hashlib.sha256((source / "metadata.json").read_bytes()).hexdigest(),
              "mapping": "PNG columns +R, rows +A, planes +S; Viro XYZ=R,S,-A; quad UV=(rMin,aMax,rMax,aMin)",
              "appearance": "Preset grayscale with opacity baked from real scalar density; zero alpha for air/invalid data; alpha capped at 0.40 per plane",
              "presets": {}, "probes": {}, "totalBytes": 0}
    for series in data["series"]:
        arrays = {key: unpack(inspect_alpha_png(source / image["filename"], True)[3], dimensions, atlas)
                  for key, image in series["atlases"].items()}
        codes = arrays["high"].astype(np.uint16) * 256 + arrays["low"].astype(np.uint16)
        values = series["scalarOffset"] + codes.astype(float) * series["scalarScale"]
        valid = arrays["validity"] > 0
        # Select a fully valid, nonempty texel with distinct bytes, independent of the shader.
        candidates = np.argwhere(valid & (arrays["high"] > 32) & (arrays["high"] < 220)
                                  & (arrays["low"] > 24) & (arrays["low"] < 230)
                                  & (np.abs(arrays["high"].astype(int) - arrays["low"].astype(int)) > 40))
        if not len(candidates):
            raise ValueError("No useful asymmetric diagnostic texel")
        z, y, x = (int(i) for i in candidates[len(candidates) // 2])
        texel = [(z % atlas["columns"]) * atlas["tileDimensions"][0] + 1 + x,
                 (z // atlas["columns"]) * atlas["tileDimensions"][1] + 1 + y]
        ez, ey, ex = (int(i) for i in np.argwhere(~valid)[0])
        empty_texel = [(ez % atlas["columns"]) * atlas["tileDimensions"][0] + 1 + ex,
                       (ez // atlas["columns"]) * atlas["tileDimensions"][1] + 1 + ey]
        output["probes"][series["modality"]] = {
            "ijk": [x, y, z], "uv": [(texel[0] + .5) / atlas["dimensions"][0], (texel[1] + .5) / atlas["dimensions"][1]],
            "alphaBytes": {key: int(array[z, y, x]) for key, array in arrays.items()},
            "scalar": float(values[z, y, x]),
            "emptyUV": [(empty_texel[0] + .5) / atlas["dimensions"][0], (empty_texel[1] + .5) / atlas["dimensions"][1]]}
        for preset, config in PRESETS.items():
            if config["modality"] != series["modality"]:
                continue
            planes = []
            for z in indices:
                gray, density = transfer_function(values[z], preset)
                alpha = np.minimum(.40, density * .70) * valid[z]
                rgba = np.empty((dimensions[1], dimensions[0], 4), dtype=np.uint8)
                rgba[:, :, :3] = np.rint(gray[:, :, None] * 255).astype(np.uint8)
                rgba[:, :, 3] = np.rint(alpha * 255).astype(np.uint8)
                rgba[rgba[:, :, 3] == 0, :3] = 0
                image = write_rgba(destination / f"{preset}_{int(z):03d}.png", rgba)
                image.update({"ijkZ": int(z), "positionRasMm": data["grid"]["boundsRasMm"][4] + int(z) * data["grid"]["spacingMm"]})
                output["totalBytes"] += image["bytes"]
                planes.append(image)
            output["presets"][preset] = {"modality": series["modality"], "window": config["window"], "level": config["level"], "planes": planes}
    (destination / "metadata.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    lines = ["// Generated by tools/medical/generate_volume_fallback.py. Do not hand-edit.",
             "export const MEDICAL_STACK_SOURCES = {"]
    for preset, item in output["presets"].items():
        lines += [f"  '{preset}': ["] + [f"    require('./{plane['filename']}')," for plane in item["planes"]] + ["  ],"]
    lines += ["} as const;", ""]
    (destination / "sources.native.ts").write_text("\n".join(lines), encoding="utf-8")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("assets/medical/volumes"))
    parser.add_argument("--output", type=Path, default=Path("assets/medical/stack"))
    parser.add_argument("--count", type=int, default=48)
    args = parser.parse_args()
    result = generate(args.source, args.output, args.count)
    print(json.dumps({"planesPerPreset": len(next(iter(result["presets"].values()))["planes"]),
                      "totalBytes": result["totalBytes"], "probes": result["probes"]}, indent=2))
