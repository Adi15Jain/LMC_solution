#!/usr/bin/env python3
"""
Procedurally build the Gaia spacecraft and export it as glTF for the web app.

    blender --background --python scripts/blender/build_gaia.py -- \
            --out web/public/models/gaia.glb

    blender --background --python scripts/blender/build_gaia.py -- --dump-api
        prints this build's Principled BSDF sockets and glTF exporter params

Why a script instead of a .blend file:
  - reproducible: regenerate identically, change one constant and re-export
  - git-friendly: a diffable .py, not a binary blob
  - unambiguously your own work (ESA's SCIFLEET .blend states no licence terms)

Published specifications used below (ESA / Wikipedia):
  Deployable Sunshield Assembly   10.0 m diameter, 12-sided
  Spacecraft envelope              4.6 m x 2.3 m
  Telescope separation             106.5 deg (basic angle)
  Primary mirrors                  1.45 m x 0.5 m each
  Spin period                      6 hours; precession 63 days
  Sunshield angle to Sun           45 degrees

Visual reference: the real spacecraft is a *silver crinkled multi-layer-insulation*
disc carrying gold thermal panels near its rim, under a *dark* cylindrical payload
tent with an overhanging pale cap. Getting those three things wrong is what made the
first pass read as a birthday cake.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
from pathlib import Path

try:
    import bpy
    import bmesh
    from mathutils import Vector
except ImportError:  # pragma: no cover - only importable inside Blender
    sys.exit("This script must be run inside Blender:\n"
             "  blender --background --python scripts/blender/build_gaia.py -- --out <path>")


# --------------------------------------------------------------------------
# Dimensions (metres). Proportions cross-checked against ESA reference imagery.
# --------------------------------------------------------------------------
SUNSHIELD_DIAMETER = 10.0
SUNSHIELD_SIDES = 12          # the DSA really is a dodecagon
SUNSHIELD_RINGS = 20          # radial subdivisions, for the crinkle
SUNSHIELD_SEGMENT_STEPS = 11   # angular steps per dodecagon side
SUNSHIELD_THICKNESS = 0.05

RIB_COUNT = 36                # thin radial ribs across the foil
GOLD_PANELS = 12              # thermal panels near the rim, one per segment

BODY_DIAMETER = 3.30          # payload thermal tent
BODY_HEIGHT = 2.55            # nearly as tall as it is wide — the first pass was squat
BODY_SIDES = 96
BODY_RINGS = 10

SKIRT_HEIGHT = 0.62           # conical flare where the tent meets the shield
SKIRT_FLARE = 1.28            # bottom radius as a multiple of the body radius

CAP_OVERHANG = 1.16           # cap radius as a multiple of the body radius
CAP_HEIGHT = 0.44             # the cap is a shallow segmented cone, not a flat lid
CAP_SIDES = 16                # low on purpose: the facet seams ARE the panel lines
CAP_SPIKE = 0.42              # slender mast at the apex

GLOSS_BAND = 0.26             # top fraction of the tent that is the polished band

ANTENNA_DIAMETER = 1.70
ANTENNA_THICKNESS = 0.10

BASIC_ANGLE = 106.5
APERTURE_WIDTH = 1.45
APERTURE_HEIGHT = 0.50

CRINKLE_SHIELD = 0.036        # MLI foil is never flat; this is what sells it
CRINKLE_BODY = 0.009


# --------------------------------------------------------------------------
# Scene / material helpers
# --------------------------------------------------------------------------
def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def find_principled(mat):
    """Locate the Principled BSDF by node *type*, not display name.

    Display names are localised and get renamed between releases; the type enum has
    been stable since 2.8. Blender 5.x realigned these sockets toward OpenPBR, so the
    socket lookup below is candidate-based for the same reason.
    """
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def set_socket(node, candidates: tuple[str, ...], value) -> bool:
    if node is None:
        return False
    for key in candidates:
        socket = node.inputs.get(key)
        if socket is None:
            continue
        try:
            current = socket.default_value
            if hasattr(current, "__len__"):
                n = len(current)
                if isinstance(value, (int, float)):
                    socket.default_value = (value,) * (n - 1) + (1.0,) if n == 4 else (value,) * n
                else:
                    v = tuple(value)
                    socket.default_value = (v + (1.0,) * n)[:n]
            else:
                socket.default_value = float(value) if not hasattr(value, "__len__") else float(value[0])
            return True
        except Exception as exc:  # pragma: no cover
            print(f"   ! could not set socket {key!r}: {exc}")
    return False


MISSING_SOCKETS: set[str] = set()


def make_material(name, rgba, metallic, roughness, emission=None):
    """Flat PBR material — no textures. The crinkled geometry carries the detail."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = find_principled(mat)
    if bsdf is None:
        print(f"   ! no Principled BSDF for {name}; left at defaults")
        return mat

    if not set_socket(bsdf, ("Base Color", "Base Colour", "Color"), rgba):
        MISSING_SOCKETS.add("Base Color")
    if not set_socket(bsdf, ("Metallic", "Metalness", "Base Metalness"), metallic):
        MISSING_SOCKETS.add("Metallic")
    if not set_socket(bsdf, ("Roughness", "Specular Roughness"), roughness):
        MISSING_SOCKETS.add("Roughness")
    if emission is not None:
        set_socket(bsdf, ("Emission Color", "Emission Colour", "Emission"), emission)
        set_socket(bsdf, ("Emission Strength", "Emission Luminance"), 1.4)
    return mat


def assign(obj, mat) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def new_object(name: str, bm: "bmesh.types.BMesh"):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def flat_shade(obj) -> None:
    for poly in obj.data.polygons:
        poly.use_smooth = False


def solidify(obj, thickness: float) -> None:
    mod = obj.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 0.0


def apply_modifiers(obj) -> None:
    """Bake the modifier stack into the mesh.

    Needed before a boolean cut so the solidified wall is real geometry, and needed
    again afterwards so the cutter can be deleted rather than exported.
    """
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as exc:  # pragma: no cover
            print(f"   ! could not apply {mod.name} on {obj.name}: {exc}")
    obj.select_set(False)


def boolean_cut(target, cutter) -> None:
    """Cut `cutter` out of `target`, then remove the cutter.

    This is what actually makes the telescope apertures holes. Layering dark panels
    over a closed shell never reads as an opening — the geometry has to be absent.
    """
    apply_modifiers(target)
    mod = target.modifiers.new("ApertureCut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    if hasattr(mod, "solver"):
        mod.solver = "EXACT"
    apply_modifiers(target)
    bpy.data.objects.remove(cutter, do_unlink=True)


# --------------------------------------------------------------------------
# Geometry builders
# --------------------------------------------------------------------------
def polygon_radius(radius: float, sides: int, angle: float) -> float:
    """Radius of a regular polygon's edge at a given angle (inscribed-circle form).

    Using this instead of a constant radius is what makes the sunshield read as a
    true dodecagon with straight edges rather than a circle.
    """
    step = 2 * math.pi / sides
    half = step / 2
    local = ((angle + half) % step) - half
    return radius * math.cos(half) / math.cos(local)


def build_shield_surface(name: str, mat, crinkle: float, seed: int):
    """Crinkled 12-sided foil disc, built as a radial grid so it can be displaced."""
    sides = SUNSHIELD_SIDES
    steps = sides * SUNSHIELD_SEGMENT_STEPS
    outer = SUNSHIELD_DIAMETER / 2
    inner = BODY_DIAMETER / 2 * SKIRT_FLARE * 0.92

    rng = random.Random(seed)
    bm = bmesh.new()
    grid = []
    for i in range(SUNSHIELD_RINGS + 1):
        t = i / SUNSHIELD_RINGS
        ring = []
        for j in range(steps):
            a = 2 * math.pi * j / steps
            r_edge = polygon_radius(outer, sides, a)
            r = inner + (r_edge - inner) * t
            # Crinkle fades out at the hub and at the rim, where the real foil is
            # clamped by structure and lies comparatively flat.
            envelope = math.sin(math.pi * t) ** 0.6
            z = rng.uniform(-crinkle, crinkle) * envelope
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        grid.append(ring)

    for i in range(SUNSHIELD_RINGS):
        for j in range(steps):
            j2 = (j + 1) % steps
            bm.faces.new((grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]))

    obj = new_object(name, bm)
    assign(obj, mat)
    flat_shade(obj)          # faceted shading is what makes it read as crumpled foil
    solidify(obj, SUNSHIELD_THICKNESS)
    return obj


def build_ribs(mat):
    """Thin radial ribs across the foil — many and fine, not a few chunky bars."""
    out = []
    outer = SUNSHIELD_DIAMETER / 2
    inner = BODY_DIAMETER / 2 * SKIRT_FLARE * 0.95
    for i in range(RIB_COUNT):
        a = 2 * math.pi * i / RIB_COUNT
        r_edge = polygon_radius(outer, SUNSHIELD_SIDES, a) * 0.985
        length = r_edge - inner
        mid = inner + length / 2
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(
            mid * math.cos(a), mid * math.sin(a), SUNSHIELD_THICKNESS * 0.5 + 0.058))
        rib = bpy.context.active_object
        rib.name = f"DSA_Rib_{i:02d}"
        rib.scale = (length, 0.030, 0.030)
        rib.rotation_euler[2] = a
        assign(rib, mat)
        out.append(rib)
    return out


def build_gold_panels(mat):
    """Trapezoidal thermal panels near the rim, one per dodecagon segment."""
    out = []
    outer = SUNSHIELD_DIAMETER / 2
    bm_objs = []
    for i in range(GOLD_PANELS):
        centre = 2 * math.pi * (i + 0.5) / GOLD_PANELS
        span = math.radians(15.0)
        r_in, r_out = outer * 0.735, outer * 0.945

        bm = bmesh.new()
        rings = []
        for r in (r_in, r_out):
            row = []
            for k in range(7):
                a = centre - span / 2 + span * k / 6
                rr = min(r, polygon_radius(outer, SUNSHIELD_SIDES, a) * 0.96)
                row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a),
                                         SUNSHIELD_THICKNESS * 0.5 + 0.052)))
            rings.append(row)
        for k in range(6):
            bm.faces.new((rings[0][k], rings[0][k + 1], rings[1][k + 1], rings[1][k]))

        obj = new_object(f"DSA_GoldPanel_{i:02d}", bm)
        assign(obj, mat)
        solidify(obj, 0.018)
        bm_objs.append(obj)
    out.extend(bm_objs)
    return out


def build_rim(mat):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=SUNSHIELD_DIAMETER / 2 * 0.955,
        minor_radius=0.032,
        major_segments=SUNSHIELD_SIDES * SUNSHIELD_SEGMENT_STEPS,
        minor_segments=8,
        location=(0, 0, 0),
    )
    rim = bpy.context.active_object
    rim.name = "DSA_Rim"
    assign(rim, mat)
    return [rim]


def build_shell(name, r_bottom, r_top, z0, z1, sides, rings, mat,
                crinkle: float, seed: int, flat: bool = True):
    """Tapered cylindrical shell, optionally crinkled. Used for tent, skirt and cap."""
    rng = random.Random(seed)
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        t = i / rings
        r = r_bottom + (r_top - r_bottom) * t
        z = z0 + (z1 - z0) * t
        row = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            envelope = math.sin(math.pi * t) ** 0.5
            rr = r + rng.uniform(-crinkle, crinkle) * envelope
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        grid.append(row)

    for i in range(rings):
        for j in range(sides):
            j2 = (j + 1) % sides
            bm.faces.new((grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]))

    obj = new_object(name, bm)
    assign(obj, mat)
    if flat:
        flat_shade(obj)
    solidify(obj, 0.045)
    return obj


def build_disc(name, radius, z, sides, mat, thickness=0.05):
    bm = bmesh.new()
    verts = [bm.verts.new((radius * math.cos(2 * math.pi * j / sides),
                           radius * math.sin(2 * math.pi * j / sides), z))
             for j in range(sides)]
    bm.faces.new(verts)
    obj = new_object(name, bm)
    assign(obj, mat)
    solidify(obj, thickness)
    return obj


def arc_panel(name, r_in, r_out, z0, z1, center_deg, span_deg, segments=12):
    """Curved panel following the hull.

    A flat box spanning 1.45 m of a 3.3 m tent deviates ~0.15 m from the wall at its
    ends and renders as a rectangle stuck onto the outside. An arc sits flush.
    """
    bm = bmesh.new()
    rings = []
    for i in range(segments + 1):
        a = math.radians(center_deg - span_deg / 2 + span_deg * i / segments)
        c, s = math.cos(a), math.sin(a)
        rings.append([
            bm.verts.new((r_in * c, r_in * s, z0)),
            bm.verts.new((r_out * c, r_out * s, z0)),
            bm.verts.new((r_out * c, r_out * s, z1)),
            bm.verts.new((r_in * c, r_in * s, z1)),
        ])
    for i in range(segments):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return new_object(name, bm)


def build_greebles(r_body, z0, z1, mat_strut, mat_gold):
    """Small surface hardware on the tent.

    The reference spacecraft is covered in brackets, boxes and gold foil patches.
    Without them a 3.3 m cylinder has no sense of scale — it could be a coffee can.
    Seeded, so the layout is identical on every rebuild.
    """
    rng = random.Random(101)
    out = []
    height = z1 - z0

    # Gold foil patches.
    for i in range(14):
        a = rng.uniform(0, 360)
        z = z0 + rng.uniform(0.12, 0.88) * height
        w = rng.uniform(4.0, 9.0)
        h = rng.uniform(0.09, 0.20)
        patch = arc_panel(f"PLM_FoilPatch_{i:02d}",
                          r_in=r_body * 0.998, r_out=r_body * 1.014,
                          z0=z - h / 2, z1=z + h / 2,
                          center_deg=a, span_deg=w, segments=4)
        assign(patch, mat_gold)
        out.append(patch)

    # Equipment boxes.
    for i in range(9):
        a = math.radians(rng.uniform(0, 360))
        z = z0 + rng.uniform(0.15, 0.85) * height
        d = rng.uniform(0.05, 0.11)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(
            math.cos(a) * (r_body + d / 2), math.sin(a) * (r_body + d / 2), z))
        box = bpy.context.active_object
        box.name = f"PLM_Box_{i:02d}"
        box.scale = (d, rng.uniform(0.14, 0.34), rng.uniform(0.10, 0.26))
        box.rotation_euler[2] = a
        assign(box, mat_strut)
        out.append(box)

    return out


def build_instrument_bay(r_body, z_ap, half_h, span, centre, idx, mat_strut, mat_gold):
    """The protruding instrument housing beside each aperture.

    In the reference this is the most eye-catching feature of the whole cylinder —
    a grey box in an ornate gold surround. Without it the aperture is just a slot.
    """
    out = []

    # Ornate gold surround: two vertical returns flanking the opening.
    for side in (-1, 1):
        edge = centre + side * span * 0.56
        post = arc_panel(f"PLM_ApSurround_{idx}_{'L' if side < 0 else 'R'}",
                         r_in=r_body * 0.985, r_out=r_body * 1.034,
                         z0=z_ap - half_h * 1.5, z1=z_ap + half_h * 1.5,
                         center_deg=edge, span_deg=span * 0.13, segments=3)
        assign(post, mat_gold)
        out.append(post)

    # Housing that stands proud of the hull, below the opening.
    a = math.radians(centre)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(
        math.cos(a) * (r_body + 0.10), math.sin(a) * (r_body + 0.10),
        z_ap - half_h * 1.9))
    bay = bpy.context.active_object
    bay.name = f"PLM_InstrumentBay_{idx}"
    bay.scale = (0.22, APERTURE_WIDTH * 0.62, 0.40)
    bay.rotation_euler[2] = a
    assign(bay, mat_strut)
    out.append(bay)

    # Small radiator face on the front of the housing.
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(
        math.cos(a) * (r_body + 0.21), math.sin(a) * (r_body + 0.21),
        z_ap - half_h * 1.9))
    face = bpy.context.active_object
    face.name = f"PLM_BayFace_{idx}"
    face.scale = (0.03, APERTURE_WIDTH * 0.44, 0.26)
    face.rotation_euler[2] = a
    assign(face, mat_gold)
    out.append(face)

    return out


def build_trim_ring(name, radius, z, mat, minor=0.035):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=minor,
        major_segments=BODY_SIDES, minor_segments=8, location=(0, 0, z))
    ring = bpy.context.active_object
    ring.name = name
    assign(ring, mat)
    return ring


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------
def build():
    clear_scene()

    mat_foil = make_material("MLI_Silver", (0.60, 0.615, 0.645, 1.0), 1.0, 0.30)
    mat_dark = make_material("MLI_Dark", (0.055, 0.057, 0.064, 1.0), 0.85, 0.44)
    mat_gold = make_material("ThermalGold", (0.83, 0.60, 0.13, 1.0), 1.0, 0.26)
    mat_cap = make_material("CapWhite", (0.86, 0.87, 0.885, 1.0), 0.40, 0.34)
    mat_strut = make_material("Strut", (0.34, 0.35, 0.38, 1.0), 0.90, 0.40)
    mat_optics = make_material("Optics", (0.010, 0.013, 0.024, 1.0), 0.6, 0.16,
                               emission=(0.008, 0.020, 0.048))
    # Polished band under the cap — near-mirror, which is what makes it catch light
    # so distinctly against the matte drum below it.
    mat_gloss = make_material("GlossBand", (0.20, 0.22, 0.26, 1.0), 1.0, 0.08)

    parts = []

    # ---- sunshield -------------------------------------------------------
    parts.append(build_shield_surface("DSA_Sunshield", mat_foil, CRINKLE_SHIELD, seed=7))
    parts += build_rim(mat_strut)
    parts += build_ribs(mat_strut)
    parts += build_gold_panels(mat_gold)

    # ---- body ------------------------------------------------------------
    r_body = BODY_DIAMETER / 2
    z_skirt0 = SUNSHIELD_THICKNESS * 0.5
    z_skirt1 = z_skirt0 + SKIRT_HEIGHT
    z_body1 = z_skirt1 + BODY_HEIGHT

    parts.append(build_shell("PLM_Skirt", r_body * SKIRT_FLARE, r_body,
                             z_skirt0, z_skirt1, BODY_SIDES, 5, mat_dark,
                             CRINKLE_BODY, seed=11))

    # The tent splits into a matte lower drum and a polished upper band — that
    # bright glassy ring under the cap is one of the spacecraft's most recognisable
    # features and a single uniform cylinder cannot produce it.
    z_gloss = z_body1 - BODY_HEIGHT * GLOSS_BAND

    tent = build_shell("PLM_ThermalTent", r_body, r_body,
                       z_skirt1, z_gloss, BODY_SIDES, BODY_RINGS, mat_dark,
                       CRINKLE_BODY, seed=13, flat=False)
    parts.append(tent)

    parts.append(build_shell("PLM_GlossBand", r_body, r_body,
                             z_gloss, z_body1, BODY_SIDES, 3, mat_gloss,
                             0.0, seed=19, flat=False))

    # Horizontal panel seams. Cheap, and they do more for perceived resolution
    # than any amount of extra silhouette detail.
    for frac in (0.16, 0.34, 0.52, 0.78):
        z = z_skirt1 + BODY_HEIGHT * frac
        parts.append(build_trim_ring(f"PLM_Seam_{int(frac*100)}",
                                     r_body * 1.002, z, mat_strut, minor=0.012))

    parts.append(build_trim_ring("PLM_TrimLower", r_body * 1.006, z_skirt1 + 0.05, mat_gold))
    parts.append(build_trim_ring("PLM_TrimGloss", r_body * 1.006, z_gloss, mat_gold))
    parts.append(build_trim_ring("PLM_TrimUpper", r_body * 1.006, z_body1 - 0.06, mat_gold))

    parts += build_greebles(r_body, z_skirt1, z_gloss, mat_strut, mat_gold)

    # ---- segmented conical cap ------------------------------------------
    # A flat drum lid was wrong: the real cap is a shallow faceted cone, like a
    # parasol, with a mast at the apex. CAP_SIDES is deliberately low so the facet
    # seams read as the radial panel joins.
    r_cap = r_body * CAP_OVERHANG
    z_cap = z_body1 + CAP_HEIGHT
    parts.append(build_shell("PLM_Cap", r_cap, r_cap * 0.10,
                             z_body1, z_cap, CAP_SIDES, 4, mat_cap,
                             0.0, seed=17, flat=True))
    parts.append(build_disc("PLM_CapApex", r_cap * 0.10, z_cap,
                            CAP_SIDES, mat_cap, thickness=0.04))

    # Rim lip under the cap edge, so it overhangs visibly rather than floating.
    parts.append(build_trim_ring("PLM_CapRim", r_cap * 0.995, z_body1 + 0.02,
                                 mat_strut, minor=0.030))

    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.035, depth=CAP_SPIKE,
                                        location=(0, 0, z_cap + CAP_SPIKE / 2))
    spike = bpy.context.active_object
    spike.name = "PLM_ApexMast"
    assign(spike, mat_strut)
    parts.append(spike)

    # ---- telescope apertures --------------------------------------------
    z_ap = z_skirt1 + BODY_HEIGHT * 0.60
    span = 2 * math.degrees(math.asin(min(0.99, (APERTURE_WIDTH / 2) / r_body)))
    half_h = APERTURE_HEIGHT / 2
    for i, sign in enumerate((-1, 1)):
        centre = sign * BASIC_ANGLE / 2

        # Cut a real hole through the tent wall.
        cutter = arc_panel(f"__cutter_{i+1}",
                           r_in=r_body * 0.86, r_out=r_body * 1.14,
                           z0=z_ap - half_h, z1=z_ap + half_h,
                           center_deg=centre, span_deg=span)
        boolean_cut(tent, cutter)

        # Baffle shaft behind the hole — its side walls self-shadow, which is what
        # gives the opening visible depth.
        shaft = arc_panel(f"PLM_ApertureShaft_{i+1}",
                          r_in=r_body * 0.42, r_out=r_body * 0.99,
                          z0=z_ap - half_h * 0.97, z1=z_ap + half_h * 0.97,
                          center_deg=centre, span_deg=span * 0.97)
        assign(shaft, mat_optics)
        parts.append(shaft)

        # Edge lips only — top and bottom. A single arc spanning the full opening
        # is a *filled* solid, which simply plugged the hole that was just cut.
        for lip, (lz0, lz1) in enumerate((
            (z_ap + half_h, z_ap + half_h + 0.055),
            (z_ap - half_h - 0.055, z_ap - half_h),
        )):
            strip = arc_panel(f"PLM_ApertureLip_{i+1}_{lip}",
                              r_in=r_body * 0.985, r_out=r_body * 1.028,
                              z0=lz0, z1=lz1,
                              center_deg=centre, span_deg=span * 1.06)
            assign(strip, mat_gold)
            parts.append(strip)

        parts += build_instrument_bay(r_body, z_ap, half_h, span, centre,
                                      i + 1, mat_strut, mat_gold)

    # ---- antenna ---------------------------------------------------------
    ant = build_disc("SVM_PhasedArrayAntenna", ANTENNA_DIAMETER / 2,
                     -(SUNSHIELD_THICKNESS * 0.5 + 0.06), 6, mat_strut,
                     thickness=-ANTENNA_THICKNESS)
    parts.append(ant)

    # Parent to an empty on the spin axis, so the web app rotates one node for the
    # 6-hour spin and precesses its parent for the 63-day cone.
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = "Gaia"
    for p in parts:
        p.parent = root
    return root


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def supported_gltf_params() -> set[str]:
    """Ask the operator which parameters this build accepts, rather than guess."""
    try:
        return {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    except Exception as exc:  # pragma: no cover
        print(f"   ! could not introspect glTF exporter ({exc})")
        return set()


def export(out_path: Path, draco: bool = True) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")

    supported = supported_gltf_params()
    desired = {
        "filepath": str(out_path),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_draco_mesh_compression_enable": draco,
        "export_draco_mesh_compression_level": 6,
    }
    if supported:
        kwargs = {k: v for k, v in desired.items() if k in supported or k == "filepath"}
        skipped = sorted(set(desired) - set(kwargs))
        if skipped:
            print(f"   note: exporter does not accept {skipped} — skipped")
    else:
        kwargs = {"filepath": str(out_path), "export_format": "GLB"}

    bpy.ops.export_scene.gltf(**kwargs)
    print(f"\nwrote {out_path}  ({out_path.stat().st_size / 1e3:.0f} KB)")


def dump_api() -> None:
    print(f"\nBlender {bpy.app.version_string}  (Python {sys.version.split()[0]})")
    probe = bpy.data.materials.new("__api_probe__")
    probe.use_nodes = True
    bsdf = find_principled(probe)
    if bsdf is not None:
        print("\nPrincipled BSDF inputs:")
        for socket in bsdf.inputs:
            print(f"   {socket.name!r}  ({socket.type})")
    bpy.data.materials.remove(probe)
    params = sorted(supported_gltf_params())
    print(f"\nexport_scene.gltf accepts {len(params)} params; export-related:")
    for p in params:
        if "draco" in p or p in ("export_format", "use_selection", "export_apply", "export_yup"):
            print(f"   {p}")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("web/public/models/gaia.glb"))
    ap.add_argument("--dump-api", action="store_true")
    ap.add_argument("--no-draco", action="store_true",
                    help="skip Draco (faster iteration, larger file)")
    args = ap.parse_args(argv)

    print(f"Blender {bpy.app.version_string}")
    if args.dump_api:
        dump_api()
        return

    build()
    if MISSING_SOCKETS:
        print(f"\n!! sockets not found on this build: {sorted(MISSING_SOCKETS)}")
        print("   run with --dump-api and update the candidates in make_material()")

    export(args.out.resolve(), draco=not args.no_draco)


if __name__ == "__main__":
    main()
