# Gakumas 面部特殊效果导出

这些文件来自当前本地解包中实际存在的 Unity AssetBundle，清单在 `manifest.json`。

每个效果目录包含：

- `textures/*.png`：Unity Texture2D 解码后的透明 PNG；
- `meshes/*.obj`：泪滴、眼睛特殊网格或黑线网格，坐标保持 Unity 本地坐标；
- 根目录的 `manifest.json`：效果类别、原始 bundle、挂载骨骼和导出文件索引。

当前已导出：

- 13 名角色各自的星星眼 3×3 图集（含角色专属瞳色、shade/Def 贴图与 tileFPS；清单见 `star-eyes-manifest.json`，运行时映射见 `../../star-eye-resources.js`）；
- 左右眼泪滴、下落泪珠和充满眼泪变体；
- 有村麻央无高光眼睛；
- 花海咲季左右不等号眼形；
- 篠澤广 `gaan` 黑线脸部网格；
- 藤田琴音脸部 `Shadow`、`Pale`、腮红和线条 decal 贴图及脸部网格。

当前导出是给 Stage 适配层使用的素材包。Unity 粒子系统的发射、循环和淡入淡出参数仍以原始 bundle 为准，后续接入 Three.js 时需要根据 `manifest.json` 中的类别和挂载路径重建。

如需从解包目录重新生成：

```powershell
python tools/gakumas-facial-effects/export_effects.py `
  --source 'E:/gakumas-unpack-2026-09-06/asset_bundle' `
  --output 'public/mmd-dialogue-stage/assets/facial-effects'

# 完整缓存中的角色星星眼图集
python tools/gakumas-facial-effects/export_star_eyes_current.py
```
