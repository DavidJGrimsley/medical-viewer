"""Prepare supplied Slicer LPS brain/half-skull OBJ exports without changing originals.

Run with Blender --background --factory-startup --python this-file --
--source-directory <From3DSlicer>. Both use the existing skull's recorded LPS
origin. Never independently centre or ground the new meshes: that loses registration.
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

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--source-directory", required=True)
parser.add_argument("--output", default=str(ROOT / "assets" / "medical"))
parser.add_argument("--preview-directory")
parser.add_argument("--registration-confirmed", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
source_directory = pathlib.Path(args.source_directory)
out = pathlib.Path(args.output)
out.mkdir(parents=True, exist_ok=True)
skull = json.loads((ROOT / "assets" / "medical" / "skull-provenance.json").read_text())
origin = np.array(skull["originLpsMm"], dtype=np.float64)
matrix = skull["lpsToModelMatrix"]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
models = []
for model_id, filename, name, budget, colour in [
    ("brain", "MRI_Elastix mask.obj", "Brain", 65000, (0.64, 0.30, 0.43, 1)),
    ("half-skull", "Skull3D-Half.obj", "Half Skull", 80000, (0.83, 0.80, 0.71, 1)),
]:
    source = source_directory / filename
    with source.open(encoding="utf-8") as file:
        if "SPACE=LPS" not in file.readline():
            raise RuntimeError(f"Expected Slicer LPS export: {filename}")
    with tempfile.TemporaryDirectory(prefix="xr-medical-model-") as temporary:
        subprocess.run(["node", str(ROOT / "scripts" / "medical-mesh-clean.cjs"), str(source), temporary], check=True)
        temp = pathlib.Path(temporary)
        stats = json.loads((temp / "cleaning.json").read_text())
        positions = np.fromfile(temp / "positions.bin", dtype="<f4").reshape(-1, 3)
        # Blender is Z-up. glTF export maps (x,y,z) to (x,z,-y), matching skull.
        positions = ((positions.astype(np.float64) - origin) * 0.001).astype(np.float32)
        triangles = np.fromfile(temp / "triangles.bin", dtype="<u4")
        mesh = bpy.data.meshes.new(name)
        mesh.vertices.add(len(positions))
        mesh.vertices.foreach_set("co", positions.ravel())
        mesh.loops.add(len(triangles))
        mesh.loops.foreach_set("vertex_index", triangles)
        mesh.polygons.add(len(triangles) // 3)
        mesh.polygons.foreach_set("loop_start", np.arange(0, len(triangles), 3, dtype=np.int32))
        mesh.polygons.foreach_set("loop_total", np.full(len(triangles) // 3, 3, dtype=np.int32))
        mesh.update(calc_edges=True)
        mesh.validate(clean_customdata=True)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        ratio = min(1, budget / len(mesh.polygons))
        modifier = obj.modifiers.new("Mobile simplification", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        simplified = bmesh.new()
        simplified.from_mesh(obj.data)
        bmesh.ops.triangulate(simplified, faces=list(simplified.faces))
        faces = list(simplified.faces)
        corners = np.array([[list(vertex.co) for vertex in face.verts] for face in faces], dtype=np.float64)
        areas = np.linalg.norm(np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]), axis=1) / 2
        degenerate = [faces[index] for index in np.flatnonzero(areas <= 5e-15)]
        bmesh.ops.delete(simplified, geom=degenerate, context="FACES")
        simplified.normal_update()
        simplified.to_mesh(obj.data)
        simplified.free()
        obj.data.validate(clean_customdata=True)
        obj.data.update(calc_edges=True)
        obj.data.polygons.foreach_set("use_smooth", np.ones(len(obj.data.polygons), dtype=bool))
        obj.data.calc_loop_triangles()
        triangle_count = len(obj.data.loop_triangles)
        if triangle_count > budget:
            raise RuntimeError(f"Triangle budget exceeded: {model_id} {triangle_count}")
        material = bpy.data.materials.new(name)
        material.diffuse_color = colour
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = colour
        shader.inputs["Metallic"].default_value = 0
        shader.inputs["Roughness"].default_value = 0.75
        shader.inputs["Alpha"].default_value = 1
        obj.data.materials.clear()
        obj.data.materials.append(material)
        target = out / f"{model_id}.glb"
        bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True,
                                  export_yup=True, export_texcoords=False, export_materials="EXPORT",
                                  export_draco_mesh_compression_enable=False)
        if target.stat().st_size > 10 * 1024 * 1024:
            raise RuntimeError(f"GLB exceeds 10 MiB: {model_id}")
        final = np.array([[vertex.co.x, vertex.co.z, -vertex.co.y] for vertex in obj.data.vertices])
        record = {
            "model": model_id,
            "sourceFilename": filename,
            "sourceBytes": source.stat().st_size,
            "sourceSha256": stats["sourceSha256"],
            "sourceHeader": "3D Slicer output. SPACE=LPS",
            "collection": skull["collection"],
            "collectionReadme": skull["collectionReadme"],
            "termsUrl": skull["termsUrl"],
            "attribution": skull["attribution"],
            "sourceUrl": "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/" + ("MRI/" if model_id == "brain" else "CAT/"),
            "license": "NLM describes the Visible Human Project image data as public-domain; attribution retained.",
            "derivation": "Owner-supplied 3D Slicer surface export; " + ("MRI brain mask" if model_id == "brain" else "CT half-skull"),
            "provenanceConfirmation": ("Owner confirmed the same NLM Additional Head Images dataset and registration in Slicer on 2026-10-09."
                                       if args.registration_confirmed else "Dataset and Slicer registration confirmation pending owner response."),
            "sourceSpace": "LPS millimetres",
            "outputSpace": skull["outputSpace"],
            "originLpsMm": skull["originLpsMm"],
            "lpsToModelMatrix": matrix,
            "alignment": "Same recorded skull LPS-to-model matrix, baked into every mesh; no independent centering, grounding, scaling or registration adjustment.",
            "displayTransform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]},
            "boundsModelMetres": {"min": final.min(axis=0).tolist(), "max": final.max(axis=0).tolist()},
            "blenderVersion": bpy.app.version_string,
            "fragmentThresholdMm": 0.1,
            "degenerateCrossProductSquaredThresholdMm4": 1e-16,
            "decimationRatio": ratio,
            "postDecimationDegenerateFacesRemoved": len(degenerate),
            "triangleBudget": budget,
            "triangles": triangle_count,
            "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "presentation": "Opaque matte bone ivory / brain rose; display colours are not clinical tissue classification.",
            "cleaning": stats,
            "clinicalValidation": "Not clinically validated; educational visualization only.",
        }
        (out / f"{model_id}-provenance.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        models.append(obj)
        print(json.dumps({"model": model_id, "output": str(target), "triangles": triangle_count, "bytes": target.stat().st_size}), flush=True)

subprocess.run(["node", str(ROOT / "node_modules" / "prettier" / "bin" / "prettier.cjs"), "--write",
                str(out / "brain-provenance.json"), str(out / "half-skull-provenance.json")], cwd=ROOT, check=True)

if args.preview_directory:
    preview = pathlib.Path(args.preview_directory)
    if not preview.is_absolute():
        preview = ROOT / preview
    preview.mkdir(parents=True, exist_ok=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "assets" / "medical" / "skull.glb"))
    full_skull = bpy.context.selected_objects[0]
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.world.color = (0.06, 0.06, 0.06)
    scene.view_settings.view_transform = "AgX"
    def point_at(obj, target):
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.camera_add(location=(-0.42, -0.62, 0.30))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 0.32
    point_at(camera, (0, 0, 0.115))
    scene.camera = camera
    for location, power, size in [((-0.3, -0.4, 0.6), 30, 0.5), ((0.3, 0.15, 0.4), 15, 0.4)]:
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.object
        light.data.energy = power
        light.data.shape = "DISK"
        light.data.size = size
        point_at(light, (0, 0, 0.1))
    for model_id, visible in [("skull", [full_skull]), ("brain", [models[0]]),
                               ("half-skull", [models[1]]), ("both", models)]:
        for obj in [full_skull, *models]:
            obj.hide_render = obj not in visible
        scene.render.filepath = str(preview / f"{model_id}.png")
        bpy.ops.render.render(write_still=True)
