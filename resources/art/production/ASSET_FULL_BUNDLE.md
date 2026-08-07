# 全量可交付视觉资源包（能画的尽量给齐）

> 运行时：`public/assets/`  
> 设计母版：`resources/art/production/`  
> **不含 GLB**（需 3D 建模）。

---

## A. 角色待机（运行时主视觉）

| 路径 | 数量 |
|------|------|
| `public/assets/characters/{red,black}_*_v3.jpg` | 14 |
| `public/assets/silhouettes/sil_*_alpha.png` | 7（红黑共用轮廓） |
| `public/assets/runtime/512|768/characters|silhouettes/` | 分级档 |

---

## B. 多姿态（演出用，已进 public/poses）

### 攻击 / 指挥 `poses/attack/` + `poses/black/`

| 棋 | 红 | 黑 |
|----|----|----|
| 帅/将 | `red_king_command` | `black_king_command` |
| 仕/士 | `red_advisor_attack` | `black_advisor_attack` |
| 相/象 | `red_elephant_attack` | `black_elephant_attack` |
| 马 | `red_horse_attack` | `black_horse_attack` |
| 车 | `red_chariot_attack` | `black_chariot_attack` |
| 炮 | `red_cannon_attack` | `black_cannon_attack` |
| 兵/卒 | `red_pawn_attack` | `black_pawn_attack` |

### 受击 `poses/hit/`

- `red_king_hit` / `black_king_hit`

### 死亡 `poses/death/`

- 红：`red_chariot_death` `red_cannon_death` `red_horse_death`
- 黑：`black_chariot_death`（其余可用红死亡 recolor 或程序 dissolve）

### 行走帧 `poses/walk/`

- `red_pawn_walk` `red_chariot_walk`（假步态切卡用）

---

## C. 三视图（建模参考）

| 侧 | 路径 |
|----|------|
| 红全 7 | `production/turnarounds/*_turnaround_v3.jpg` |
| 黑 5+ | `turnarounds/black/` 将炮车马象（士/卒缺可待机 recolor） |

---

## D. 场景与棋盘

| 资源 | public 路径 | 说明 |
|------|-------------|------|
| 对战场 16:9 | `backgrounds/battle_arena_16x9.jpg` | 高山+星辰（当前定稿） |
| 对战场 9:16 | `backgrounds/battle_arena_9x16.jpg` | 竖屏 |
| 天空 equirect | `backgrounds/sky_equirect_2x1.jpg` | 环境球 |
| 棋盘 albedo | `board/board_albedo_topdown.jpg` | 俯视 |
| 棋盘 normal 向 | `board/board_normal_topdown.jpg` | 细节 |

历史背景备份：`production/backgrounds/archive_*`

---

## E. 交互 UI 贴图

| 资源 | 路径 |
|------|------|
| 选中/可走/可吃环 | `ui/ring_*.png` |
| 将军叠加 | `ui/overlay_check_jiangjun.jpg` |
| 绝杀叠加 | `ui/overlay_checkmate_juesha.jpg` |
| 将军暗角 | `ui/overlay_check_vignette.jpg` |
| 对话框面板 | `ui/panel_dialog_empty.jpg` |
| 底座 14 | `bases/base_*.png` |
| 徽章 14 | `badges/badge_*.png` |
| 底座/徽章 runtime 档 | `runtime/512|768/bases|badges/` |

---

## F. 演出 VFX / 标记

| 资源 | public 路径 |
|------|-------------|
| 白青爆炸 | `vfx/vfx_blast_white_cyan_alpha.png` |
| 橙金爆炸 | `vfx/vfx_blast_orange_gold_alpha.png` |
| 炮弹火球 | `vfx/vfx_cannon_fireball_alpha.png` |
| 车刀光拖尾 | `vfx/vfx_chariot_slash_trail_alpha.png` |
| 脚步尘 | `vfx/vfx_footstep_dust_alpha.png` |
| 钢刃弧 | `vfx/vfx_steel_slash_arc_alpha.png` |
| 审判光柱 | `vfx/vfx_judgement_pillar_alpha.png` |
| 地面冲击环 | `vfx/vfx_ground_wave_ring_alpha.png` |
| 占格金印 | `marks/claim_seal_gold_alpha.png` |
| 将军危灯 | `marks/check_warning_lamp_alpha.png` |

---

## G. 传播

| 资源 | 路径 |
|------|------|
| App 图标 JPG/PNG | `icons/app_icon.jpg` / `app_icon.png` |
| 分享封面 16:9 | `icons/share_cover_16x9.jpg` |

---

## H. 文档

- `ASSET_PHASES.md` — 分阶段说明  
- `ASSET_FULL_BUNDLE.md` — 本文  
- `LOCKED_FEATURES.md` / `DESIGN_BRIEF.md` / `ENGINE_LIGHTING.md`  

预览：`production/index.html`

---

## I. 仍无法用出图替代

| 项 | 原因 |
|----|------|
| `.glb` 骨骼模型 | 需 Blender/建模 |
| 严格 9×10 像素对齐棋盘线 | 应用程序线叠加贴图 |
| 多帧 8–16 连帧爆炸序列 | 现为关键单帧 + 粒子 |
| 黑方全套 death/walk | 部分有，其余可 dissolve/假步态 |

---

## J. 建议代码接线顺序

1. 背景 + 棋盘贴图  
2. attack 切卡（吃子 windup 200ms）  
3. claim_seal + ground_wave + slash  
4. check_warning_lamp + vignette  
5. footstep_dust 绑假步态  
6. death 切卡或 dissolve  
