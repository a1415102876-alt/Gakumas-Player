# 河岸（午）Shader 补充数据

仅用于 `env_3d_adv_riverbed-00-00-noon`，由 `scripts/export-riverbed-shader-data.py` 调用已有 SceneExporter 导出。水面三张 PNG 保留 Unity 导入后的 RGBA 原始通道；`clouds.glb` 含 CloudData 的五层网格及原始云贴图。

水纹公式来自 `Environment/SimpleWaterFlow` 的 forward DXBC；云使用 `Campus/Cloud` 的贴图、颜色、双面透明混合及各层转速。时间使用秒和 Unity `_Time.x = t / 20`。这些补充文件通过 `resource-manifest.json` 作为河岸场景的前端依赖加载，无需改变 R2 上的原场景。

`depthFog.densityScale = 0.01` 是本次近景清晰度的保守校准值，**不是已还原的 Unity CPU 常量**。指数雾公式和 volume 的 density/maxAmount 已核对，仍需捕获游戏上传的 `_VLFogParams` 确定最终密度系数。

所有 3D 场景在支持半浮点渲染目标时，先在线性 HDR 中进行 TAA、泛光和柔化，再统一应用各自 volume 的曝光、LogC 对比度、SMH、饱和度和 GT 色调映射。场景材质在该次绘制中临时跳过调色，最终合成替代全帧 LookPass，避免重复调色或泛光；直接渲染及不支持 HDR 时继续使用材质调色。河岸专用水面、动态云和深度雾补充仍只用于河岸午。

泛光改用软阈值和逐级降采样、回升合成；柔化缩小采样半径，色差限制为轻微径向偏移。星芒遵循 volume 的激活状态，河岸午默认关闭。HDR 泛光强度系数 `0.35`、显示空间系数 `0.15`、柔化半径和光晕近似均为当前视觉校准，**尚未逐指令还原游戏完整后处理 Shader**。小尺寸泛光缓冲已纳入 GPU 资源估算，并随尺寸变化和卸载释放。

游戏资源的权利归原权利人，项目代码的 GPL 许可证不授予这些素材的使用或再分发权利。
