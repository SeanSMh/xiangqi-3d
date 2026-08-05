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

## art/production/ — 当前美术定稿

| 路径 | 说明 |
|------|------|
| `art/production/LOCKED_FEATURES.md` | 红黑角色不可漂移的锁定特征；后续重绘与建模必须遵守 |
| `art/production/redesign/*_v3.jpg` | 红黑七棋种共 14 张当前全彩定稿，是运行时角色颜色图的唯一来源 |
| `art/production/silhouettes/sil_*_alpha.png` | 从定稿角色转出的七棋种同源 Alpha 与剪影回退 |
| `art/production/silhouettes/pair_character_silhouette_v3.png` | 全彩角色与剪影成对校对图 |
| `art/production/**/archive_*` | 历史错位或失败资源，只供追溯，禁止进入运行时 |

运行时源尺寸副本位于 `public/assets/characters/` 与 `public/assets/silhouettes/`；移动端衍生档位于 `public/assets/runtime/{512,768}/`。代码只从 `public/assets/` 加载，并按设备档位成对选择颜色图与 Alpha。

定稿更新后先同步源尺寸副本，再重新生成移动档：

```bash
./scripts/generate_runtime_character_assets.sh
```

脚本只读取 `redesign/{red,black}_*_v3.jpg` 与 `silhouettes/sil_*_alpha.png`，不会读取任何 `archive_*`，也不会改动同档位下独立生成的 `bases/`、`badges/` 等目录。颜色图与 Alpha 使用相同的等比缩放；其中马保持非方形画布，必须继续核对两层输出尺寸一致。

## 后续可扩展

```
resources/
├── reference/          # 已有：原版参考
├── art/                # 自研美术（贴图、模型）
├── audio/              # 自研 BGM / SFX
└── design/             # 线框、UI 稿
```

当前已有 `reference/` 与 `art/production/`；音频采用 Web Audio 实时合成，因此暂不需要运行时音频文件。GLB 角色试点可在后续阶段加入 `art/models/`。
