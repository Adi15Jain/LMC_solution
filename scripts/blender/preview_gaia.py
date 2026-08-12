#!/usr/bin/env python3
"""
Render turnaround previews of the Gaia model so the proportions can be checked
by eye — the one thing a headless build script cannot verify for itself.

    blender --background --python scripts/blender/preview_gaia.py -- \
            --out /tmp/gaia_preview

Writes <out>_01.png .. <out>_04.png
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

try:
    import bpy
except ImportError:  # pragma: no cover
    sys.exit("Run inside Blender: blender --background --python scripts/blender/preview_gaia.py")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_gaia  # noqa: E402


# (name, azimuth deg, elevation deg, distance as a multiple of model radius)
VIEWS = [
    ("three-quarter", 55, 28, 2.0),
    ("side",           0,  4, 2.0),
    ("top",           35, 78, 2.0),
    ("detail-payload", 70, 18, 0.9),
]


def scene_bounds():
    """Radius and centre height of everything in the scene.

    Framing off the real bounds means the same preview works for a 10 m model and
    for a raw FBX on some arbitrary authoring scale.
    """
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c)
           for o in bpy.data.objects if o.type == "MESH" for c in o.bound_box]
    if not pts:
        return 5.0, 1.0
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    radius = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
    return radius, (max(zs) + min(zs)) / 2


def pick_engine() -> str:
    """EEVEE's identifier has changed across releases; take whatever exists."""
    try:
        options = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    except Exception:
        return "BLENDER_EEVEE"
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        if candidate in options:
            return candidate
    return list(options)[0]


def setup_world(studio: bool) -> None:
    """Light the model.

    `studio` matches the reference photography: a bright environment so the metals
    have something to reflect. This matters — Principled metals with metallic=1.0
    have no diffuse response at all, so in a black void they render black no matter
    what base colour you give them. The dark `space` preset is the honest preview of
    how the model will look in the actual cinematic, where a key light plus a faint
    environment is all it gets.
    """
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        if studio:
            bg.inputs[0].default_value = (0.55, 0.58, 0.64, 1.0)
            bg.inputs[1].default_value = 1.0
        else:
            bg.inputs[0].default_value = (0.020, 0.024, 0.035, 1.0)
            bg.inputs[1].default_value = 0.35
    bpy.context.scene.world = world

    # Key — stands in for the Sun.
    bpy.ops.object.light_add(type="SUN", location=(9, -11, 9))
    key = bpy.context.active_object
    key.data.energy = 5.0 if studio else 9.0
    key.data.angle = math.radians(2.0)
    key.rotation_euler = (math.radians(52), 0, math.radians(38))

    # Fill — broad and soft, so the shaded side is not a silhouette.
    bpy.ops.object.light_add(type="AREA", location=(-11, -6, 5))
    fill = bpy.context.active_object
    fill.data.energy = 2200.0 if studio else 700.0
    fill.data.size = 16.0
    fill.data.color = (0.80, 0.85, 1.0)
    fill.rotation_euler = (math.radians(58), 0, math.radians(-120))

    # Rim — separates the hull from the background.
    bpy.ops.object.light_add(type="AREA", location=(-8, 10, -2))
    rim = bpy.context.active_object
    rim.data.energy = 2600.0 if studio else 1400.0
    rim.data.size = 12.0
    rim.data.color = (0.55, 0.68, 1.0)
    rim.rotation_euler = (math.radians(100), 0, math.radians(40))


def place_camera(az_deg: float, el_deg: float, dist: float, look_z: float) -> "bpy.types.Object":
    az, el = math.radians(az_deg), math.radians(el_deg)
    loc = (
        dist * math.cos(el) * math.cos(az),
        dist * math.cos(el) * math.sin(az),
        dist * math.sin(el) + look_z,
    )
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    cam.data.lens = 60

    # Aim at the spacecraft's mid-height rather than the origin, so the bus is
    # centred instead of the sunshield plane.
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, look_z))
    target = bpy.context.active_object
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return cam


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("/tmp/gaia_preview"))
    ap.add_argument("--res", type=int, default=900)
    ap.add_argument("--space", action="store_true",
                    help="dark space lighting instead of studio")
    ap.add_argument("--glb", type=Path,
                    help="preview an existing .glb instead of rebuilding from script")
    args = ap.parse_args(argv)

    if args.glb:
        # Round-trip check: what we preview is exactly what the browser will load,
        # not the pre-export scene.
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        bpy.ops.import_scene.gltf(filepath=str(args.glb))
    else:
        build_gaia.build()
    setup_world(studio=not args.space)

    scene = bpy.context.scene
    scene.render.engine = pick_engine()
    scene.render.resolution_x = args.res
    scene.render.resolution_y = args.res
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    print(f"engine: {scene.render.engine}")

    radius, look_z = scene_bounds()
    print(f"framing: radius {radius:.2f}, centre z {look_z:.2f}")

    for i, (name, az, el, mult) in enumerate(VIEWS, start=1):
        cam = place_camera(az, el, radius * 2.0 * mult, look_z)
        scene.camera = cam
        out = f"{args.out}_{i:02d}.png"
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print(f"rendered {name} -> {out}")


if __name__ == "__main__":
    main()
