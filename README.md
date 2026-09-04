# 3D 资源预览器（绿色版）

批量预览 3D 素材的桌面工具。指向一个文件夹，立刻得到一墙可辨认的 3D 缩略图；
双击任意一个即可全屏放大、拖拽旋转、滚轮缩放细看。

解决的问题：Windows 资源管理器不给 3D 文件生成缩略图。一个装了 35 个模型的
素材包，在资源管理器里是 105 个一模一样的通用图标（模型混着 `.bin` 和贴图），
想知道哪个是哪个只能逐个拖进 Blender。

## 支持格式

| 类别 | 格式 |
|---|---|
| 开箱即用 | `glb` `gltf` `fbx` `obj` `stl` `ply` `dae` `3ds` `3mf` `wrl` `vrm` |
| 需要 Blender | `blend` |

`.bin`、`.mtl` 和贴图会被自动识别为伴生文件并隐藏，只留下真正的模型。

## 使用

解压后双击 `3D资源预览器.exe`。不需要安装任何东西。

也可以带参数启动，直接打开指定目录：

```bash
"3D资源预览器.exe" --folder="D:\素材\FreePack"
```

### 操作

| 操作 | 效果 |
|---|---|
| 双击卡片 / Enter | 放大进入 3D 查看器 |
| 左键拖拽 | 旋转 |
| 滚轮 | 缩放 |
| 右键拖拽 | 平移 |
| `←` `→` | 上一个 / 下一个模型 |
| `F` | 重置视角 |
| `W` | 线框 |
| `G` | 地面网格 |
| `空格` | 播放/暂停动画 |
| `Esc` | 返回网格 |

右键卡片可以：在资源管理器中定位、复制路径、重新生成缩略图、导出 GLB。

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
不接受某个格式，右键卡片「导出为 GLB」再拖那个 GLB 即可。

## 绿色版说明

所有配置和缓存写在 exe 同级的 `data/` 目录里，包括 Chromium 自己的缓存。
不写注册表，不碰 `%APPDATA%`。整个文件夹拷到 U 盘或另一台机器可以直接跑，
缩略图缓存一起跟着走。

若程序所在目录不可写（只读介质、放在 Program Files 且无权限），会自动退回
系统默认位置，不会因此启动失败。

## 关于 .blend

`.blend` 是唯一需要外部依赖的格式 —— **没有任何 JS 库能解析 .blend 的几何体，
只有 Blender 自己能读**。所以采用分层策略：

1. **内嵌预览图**（毫秒级，零依赖）——
   直接从 `.blend` 文件里抠出保存时写入的预览图，网格上立刻有图。
2. **转成 GLB**（后台自动，需要 Blender）——
   调用本机已安装的 Blender 无头导出 GLB 并缓存，转完之后该文件就能
   和其它格式一样自由旋转缩放。

程序会自动探测 `C:\Program Files\Blender Foundation\` 下的所有版本、Steam 版
以及 PATH 上的 blender，并**按版本匹配**：读取 `.blend` 头部记录的保存版本，
挑一个不低于它的 Blender 来转（高版本存的文件低版本打不开）。
也可以在设置里手动指定路径。

转换是**批量**做的：一个 Blender 进程里循环 `open_mainfile` 处理 12 个文件，
而不是一个文件起一次进程。启动一次 Blender 要 0.5-1 秒，128 个文件就是
128 次启动开销 —— 批量之后实测 12 个文件总共 0.9 秒（约 0.08 秒/个）。
每转完一个就立刻刷新对应卡片，不用等整批结束。

### 内嵌预览图什么时候会被丢弃

Blender 的 `Preferences > Save & Load > File Preview Type` 有三种模式：

- `Camera View` / `Auto` —— 渲染模型，输出接近正方形（128×128）
- `Screenshot` —— **截整个应用窗口**，输出是窗口比例（如 128×70）

后者拿来当缩略图毫无意义：满屏是大纲视图和属性面板，模型只是正中间一个小点。
所以宽高比明显偏离正方形的内嵌图会被直接丢弃，宁可留占位符等真渲染，
也不显示一张误导人的截图。

三个已知限制：

- 没装 Blender 时，`.blend` 只能看内嵌预览图，无法进入 3D 交互。
- **Blender 无头模式（`-b`）保存的 .blend 不含内嵌预览图**（没有视口可截），
  这类文件必须靠第 2 层转换才能有缩略图。
- 用 `Screenshot` 模式保存的 .blend 同理 —— 内嵌图会被丢弃，走第 2 层。

## 开发

```bash
npm install
npm run dev
```

打绿色包：

```bash
npm run pack
```

产物在 `release/win-unpacked/`，整个目录压缩即可分发（约 275MB）。

### 验收脚本

都用真实素材跑，不用 mock：

```bash
npx electron scripts/verify-render.cjs "D:\素材目录"
```

批量出图并逐张分析像素，报告覆盖率、色彩数、均色，能自动识别"渲染成空白"
和"渲染成纯色"这两类静默失败。

```bash
npx electron scripts/verify-ui.cjs "D:\素材目录"
```

启动真实主进程，打开目录、等出图、双击进查看器、用 `sendInputEvent` 发真实
鼠标事件验证拖拽旋转和滚轮缩放确实生效，并截图到 `.verify-ui/`。

```bash
npx electron scripts/verify-drag.cjs "D:\素材目录"
```

验证多选（Ctrl/Shift/Ctrl+A）和拖出时算出的文件列表是否正确。
注意它会先把应用自己的 `drag:start` 处理器摘掉再测 —— `webContents.startDrag()`
在 Windows 上会进入系统级模态拖拽循环，脚本发的合成事件没有真实鼠标手势，
那个循环永远等不到结束，主进程会直接卡死。

```bash
node scripts/verify-blend.mjs [.blend 目录]
```

验证 `.blend` 的 TEST 块解析，包括垂直翻转是否正确（Blender 按 OpenGL 惯例
自下而上存储行）。

生成测试用 .blend：

```bash
"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" -b --factory-startup -P scripts/make-test-blend.py -- .testdata
```

## 架构

```
main 进程 (Node)
├─ scanner.ts        递归扫描 + 伴生文件抑制
├─ cache.ts          便携路径 + 缩略图缓存
├─ protocol.ts       asset3d:// 协议 + 贴图路径兜底
├─ blendThumb.ts     .blend 内嵌预览图提取（纯 JS）
├─ blenderService.ts Blender 探测 / 版本匹配 / 转 GLB
└─ thumbnailer.ts    出图队列与 worker 池

隐藏的 worker BrowserWindow ×N
└─ three.js 离屏渲染 → PNG

主窗口 (React)
├─ Grid.tsx    虚拟化网格 + 视口优先出图
└─ Viewer.tsx  OrbitControls 详情查看器
```

几个关键设计：

**缩略图在隐藏的 BrowserWindow 里渲染，而不是在 Node 里。**
Node 侧做 WebGL 需要 `headless-gl` 这类原生模块，编译麻烦且会拖累绿色打包。
隐藏窗口里是真实 WebGL 上下文，而且跑的是和详情查看器完全相同的代码路径，
缩略图和放大后看到的效果天然一致。

**自定义 `asset3d://` 协议承载本地文件。**
注册成 standard scheme 后，three.js 按字符串拼接解析相对路径的行为可以直接
复用 —— `Barrel.gltf` 引用的 `Barrel.bin` 和 `textures/ColorAtlas.png`
会自然拼成正确 URL，不需要 `setURLModifier`。同时只放行用户主动打开过的目录，
挡住 `../../../Windows/System32/...` 这类越权读取。

**贴图找不到时逐级向上兜底。**
现实中的 FBX 经常引用一个不存在的路径（比如 `Barrel.fbm/ColorAtlas.png` ——
FBX 提取内嵌媒体用的 `.fbm` 目录，导出后往往不会一起带上），而真正的贴图
就平铺在模型旁边。协议层统一兜底，所有加载器都受益。

**老式材质统一转成 PBR。**
three.js 里只有 PBR 材质吃 `scene.environment`，`MeshPhongMaterial` 收不到
环境光照。不转的话同一个模型的 glTF 版明亮通透、FBX 版却发灰发暗。
顺带清掉 FBX 导出器常见的 `EmissiveColor = 纯白` 脏数据。

**等贴图真正就位再渲染。**
`GLTFLoader` 会等所有贴图落地才 resolve，但 `FBXLoader` 等是
`TextureLoader.load()` 发出去就不管 —— `loadAsync` 返回时 `texture.image`
往往还是 `undefined`，此时渲染会得到一张空贴图，模型全黑。
用带完成信号的 `LoadingManager` 等齐；它在加载失败时同样会结束计数，
不会让一个坏贴图把整批出图卡到超时。
