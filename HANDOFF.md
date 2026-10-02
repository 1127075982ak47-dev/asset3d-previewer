# 交接说明 · v1.3.0 · 换电脑继续开发

本工程为免费、中文、离线的 Windows x64 3D 资源浏览器，采用 Electron 44.5.1、React 18、three.js r171。
普通使用无需 Node.js；开发时需要 Windows 10/11 x64、Node.js ≥22.12.0、npm、Git。

## 1. 选哪个包

- **win64 绿色版**：完整解压后运行 `3D资源预览器.exe`。
- **源码工程**：当前提交的源码、锁文件、HDRI、图标、脚本和文档，适合编译；不含 Git 历史。
- **开发工程完整包（含git历史）**：解压后进入 `asset3d-previewer`，包含 `.git`、当前分支和提交历史，可以直接继续提交。
  不包含 node_modules、测试输出、本机 data、远端地址、用户身份或 Git hooks。
- **发布清单.json**：精确版本、提交、文件大小、SHA256，用于检查传输是否完整。

## 2. 新电脑启动

在包含 package.json 的目录打开 PowerShell：

```powershell
npm run setup
npm run dev
```

`setup` 通过 `npm ci` 按 package-lock 安装依赖，再下载 Electron，并核对 npm 包中官方 SHA256。
Electron 已安装时跳过下载。优先使用 npmmirror，失败时尝试 GitHub；不需要手工解压二进制。
初次开发需要网络，软件本身不使用在线服务。

```powershell
npm run typecheck
npm test
npm run build
npm run pack
```

测试目前 104 项。构建结果在 `out`；EXE 在 `release/win-unpacked`；绿色 ZIP 在 `release`。
`.blend` 的 3D 转换需要另外安装兼容版本的 Blender；其他常见格式可直接运行。

## 3. Git 与发布

完整包已经是 Git 工作区：

```powershell
git status
git log --oneline -8
git config user.name "你的名字"
git config user.email "你的邮箱"
```

源码包需要自行 `git init`。发布流程要求全部改动已提交：

```powershell
git add .
git commit -m "说明本次修改"
npm run release
```

发布会运行类型检查、单元测试、打包，再从同一提交生成三个 ZIP 和 SHA256 清单，放到工程上级目录。
工作区有未提交修改时拒绝生成源码包；找不到精确版本的绿色 ZIP 时拒绝拿旧包代替。
旧版本 ZIP 保留。

## 4. 验收

先 `npm run build`。建议每类脚本设置独立数据目录，避免单实例锁和本机设置互相影响：

```powershell
$env:ASSET3D_DATA_DIR = Join-Path (Get-Location) '.verify-product-profile-local'
npm run verify:product
npm run verify:library
node node_modules/electron/cli.js scripts/verify-viewer.cjs 'D:\素材\GLTF'
node node_modules/electron/cli.js scripts/verify-soak.cjs 'D:\素材库' 30
node node_modules/electron/cli.js scripts/verify-blender.cjs 'D:\素材\scene.blend'
Remove-Item Env:ASSET3D_DATA_DIR
node scripts/verify-package.mjs 'release/win-unpacked' 'D:\素材\GLTF'
```

`verify:product` 生成自己的小素材，覆盖缓存隔离、材质更新、链接越权、GLB 导出、依赖冲突、部分删除失败和备份恢复。
`verify:library` 使用合成夹具临时副本，涉及重命名和回收站，不操作真实素材。
`verify-package` 启动真实 EXE 的临时便携副本，检查版本、数据位置、缩略图、查看器、单实例、退出及用户文档。
验收脚本请串行运行；Windows GUI EXE 在 PowerShell 下请通过 `node node_modules/electron/cli.js` 启动脚本以保留输出管道。

跨软件的真实系统拖拽仍需人工检查；合成 dragstart 会阻塞 Windows 模态拖放循环，verify-drag 只验证选择和拖出文件清单。

## 5. 产品结构

- `src/main`：扫描、依赖检查、缓存修订、JSON 原子存储、文件事务、IPC 权限、协议、Blender、资源库、worker 池。
- `src/preload`：主窗口 API 与 worker API 分开暴露。
- `src/renderer`：中文界面、网格/列表、筛选、查看器、HDRI、AO、剖切、测量、对比、备份。
- `src/shared`：类型、格式、筛选、CSV、评分与颜色。
- `tests`：单元回归；`scripts`：真实运行验收、安装、发布。
- `resources`：HDRI 和 Blender 脚本；`docs`：快速说明、验收报告与历次方案。

本轮改动见 CHANGELOG.md；验收范围与实际结果见 docs/RELEASE_VALIDATION.md。

## 6. 数据与升级

可写目录下，绿色版数据保存在 exe 同级 `data`：设置、资源库、缩略图、转 GLB 缓存、自定义 HDRI、Chromium 本地状态和日志。
程序目录不可写时会回退到用户数据目录，在「关于」可查看实际位置。
升级时关闭程序、完整解压新版，再复制旧 `data` 到新版 exe 同级。

收藏和标签按绝对素材路径关联。换电脑但路径一致时可沿用；换盘符/位置后旧记录不会自动指向新文件。
缩略图包含路径与依赖修订，搬迁后可重建；v1.3 首次升级也会重建旧缩略图。
原格式移动保留源共享依赖；对未知私有格式与非标准引用，整体复制资源文件夹更稳妥。

## 7. 保持的产品约束

- 完全免费，不添加收费、会员、账号、遥测和联网服务。
- 中文；浅色玻璃界面为默认，深色可选。
- Windows 10/11 x64 便携交付，保留旧版本。
- 修改必须有对应的实际验证，构建通过不能代替运行结果。

本轮在当前电脑完成验收，不代表已完成多机型长期稳定性认证。发布包尚未进行代码签名。
