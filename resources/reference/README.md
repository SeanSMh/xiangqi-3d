# 3D Chess → 中国象棋复刻参考包

从 [Alex Nguyen 的 X 视频演示](https://x.com/cellinlab/status/2084507607713116460)导出的 **全帧画面、UI、动效序列、音频与规格文档**，用于开发中国象棋 3D 对战版。

## 所属项目

```
xiangqi-3d/
└── resources/reference/    ← 当前目录
```

上级资源说明：`../README.md`  
项目说明：`../../README.md`

> **远端仓库不包含大体积参考素材。**源视频、逐帧序列、裁切图与音频仅在本地留存，
> 并由 `.gitignore` 排除；克隆远端仓库后，本页列出的对应文件需要自行补齐才能预览。

## 目录结构

| 路径 | 内容 | 数量/大小约 |
|------|------|-------------|
| `00_source_video.mp4` | 源演示视频 | 31MB |
| `01_all_frames_native_60fps/` | **视频每一帧**（60fps） | 10316 张 / ~739MB |
| `01_all_frames/` | 10fps 序列（日常 scrub） | 1719 张 / ~160MB |
| `01_all_frames_1fps/` | 每秒 1 张总览 | 172 张 / ~20MB |
| `02_ui_crops/` | UI 裁切与状态图 | 行棋方、将军、SPOILS、工具栏等 |
| `03_vfx_battle/` | 吃子战斗特效序列 | 白闪 / 橙爆 / 将军相关 / 其它 |
| `04_pieces_selection/` | 选中环、合法走位、走子动画、俘虏列 | — |
| `05_board_scene/` | 棋盘与场景静帧 | — |
| `06_audio/` | 全片音轨 + 吃子时刻 SFX 切片 | — |
| `docs/` | 画面规格 + 中国象棋复刻计划 + 色板 | — |

## 打开方式

```bash
npm run open:reference
# 或
open resources/reference/index.html
```

## 说明

- 原视频分辨率 **1320×720**，**60fps**，时长约 **2 分 52 秒**。
- 左下角录屏控件、右下角平台水印**不属于游戏本体**，复刻时忽略。
- 素材仅作学习与 UX/动效参考；商用请自备美术与音效授权。
