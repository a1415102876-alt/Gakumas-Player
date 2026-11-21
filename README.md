# Gakumas Player

Gakumas Player 是一个在浏览器中运行的学园偶像大师剧情播放器。它可以把 Beat 脚本演出为带有角色动作、表情、场景和对话的剧情，也提供可视化脚本编辑、AI 剧本整理与扩写，以及偶像闲聊功能。

## 运行要求

- Git 和 Node.js 20 或更新版本。仓库没有 npm 运行时依赖，不需要执行 `npm install`。
- 支持 WebGL 的现代浏览器，并开启硬件加速。3D 场景对显卡和显存有一定要求。
- 能够访问 `library.json` 中配置的资源地址。模型、动作和部分场景等资源会按需从 Cloudflare R2 下载，首次加载可能需要较长时间和浏览器缓存空间。
- 使用 AI 整理、扩写或闲聊时，需要自行配置兼容 OpenAI Chat Completions 的 API 地址、模型及所需密钥。接口需要允许浏览器跨域请求。角色语音可使用本机 Irodori-TTS 或 Fish Audio。

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
4. 如需语音，在「设置」中开启「启用角色语音」，然后配置本机 Irodori-TTS 或填写 Fish API Key。

例如，可以将以下内容粘贴到「Beat 脚本」框进行简单测试：

```xml
<beat speaker="kotone" cue="talk" face="neutral">收到，制作人。</beat>
```

API 和语音配置保存在浏览器本机，密钥会在使用相应功能时发送给你配置的服务。清除网站数据可能删除设置和聊天记录，请先从闲聊档案导出需要保留的聊天记忆。

### 保存和打开 Beat 脚本

运行 `npm start` 后，在 Beat 编辑器填写脚本名称并选择「保存脚本」。脚本保存到本机 `assets/jobs/<名称>.txt`，再次用同一个名称保存会覆盖该文件。

在编辑器的「已保存的脚本」列表中选择文件并打开，也可以在播放器的「打开已保存脚本」中载入。使用普通文本文件即可备份或在另一台电脑上打开。

## 配置角色语音

1. 使用支持 Irodori 的 Gradio 界面或兼容 OpenAI 语音接口的服务，在本机启动语音模型。播放器默认连接端口 `7862`。接口选择「按端口选择」时，`7860` 与 `7861` 使用 Gradio，其他端口使用 OpenAI 兼容 API。
2. 运行 `npm start` 打开播放器。在「设置」开启「启用角色语音」，进入「本地 Irodori-TTS」填写端口和接口类型，再点击「检测连接」。检测会检查 Gradio 生成接口或 OpenAI 模型列表。
3. 在同一设置区选择角色，填入服务中已注册的 Voice ID，保存后播放带日文 `<tts lang="ja">` 的脚本。Gradio 支持 `default`、`none`，以及 `voices/<音源ID>.speaker.safetensors` 的音源 ID。实际可用音源由语音服务决定。
4. 需要 Fish Audio 时，在播放器中填写自己的 Fish API Key，并按需设置模型。通过本地播放器打开时，Fish 语音代理默认使用实际播放器端口上的同源 `/api/fish-tts`。已有自定义代理仍可使用。未为角色填写 Irodori Voice ID 或本地合成失败时，已配置的 Fish 音色可以接续配音。

播放器服务可通过环境变量 `IRODORI_PORT` 和 `IRODORI_PROTOCOL` 设定默认端口和接口，其中接口类型为 `gradio` 或 `openai`。对于兼容 OpenAI 的服务，可通过 `IRODORI_MODEL_NAME` 指定模型 ID，默认是 `irodori-tts`。服务如需认证，在播放器启动环境中设置 `IRODORI_API_KEY`。

### 逐句语气描述

闲聊、全文案整理、AI 扩写和续写可为已配置 Irodori Voice ID 的角色生成简短的日语语气描述。描述保存在同一句 Beat 的 `irodori-caption` 字段里，可在 Beat 编辑器的「文本」面板中修改。支持此字段的语音服务会将它用于合成。有日文台词的旧 Beat 也能直接使用本机语音配置。

```xml
<beat speaker="kotone" irodori-caption="照れながら、少し嬉しそうに話す。"><display lang="zh">我就知道你会来。</display><tts lang="ja">来てくれると思ってたよ。</tts></beat>
```

### 可选的 Caption 服务

随仓库提供的 `tools/irodori-caption-server.py` 可将已有 Irodori 推理运行时和支持 Caption 的 checkpoint 接成 OpenAI 兼容语音接口。使用 Irodori 安装环境的 Python，确认该环境能导入 `irodori_tts`、`fastapi`、`gradio`、`soundfile` 和 `uvicorn`，再运行：

```sh
python tools/irodori-caption-server.py --install-dir "/path/to/irodori-tts" --checkpoint "/path/to/model.safetensors" --port 7862
```

模型使用已有运行时解析其依赖资源。Hugging Face 缓存位于自定义目录时可加 `--hf-cache`。将说话人嵌入文件或参考音频放入 Irodori 安装目录的 `voices/`，命名为 `<音源ID>.speaker.safetensors` 或 `<音源ID>.wav`。使用无参考音色时，Voice ID 填 `none`。然后在播放器的 Irodori 设置中选择该端口和「OpenAI 兼容 API」。

### 导出和复用语音

先在播放器设置中配置 Irodori 或 Fish 音色。在 Beat 编辑器填写脚本名称，选择「导出全部语音」，或在选中台词的「文本」面板选择「导出本句语音」。批量导出只处理含日文语音文本的段落。重新导出一条已有录音的台词时，可以试听新旧版本，再选择保留哪一版。

录音保存在本机 `assets/tts-output/<脚本名>/`。在播放器打开同名存档并启用角色语音后，匹配当前说话人、日语台词和语气描述的录音会优先播放。录音缺失或台词设置已变化时，播放器尝试实时合成。在另一台电脑复用录音时，可以将脚本文件和对应的整个录音目录一并复制过去。

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

主要入口是 `gakumas-player.html`，本地服务为 `server.mjs`，脚本编辑器为 `beat-editor.html`。Three.js 位于 `vendor/three/`。

Player 和编辑器预览默认共用一个 WebGL 渲染器与画布，角色、3D 场景和 2D 背景会合成到同一舞台。要临时回退到每个角色单独渲染器，可在网址加 `?stage=private`；也可在浏览器控制台设置 `localStorage.setItem('gakumas.stage', 'private')`，重新加载后生效。网址中的 `?stage=shared` 可以覆盖这个回退设置。GPU 资源窗口提供的是基于资源尺寸和渲染目标的程序估算，浏览器不会提供 NVIDIA 驱动报告的真实显存用量。

3D 场景支持统一 HDR 后处理：各场景按当前机位解析自己的 volume，使用各自的曝光、对比度、饱和度、色调映射、泛光及柔化参数，并遵循组件的激活状态。切换场景时会替换参数并重置 TAA 历史；不支持半浮点目标时保留材质调色的兼容路径。泛光、柔化等采用近似实现和视觉校准，尚未完整复现游戏原版 Shader。

运行现有 Node 测试：

```sh
node --test tests
```

## 许可与素材

本项目中由项目维护者及贡献者有权授权的原创代码以 [GNU 通用公共许可证第 3 版（GPL-3.0-only）](LICENSE)发布。第三方代码继续遵循其各自的许可证，例如 Three.js 的许可文件见 [vendor/three/LICENSE](vendor/three/LICENSE)。

游戏相关的角色、模型、贴图、动作、音频等素材不因此获得 GPL 授权，其权利归各自的权利人所有；仓库或远程地址可访问不代表这些素材已获得使用或再分发许可。
