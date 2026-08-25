# 站立态背视原画（生成简报）

给背向镜头的一方补上真实角色图，替换当前的纯色剪影。

| 交付 | 数量 | 去处 |
|------|------|------|
| `{side}_{kind}_back_v3.jpg` | 14（7 兵种 × 红/黑） | `public/assets/characters/` |
| 蒙版 | **不用你做** | 接入侧用 `scripts/derive_pose_alpha.mjs` 生成 |

`kind` ∈ `king / advisor / elephant / horse / chariot / cannon / pawn`，`side` ∈ `red / black`。

---

## 一、为什么需要

背向一方（当前是红方）现在渲染的是 `role-fallback`——用蒙版填单色的**纯色剪影**，
形状对但没有任何画面内容。代码里写得很直白：

```ts
// 背向：有背向攻击姿则显示攻击层；否则仍用同源轮廓剪影（绝不镜像正脸）。
```

即：这是**缺资源时的占位**，而且明确禁止镜像正脸（否则人物背后会长出一张脸）。
架构本身已经预留好了背视通道（`CHARACTER_BACK_VISUAL_MODE`、背向攻击层），
缺的只是站立态的背视原画。

## 二、为什么不能复用现有资源

两套现成的背面素材都试过，都不行：

**三视图 `turnarounds/*_turnaround_v3.jpg` 的 BACK 栏**
- 姿势是 T-pose 摊手，而游戏正面图是持械站姿，混用一眼假
- BACK 栏在 1024×1024 的图里只占约 240×620，比正面图低三倍分辨率
- 灰底、平光，和正面图的深蓝渐晕环境光不是一套

**攻击态 `poses/{side}_{kind}_attack_back.jpg`**
- 动作幅度差异极大：`king` 基本是站姿（可用），但 `horse` 是人立掷矛的冲锋（完全不可用）。
  直接挪用会出现「有的站着有的在冲锋」
- 更要命的是**攻击动画会失去落点**——站立态若已经是攻击姿，出手时就无姿可换

## 三、关键做法：这是「换姿势」不是「从头画」

14 个角色的甲胄纹样很密，**纯文字提示词复现不出来**。但背面甲胄的样子已经画过了——
就在 `poses/{side}_{kind}_attack_back.jpg` 里。所以：

> **用 `{side}_{kind}_attack_back.jpg` 作外观参考（甲胄/配色/背面结构），
> 用 `characters/{side}_{kind}_v3.jpg` 作姿势与构图参考，
> 产出「该角色的站立姿势，从背后看」。**

务必走图生图 / 角色参考（character reference）通道，不要纯文本生成。

## 四、构图必须逐兵种对齐

相机可 360° 环绕，转过切换点时正视会换成背视。两图的人物包围盒若对不上，
棋子会**跳一下**。所以背视图要匹配**它自己那张正面图**的画布与包围盒，不是统一值。

实测各兵种正面蒙版的包围盒（容差 ±10px）：

| kind | 画布 | 头顶行 | 脚底行 | 左 | 右 | 水平中心 | 身高占比 |
|------|------|--------|--------|----|----|----------|----------|
| king | 1024×1024 | 33 | 953 | 354 | 752 | 553 | 89.8% |
| advisor | 1024×1024 | 55 | 963 | 336 | 716 | 526 | 88.7% |
| elephant | 1024×1024 | 121 | 937 | 96 | 896 | 496 | 79.7% |
| horse | **912×1136** | 26 | 1076 | 176 | 710 | 443 | 92.4% |
| chariot | 1024×1024 | 28 | 971 | 248 | 738 | 493 | 92.1% |
| cannon | 1024×1024 | 34 | 984 | 216 | 744 | 480 | 92.8% |
| pawn | 1024×1024 | 168 | 933 | 132 | 746 | 439 | 74.7% |

注意 `horse` 的画布不是 1024×1024。

**左右会镜像**：背视是原地转 180°，不是照镜子。所以正面图里握在人物右手的兵器，
在背视图里应出现在**画面另一侧**。这条最容易做错——做成镜像正脸就废了。

## 五、提示词

**14 条完整提示词见同目录 [`PROMPTS.md`](./PROMPTS.md)**（按兵种逐条写好，可直接复制）。
下面是它们共用的骨架，仅供理解；实际使用请用 `PROMPTS.md`。

必须配合第三节的两张参考图一起用。

### 通用约束

```
Back view of the character, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and same camera framing as the pose reference,
rotated 180 degrees — this is the character turned around, NOT a mirror image.
The head must show the back of the helmet and the back of the head.
No face, no eyes, absolutely nothing facial visible.

Weapons and props stay in the same hand as the reference, which means they
appear on the OPPOSITE side of the frame.

BACKGROUND: solid flat magenta #FF00FF, completely uniform,
no gradient, no vignette, no ground plane, no floor glow, no cast shadow.
Crisp edge between figure and magenta.
Light the figure as if standing in a dark blue night environment
(match the reference lighting) — no magenta light spilling onto the armour.

Full body, feet included, nothing cropped.
```

### 反向词

```
face, eyes, facial features, front view, three-quarter view, mirrored,
T-pose, arms spread, attack pose, lunging, running, rearing horse,
ground shadow, floor glow, magic circle, pedestal, background scenery,
gradient background, text, watermark, border, frame
```

### 逐兵种姿势备注

姿势一律照抄各自的正面图，只补两点：

| kind | 备注 |
|------|------|
| horse | 马与骑手都要背视，**马四蹄着地站立**，不是人立冲锋 |
| chariot / cannon | 器械的背面结构要交代清楚，别只画人 |
| elephant | 体宽最大（占画布 800px），别缩小 |
| pawn | 身高占比最低（74.7%），画小一点是对的 |

## 六、验收

- [ ] 完全看不到脸、眼睛或任何五官
- [ ] 不是镜像——兵器换到了画面另一侧
- [ ] 背景是纯平洋红，无渐晕、无地面光圈、无投影
- [ ] 甲胄纹样与配色和 `attack_back` 参考一致（红方红金、黑方藏青银）
- [ ] 画布尺寸与第四节表格一致（注意 `horse` 是 912×1136）
- [ ] 人物包围盒与表格相差不超过 ±10px
- [ ] 站立姿，不是攻击姿

## 七、接入侧会做什么

1. 洋红抠图 + 去溢色（复用远山那套判据，`scripts/prepare_ridge_texture.mjs` 已验证）
2. 用 `scripts/derive_pose_alpha.mjs` 生成蒙版到
   `public/assets/silhouettes/sil_{side}_{kind}_back_alpha.png`
3. 在 `pieceVisuals.ts` 增加背视资源规格（现有 URL 约定见
   `colorAssetUrl: /assets/characters/${side}_${kind}_v3.jpg`）
4. `piecePresenter.ts` 的 back 分支改为优先用背视本体，剪影降为加载中的兜底
5. 校验包围盒对齐：绕相机过切换点截图，比对棋子屏幕位置是否连续
6. **重跑 `scripts/generate_runtime_character_assets.sh`**，补出 512／768 衍生档。
   `/assets/characters/*.jpg` 与 `/assets/silhouettes/sil_*_alpha.png` 都会被
   `resolvePresentationTextureUrl` 映射到 `/assets/runtime/{512,768}/`；漏了这步，
   桌面正常但手机／平板一律 404、静默退回纯色剪影
7. 回归测试与手动时钟截图确定性
