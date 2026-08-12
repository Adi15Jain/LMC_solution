#!/usr/bin/env python3
"""
Convert ESA's Gaia FBX + texture set into a web-ready glTF.

    # look at what we were given, change nothing
    blender --background --python scripts/blender/convert_esa_gaia.py -- --inspect

    # full conversion
    blender --background --python scripts/blender/convert_esa_gaia.py -- \
            --out web/public/models/gaia_esa.glb --target-tris 120000 --tex-size 2048

Source: https://scifleet.esa.int  (ESA Science Satellite Fleet)
NOTE: the SCIFLEET pages state no licensing terms. Confirm reuse rights with
support.cosmos.esa.int/sci-fleet before publishing this asset anywhere public.

The pipeline:
  import FBX -> rebuild materials from the PBR maps -> decimate to a web budget
  -> downscale textures -> export GLB with Draco

ESA build these for print and offline render, so the raw asset is far too heavy for
a browser. Everything here is about getting it under budget without visibly losing
the crumpled-foil detail that made it worth using in the first place.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import bpy
except ImportError:  # pragma: no cover
    sys.exit("Run inside Blender:\n"
             "  blender --background --python scripts/blender/convert_esa_gaia.py -- --inspect")

ROOT = Path(__file__).resolve().parent.parent.parent
SRC_FBX = ROOT / "assets" / "gaia_esa" / "gaia.fbx"
TEX_ROOT = ROOT / "assets" / "gaia_esa" / "textures" / "gaia_textures"

# Which PBR map feeds which Principled socket. Keys are the filename suffixes ESA use.
MAP_SOCKETS = {
    "BaseColor": ("Base Color", "Base Colour", "Color"),
    "Metallic": ("Metallic", "Metalness"),
    "Roughness": ("Roughness", "Specular Roughness"),
    "Normal": None,        # routed through a Normal Map node
    "Emissive": ("Emission Color", "Emission Colour", "Emission"),
    # AO and Height are deliberately skipped: glTF has no AO-only slot without
    # packing, and displacement is meaningless for a real-time asset.
}

NON_COLOR = {"Metallic", "Roughness", "Normal", "Height", "AO"}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_fbx(path: Path) -> None:
    if not path.exists():
        sys.exit(f"Missing {path}")
    try:
        bpy.ops.import_scene.fbx(filepath=str(path))
    except AttributeError:
        sys.exit("This Blender build has no FBX importer (bpy.ops.import_scene.fbx)")


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def total_tris() -> int:
    n = 0
    for obj in mesh_objects():
        for poly in obj.data.polygons:
            n += max(1, len(poly.vertices) - 2)
    return n


def find_texture_sets() -> dict[str, dict[str, Path]]:
    """Group the delivered PNGs by folder — one folder per material."""
    sets: dict[str, dict[str, Path]] = {}
    if not TEX_ROOT.exists():
        return sets
    for png in TEX_ROOT.rglob("*.png"):
        if "__MACOSX" in png.parts or png.name.startswith("._"):
            continue
        group = png.relative_to(TEX_ROOT).parts[0]
        for suffix in ("BaseColor", "Metallic", "Roughness", "Normal", "Emissive",
                       "Height", "AO"):
            if png.stem.endswith(suffix):
                sets.setdefault(group, {})[suffix] = png
                break
    return sets


def inspect() -> None:
    print(f"\nBlender {bpy.app.version_string}")
    clear_scene()
    import_fbx(SRC_FBX)

    objs = mesh_objects()
    print(f"\nFBX: {len(objs)} mesh objects, {total_tris():,} triangles")
    print(f"     {len(bpy.data.materials)} materials, {len(bpy.data.images)} embedded images")

    print("\nlargest objects:")
    ranked = sorted(objs, key=lambda o: -len(o.data.polygons))
    for obj in ranked[:12]:
        print(f"   {len(obj.data.polygons):>8,} faces  {obj.name}")
    if len(ranked) > 12:
        print(f"   ... and {len(ranked) - 12} more")

    print("\nmaterials:")
    for mat in bpy.data.materials:
        print(f"   {mat.name}")

    print("\ntexture sets on disk:")
    for group, maps in find_texture_sets().items():
        print(f"   {group}: {', '.join(sorted(maps))}")


def build_material(name: str, maps: dict[str, Path], tex_size: int):
    """Rebuild a clean Principled material from the delivered PBR maps."""
    mat = bpy.data.materials.new(f"ESA_{name}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return mat

    for suffix, sockets in MAP_SOCKETS.items():
        path = maps.get(suffix)
        if path is None:
            continue

        img = bpy.data.images.load(str(path), check_existing=True)
        if suffix in NON_COLOR:
            img.colorspace_settings.name = "Non-Color"
        if max(img.size) > tex_size:
            img.scale(tex_size, tex_size)

        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.label = suffix

        if suffix == "Normal":
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
            if "Normal" in bsdf.inputs:
                nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
            continue

        target = next((s for s in (sockets or ()) if s in bsdf.inputs), None)
        if target is None:
            print(f"   ! no socket for {suffix} on this build")
            continue
        nt.links.new(tex.outputs["Color"], bsdf.inputs[target])

    # Emissive maps ship black where nothing glows; without strength it does nothing.
    if "Emissive" in maps and "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 1.0

    return mat


def assign_materials(tex_size: int) -> None:
    """Map each mesh to the right texture set.

    ESA split the asset into a body and a bottom face. Anything whose name hints at
    the underside gets Bot_face; everything else gets Body.
    """
    sets = find_texture_sets()
    if not sets:
        print("   ! no textures found — exporting untextured")
        return

    built = {name: build_material(name, maps, tex_size) for name, maps in sets.items()}
    body = built.get("Body") or next(iter(built.values()))
    bot = built.get("Bot_face", body)

    for obj in mesh_objects():
        lowered = obj.name.lower()
        chosen = bot if any(k in lowered for k in ("bot", "bottom", "under", "face")) else body
        obj.data.materials.clear()
        obj.data.materials.append(chosen)


def decimate(target_tris: int) -> None:
    """Decimate proportionally so every object loses the same fraction.

    Uniform ratio keeps the silhouette balanced; decimating only the heaviest object
    would flatten the sunshield while leaving greebles at full density.
    """
    current = total_tris()
    if current <= target_tris:
        print(f"   {current:,} tris already under target {target_tris:,} — no decimation")
        return

    ratio = target_tris / current
    print(f"   decimating {current:,} -> ~{target_tris:,} tris (ratio {ratio:.3f})")

    for obj in mesh_objects():
        if len(obj.data.polygons) < 200:
            continue  # too small to survive decimation cleanly
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as exc:
            print(f"   ! decimate failed on {obj.name}: {exc}")

    print(f"   result: {total_tris():,} tris")


def normalise(target_span: float = 10.0):
    """Rescale and recentre to real-world metres, then parent to a `Gaia` empty.

    The FBX arrives ~197 units wide on an arbitrary authoring scale. The web scene
    works in metres, and the shot list quotes a 10 m sunshield, so scale the widest
    horizontal span to that. Origin goes at the centre of the sunshield plane so the
    spin axis is correct — the same convention build_gaia.py uses, which makes the
    two models interchangeable in the scene.
    """
    from mathutils import Vector

    meshes = mesh_objects()
    if not meshes:
        sys.exit("No meshes to normalise")

    # 1. Flatten the FBX hierarchy, KEEPING world transforms. The importer wraps the
    #    meshes in empties carrying a -90 deg X axis conversion; re-parenting without
    #    this step drops that rotation and lays the spacecraft on its side.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")

    # 2. Bake rotation and scale into the mesh data so bounds are meaningful.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")

    # 3. Drop the authoring leftovers — the FBX ships a camera, a sky and a render
    #    rig that have no business in a web asset.
    junk = [o for o in bpy.data.objects if o.type != "MESH"]
    junk_names = [o.name for o in junk]      # read before removing — the structs die
    for obj in junk:
        bpy.data.objects.remove(obj, do_unlink=True)
    if junk_names:
        print(f"   removed {len(junk_names)} non-mesh objects: {junk_names[:6]}")

    # 4. Rescale and recentre.
    corners = [obj.matrix_world @ Vector(c)
               for obj in mesh_objects() for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]

    span = max(max(xs) - min(xs), max(ys) - min(ys))
    scale = target_span / span
    print(f"   span {span:.2f} units -> {target_span:.1f} m (scale {scale:.5f})")

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = "Gaia"

    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    cz = min(zs)          # sunshield plane sits at the bottom of the bounds

    for obj in mesh_objects():
        obj.parent = root

    root.scale = (scale, scale, scale)
    root.location = (-cx * scale, -cy * scale, -cz * scale)

    bpy.context.view_layer.update()
    print(f"   height {(max(zs) - min(zs)) * scale:.2f} m")
    return root


def supported_gltf_params() -> set[str]:
    try:
        return {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    except Exception:
        return set()


def export(out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")

    supported = supported_gltf_params()
    desired = {
        "filepath": str(out_path),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_draco_mesh_compression_enable": True,
        "export_draco_mesh_compression_level": 6,
        "export_image_format": "WEBP",     # far smaller than PNG for these maps
        "export_image_quality": 85,
    }
    kwargs = ({k: v for k, v in desired.items() if k in supported or k == "filepath"}
              if supported else {"filepath": str(out_path), "export_format": "GLB"})
    skipped = sorted(set(desired) - set(kwargs))
    if skipped:
        print(f"   note: exporter does not accept {skipped} — skipped")

    bpy.ops.export_scene.gltf(**kwargs)
    print(f"\nwrote {out_path}  ({out_path.stat().st_size / 1e6:.2f} MB)")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--out", type=Path, default=ROOT / "web/public/models/gaia_esa.glb")
    ap.add_argument("--target-tris", type=int, default=120_000)
    ap.add_argument("--tex-size", type=int, default=2048)
    ap.add_argument("--span", type=float, default=10.0,
                    help="sunshield diameter in metres after rescaling")
    args = ap.parse_args(argv)

    if args.inspect:
        inspect()
        return

    print(f"Blender {bpy.app.version_string}")
    clear_scene()
    print("importing FBX...")
    import_fbx(SRC_FBX)
    print(f"   {len(mesh_objects())} objects, {total_tris():,} tris")

    print("rebuilding materials...")
    assign_materials(args.tex_size)

    print("normalising scale...")
    normalise(args.span)

    print("decimating...")
    decimate(args.target_tris)

    print("exporting...")
    export(args.out.resolve())


if __name__ == "__main__":
    main()
