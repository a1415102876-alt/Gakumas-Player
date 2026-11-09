# Agent 安装与维护指南

本文件供协助用户安装、运行或维护 Gakumas Player 的编码 Agent 阅读。面向用户的介绍与操作步骤见 [README.md](README.md)。

## 安装

1. 确认用户希望安装的目录；如果目标目录已经存在，先检查其内容和 Git 状态，保留用户数据，不要覆盖或删除。
2. 检查 Git 和 Node.js 版本。建议 Node.js 20 或更新版本；项目无 npm 运行时依赖，不需要安装依赖。
3. 若尚未克隆，使用 `git clone https://github.com/a1415102876-alt/Gakumas-Player.git`。不要擅自重置、清理或覆盖已有工作区。
4. 在仓库根目录运行 `npm start`，默认监听 `127.0.0.1:4173`。如果端口被占用，使用 `PORT` 环境变量指定空闲端口。告知用户实际 URL；需要持续使用时保持服务运行。
5. 用 HTTP 检查首页和 `resource-manifest.json` 是否返回成功；有浏览器时打开首页，确认页面可用。网络允许时检查 `library.json` 中的远程资源地址可访问。不要声称已完成 3D 播放、AI 或语音验证，除非实际测试过。

## 功能与配置

- 前端入口是 `gakumas-player.html`；`server.mjs` 是仅监听本机的静态文件服务器。项目默认无需 SillyTavern 或构建步骤即可打开播放器。
- `library.json` 默认使用 R2，`resource-manifest.json` 列出资源大小、哈希和依赖。部分大型资源需要从远程按需加载，不能假设仓库包含完整离线资源。
- 页面设置中的 AI 地址使用 OpenAI 兼容的 Chat Completions 接口，浏览器必须能够跨域访问该接口。API 和语音参数由用户自行填写；不要向用户索取密钥，不要将密钥写入仓库、命令记录、日志或截图。
- AI 整理、扩写和闲聊需要用户配置接口；直接播放已有 Beat 脚本不依赖 AI。Fish 语音需要单独的服务、代理和配置。
- 设置、档案、聊天记录和资源缓存由浏览器保存。不要在排障时擅自清除站点数据；清理前告知用户可能丢失的数据，并引导用户导出所需聊天记忆。

## 验证与排障

- 现有测试可运行：`node --test tests/chat-memory.test.mjs tests/gpu-resource-estimator.test.mjs tests/portrait-texture-budget.test.mjs tests/ssmk-shoulder-collisions.test.mjs`。
- HTTP 加载失败时，核实服务进程、端口和路径。网络或资源加载失败时，检查 R2 地址、HTTP 状态及浏览器 CORS。
- 出现资源大小或哈希不符时，比较**当前部署返回的清单**与**实际下载的资源字节**；也要检查部署和缓存是否仍在提供旧版本。确认文件来源后再更新清单，保持大小和 SHA-256 与实际发布文件一致。
- 对显卡问题区分程序中的 GPU 资源估算和操作系统或驱动报告的实际显存。报告实际验证过的环境和限制。
- 项目尚无项目级许可证。不要自行添加或声称存在某种开源许可证；游戏素材和第三方依赖可能受各自许可约束。
