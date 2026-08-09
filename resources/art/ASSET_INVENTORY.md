# 图片资源清单（v3 完整收口）

## 角色

| 路径 | 内容 |
|------|------|
| `production/redesign/red_*_v3.jpg` | 红方 7 |
| `production/redesign/black_*_v3.jpg` | 黑方 7（同造型 recolor） |
| `production/redesign/pair_red_black_v3.png` | 红黑对照 |

## 剪影

| 路径 | 内容 |
|------|------|
| `production/silhouettes/sil_*_alpha.png` | 7 棋种（红黑共用） |
| `pair_character_silhouette_v3.png` | 对照 |
| `public/assets/silhouettes/` | 运行时同步 |

## 三视图 `production/turnarounds/`

| 文件 |
|------|
| `king_turnaround_v3.jpg` |
| `advisor_turnaround_v3.jpg` |
| `elephant_turnaround_v3.jpg` |
| `horse_turnaround_v3.jpg` |
| `chariot_turnaround_v3.jpg` |
| `cannon_turnaround_v3.jpg` |
| `pawn_turnaround_v3.jpg` |

## 工程

| 路径 | 说明 |
|------|------|
| `src/scene/lighting.ts` | 统一灯光 + 阵营色 |
| `src/scene/boardScene.ts` | 接入灯光 / 0.85 占位 |
| `production/ENGINE_LIGHTING.md` | 参数文档 |
| `production/occupancy_0.85_guide.png` | 占位示意图 |

## 角色背视（站立态）

| 路径 | 说明 |
|------|------|
| `production/back_idle/` | 站立态背视**生成简报**，资源待产出 |

背向一方目前渲染纯色剪影（`role-fallback`）。攻击态已有背视
（`poses/*_attack_back.jpg`），站立态没有。

## 背景

| 路径 | 说明 |
|------|------|
| `production/backgrounds/round_stage/` | 圆台竞技场贴图（地面 / 台顶 / 金环） |
| `production/backgrounds/ridge_layers/` | 远山分层贴图**生成简报**，资源待产出 |

天穹已改为程序化（`src/scene/skyDome.ts`），不再使用 equirect 照片。

## 底座 / 徽章 / VFX

`public/assets/bases|badges|ui|vfx` 同前。

## 禁止

- `archive_*`、`full_set/black_*`、`redesign/black/` 子目录  

## 阶段扩展 P0–P2

完整清单见 [`production/ASSET_PHASES.md`](./production/ASSET_PHASES.md)。

| 阶段 | 内容 | 路径 |
|------|------|------|
| P0 | 对战场 16:9/9:16、equirect 天空、棋盘 albedo/normal | `public/assets/backgrounds/` `board/` |
| P1 | 攻击姿态、黑方三视图 | `production/poses/` `turnarounds/black/`（无 GLB） |
| P2 | 炮弹/刀光 VFX、将军/绝杀层、图标封面、底座徽章 runtime 分级 | `public/assets/vfx|ui|icons|runtime/` |
