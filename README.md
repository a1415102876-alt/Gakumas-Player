# Gakumas Player

Gakumas Player 是一个在浏览器中运行的学园偶像大师剧情播放器。它可以把 Beat 脚本演出为带有角色动作、表情、场景和对话的剧情，也提供可视化脚本编辑、AI 剧本整理与扩写，以及偶像闲聊功能。

## 运行要求

- Git 和 Node.js 20 或更新版本。仓库没有 npm 运行时依赖，不需要执行 `npm install`。
- 支持 WebGL 的现代浏览器，并开启硬件加速。3D 场景对显卡和显存有一定要求。
- 能够访问 `library.json` 中配置的资源地址。模型、动作和部分场景等资源会按需从 Cloudflare R2 下载，首次加载可能需要较长时间和浏览器缓存空间。
- 使用 AI 整理、扩写或闲聊时，需要自行配置兼容 OpenAI Chat Completions 的 API 地址、模型及所需密钥。接口需要允许浏览器跨域请求。语音是可选功能，需要单独配置 Fish Audio 和语音代理。

## 安装和启动

在终端执行：

```sh
git clone https://github.com/a1415102876-alt/Gakumas-Player.git
cd Gakumas-Player
npm start
```

在浏览器访问 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。终端保持运行，按 `Ctrl+C` 停止服务。请通过 HTTP 服务访问，不要直接双击 HTML 文件。

服务默认只监听本机的 `127.0.0.1`。如果 4173 端口已被占用，可以指定其他端口，例如 PowerShell：

```powershell
$env:PORT = '4174'
npm start
```

macOS / Linux：

```sh
PORT=4174 npm start
```

然后访问对应的 `http://127.0.0.1:4174/`。

## 让 Agent 安装

把下面的内容发给有终端和浏览器访问能力的编码 Agent，并指定希望安装的位置：

> 请克隆 https://github.com/a1415102876-alt/Gakumas-Player 到我指定的目录，阅读仓库中的 AGENTS.md 和 README.md，检查 Node.js 环境并启动播放器，验证页面和资源清单可以访问，最后告诉我访问地址。不要覆盖已有文件，也不要索取或提交 API 密钥；需要 AI 功能时让我自己在页面中配置。

仓库内的 [AGENTS.md](AGENTS.md) 包含更详细的安装、验证和排障说明。

## 开始使用

1. 打开播放器，在「设置」中按需配置 API 地址、模型和密钥。已有 Beat 脚本可以直接播放，不需要 AI 接口。
2. 将完整的 Beat 脚本粘贴到「Beat 脚本」框，或者选择「编辑器」制作脚本，再点击「开始播放」。也可以使用「全文案」整理已有文案，或使用「AI 扩写」生成剧情；这两种方式需要配置 AI 接口。
3. 选择「闲聊」，选定偶像并进入教室，可以使用已配置的 AI 接口对话。制作人档案和聊天记忆保存在当前浏览器；闲聊时，相关内容会发送到所配置的 AI 接口。
4. 如需语音，在「设置」中填写语音代理 URL、语音模型和 Fish API Key。语音服务及其网络访问需要自行准备。

例如，可以将以下内容粘贴到「Beat 脚本」框进行简单测试：

```xml
<beat speaker="kotone" cue="talk" face="neutral">收到，制作人。</beat>
```

API 和语音配置保存在浏览器本机，密钥会在使用相应功能时发送给你配置的服务。清除网站数据可能删除设置和聊天记录，请先从闲聊档案导出需要保留的聊天记忆。

## 资源与常见问题

- **加载缓慢或资源下载失败**：检查网络能否访问 `library.json` 中的 R2 地址。资源服务需要支持浏览器跨域访问；资源较大时也要检查浏览器可用存储空间。
- **提示资源大小不符或校验失败**：清单记录的大小和 SHA-256 必须与实际下载的文件一致。更新后刷新页面并重试；若仍失败，检查当前部署返回的 `resource-manifest.json` 与资源服务上的文件是否来自同一版本。不要只修改清单掩盖文件不一致的问题。
- **页面空白或帧数低**：检查浏览器是否开启硬件加速、显卡驱动是否正常，以及可用显存是否足够。播放界面的 GPU 窗口显示的是程序估算值，不是驱动报告的实际显存占用。
- **AI 请求失败**：检查 API 地址、模型、密钥和服务商的 CORS 设置。页面会从浏览器直接请求所配置的接口。
- **更新本地代码**：在仓库目录运行 `git pull` 前，先确认本地没有需要保留的未提交修改；更新后重启服务并刷新页面。

`library.json` 配置资源来源，`resource-manifest.json` 记录资源的大小、哈希和依赖。默认远程资源服务的可用性取决于服务本身；仓库中的前端代码不等于完整的离线资源库。

## 发布通知

编辑仓库根目录的 [notices.json](notices.json)，把新通知放在列表前面，然后提交、推送并部署。示例：

```json
{
  "notices": [
    {
      "id": "2026-11-09-update-1",
      "date": "2026-11-09",
      "title": "更新通知",
      "body": "这里填写通知内容。\n可以使用换行。"
    }
  ]
}
```

`id`、`title` 和 `body` 必须是非空字符串，`date` 可省略。通知按文件中的顺序显示，正文按纯文本处理。每条新通知使用不同的 `id`；需要修改已发布通知并再次提醒用户时，也请换一个新 `id`。用户打开通知后，当前浏览器会将已显示的通知记为已读。保存文件后请确保 JSON 格式正确，部署完成后刷新页面检查。

## 开发和验证

主要入口是 `gakumas-player.html`，本地服务为 `server.mjs`，脚本编辑器为 `beat-editor.html`。Three.js 位于 `vendor/three/`。运行现有 Node 测试：

```sh
node --test tests/chat-memory.test.mjs tests/gpu-resource-estimator.test.mjs tests/portrait-texture-budget.test.mjs tests/ssmk-shoulder-collisions.test.mjs tests/notices.test.mjs
```

## 许可与素材

本仓库目前尚未提供项目级开源许可证，请在使用、修改或再分发前向项目维护者确认授权。第三方依赖和游戏相关的角色、模型、贴图、音频等素材可能有各自的权利归属；仓库或远程地址可访问不代表这些素材已获得再分发许可。Three.js 的许可文件见 [vendor/three/LICENSE](vendor/three/LICENSE)。
