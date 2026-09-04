# 生成测试用 .blend：一个有材质的场景，分别存成未压缩和压缩两个版本。
# 用法: blender -b --factory-startup -P scripts/make-test-blend.py -- <输出目录>
import bpy
import sys
import os
import math

argv = sys.argv
outdir = argv[argv.index("--") + 1] if "--" in argv else "."
os.makedirs(outdir, exist_ok=True)

# 清空默认场景
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def mat(name, rgba, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    return m

# 摆几个不同形状和颜色的物体，方便肉眼确认缩略图是不是这个场景
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(-2.2, 0, 1))
bpy.context.object.data.materials.append(mat("Red", (0.8, 0.15, 0.12, 1), 0.0, 0.35))
bpy.ops.object.shade_smooth()

bpy.ops.mesh.primitive_cube_add(size=1.7, location=(0, 0, 0.85))
bpy.context.object.data.materials.append(mat("Blue", (0.13, 0.35, 0.85, 1), 0.1, 0.5))

bpy.ops.mesh.primitive_cone_add(radius1=1.0, depth=2.2, location=(2.2, 0, 1.1))
bpy.context.object.data.materials.append(mat("Green", (0.2, 0.7, 0.25, 1), 0.0, 0.6))

bpy.ops.mesh.primitive_torus_add(major_radius=0.9, minor_radius=0.3, location=(0, 2.4, 0.9),
                                 rotation=(math.radians(90), 0, 0))
bpy.context.object.data.materials.append(mat("Gold", (0.95, 0.72, 0.2, 1), 1.0, 0.25))

bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
bpy.context.object.data.materials.append(mat("Floor", (0.55, 0.55, 0.58, 1), 0.0, 0.9))

# 相机和灯，保证内嵌预览图里能看见东西
bpy.ops.object.camera_add(location=(7.5, -7.5, 5.5), rotation=(math.radians(63), 0, math.radians(45)))
bpy.context.scene.camera = bpy.context.object
bpy.ops.object.light_add(type="SUN", location=(4, -4, 8))
bpy.context.object.data.energy = 3.0

# 关键：打开保存预览图，否则 .blend 里根本没有 TEST 块。
# Blender 4.x 把这个开关换成了枚举 file_preview_type（NONE/AUTO/SCREENSHOT/CAMERA）
bpy.context.preferences.filepaths.file_preview_type = "CAMERA"

uncompressed = os.path.join(outdir, "test_scene.blend")
compressed = os.path.join(outdir, "test_scene_compressed.blend")

bpy.ops.wm.save_as_mainfile(filepath=uncompressed, compress=False)
print("SAVED:", uncompressed)

bpy.ops.wm.save_as_mainfile(filepath=compressed, compress=True)
print("SAVED:", compressed)
