# 站立态背视 · 14 条提示词

配套简报见同目录 [`README.md`](./README.md)（含为什么需要、构图约束、验收清单）。
本文件只放可直接复制的提示词。

## 使用方式

**必须走图生图 / 角色参考通道，不要纯文本生成。** 每条提示词要挂两张参考图：

| 参考 | 文件 | 作用 |
|------|------|------|
| 外观参考 | `public/assets/poses/{side}_{kind}_attack_back.jpg` | 背面甲胄、纹样、配色 |
| 姿势参考 | `public/assets/characters/{side}_{kind}_v3.jpg` | 站姿、构图、取景 |

背面甲胄的样子**已经画过了**，就在攻击态背视里。这是「换姿势」不是「从头画」。

## 反向词（14 条通用）

```
face, eyes, facial features, front view, three-quarter view, mirrored image,
T-pose, arms spread, attack pose, lunging, charging, rearing horse,
ground shadow, floor glow, magic circle, pedestal, background scenery,
gradient background, vignette, text, watermark, border, frame
```

## 输出规格

| kind | 画布 | `--ar` | 头顶行 | 脚底行 | 水平中心 |
|------|------|--------|--------|--------|----------|
| king | 1024×1024 | 1:1 | 33 | 953 | 553 |
| advisor | 1024×1024 | 1:1 | 55 | 963 | 526 |
| elephant | 1024×1024 | 1:1 | 121 | 937 | 496 |
| horse | **912×1136** | 4:5 | 26 | 1076 | 443 |
| chariot | 1024×1024 | 1:1 | 28 | 971 | 493 |
| cannon | 1024×1024 | 1:1 | 34 | 984 | 480 |
| pawn | 1024×1024 | 1:1 | 168 | 933 | 439 |

包围盒容差 ±10px。相机可 360° 环绕，过切换点时正视换背视，对不上棋子会跳。

---

# 红方（红漆甲 + 金饰）

## 1. `red_king_back_v3.jpg`

```
Back view of an armoured general, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: heavy lamellar armour in deep red lacquer with gold trim, red plume on
the helmet, gold beast-head pauldrons. Standing at ease, feet planted apart,
arms relaxed at the sides. He holds a straight sword point-down in one hand —
same hand as the reference, so the blade appears on the OPPOSITE side of frame.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 2. `red_advisor_back_v3.jpg`

```
Back view of an armoured court advisor, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: deep red lacquered armour with gold trim, red plume. He holds a tall
green jade tablet upright against his chest with both hands. Seen from behind
the tablet is almost entirely HIDDEN by his body — only its top edge rises
above his shoulders and a sliver may show at his sides. Do not draw the jade
tablet in front of his back.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 3. `red_elephant_back_v3.jpg`

```
Back view of an armoured war elephant, standing idle, seen directly from behind.
Same creature, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the elephant turned around, NOT a mirror image.

SUBJECT: a war elephant in deep red lacquered barding with gold trim, standing
squarely on all four legs. From behind we see its armoured rump, its tail, the
back edges of the ear armour, and the rear straps of the barding. The trunk and
tusks are NOT visible. The spiked gold mace and the banner stay on the same
side of the animal, so they appear on the OPPOSITE side of the frame.
This is the widest of the set — it should fill roughly 800px of the canvas width.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light it as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Whole animal, feet included, nothing cropped.
--ar 1:1
```

## 4. `red_horse_back_v3.jpg`

```
Back view of an armoured cavalryman on horseback, standing idle, seen directly
from behind. Same character, same armour, same colours as the appearance
reference. Same framing as the pose reference, rotated 180 degrees — horse and
rider turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the rider's head.
No face, no eyes.

SUBJECT: rider in deep red lacquered armour with gold trim, mounted on a dark
brown warhorse in red tack. The horse STANDS CALMLY ON ALL FOUR HOOVES — it is
not rearing, not charging, not in motion. From behind we see the horse's
armoured rump, its braided tail, and the rider's back. The rider holds a spear
upright in the same hand as the reference, so it appears on the OPPOSITE side
of the frame.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Horse and rider complete, all four hooves included, nothing cropped.
--ar 4:5
```

## 5. `red_chariot_back_v3.jpg`

```
Back view of an armoured halberdier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: deep red lacquered armour with gold trim. He stands holding a tall
gold-bladed polearm upright, and a large wooden spoked chariot wheel rests
against his other side. Both props keep the same hand and side of the body, so
BOTH appear on the OPPOSITE side of the frame from the reference. Draw the back
face of the wheel — hub, spokes and rim seen from behind.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 6. `red_cannon_back_v3.jpg`

```
Back view of an armoured bombardier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: deep red lacquered armour with gold trim, arms relaxed at the sides.
A tall bronze cannon barrel with a flared muzzle stands upright beside him,
on the same side of his body as the reference — so it appears on the OPPOSITE
side of the frame. Show the barrel's rear: the breech end and its bands.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 7. `red_pawn_back_v3.jpg`

```
Back view of a light infantry soldier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: lighter armour than the other pieces — dark padded coat with red
lacquered plates and modest gold trim, red plume. He holds a spear angled
across his body in the same hand as the reference, so the shaft crosses to the
OPPOSITE side of the frame. He is the shortest of the set: the figure should
fill only about 75% of the canvas height, feet low, clear space above the head.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

---

# 黑方（藏青甲 + 银饰）

与红方**同一造型、同一姿势**，只换配色：红漆→藏青，金饰→银饰，红缨→深蓝缨。
参考图换成 `black_*` 那一套。

## 8. `black_king_back_v3.jpg`

```
Back view of an armoured general, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: heavy lamellar armour in dark navy blue with silver trim, dark blue
plume on the helmet, silver beast-head pauldrons. Standing at ease, feet planted
apart, arms relaxed at the sides. He holds a straight sword point-down in one
hand — same hand as the reference, so the blade appears on the OPPOSITE side
of frame.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 9. `black_advisor_back_v3.jpg`

```
Back view of an armoured court advisor, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: dark navy armour with silver trim, dark blue plume. He holds a tall
green jade tablet upright against his chest with both hands. Seen from behind
the tablet is almost entirely HIDDEN by his body — only its top edge rises
above his shoulders and a sliver may show at his sides. Do not draw the jade
tablet in front of his back.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 10. `black_elephant_back_v3.jpg`

```
Back view of an armoured war elephant, standing idle, seen directly from behind.
Same creature, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the elephant turned around, NOT a mirror image.

SUBJECT: a war elephant in dark navy barding with silver trim, standing squarely
on all four legs. From behind we see its armoured rump, its tail, the back edges
of the ear armour, and the rear straps of the barding. The trunk and tusks are
NOT visible. The spiked mace and the banner stay on the same side of the animal,
so they appear on the OPPOSITE side of the frame.
This is the widest of the set — it should fill roughly 800px of the canvas width.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light it as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Whole animal, feet included, nothing cropped.
--ar 1:1
```

## 11. `black_horse_back_v3.jpg`

```
Back view of an armoured cavalryman on horseback, standing idle, seen directly
from behind. Same character, same armour, same colours as the appearance
reference. Same framing as the pose reference, rotated 180 degrees — horse and
rider turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the rider's head.
No face, no eyes.

SUBJECT: rider in dark navy armour with silver trim, mounted on a dark warhorse
in navy tack. The horse STANDS CALMLY ON ALL FOUR HOOVES — it is not rearing,
not charging, not in motion. From behind we see the horse's armoured rump, its
braided tail, and the rider's back. The rider holds a spear upright in the same
hand as the reference, so it appears on the OPPOSITE side of the frame.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Horse and rider complete, all four hooves included, nothing cropped.
--ar 4:5
```

## 12. `black_chariot_back_v3.jpg`

```
Back view of an armoured halberdier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: dark navy armour with silver trim. He stands holding a tall
silver-bladed polearm upright, and a large wooden spoked chariot wheel rests
against his other side. Both props keep the same hand and side of the body, so
BOTH appear on the OPPOSITE side of the frame from the reference. Draw the back
face of the wheel — hub, spokes and rim seen from behind.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 13. `black_cannon_back_v3.jpg`

```
Back view of an armoured bombardier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: dark navy armour with silver trim, arms relaxed at the sides.
A tall dark bronze cannon barrel with a flared muzzle stands upright beside him,
on the same side of his body as the reference — so it appears on the OPPOSITE
side of the frame. Show the barrel's rear: the breech end and its bands.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

## 14. `black_pawn_back_v3.jpg`

```
Back view of a light infantry soldier, standing idle, seen directly from behind.
Same character, same armour, same colours as the appearance reference.
Same standing pose and framing as the pose reference, rotated 180 degrees —
the character turned around, NOT a mirror image.
Show the back of the plumed helmet and the back of the head. No face, no eyes.

SUBJECT: lighter armour than the other pieces — dark padded coat with navy
lacquered plates and modest silver trim, dark blue plume. He holds a spear
angled across his body in the same hand as the reference, so the shaft crosses
to the OPPOSITE side of the frame. He is the shortest of the set: the figure
should fill only about 75% of the canvas height, feet low, clear space above
the head.

Background: solid flat magenta #FF00FF, uniform, no gradient, no vignette,
no ground plane, no floor glow, no cast shadow. Crisp edge against the magenta.
Light the figure as if in a dark blue night environment (match the reference);
no magenta spill on the armour.
Full body, feet included, nothing cropped.
--ar 1:1
```

---

## 最容易做错的三件事

1. **做成了镜像**。背视是原地转 180°，不是照镜子。兵器必须换到画面另一侧。
   镜像的特征是兵器还在原来那一侧——一眼可查。
2. **画出了脸**。哪怕是四分之三侧脸也不行，会和正面图撞车。
3. **马在冲锋 / 人在出手**。这是站立态，不是攻击态。攻击态另有一套
   （`poses/*_attack_back.jpg`），站立态若也画成攻击姿，出手时动画就没有落点了。

## 交付

放到 `resources/art/production/back_idle/`，命名照上面的小标题。
**蒙版不用做**，接入侧用 `scripts/derive_pose_alpha.mjs` 生成。
