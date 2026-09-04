# 由 blenderService.ts 调用：在 GUI 模式下把一个非 .blend 的模型文件导入 Blender。
#
# Blender 的命令行位置参数只认 .blend，`blender model.fbx` 会报 "not a blend file"，
# 所以要靠这个脚本按扩展名调对应的导入算子。不同版本算子名不一样
# （FBX 在 5.0 变成了 wm.fbx_import，OBJ 在 3.3 变成了 wm.obj_import），
# 逐个尝试，哪个存在用哪个。
#
# 用法: blender --python blender_import.py -- <file>
import bpy
import os
import sys

argv = sys.argv
if "--" not in argv:
    sys.exit(0)
target = argv[argv.index("--") + 1]
ext = os.path.splitext(target)[1].lower()

# 扩展名 -> 候选算子（按优先级）
CANDIDATES = {
    ".fbx": ["wm.fbx_import", "import_scene.fbx"],
    ".obj": ["wm.obj_import", "import_scene.obj"],
    ".gltf": ["import_scene.gltf"],
    ".glb": ["import_scene.gltf"],
    ".vrm": ["import_scene.gltf"],
    ".stl": ["wm.stl_import", "import_mesh.stl"],
    ".ply": ["wm.ply_import", "import_mesh.ply"],
    ".dae": ["wm.collada_import"],
    ".usd": ["wm.usd_import"],
    ".usda": ["wm.usd_import"],
    ".usdc": ["wm.usd_import"],
    ".usdz": ["wm.usd_import"],
    ".abc": ["wm.alembic_import"],
    ".3ds": ["import_scene.autodesk_3ds", "import_scene.max3ds"],
    ".x3d": ["import_scene.x3d"],
    ".wrl": ["import_scene.x3d"],
    ".svg": ["import_curve.svg"],
    ".3mf": ["import_mesh.3mf"],
}


def resolve(op_path):
    """'wm.obj_import' -> bpy.ops.wm.obj_import，不存在返回 None"""
    mod, name = op_path.split(".", 1)
    group = getattr(bpy.ops, mod, None)
    if group is None:
        return None
    op = getattr(group, name, None)
    try:
        # 未注册的算子 poll 会抛 AttributeError
        if op is None or not op.poll():
            return None
    except Exception:
        return None
    return op


def report(msg):
    print("IMPORT: %s" % msg, flush=True)
    try:
        def draw(self, _ctx):
            self.layout.label(text=msg)
        bpy.context.window_manager.popup_menu(draw, title="3D 资源预览器", icon="INFO")
    except Exception:
        pass


def run():
    ops = CANDIDATES.get(ext)
    if not ops:
        report("不知道怎么导入 %s 格式" % ext)
        return
    for op_path in ops:
        op = resolve(op_path)
        if op is None:
            continue
        try:
            op(filepath=target)
            report("已导入 %s" % os.path.basename(target))
            return
        except Exception as e:  # noqa: BLE001
            report("导入失败: %s" % e)
            return
    report("当前 Blender 版本没有 %s 的导入器（可能需要启用对应插件）" % ext)


# 要等窗口就绪之后再导入，否则某些算子 poll 不通过
def _deferred():
    run()
    return None


bpy.app.timers.register(_deferred, first_interval=0.5)
