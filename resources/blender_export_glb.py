# 由 blenderService.ts 调用，把一批 .blend 批量导出成 GLB。
#
# 为什么是「一批」而不是一个：启动一次 Blender 进程要 0.5-1 秒，
# 128 个文件就是 128 次启动开销。一个进程里循环 open_mainfile
# 能把这部分开销摊掉，实测快 2-3 倍。
#
# 任务通过 JSON 文件传入，避免命令行长度限制和路径转义问题：
#   [{"in": "C:/a.blend", "out": "C:/a.glb"}, ...]
#
# 每转完一个立刻打印一行并 flush，上层据此增量更新界面，
# 不用等整批结束。
#
# 用法: blender -b --factory-startup -P blender_export_glb.py -- <jobs.json>
import bpy
import sys
import json
import os

argv = sys.argv
if "--" not in argv:
    print("BATCH_FATAL: 缺少任务文件参数", flush=True)
    sys.exit(1)

jobs_path = argv[argv.index("--") + 1]

try:
    with open(jobs_path, "r", encoding="utf-8") as fh:
        jobs = json.load(fh)
except Exception as e:
    print("BATCH_FATAL: 读取任务文件失败 %s" % e, flush=True)
    sys.exit(1)


def export_one(out_path):
    # 场景里一个可导出的物体都没有时，导出器会生成一个空 GLB。
    # 与其让预览器显示一片空白，不如明确报错让上层回退。
    exportable = [
        o for o in bpy.context.scene.objects
        if o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT", "ARMATURE", "EMPTY"}
    ]
    if not exportable:
        raise RuntimeError("场景中没有可导出的物体")

    kwargs = {
        "filepath": out_path,
        "export_format": "GLB",
        # 应用修改器，否则细分/镜像之类的效果在预览里看不到
        "export_apply": True,
        "export_yup": True,
    }
    # 不同 Blender 版本导出器参数名有出入，不认识的会抛 TypeError，逐层降级
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_yup", None)
        try:
            bpy.ops.export_scene.gltf(**kwargs)
        except TypeError:
            bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB")


for job in jobs:
    src = job.get("in")
    dst = job.get("out")
    try:
        bpy.ops.wm.open_mainfile(filepath=src)
        export_one(dst)
        if os.path.exists(dst):
            print("BATCH_OK\t%s" % src, flush=True)
        else:
            print("BATCH_ERR\t%s\t导出器没有产生文件" % src, flush=True)
    except Exception as e:
        # 单个文件失败不能拖垮整批
        msg = str(e).replace("\t", " ").replace("\n", " ")[:200]
        print("BATCH_ERR\t%s\t%s" % (src, msg), flush=True)

print("BATCH_DONE", flush=True)
