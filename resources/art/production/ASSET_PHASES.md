# 阶段图片资源清单（P0 / P1 / P2）

生成日期：对战背景与扩展资源批次。  
**运行时可加载路径以 `public/assets/` 为准。**  
设计母版在 `resources/art/production/`。

> **背景 v2（宏大玄幻）**：`battle_arena_*` 与 `sky_equirect` 已替换为仙侠天宫战境风格；旧石殿版见 `backgrounds/archive_v1_stone/`。


> **GLB 真 3D 网格**：本批仍为 2D 概念 / 贴图 / 三视图，**不含** `.glb` 二进制（需 Blender 或外包建模）。

---

## P0 — 背景与棋盘（已交付）

| 资源 | production | public |
|------|------------|--------|
| 横屏对战场 16:9 | `backgrounds/battle_arena_16x9.jpg` | `backgrounds/battle_arena_16x9.jpg` |
| 竖屏对战场 9:16 | `backgrounds/battle_arena_9x16.jpg` | `backgrounds/battle_arena_9x16.jpg` |
| 环境全景 equirect 2:1 | `backgrounds/sky_equirect_2x1.jpg` | `backgrounds/sky_equirect_2x1.jpg` |
| 棋盘俯视 albedo | `board/board_albedo_topdown.jpg` | `board/board_albedo_topdown.jpg` |
| 棋盘细节/法线向贴图 | `board/board_normal_topdown.jpg` | `board/board_normal_topdown.jpg` |

说明：

- 背景为宋风暗色石殿竞技场，**无棋子**，中心留台面。
- 棋盘图为 **俯视正交贴图**，可直接贴 `BoardScene` 面层；九宫/河界以纹理表现为准，若线条不精准可用程序线叠加。
- 全景可用于 `THREE.EquirectangularReflectionMapping` 或背景球。

---

## P1 — 建模 / 多姿态参考（已交付，非运行时必载）

### 攻击 / 指挥姿态（红）

| 文件 | 棋种 |
|------|------|
| `poses/red_king_command.jpg` | 帅 · 拔剑指挥 |
| `poses/red_cannon_attack.jpg` | 炮 · 端平开火 |
| `poses/red_chariot_attack.jpg` | 车 · 刺击 |
| `poses/red_horse_attack.jpg` | 马 · 突击 |
| `poses/red_elephant_attack.jpg` | 相 · 举盾 |

### 黑方三视图（从红 turnaround recolor）

| 文件 |
|------|
| `turnarounds/black/king_turnaround_v3.jpg` |
| `turnarounds/black/cannon_turnaround_v3.jpg` |
| `turnarounds/black/chariot_turnaround_v3.jpg` |
| `turnarounds/black/horse_turnaround_v3.jpg` |
| `turnarounds/black/elephant_turnaround_v3.jpg` |

红方全套仍在 `turnarounds/*_turnaround_v3.jpg`（7 种）。

### 仍属 P1 缺口

| 项 | 状态 |
|----|------|
| **GLB 低模** | 未提供（需建模） |
| 仕/兵攻击姿态 | 未单独出（可用待机 + 短标枪） |
| 黑方攻击姿态 | 可用红姿态 + 黑 recolor 流程补 |

---

## P2 — 增强（已交付）

| 资源 | production | public |
|------|------------|--------|
| 炮弹火球 | `vfx_extra/vfx_cannon_fireball(_alpha).png` | `vfx/` 同名 |
| 车冲锋刀光拖尾 | `vfx_extra/vfx_chariot_slash_trail(_alpha)` | `vfx/` |
| 将军叠加层 | `ui_extra/overlay_check_jiangjun.jpg` | `ui/` |
| 绝杀叠加层 | `ui_extra/overlay_checkmate_juesha.jpg` | `ui/` |
| 对话框空面板 | `ui_extra/panel_dialog_empty.jpg` | `ui/` |
| App 图标 | `ui_extra/app_icon.jpg` | `icons/app_icon.jpg` |
| 分享封面 16:9 | `ui_extra/share_cover_16x9.jpg` | `icons/share_cover_16x9.jpg` |
| 底座 512/768 | — | `runtime/512\|768/bases/` |
| 徽章分级 | — | `runtime/512\|768/badges/` |

原有爆炸 VFX 仍在：`vfx_blast_*_alpha.png`。

### 仍属 P2 可选缺口

| 项 | 说明 |
|----|------|
| 六面 cubemap 拆分 | 已有 equirect，可运行时转 cube |
| 多帧 VFX 序列（8–16 帧） | 现为关键单帧 + 代码粒子 |
| 图标 PNG 透明圆角导出 | 现为 JPG，上架前可再导出 |

---

## 接入提示（代码尚未强制绑定）

当前主循环仍以程序化竞技场为主。新图可按需接入：

```ts
// 背景
'/assets/backgrounds/battle_arena_16x9.jpg'
'/assets/backgrounds/battle_arena_9x16.jpg'
'/assets/backgrounds/sky_equirect_2x1.jpg'
// 棋盘
'/assets/board/board_albedo_topdown.jpg'
'/assets/board/board_normal_topdown.jpg'
// 叠加
'/assets/ui/overlay_check_jiangjun.jpg'
'/assets/ui/overlay_checkmate_juesha.jpg'
// 新 VFX
'/assets/vfx/vfx_cannon_fireball_alpha.png'
'/assets/vfx/vfx_chariot_slash_trail_alpha.png'
```

---

## 目录总览

```
production/
  backgrounds/     P0 场景
  board/           P0 棋盘贴图
  poses/           P1 攻击姿态
  turnarounds/     红 7 + black/ 5
  vfx_extra/       P2 扩展特效
  ui_extra/        P2 图标/叠加/面板
public/assets/
  backgrounds/ board/ vfx/ ui/ icons/
  runtime/512|768/ bases badges characters silhouettes
```
