# 交接说明 · 换电脑接着开发

这份包是完整的开发工程：源码 + git 提交历史 + 文档。不含 `node_modules`、构建产物和本机缓存。

当前状态：**v1.2.0 已完成并发布**（2026-09-06），工作区干净，所有验收通过。

## 1. 在新电脑上跑起来

需要：

- **Node.js 22 或 24**（这边用的是 24.16 / npm 11）。
- 网络能访问 npmmirror（`.npmrc` 已把 registry、Electron、electron-builder 二进制都指向国内镜像）。
- 可选：**Blender**（`.blend` 转 GLB 要用；没有也能跑，只是 .blend 只显示内嵌图）。
- Git（看历史、提交用；没有也能编译）。

```bash
npm install
npm run dev          # 开发模式，热更新
npm run typecheck    # tsc
npm test             # 89 个单元测试
npm run pack         # 构建 + electron-builder，产物在 release/win-unpacked 与 release/*.zip
npm run release      # typecheck + test + pack + 把两个 zip 复制到上级目录
```

### 已知坑（这台机器踩过的）

- `npm install` 后 **Electron 二进制可能没解压**（`node_modules/electron/dist` 为空，报 "Electron failed to install correctly"）。
  处理：到 `%LOCALAPPDATA%\electron\Cache\` 里找 `electron-v33.4.11-win32-x64.zip`，手动解压到 `node_modules/electron/dist/`，
  并在 `node_modules/electron/` 下写一个 `path.txt`，内容是 `electron.exe`。
- electron-builder 首次打包要下载 winCodeSign / nsis 等二进制，走的是 `.npmrc` 里的镜像；失败就重跑一次。
- 开发模式和验收脚本共用 `.dev-data/`（相当于绿色版的 `data/`），有**单实例锁**：不能同时开两个 dev 实例，验收脚本也要串行跑。
- Windows PowerShell 5.1 跑含中文的 `.ps1` 会乱码，脚本里只放 ASCII（`scripts/` 下的都是 `.cjs` / `.mjs`，没这个问题）。
- Git Bash 传中文路径给 electron.exe 会乱码；PowerShell 或 cmd 正常。

## 2. 目录

```
src/main/        Electron 主进程（扫描、缓存、协议、出图 worker 池、Blender、文件操作、重复查找、库）
src/preload/     contextBridge 白名单 API
src/renderer/    React 界面（App / Grid / ListView / Sidebar / Viewer / ViewerPanel / 各弹层）
src/renderer/lib 查看器引擎（viewerEngine / shading / measure / loaders / framing / fbxText）
src/shared/      主进程与渲染进程共用：类型、格式表、筛选排序、CSV、颜色标签
tests/           vitest 单元测试（纯逻辑模块）
scripts/         验收脚本（真实素材 / 合成夹具跑 Electron）与发布脚本
resources/       内置 HDRI（Poly Haven CC0）、Blender 导入导出脚本
build/           图标
docs/            方案文档与工作笔记（见下）
```

详细架构和关键设计在 `README.md` 末尾；每个版本改了什么在 `CHANGELOG.md`。

## 3. 验收脚本

先生成合成夹具，再按需跑（都要先 `npm run build` 或 `npm run pack`，脚本用的是 `out/` 里的产物）：

```bash
node scripts/make-fixtures.mjs                              # .fixtures/
npx electron scripts/verify-render.cjs .fixtures .verify-out-fixtures   # 离屏出图，VERIFY_LIMIT=20 控制张数
npx electron scripts/verify-library.cjs                     # 资源库功能 24 项（用夹具的临时拷贝，安全）
npx electron scripts/verify-ui.cjs "某个素材目录"            # 扫描、出图、进查看器、拖拽旋转
npx electron scripts/verify-viewer.cjs "某个素材目录"        # 查看器 93 步逐项截图
npx electron scripts/verify-soak.cjs "上千个模型的目录"      # 压力
```

这边用的真实素材是 Kenney nature-kit（每种格式 329 个）和 Quaternius 的 FBX；换电脑后随便找个 glTF / FBX 素材包即可，
脚本不依赖具体文件。

## 4. 文档

- `docs/plan-v1.md`：从 v1.0 到 v1.2 的完整方案、执行记录、追加需求。
- `docs/notes-project-env.md`：工程位置、素材、环境与已知坑（这台机器的路径，仅供参考）。
- `docs/notes-ui-style.md`：用户对界面风格的要求（浅色玻璃拟态、排版松弛），新界面都按这个来。

文件名故意用英文：压缩包里的中文文件名在某些解压工具下会变成乱码。

## 5. 约束（用户明确要求过的）

- **完全免费**，不加任何收费 / 会员 / 联网功能；关于对话框写着"免费软件 · MIT · 不联网"。
- 中文界面。
- 界面：浅色玻璃拟态（淡蓝 / 淡紫渐变、磨砂白卡片、大圆角、宽松间距），深色只是可选主题。
- 绿色版：所有数据写在 exe 同级 `data/`，不碰注册表和 `%APPDATA%`。
- 发布产物是两个 zip（绿色版 + 源码工程）放到工程上级目录，旧版本的 zip 保留。

## 6. 可以继续做的方向（未开始）

- 悬停卡片自动转盘预览（多角度 sprite），成本较高，需要在出图队列里加一种任务。
- 浏览 zip 素材包内部的模型（虚拟文件系统）。
- 缩略图改 WebP 减小缓存（拖拽图标依赖 `nativeImage`，只认 PNG / JPEG，需要另做一份）。
- 更多格式：`.usda`（USDZLoader 只认 zip 包）、`.x`、`.abc` 目前没有 JS 加载器。
- i18n、安装包（用户没要求，暂不做）。
