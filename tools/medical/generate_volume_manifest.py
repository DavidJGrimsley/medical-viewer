"""Validate packaged atlas geometry, CRCs, alpha encoding, and provenance before codegen."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import zlib

def inspect_alpha_png(path, include_alpha=False):
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Invalid PNG signature")
    position, compressed, size, ended = 8, bytearray(), None, False
    while position < len(data):
        length = struct.unpack(">I", data[position:position+4])[0]
        tag = data[position+4:position+8]
        payload = data[position+8:position+8+length]
        crc = data[position+8+length:position+12+length]
        if len(crc) != 4 or zlib.crc32(tag+payload) != struct.unpack(">I", crc)[0]:
            raise ValueError("Invalid PNG CRC")
        if tag == b"IHDR":
            if position != 8 or size is not None or length != 13:
                raise ValueError("Invalid PNG header")
            width, height, *format_fields = struct.unpack(">IIBBBBB", payload)
            if format_fields != [8, 6, 0, 0, 0] or min(width, height) < 1 or max(width, height) > 4096:
                raise ValueError("Expected non-interlaced RGBA8 atlas")
            size = [width, height]
        elif tag == b"IDAT":
            compressed.extend(payload)
        elif tag == b"IEND":
            ended = True
            position += length+12
            break
        position += length+12
    if not ended or position != len(data) or size is None:
        raise ValueError("Incomplete PNG")
    raw = zlib.decompress(compressed)
    stride = size[0]*4+1
    if len(raw) != stride*size[1] or any(raw[y*stride] != 0 for y in range(size[1])):
        raise ValueError("Invalid atlas pixels")
    rgba = b"".join(raw[row*stride+1:(row+1)*stride] for row in range(size[1]))
    if any(channel != bytes([255])*(size[0]*size[1]) for channel in (rgba[0::4], rgba[1::4], rgba[2::4])):
        raise ValueError("Atlas RGB must remain white; numeric data belongs in alpha")
    result = size, len(data), hashlib.sha256(data).hexdigest()
    return (*result, rgba[3::4]) if include_alpha else result

def validate_pixels(alpha, dims, atlas, validity=False):
    width, _ = atlas["dimensions"]
    tile_x, tile_y = atlas["tileDimensions"]
    valid_count = 0
    if validity and not set(alpha).issubset({0, 255}):
        raise ValueError("Validity must be binary")
    for z in range(dims[2]):
        row, col = divmod(z, atlas["columns"])
        rows = [alpha[(row*tile_y+y)*width+col*tile_x:(row*tile_y+y)*width+(col+1)*tile_x] for y in range(tile_y)]
        if rows[0] != rows[1] or rows[-1] != rows[-2] or any(r[0] != r[1] or r[-1] != r[-2] for r in rows):
            raise ValueError("Atlas gutter does not repeat edge voxels")
        if validity:
            valid_count += sum(r[1:-1].count(255) for r in rows[1:-1])
    return valid_count

def validate_export(directory):
    directory = Path(directory)
    data = json.loads((directory/"metadata.json").read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 1 or data.get("coordinateSystem") != "RAS mm":
        raise ValueError("Unsupported volume metadata")
    grid, atlas = data["grid"], data["atlas"]
    dims, bounds, spacing = grid["dimensions"], grid["boundsRasMm"], grid["spacingMm"]
    if len(dims) != 3 or any(type(x) is not int or not 2 <= x <= 256 for x in dims) or len(bounds) != 6 or not all(math.isfinite(x) for x in bounds) or not math.isfinite(spacing) or spacing <= 0:
        raise ValueError("Invalid volume grid")
    for axis in range(3):
        if abs(bounds[2*axis+1]-bounds[2*axis]-(dims[axis]-1)*spacing) > 0.001:
            raise ValueError("Grid extent/spacing mismatch")
    tile = [dims[0]+2, dims[1]+2]
    columns = atlas["columns"]
    if type(columns) is not int or columns < 1 or atlas["gutter"] != 1 or atlas["tileDimensions"] != tile or atlas["dimensions"] != [columns*tile[0], math.ceil(dims[2]/columns)*tile[1]]:
        raise ValueError("Invalid atlas layout")
    seen, total = set(), 0
    for series in data["series"]:
        modality = series["modality"]
        lo, hi = series["scalarRange"]
        if modality not in ("ct", "mri") or modality in seen or not all(math.isfinite(x) for x in (lo, hi, series["scalarScale"], series["scalarOffset"])) or hi <= lo or series["scalarScale"] <= 0:
            raise ValueError("Invalid volume series")
        if abs(series["scalarOffset"]-lo) > 1e-6 or abs(series["scalarScale"]*65535-(hi-lo)) > 1e-6 or not math.isfinite(series["quantizationMaxError"]) or not 0 <= series["quantizationMaxError"] <= series["scalarScale"]/2+1e-6 or abs(series["quantizationErrorBound"]-series["scalarScale"]/2) > 1e-6:
            raise ValueError("Invalid scalar encoding or quantization error")
        seen.add(modality)
        for key in ("high", "low", "validity"):
            record = series["atlases"][key]
            filename = f"{modality}_{key}.png"
            if record["filename"] != filename:
                raise ValueError("Invalid atlas filename")
            size, count, digest, alpha = inspect_alpha_png(directory/filename, include_alpha=True)
            if size != atlas["dimensions"] or record["bytes"] != count or record["sha256"] != digest:
                raise ValueError("Atlas dimensions/hash/byte count mismatch")
            valid_count = validate_pixels(alpha, dims, atlas, key == "validity")
            if key == "validity" and valid_count != series["validVoxelCount"]:
                raise ValueError("Validity voxel count mismatch")
            total += count
    if not seen or total != data["imageBytes"]:
        raise ValueError("Invalid volume count/byte total")
    return data

def generate_manifest(directory):
    directory = Path(directory)
    data = validate_export(directory)
    lines = ["// Generated by tools/medical/generate_volume_manifest.py; do not edit.", "export const MEDICAL_VOLUME_SOURCES = {"]
    for series in data["series"]:
        lines.append(f"  {series['modality']}: {{")
        for key in ("high", "low", "validity"):
            lines.append(f"    {key}: require('./{series['atlases'][key]['filename']}'),")
        lines.append("  },")
    lines += ["} as const;", ""]
    (directory/"sources.native.ts").write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return data

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    print(f"Validated {len(generate_manifest(parser.parse_args().directory)['series'])} volume series")
