# 资源目录（resources）

本目录存放 **设计参考与非运行时资产**。  
游戏运行时需要的静态文件请放在项目根目录的 `public/`。

## reference/ — 原版 3D Chess 视觉参考包

从演示视频导出，用于对齐画面、UI、动效节奏。

| 路径 | 说明 |
|------|------|
| `reference/00_source_video.mp4` | 源演示视频（约 2:52，1320×720，60fps） |
| `reference/01_all_frames_native_60fps/` | **每一帧**（10316 张） |
| `reference/01_all_frames/` | 10fps 序列（1719 张） |
| `reference/01_all_frames_1fps/` | 1fps 总览（172 张） |
| `reference/02_ui_crops/` | UI 裁切：行棋方、CHECK、SPOILS、工具栏 |
| `reference/03_vfx_battle/` | 吃子战斗特效序列 |
| `reference/04_pieces_selection/` | 选中 / 合法走位 / 走子 / 俘虏列 |
| `reference/05_board_scene/` | 棋盘场景静帧 |
| `reference/06_audio/` | 全轨 + 吃子 SFX 切片 |
| `reference/docs/VISUAL_SPEC.md` | 画面与动效规格书 |
| `reference/docs/XIANGQI_REMAKE_PLAN.md` | 中国象棋复刻计划 |
| `reference/docs/color_palette.json` | 主色板 |
| `reference/index.html` | 浏览器预览关键资源 |

### 打开预览

```bash
open /Users/bril/projects/xiangqi-3d/resources/reference/index.html
```

### 体积提示

整包约 **1 GB**，其中 `01_all_frames_native_60fps` 约 739MB。  
若不需要逐帧分析，可只保留 `01_all_frames_1fps` + `02–06` + `docs`。

## 后续可扩展

```
resources/
├── reference/          # 已有：原版参考
├── art/                # 自研美术（贴图、模型）
├── audio/              # 自研 BGM / SFX
└── design/             # 线框、UI 稿
```

当前仅创建 `reference/`；开发产出资源时再补子目录即可。
