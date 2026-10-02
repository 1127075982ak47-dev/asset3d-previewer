# GitHub 开源与发布

仓库：https://github.com/1127075982ak47-dev/asset3d-previewer
下载：https://github.com/1127075982ak47-dev/asset3d-previewer/releases/latest

main 是公开开发分支。公开仓库从原开发仓库整理而来，历史中的本机笔记、测试输出、私人路径和提交邮箱已清理。
继续开源开发请从本仓库 main 开始，或直接使用本地 asset3d-previewer-open-source 目录。

## 自动检查

Windows CI 在 main 推送、Pull Request 与手动触发时运行依赖安装、类型检查、单元测试和构建。
GitHub Actions 固定到官方 Action 的提交 SHA，任务只需要 contents: read。

推送版本标签（例如 v1.3.1）会触发 Build release，验证标签与 package.json 一致后构建绿色版，作为 Actions artifact 保存 14 天。
正式 Release 使用经过验证的程序包，由维护者发布；流水线不会自动覆盖已发布附件。

## 正式发布

1. 更新 package.json、锁文件、CHANGELOG 和使用说明；提交改动。
2. 运行 npm run release，完成本地类型检查、单元测试和打包。
3. 使用真实 EXE 验收，确认版本、出图、查看器、便携数据与正常退出。
4. 检查三个 ZIP 和发布清单 SHA256；创建对应标签。
5. 在 GitHub Releases 上传绿色版、源码、完整开发包和发布清单，填写验证范围与版本说明。

既有 v1.3.0 绿色版与公开源码的运行源码指纹相同；公开版文档和历史经过整理。
MIT 与第三方许可应随发布包保留；普通用户无需 Node.js。
