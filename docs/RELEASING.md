# 大肥鱼发布流程

仓库：https://github.com/fh199601-oss/dafeiyu

1. 同步 `extension/manifest.json`、`package.json`、`package-lock.json`、`connector/engine.mjs` 和界面中的版本号。版本号为 Chrome 支持的 2–4 段数字，不含 beta 等后缀。
2. 执行 `npm run check`、`npm test`。涉及更新功能时另运行 `npm run test:updates` 和 `npm run test:popup`，检查两处入口及真实工具栏弹窗布局。
3. 打包前将官方版本运行组件放到 `connector/bin/`；二进制不提交 Git，许可证随包保留。Windows 运行 `powershell -File scripts/package.ps1`；macOS 运行 `node scripts/package-mac.mjs`。已存在同版本文件时停止，避免覆盖已发布文件。
4. 提交源码并推送到仓库。创建标签 `v版本号` 的 **草稿 Release**，上传两个 ZIP 和对应 SHA-256 校验文件，填好更新说明后再发布为正式版。未就绪版本不要标记 Latest。

检查更新使用 GitHub REST 的 `releases/latest`，只识别正式版本：

- `dafeiyu-v版本号.zip`：Windows / macOS 通用包。
- `dafeiyu-v版本号-macOS.zip`：Mac 包，包含 M / Intel 组件。
- 发布 URL、标签、文件名须一致；插件拒绝其他仓库、域名或不匹配版本的下载链接。
- GitHub 草稿和预发布版本不向普通用户提示更新。用户主动检查时读取，成功结果缓存 5 分钟。
- 当前解压版不具备静默覆盖安装能力。用户下载后覆盖**原目录**，在扩展管理页重新加载，再刷新网页；不要删除原安装或更换加载路径。

禁止提交本地 API 配置、原生连接状态、钱包诊断、浏览器配置、迁移历史或个人日志。公开仓库仅包含可发布源码、素材、测试、脚本和说明。发行 ZIP 只收录打包脚本列出的文件。
