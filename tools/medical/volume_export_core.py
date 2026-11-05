"""Volume grid, loss-bounded scalar packing, and PNG atlases; no Slicer scene mutations."""
import hashlib
import math
from pathlib import Path
import struct
import zlib
import numpy as np

PRESETS = {
    "mri-grayscale": {"modality": "mri", "window": 5589.0, "level": 2671.5, "threshold": 0.1},
    "ct-bone": {"modality": "ct", "window": 1800.0, "level": 400.0, "threshold": 0.4},
    "ct-soft-tissue": {"modality": "ct", "window": 150.0, "level": 40.0, "threshold": 0.1},
}

def common_volume_grid(bounds, resolution=160):
    if not isinstance(resolution, int) or not 16 <= resolution <= 256:
        raise ValueError("Resolution must be an integer from 16 to 256")
    combined = [min(x[i] for x in bounds) if i % 2 == 0 else max(x[i] for x in bounds) for i in range(6)]
    spans = [combined[i+1]-combined[i] for i in (0, 2, 4)]
    if not all(math.isfinite(x) and x > 0 for x in spans):
        raise ValueError("Degenerate volume bounds")
    spacing = max(spans)/(resolution-1)
    dimensions = [min(resolution, math.ceil(x/spacing - 1e-8)+1) for x in spans]
    for axis in range(3):
        combined[2*axis+1] = combined[2*axis] + (dimensions[axis]-1)*spacing
    return {"boundsRasMm": combined, "dimensions": dimensions, "spacingMm": spacing,
            "sampleOrder": "Array Z,Y,X = increasing S,A,R; PNG rows retain array Y order",
            "rasToViro": "X=R, Y=S, Z=-A; centred at common-grid midpoint"}

def atlas_layout(dimensions):
    x, y, z = dimensions
    columns = math.ceil(math.sqrt(z))
    tile = [x+2, y+2]
    size = [columns*tile[0], math.ceil(z/columns)*tile[1]]
    if max(size) > 4096:
        raise ValueError("Atlas exceeds 4096-pixel texture limit")
    return {"dimensions": size, "columns": columns, "tileDimensions": tile, "gutter": 1,
            "encoding": "16-bit unsigned scalar, high and low bytes in separate PNG alpha channels; validity in third alpha channel",
            "texture": "RGBA8, LINEAR filtering, no mipmaps, clamp; alpha is linear even in sRGB textures"}

def encode_volume(values, validity):
    valid = validity > 0
    if not valid.any() or not np.isfinite(values[valid]).all():
        raise ValueError("Volume has no valid finite samples")
    lo, hi = float(values[valid].min()), float(values[valid].max())
    if hi <= lo:
        raise ValueError("Volume has no scalar range")
    scale = (hi-lo)/65535
    codes = np.zeros(values.shape, dtype=np.uint16)
    codes[valid] = np.rint((values[valid]-lo)/scale).clip(0, 65535).astype(np.uint16)
    decoded = lo + codes[valid].astype(np.float64)*scale
    return codes, {"scalarOffset": lo, "scalarScale": scale, "scalarRange": [lo, hi],
                   "quantizationMaxError": float(np.max(np.abs(decoded-values[valid]))),
                   "quantizationErrorBound": scale/2, "validVoxelCount": int(valid.sum())}

def pack_atlas(values, layout):
    width, height = layout["dimensions"]
    tile_x, tile_y = layout["tileDimensions"]
    atlas = np.zeros((height, width), dtype=np.uint8)
    for z, plane in enumerate(values):
        row, col = divmod(z, layout["columns"])
        atlas[row*tile_y:(row+1)*tile_y, col*tile_x:(col+1)*tile_x] = np.pad(plane, 1, mode="edge")
    return atlas

def write_alpha_png(path, alpha):
    """Deterministic RGBA8 PNG: RGB white, alpha numeric; no colour/profile chunks."""
    height, width = alpha.shape
    rgba = np.full((height, width, 4), 255, dtype=np.uint8)
    rgba[:, :, 3] = alpha
    rows = np.zeros((height, width*4+1), dtype=np.uint8)
    rows[:, 1:] = rgba.reshape(height, width*4)
    def chunk(tag, payload):
        return struct.pack(">I", len(payload))+tag+payload+struct.pack(">I", zlib.crc32(tag+payload))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(rows.tobytes(), 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(data)
    return {"filename": Path(path).name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def transfer_function(values, preset):
    item = PRESETS[preset]
    gray = np.clip((np.asarray(values)-item["level"])/item["window"]+0.5, 0, 1)
    ramp = np.clip((gray-item["threshold"])/(1-item["threshold"]), 0, 1)
    return gray, (ramp*ramp*(3-2*ramp))*0.65
