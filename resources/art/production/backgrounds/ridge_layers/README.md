# 远山分层贴图（生成简报）

用真实绘制的分层山脉贴图，替换 `src/scene/skyDome.ts` 里正弦位移生成的程序化山脊。

| 文件 | 对应 mesh | 理想尺寸 | 目标色 |
|------|-----------|----------|--------|
| `ridge_01_near.png` | `arena-ridge-20`（r=20，最近） | 4096×256 | `#0a1120` 近乎纯黑 |
| `ridge_02_mid.png` | `arena-ridge-28`（r=28） | 4096×256 | `#101a2e` |
| `ridge_03_far.png` | `arena-ridge-38`（r=38） | 4096×256 | `#1a2942` |
| `ridge_04_horizon.png` | `arena-ridge-52`（r=52，最远） | 4096×256 | `#28405e` 最浅 |

运行时副本：`public/assets/arena/`（同源）。
代码：`src/scene/skyDome.ts` 的 `RIDGE_LAYERS` 与 `createRidgeRings()`。

---

## 一、先读这一节：所有数字是怎么来的

下面每个数字都是从相机几何反解出来的，**不是审美偏好**。改任何一个之前先回来看这里，
否则很容易「改得更好看」但接进去反而糊掉或被遮住。

### 相机与遮挡（桌面档 1280×720）

| 量 | 值 | 出处 |
|---|---|---|
| 机位 / 注视点 | `(0, 11, -10)` / 原点 | `presentationProfile.ts` |
| 垂直视角 / 水平视角 | 42° / 68.6° | fov 42，aspect 16:9 |
| 视锥顶端 | 水平线下 **26.7°** | 俯角 47.7° − 42/2 |
| 地面圆盘遮挡 | 水平线下 **32.5°** | `atan((11+0.86) / (8.6+10))` |
| 环绕范围 | **完整 360°，无夹紧** | `normalizeCameraOrbitYaw` 归一化到 `[-π, π)` |

> **相机永远不看水平线以上**，真正能看到背景的只有 26.7°–32.5° 这条 5.8° 宽的缝
> （画面正中约 70px 高，两侧因圆盘边缘更低而更宽）。

### 由此推出的三条硬约束

1. **必须 360° 横向无缝**。相机能绕满一圈，接缝藏不住。
2. **比例必须是 16:1**。贴图横向要绕满 `2πR` 的周长，纵向只需覆盖可见的
   1.1–5.4 个世界单位。比例给错就会被拉扁。
3. **图里不能有任何天空**。天空是着色器实时画的（渐变 + 星云 + 星点 + 流星），
   烘进图里会和实时天空打架。

### 每层的密度与可见高度

`px/度` = 画面中央每 1° 方位角占多少屏幕像素，决定贴图要多宽才不糊。

| 层 | 半径 | 视轴距离 | px/度 | 360° 所需宽 | 可见世界高 | 4096×256 时的余量 |
|---|---|---|---|---|---|---|
| 01 近 | 20 | 33.5 | 9.77 | 3518 | 1.1 | 7.0× |
| 02 中近 | 28 | 41.9 | 10.93 | 3936 | 2.1 | 5.2× |
| 03 中远 | 38 | 52.4 | 11.87 | 4272 | 3.4 | 4.4× |
| 04 远 | 52 | 66.9 | 12.72 | 4578 | 5.4 | 3.8× |

4096 宽覆盖得住全部四层（最高需 4578，略有欠采样但可接受），且是通用最大纹理尺寸。
256 高由等比推得，同时留出 3.8–7 倍的竖直余量，换视口或换机型时不会露馅。

### ⚠️ 反直觉的一点：把力气花在 03 和 04

实测天际线归属（即「哪一层的轮廓真正压在天空上」）：

| 层 | 01 (r20) | 02 (r28) | 03 (r38) | 04 (r52) |
|---|---|---|---|---|
| 占天际线 | 0% | 0% | **23%** | **77%** |

最近两层只是垫在下面的窄带，各自只露出 1.1 和 2.1 个世界单位。
**03 和 04 的山形决定整个背景的观感，01 和 02 不必太用力。**

---

## 二、通用约束（每条提示词都要带）

```
seamless horizontally tileable panorama, left and right edges must match exactly,
dark backlit mountain ridgeline silhouette,
background above the ridgeline is SOLID FLAT MAGENTA #FF00FF,
absolutely no gradient / no glow / no atmospheric haze in the magenta area,
ridgeline peaks reach the upper 20% of the frame with clear magenta headroom above the highest peak,
mountain body extends solidly to the bottom edge, no gap, no ground line,
peak heights vary across the strip: tall clusters and low saddles, not an even wall,
--ar 16:1
```

**反向词**

```
sky, clouds, stars, sun, moon, gradient background, water, lake, river,
trees, forest, buildings, castle, people, text, watermark, signature,
vignette, border, frame, foreground rocks, birds
```

### 为什么用洋红底

天空由着色器实时绘制，图里绝对不能烘天空。洋红 `#FF00FF` 在岩石里永不出现，抠图最干净。

**如果你的工具能直接输出带 alpha 通道的 PNG，那更好——直接给透明底，跳过抠图。**

---

## 三、四条分层提示词

四层必须是**四条不同的山形**，不能是同一张改颜色——叠起来一眼假。

### 01 近景 `ridge_01_near.png`

```
seamless horizontally tileable panorama, bold jagged foreground mountain ridge,
sharp rocky spires and steep cliff faces, high contrast, almost pure black
silhouette, color #0a1120, minimal internal detail, night, dark fantasy,
<通用约束>
```

### 02 中近 `ridge_02_mid.png`

```
seamless horizontally tileable panorama, overlapping rocky ridges at medium
distance, moderately jagged crest, dark blue-black #101a2e, faint edge
definition between overlapping ridges, night, dark fantasy,
<通用约束>
```

### 03 中远 `ridge_03_far.png` — 天际线主力之一

```
seamless horizontally tileable panorama, distant mountain range, elegant varied
peak silhouette with deep V-shaped valleys and sharp summits, muted dark blue
#1a2942, slight softening toward the base, night, dark fantasy,
<通用约束>
```

### 04 远景 `ridge_04_horizon.png` — 天际线主力

```
seamless horizontally tileable panorama, very distant hazy mountain range on the
horizon, tall dramatic snow-dusted summits with low soft foothills between them,
pale slate blue #28405e, low contrast, atmospheric perspective, night,
<通用约束>
```

---

## 四、工具画不出 16:1 时的退路

多数图像模型超过 3:1 就开始崩。改用下面的尺寸，接入时按**互质次数**平铺，
合成后周期是 360°，视野内看不出重复：

| 文件 | 退让尺寸 | 比例 | 平铺次数 | 等效宽度 | 需求宽度 |
|---|---|---|---|---|---|
| `ridge_01_near.png` | 768×256 | 3:1 | 5 | 3840 | 3518 ✅ |
| `ridge_02_mid.png` | 1024×256 | 4:1 | 4 | 4096 | 3936 ✅ |
| `ridge_03_far.png` | 1536×256 | 6:1 | 3 | 4608 | 4272 ✅ |
| `ridge_04_horizon.png` | 2304×256 | 9:1 | 2 | 4608 | 4578 ✅ |

平铺次数取 5/4/3/2 是因为它们两两互质：单层各自重复，但四层叠加后的图案
要绕满一整圈才复现一次。

**接缝不用你处理。** 给我比目标宽约 10% 的图，我做环绕交叉淡化闭合。

---

## 五、风格说明：别在质感上使劲

最亮的一层也只到 `#28405e`。在这个亮度下，**写实照片和手绘板绘几乎看不出区别**——
细节全被压进剪影里了。让模型优化**山形轮廓**，不要在岩石纹理上花力气。

另外竞技场本身是低多边形风格（8 边柱体、十二面体浮岩），过度写实的山反而会打架。
「写实感但偏剪影」是安全区。

---

## 六、验收清单

拿到图后逐条对：

- [ ] 山脊之上是**纯平洋红**，无渐变、无光晕、无雾（或已是透明底）
- [ ] 最高峰顶到画面上边缘留有 15–20% 的洋红余量，峰尖没被切掉
- [ ] 山体**实心贴到下边缘**，底部没有留白、没有地平线
- [ ] 峰高有变化——有高峰簇也有低鞍部，不是一堵等高的墙
- [ ] 图里没有天空、云、星、太阳、水面、树木、建筑、文字水印
- [ ] 四张是四条不同的山形
- [ ] 比例 16:1（或第四节的退让比例之一）

---

## 七、交付与接入

1. 文件放到 `resources/art/production/backgrounds/ridge_layers/`
2. 告诉我**实际尺寸**与**是否带 alpha 通道**

接入时我会做这些（都需要按实际贴图重新量，不能沿用现值）：

- 材质从 `vertexColors` 改为 `map` + `alphaMap`
- 洋红抠图（可复用 `scripts/derive_pose_alpha.mjs` 的边界屏障法）
- 环绕交叉淡化闭合接缝；必要时按第四节平铺
- 同步到 `public/assets/arena/`
- **重新二分反解 `topY`**：图里山顶的位置和现在正弦算出来的不一样，
  不重新对齐会导致山被圆盘吃掉或顶出画面
- 复核层间雾带（`MIST_BANDS`，r=24/33/45）的高度是否仍落在层与层之间
- 回归：218 项测试 + `?clock=manual` 下的截图确定性（同一时刻两次截图 SHA-256 必须相同）

---

## 附：现行程序化参数（作为对照基准）

替换前的 `RIDGE_LAYERS`，接入后如果观感反而变差，可回退比对：

| 半径 | topY | jag | depth | top 色 | base 色 |
|---|---|---|---|---|---|
| 20 | -7.0 | 1.19 | 24 | `0x0a1120` | `0x03060d` |
| 28 | -11.1 | 1.38 | 28 | `0x101a2e` | `0x070c18` |
| 38 | -16.2 | 1.71 | 32 | `0x1a2942` | `0x0e1728` |
| 52 | -23.1 | 2.31 | 38 | `0x28405e` | `0x1a2a42` |

`topY` 由「脊线要落在屏幕第几行」二分求解 `screenY(topY, radius)` 得到，
目标行依次为 78 / 64 / 52 / 38；`jag` 由「想要多少 px 起伏」反解，
目标依次为 ±30 / 28 / 28 / 30 px。
