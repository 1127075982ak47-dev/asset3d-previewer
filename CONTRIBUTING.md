# 参与贡献

欢迎提交 Bug、格式兼容改进、性能优化、使用说明和 Pull Request。
项目本体保持免费、中文、本地离线；浅色界面为默认，深色可选。

## 开发环境

Windows 10/11 x64、Node.js ≥22.12.0、npm。建议 Node.js 24。
`.blend` 的实际转换验证需要安装兼容版本的 Blender。

```powershell
git clone https://github.com/1127075982ak47-dev/asset3d-previewer.git
cd asset3d-previewer
npm run setup
npm run dev
```

`setup` 按锁文件安装依赖，下载 Electron 并校验官方 SHA256。

## 提交前检查

```powershell
npm run typecheck
npm test
npm run build
```

涉及实际文件整理、缩略图或查看器时，还需要运行对应验收脚本，见 HANDOFF.md。
文件整理检查使用脚本生成的测试文件；不要把自己的素材库当作删除测试目录。
同一数据目录有单实例锁，验收脚本建议串行运行并使用独立 ASSET3D_DATA_DIR。

## Pull Request

1. Fork 仓库，从 main 建立工作分支。
2. 让修改集中解决一个问题，说明行为变化与验证结果。
3. 格式加载器需要说明依赖文件、动画/材质限制、失败提示，并提供有权分享的最小样例。
4. 文件操作修复重点检查源文件保留、共享依赖、目标冲突和部分失败。
5. 不提交 node_modules、data、缓存、测试输出、凭据或不具备公开分发权的模型。

提交遵循现有 TypeScript/React 风格和 LF 换行；贡献适用仓库 MIT 许可。

## 报告问题

请说明应用版本、Windows 版本、GPU/驱动、文件格式、操作步骤、预期和实际结果。
有必要时提供最小样例和脱敏后的日志；安全漏洞按 SECURITY.md 的方式报告。
