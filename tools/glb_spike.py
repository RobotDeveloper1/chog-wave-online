"""
Prototype: one GLB per Chog, carrying idle/walk/attack/hit as named clips.

A spike, not a pipeline. It answers two questions that decide whether the town
and the battle field can be real 3D:

  1. Do all four actions survive a glTF export as separate named AnimationClips?
     Assigning obj.animation_data.action replaces the previous one, so only the
     last action ever exported. Each action has to be pushed onto the NLA stack.
  2. Is the result small enough to serve 1969 of them? Sixty-one separate parts
     cost ~700KB, which is 1.4GB for the collection. Collapsing parts into one
     node per rig group is both smaller and the correct rig shape, because every
     part in a group already shares a bone.

    blender --background --python tools/glb_spike.py
"""

import json
import os
import struct
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# chog.py lives in blender/, not alongside this spike.
sys.path.insert(0, os.path.join(ROOT, "blender"))

import chog  # noqa: E402

OUT = os.path.join(ROOT, "blender", "out", "_glbspoke")
FPS = 12


def collapse_by_bone(parts):
    """Join parts that share a rig bone into one node.

    apply_pose already moves every part of a group identically, so merging them
    loses no motion — it only removes per-node overhead the GPU never needed.
    """
    groups = {}
    for o in parts:
        groups.setdefault(o.get("rig", "head"), []).append(o)

    merged = []
    for bone, objs in groups.items():
        if len(objs) == 1:
            objs[0].name = f"navi_{bone}"
            merged.append(objs[0])
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = f"navi_{bone}"
        merged.append(joined)
    return merged


def key_actions(parts):
    """Key each game action and push it down so all four survive the export."""
    order = list(reversed(chog.ACTIONS.items())) if os.environ.get("REORDER") else list(chog.ACTIONS.items())
    for act_name, count in order:
        act = bpy.data.actions.new(act_name)
        frame = 1
        for i in range(count):
            chog.apply_pose(parts, act_name, i / count)
            for o in parts:
                o.animation_data_create()
                o.animation_data.action = act
                o.keyframe_insert("location", frame=frame)
                o.keyframe_insert("rotation_euler", frame=frame)
                o.keyframe_insert("scale", frame=frame)
            frame += 1
        # Return to the rest pose at the end so looping does not snap.
        chog.apply_pose(parts, act_name, 0.0)
        for o in parts:
            o.animation_data.action = act
            o.keyframe_insert("location", frame=frame)
            o.keyframe_insert("rotation_euler", frame=frame)
            o.keyframe_insert("scale", frame=frame)

        # Without this the next action replaces the object's action and the
        # exporter only ever sees the last one.
        for o in parts:
            o.animation_data_create()
            o.animation_data.action = act
            track = o.animation_data.nla_tracks.new()
            track.name = act_name
            track.strips.new(act_name, 1, act)
            o.animation_data.action = None
            # A strip that shares its name with its track is dropped by the
            # exporter's NLA pass, which is how the 'hit' clip went missing.
            track.strips[-1].name = f"{act_name}_strip"


def tri_count(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return max(0, n)


def fit_budget(parts, target=3500):
    """Decimate to a triangle budget.

    The generator builds spheres at 32x20 because it is also used for 512px
    stills. In a browser at ~150px that is twenty times the geometry needed, and
    1969 models at that density is over a gigabyte.
    """
    total = sum(tri_count(o) for o in parts)
    if total <= target:
        print(f"tris={total} (under budget, no decimation)")
        return total
    ratio = max(0.05, target / total)
    for o in parts:
        mod = o.modifiers.new("Budget", 'DECIMATE')
        mod.ratio = ratio
    bpy.context.view_layer.update()
    total = sum(tri_count(o) for o in parts)
    print(f"tris after decimate ratio={ratio:.3f}: {total}")
    return total


def report(path):
    with open(path, "rb") as fh:
        fh.read(12)
        length, _type = struct.unpack("<II", fh.read(8))
        blob = json.loads(fh.read(length).decode("utf-8"))

    accessors = blob.get("accessors", [])
    meshes = blob.get("meshes", [])
    tris = 0
    verts = 0
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            idx = prim.get("indices")
            if idx is not None and idx < len(accessors):
                tris += accessors[idx].get("count", 0) // 3
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is not None and pos < len(accessors):
                verts += accessors[pos].get("count", 0)

    print(f"  nodes={len(blob.get('nodes', []))} meshes={len(meshes)} triangles={tris} verts={verts}")
    for anim in blob.get("animations", []):
        frames = 0
        for sampler in anim.get("samplers", []):
            src = sampler.get("input", 0)
            if src < len(accessors):
                frames = max(frames, accessors[src].get("count", 0))
        print(f"  clip {anim.get('name')!r} channels={len(anim.get('channels', []))} frames={frames}")


def main():
    os.makedirs(OUT, exist_ok=True)
    chog.setup_scene()
    params = chog.load_params()
    token = "1"
    chog.clear_chog()
    parts = chog.build_chog(params[token], keep_apart=True)
    print(f"parts built: {len(parts)}")

    parts = collapse_by_bone(parts)
    print(f"after collapse: {len(parts)} -> {[o.name for o in parts]}")
    fit_budget(parts)

    key_actions(parts)
    bpy.context.scene.render.fps = FPS

    probe = parts[0]
    print(f"DIAG {probe.name}: actions_in_file="
          f"{sorted(a.name for a in bpy.data.actions)}")
    for tr in probe.animation_data.nla_tracks:
        for st in tr.strips:
            print(f"DIAG track={tr.name!r} strip={st.name!r} act={st.action.name!r} "
                  f"frames={st.frame_start}..{st.frame_end} "
                  f"fmod={st.frame_start}..{st.frame_end if not st.action else (st.action.frame_range[:])}")

    path = os.path.join(OUT, f"chog_{token}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_apply=True,
        export_yup=True,
    )
    print(f"glb: {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    report(path)


if __name__ == "__main__":
    main()
