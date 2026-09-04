# 3D 资源预览器（绿色版）

批量预览 3D 素材的桌面工具。指向一个文件夹，立刻得到一墙可辨认的 3D 缩略图；
双击任意一个即可全屏放大、拖拽旋转、切换白膜 / 线框 / 法线等显示模式、换 HDRI 环境光。

**免费软件，MIT 许可，没有任何付费功能，不联网。**

解决的问题：Windows 资源管理器不给 3D 文件生成缩略图。一个装了 35 个模型的
素材包，在资源管理器里是 105 个一模一样的通用图标（模型混着 `.bin` 和贴图），
想知道哪个是哪个只能逐个拖进 Blender。

## 支持格式

| 类别 | 格式 |
|---|---|
| 开箱即用 | `glb` `gltf` `fbx` `obj` `stl` `ply` `dae` `3ds` `3mf` `wrl` `vrm` `usdz` `amf` `pcd` `vtk` `vtp` `drc` `xyz` `lwo` `vox` `kmz` `md2` `pmx` `pmd` `3dm` `gcode` |
| 需要 Blender | `blend` |
| 只列出、不预览 | `max` `ma` `mb` `c4d` `skp` `ztl` `abc` `usd` `usda` `usdc` `step` `stp` `iges` `dxf` `lws` `x` `spp` `sbs` `sbsar` `hip` `uasset` 等私有格式（可拖出、用默认程序打开、收藏打标；可在设置里关掉） |

`.bin`、`.mtl`、贴图、Godot `.import` 等会被自动识别为伴生文件并隐藏，只留下真正的模型。
贴图支持 png / jpg / webp / tga / dds / ktx2 等；FBX 引用了不存在的 `.fbm` 目录时会自动在模型旁边找同名贴图。

## 使用

解压后双击 `3D资源预览器.exe`。不需要安装任何东西。

也可以把文件夹直接拖到 exe 上，或带参数启动：

```bash
"3D资源预览器.exe" --folder="D:\素材\FreePack"
```

程序是单实例的：再启动一次只会把新文件夹交给已经开着的窗口。

### 网格

| 操作 | 效果 |
|---|---|
| Ctrl+O / F5 | 打开文件夹 / 重新扫描 |
| Ctrl+F | 搜索（名称、路径、标签） |
| 双击 / Enter | 放大进入查看器 |
| 方向键 / Home / End / PgUp / PgDn | 移动焦点 |
| Ctrl+点击 / Shift+点击 / Ctrl+A | 多选 / 连选 / 全选 |
| Ctrl+D | 收藏 / 取消收藏 |
| Ctrl+B | 文件夹侧栏 |
| Ctrl+= / Ctrl+- | 放大 / 缩小卡片 |
| F1 | 快捷键帮助 |

筛选行可以按格式、收藏、标签、是否带动画、是否失败筛选；排序支持名称 / 大小 / 修改时间 / 格式 / 面数，可升降序。
选中一个或多个后，底部出现批量操作条：收藏、标签、导出到文件夹、转为 GLB 导出、生成接触表、复制路径。

右键卡片：放大查看、收藏、编辑标签、用 Blender 打开、用默认程序打开、在资源管理器中显示、复制路径、重新生成缩略图、查看失败原因、导出为 GLB。

### 查看器

| 操作 | 效果 |
|---|---|
| 左键拖拽 / 滚轮 / 右键拖拽 | 旋转 / 缩放 / 平移 |
| 双击画布 / `F` | 重置视角 |
| `1` `3` `7` `5` | 前视 / 侧视 / 顶视 / 等轴 |
| `W` `G` `R` | 线框 / 地面网格 / 自动旋转 |
| `空格` | 播放 / 暂停动画 |
| `←` `→` | 上一个 / 下一个模型 |
| `Tab` | 显示 / 隐藏右侧面板 |
| `Esc` | 返回网格 |

右侧面板六页：

- **显示**：材质 / 白膜 / 雕塑（Matcap）/ 法线 / UV 棋盘 / 线框 / 透视；平滑 / 平直着色；线框叠加；环境光遮蔽（GTAO）；地面阴影；网格 / 坐标轴 / 包围盒；背景色。
- **环境**：程序化房间或 HDRI 环境光（内置 4 张 Poly Haven CC0 HDRI，可导入自己的 .hdr / .exr）；强度、旋转、是否显示为背景、背景模糊；补光预设。
- **相机**：视角预设、透视 / 正交、视场角、自动旋转。
- **动画**：片段选择、时间轴、速度、循环。
- **结构**：节点树（勾选隐藏、双击单独显示）、材质与贴图清单。
- **信息**：文件信息、几何统计、尺寸与单位换算。

「导出截图」支持当前视图、2 倍分辨率、透明背景。

### 拖进 Blender

选好的卡片可以直接拖出窗口，扔进 Blender、Unity、UE 或资源管理器。
`Ctrl` 点选、`Shift` 连选、`Ctrl+A` 全选，可以一次拖多个。

拖的是模型文件本身，不带 `.bin` 和贴图 —— 导入器会自己按相对路径找这些
伴生文件，多拖反而会被当成多个独立文件重复导入。

Blender 那边能不能接住，取决于版本（可以用下面这条命令查自己的版本支持哪些）：

| Blender | 可拖入的格式 |
|---|---|
| 4.5 | `.fbx` `.glb` `.gltf` |
| 5.1 | `.glb` `.gltf`（**`.fbx` 不支持**，是 Blender 自己的回退） |

```bash
blender -b --python-expr "import bpy;print([(c.bl_file_extensions,c.bl_import_operator) for c in bpy.types.FileHandler.__subclasses__()])"
```

`.blend` 一直可以直接拖入（Blender 会打开它）。如果你的 Blender 版本
不接受某个格式，右键卡片「用 Blender 打开」（会调用对应导入器）或「导出为 GLB」再拖那个 GLB 即可。

## 绿色版说明

所有配置和缓存写在 exe 同级的 `data/` 目录里，包括 Chromium 自己的缓存：

```
data/
├─ thumbs/      缩略图缓存（按文件名+大小+修改时间索引，换盘符也能命中）
├─ glb/         Blender 转换出的 GLB
├─ hdri/        你自己导入的 HDRI
├─ logs/        app.log（2 MB 轮转）
├─ settings.json / library.json（收藏与标签）/ recent.json / window.json
```

不写注册表，不碰 `%APPDATA%`。整个文件夹拷到 U 盘或另一台机器可以直接跑。
缓存有上限（默认 2 GB，设置里可改），超出后自动删最久没用的。

若程序所在目录不可写（只读介质、放在 Program Files 且无权限），会自动退回
系统默认位置，不会因此启动失败。

出了问题先看 `data/logs/app.log`（菜单：帮助 → 打开日志目录）。缩略图全部失败、
画面花屏多半是显卡驱动问题，可以在设置里勾「关闭 GPU 加速」后重启试试。

## 关于 .blend

`.blend` 是唯一需要外部依赖的格式 —— **没有任何 JS 库能解析 .blend 的几何体，
只有 Blender 自己能读**。所以采用分层策略：

1. **内嵌预览图**（毫秒级，零依赖）——
   直接从 `.blend` 文件里抠出保存时写入的预览图，网格上立刻有图。
   支持 2.8 到 5.x 的文件头（5.0 起换了新格式），支持 gzip 和 zstd 压缩。
2. **转成 GLB**（后台自动，需要 Blender）——
   调用本机已安装的 Blender 无头导出 GLB 并缓存，转完之后该文件就能
   和其它格式一样自由旋转缩放。

程序会自动探测各盘符 `Program Files\Blender Foundation\` 下的所有版本、Steam 版
以及 PATH 上的 blender，并**按版本匹配**：读取 `.blend` 头部记录的保存版本，
挑一个不低于它的 Blender 来转（高版本存的文件低版本打不开）。
也可以在设置里手动指定路径。

转换是**批量**做的：一个 Blender 进程里循环 `open_mainfile` 处理 12 个文件，
带看门狗 —— 一个文件卡死不会拖累同批其它文件。每转完一个就立刻刷新对应卡片。

### 内嵌预览图什么时候会被丢弃

Blender 的 `Preferences > Save & Load > File Preview Type` 有三种模式：

- `Camera View` / `Auto` —— 渲染模型，输出接近正方形（128×128）
- `Screenshot` —— **截整个应用窗口**，输出是窗口比例（如 128×68）

后者拿来当缩略图毫无意义：满屏是大纲视图和属性面板，模型只是正中间一个小点。
所以宽高比明显偏离正方形的内嵌图会被直接丢弃，宁可留占位符等真渲染。

已知限制：

- 没装 Blender 时，`.blend` 只能看内嵌预览图，无法进入 3D 交互。
- **Blender 无头模式（`-b`）保存的 .blend 不含内嵌预览图**，这类文件必须靠第 2 层转换才能有缩略图。

## 开发

```bash
npm install
npm run dev
```

```bash
npm run typecheck   # tsc
npm test            # vitest 单元测试（纯逻辑模块）
npm run pack        # 构建 + electron-builder，产物在 release/win-unpacked 和 release/*.zip
npm run release     # typecheck + test + pack + 把绿色版 zip 和源码 zip 复制到上级目录
```

### 验收脚本

都用真实素材跑，不用 mock：

```bash
npx electron scripts/verify-render.cjs "D:\素材目录"    # 离屏出图，逐张分析像素，识别空白/纯色
npx electron scripts/verify-ui.cjs "D:\素材目录"        # 真实主进程：扫描、出图、进查看器、拖拽旋转
npx electron scripts/verify-viewer.cjs "D:\素材目录"    # 逐个切换显示模式/AO/HDRI/相机并截图，收集报错
npx electron scripts/verify-drag.cjs "D:\素材目录"      # 多选与拖出的文件列表
node scripts/verify-blend.mjs "D:\blend目录"            # .blend 内嵌图解析（含 Blender 5 新格式）
```

注意 `verify-drag` 会先把应用自己的 `drag:start` 处理器摘掉再测 —— `webContents.startDrag()`
在 Windows 上会进入系统级模态拖拽循环，脚本发的合成事件没有真实鼠标手势，
那个循环永远等不到结束，主进程会直接卡死。

## 架构

```
main 进程 (Node)
├─ argv.ts           启动参数解析（--folder / 位置参数）
├─ scanner.ts        递归扫描 + 伴生文件抑制 + 进度/取消
├─ cache.ts          便携路径 + 缩略图缓存 + 淘汰
├─ pathPolicy.ts     asset3d:// 路径策略（越权判断、UNC、贴图兜底），纯逻辑
├─ protocol.ts       asset3d:// 协议处理
├─ blendThumb.ts     .blend 内嵌预览图提取（纯 JS，2.8–5.x）
├─ blenderService.ts Blender 探测 / 版本匹配 / 批量转 GLB / 导入打开
├─ jobQueue.ts       出图任务优先级队列（可见优先），纯逻辑
├─ thumbnailer.ts    worker 池、崩溃恢复、GLB 导出
├─ hdri.ts           HDRI 环境贴图管理
├─ menu.ts / log.ts / settings.ts / library.ts / windowState.ts

隐藏的 worker BrowserWindow ×N
└─ three.js 离屏渲染 → PNG / GLTFExporter → GLB

主窗口 (React)
├─ App.tsx           工具栏、筛选、选择、右键菜单、导出
├─ Grid.tsx          虚拟化网格 + 视口优先出图
├─ Sidebar.tsx       文件夹树
├─ Viewer.tsx        查看器（React 层）
├─ ViewerPanel.tsx   查看器右侧面板
└─ lib/viewerEngine.ts  查看器 three.js 引擎（显示模式、HDRI、AO、阴影、相机、动画、结构）
```

几个关键设计：

**缩略图在隐藏的 BrowserWindow 里渲染，而不是在 Node 里。**
Node 侧做 WebGL 需要 `headless-gl` 这类原生模块，编译麻烦且会拖累绿色打包。
隐藏窗口里是真实 WebGL 上下文，而且跑的是和详情查看器完全相同的代码路径，
缩略图和放大后看到的效果天然一致。GPU 进程崩了会自动重建窗口。

**自定义 `asset3d://` 协议承载本地文件。**
注册成 standard scheme 后，three.js 按字符串拼接解析相对路径的行为可以直接
复用。同时只放行用户主动打开过的目录，挡住 `../../../Windows/System32/...` 这类越权读取。

**ASCII FBX 先规整缩进再解析。**
three.js 的 FBX 文本解析器按每行 tab 数判断层级，Kenney 等素材包的导出器
把数组闭合括号多缩进了一层，结果整包 FBX 全部解析失败。加载前按花括号层级
重建一遍缩进，对规整文件是等价变换。

**老式材质统一转成 PBR。**
three.js 里只有 PBR 材质吃 `scene.environment`，`MeshPhongMaterial` 收不到
环境光照。不转的话同一个模型的 glTF 版明亮通透、FBX 版却发灰发暗。

**等贴图真正就位再渲染。**
`FBXLoader` 等是 `TextureLoader.load()` 发出去就不管 —— `loadAsync` 返回时
`texture.image` 往往还是 `undefined`，此时渲染会得到一张空贴图，模型全黑。
用带完成信号的 `LoadingManager` 等齐，同时在 manager 上注册 TGA / DDS 解码器。
