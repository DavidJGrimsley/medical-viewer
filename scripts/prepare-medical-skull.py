"""Blender 5.0: --background --factory-startup --python this-file -- --source Skull3D.obj.

Requires Node on PATH. Creates the packaged GLB and its preparation record; never
modifies the input. Binary intermediate geometry lives in an OS temporary directory.
Blender receives unrotated LPS coordinates, so glTF's built-in Y-up conversion
produces exactly (x, z, -y), without the OBJ importer's extra 180-degree rotation.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", default=str(ROOT / "assets" / "medical"))
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
with open(args.source, encoding="utf-8") as source_file:
    if "SPACE=LPS" not in source_file.readline():
        raise RuntimeError("Expected the original 3D Slicer LPS OBJ export")
out = pathlib.Path(args.output)
out.mkdir(parents=True, exist_ok=True)

with tempfile.TemporaryDirectory(prefix="xr-medical-") as temporary:
    subprocess.run(["node", str(ROOT / "scripts" / "medical-mesh-clean.cjs"), args.source, temporary], check=True)
    temp = pathlib.Path(temporary)
    stats = json.loads((temp / "cleaning.json").read_text())
    positions = np.fromfile(temp / "positions.bin", dtype="<f4").reshape(-1, 3)
    triangles = np.fromfile(temp / "triangles.bin", dtype="<u4")
    bounds = stats["boundsLpsMm"]
    origin = [(bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, bounds[2]]
    positions = (positions - np.array(origin, dtype=np.float32)) * 0.001
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    mesh = bpy.data.meshes.new("CT skull")
    mesh.vertices.add(len(positions))
    mesh.vertices.foreach_set("co", positions.ravel())
    mesh.loops.add(len(triangles))
    mesh.loops.foreach_set("vertex_index", triangles)
    mesh.polygons.add(len(triangles) // 3)
    mesh.polygons.foreach_set("loop_start", np.arange(0, len(triangles), 3, dtype=np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(len(triangles) // 3, 3, dtype=np.int32))
    mesh.update(calc_edges=True)
    mesh.validate(clean_customdata=True)
    obj = bpy.data.objects.new("Skull", mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("Mobile simplification", "DECIMATE")
    decimation_ratio = min(1, 149000 / len(mesh.polygons))
    modifier.ratio = decimation_ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.validate(clean_customdata=True)
    obj.data.update(calc_edges=True)
    # Decimation can move the lowest vertex; ground the final float coordinates
    # before testing their triangle areas (translation can introduce rounding).
    floor = min(vertex.co.z for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z -= floor
    origin[2] += floor * 1000
    # Collapse simplification can introduce coincident/zero-area triangles.
    simplified = bmesh.new()
    simplified.from_mesh(obj.data)
    bmesh.ops.triangulate(simplified, faces=list(simplified.faces))
    faces = list(simplified.faces)
    corners = np.array([[list(vertex.co) for vertex in face.verts] for face in faces], dtype=np.float64)
    areas = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) / 2
    degenerate = [faces[index] for index in np.flatnonzero(areas <= 5e-15)]
    post_decimation_degenerate_count = len(degenerate)
    bmesh.ops.delete(simplified, geom=degenerate, context="FACES")
    simplified.normal_update()
    simplified.to_mesh(obj.data)
    simplified.free()
    obj.data.validate(clean_customdata=True)
    obj.data.update(calc_edges=True)
    obj.data.polygons.foreach_set("use_smooth", np.ones(len(obj.data.polygons), dtype=bool))
    obj.data.calc_loop_triangles()
    triangle_count = len(obj.data.loop_triangles)
    if triangle_count > 150000:
        raise RuntimeError(f"Triangle budget exceeded: {triangle_count}")
    material = bpy.data.materials.new("Ivory bone")
    material.diffuse_color = (0.83, 0.80, 0.71, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = material.diffuse_color
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Roughness"].default_value = 0.75
    shader.inputs["Alpha"].default_value = 1
    obj.data.materials.clear()
    obj.data.materials.append(material)
    bpy.context.view_layer.update()
    surface = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
    labels = []
    for name, start, direction, label_position in [
        ("Frontal bone", (0, -0.3, 0.17), (0, 1, 0), (-0.17, 0.178, 0.105)),
        ("Parietal bone", (0.3, 0.025, 0.17), (-1, 0, 0), (0.17, 0.2, -0.045)),
        ("Zygomatic bone", (0.053, -0.3, 0.092), (0, 1, 0), (0.17, 0.09, 0.11)),
        ("Mandible", (0, -0.3, 0.022), (0, 1, 0), (-0.17, 0.02, 0.105)),
    ]:
        hit, normal, index, distance = surface.ray_cast(Vector(start), Vector(direction))
        if hit is None:
            raise RuntimeError(f"Label ray missed the skull: {name}")
        labels.append({"name": name, "anchor": [hit.x, hit.z, -hit.y], "position": list(label_position)})
    (out / "skull-labels.json").write_text(json.dumps({"calibration": "Surface ray intersections on the prepared skull; landmark locations visually reviewed. Anatomical owner confirmation and iPhone readability remain pending.", "labels": labels}, indent=2) + "\n", encoding="utf-8")
    filename = out / "skull.glb"
    bpy.ops.export_scene.gltf(filepath=str(filename), export_format="GLB", use_selection=True, export_yup=True, export_texcoords=False, export_materials="EXPORT", export_draco_mesh_compression_enable=False)
    if filename.stat().st_size > 10 * 1024 * 1024:
        raise RuntimeError("GLB exceeds 10 MiB")
    record = {
        "model": "skull",
        "sourceFilename": pathlib.Path(args.source).name,
        "collection": "NLM Visible Human Project — Additional Head Images",
        "sourceUrl": "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/CAT/",
        "collectionReadme": "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/README",
        "termsUrl": "https://www.nlm.nih.gov/research/visible/visible_human.html",
        "attribution": "Courtesy of the U.S. National Library of Medicine. Additional Head Images: Brigham and Women's Hospital / Harvard Medical School, Peter Ratiu and colleagues.",
        "derivation": "User-supplied CT bone segmentation exported from 3D Slicer; simplified for educational AR visualization.",
        "blenderVersion": bpy.app.version_string,
        "sourceSpace": "LPS millimetres",
        "outputSpace": "Y-up metres, anterior +Z, anatomical left +X",
        "originLpsMm": origin,
        "lpsToModelMatrix": [[0.001, 0, 0, -origin[0] * 0.001], [0, 0, 0.001, -origin[2] * 0.001], [0, -0.001, 0, origin[1] * 0.001], [0, 0, 0, 1]],
        "fragmentThresholdMm": 0.1,
        "degenerateCrossProductSquaredThresholdMm4": 1e-16,
        "decimationRatio": decimation_ratio,
        "postDecimationDegenerateFacesRemoved": post_decimation_degenerate_count,
        "triangles": triangle_count,
        "bytes": filename.stat().st_size,
        "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
        "cleaning": stats,
        "clinicalValidation": "Not clinically validated; educational visualization only.",
    }
    (out / "skull-provenance.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    # Match the project's pinned formatter so regenerating assets passes npm test.
    subprocess.run(["node", str(ROOT / "node_modules" / "prettier" / "bin" / "prettier.cjs"), "--write", str(out / "skull-labels.json"), str(out / "skull-provenance.json")], cwd=ROOT, check=True)
    print(json.dumps({"output": str(filename), "triangles": triangle_count, "bytes": filename.stat().st_size}))
