"""Build the original MIT-licensed survey quadcopter with Blender.

Run: blender --background --threads 2 --python tools/build_simulation_quadcopter.py
The GLB is self-contained, in metres, Y-up with its nose toward local -X,
matching the bundled aircraft convention. No third-party geometry/textures.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, emission=False):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = 0.42
    if emission:
        shader.inputs['Emission Color'].default_value = (*color, 1)
        shader.inputs['Emission Strength'].default_value = 2
    return result


body = material('Graphite airframe', (0.08, 0.11, 0.14), 0.25)
white = material('Light survey shell', (0.82, 0.88, 0.91))
metal = material('Motor aluminium', (0.22, 0.27, 0.32), 0.8)
prop = material('Carbon propellers', (0.09, 0.13, 0.16), 0.15)
lens = material('Camera glass', (0.02, 0.12, 0.19), 0.8)
red = material('Port navigation lamp', (0.9, 0.04, 0.03), emission=True)
green = material('Starboard navigation lamp', (0.05, 0.9, 0.25), emission=True)


def finish(obj, name, surface):
    obj.name = name
    obj.data.materials.append(surface)
    return obj


def box(name, location, dimensions, surface, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new('Rounded edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return finish(obj, name, surface)


def cylinder(name, a, b, radius, surface, vertices=12):
    a, b = Vector(a), Vector(b)
    direction = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                      depth=direction.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, surface)


box('Fuselage', (0, 0, 0), (0.29, 0.19, 0.105), white, 0.025)
box('Battery', (0.015, 0, 0.075), (0.21, 0.13, 0.06), body, 0.012)
box('Flight controller', (0, 0, -0.06), (0.16, 0.12, 0.04), body, 0.008)
for x in (-0.32, 0.32):
    for y in (-0.32, 0.32):
        corner = f'{x:+.2f},{y:+.2f}'
        cylinder(f'Arm {corner}', (x*0.15, y*0.15, 0), (x, y, 0.025), 0.018, body)
        cylinder(f'Motor {corner}', (x, y, 0.005), (x, y, 0.085), 0.035, metal)
        cylinder(f'Hub {corner}', (x, y, 0.085), (x, y, 0.108), 0.015, body)
        blade = box(f'Propeller {corner}', (x, y, 0.094), (0.28, 0.025, 0.008), prop, 0.004)
        blade.rotation_euler.z = math.radians(35 if x*y > 0 else -35)
        cylinder(f'Landing strut {corner}', (x*0.5, y*0.5, -0.01), (x*0.65, y*0.65, -0.2), 0.008, metal)
        box(f'Landing foot {corner}', (x*0.65, y*0.65, -0.205), (0.065, 0.03, 0.012), body, 0.004)
        box(f'Navigation lamp {corner}', (x, y, 0.043), (0.045, 0.048, 0.014), red if y < 0 else green)
# Nose is -X; a small forward camera and underslung survey gimbal make the
# model's direction legible without textures or external image downloads.
box('Forward camera', (-0.15, 0, -0.005), (0.045, 0.075, 0.055), body, 0.01)
cylinder('Forward lens', (-0.17, 0, -0.005), (-0.18, 0, -0.005), 0.017, lens, 16)
cylinder('Gimbal mount', (-0.055, 0, -0.07), (-0.055, 0, -0.115), 0.013, metal)
box('Survey camera', (-0.055, 0, -0.14), (0.07, 0.065, 0.055), white, 0.008)
cylinder('Survey lens', (-0.09, 0, -0.14), (-0.1, 0, -0.14), 0.022, lens, 16)

output = Path(__file__).resolve().parents[1] / 'public/models/quadcopter.glb'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
                          export_yup=True, export_animations=False,
                          export_cameras=False, export_lights=False)
print(f'Generated {output} ({output.stat().st_size} bytes)')
