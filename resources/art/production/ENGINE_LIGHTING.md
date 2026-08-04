# 引擎统一灯光参数

概念图 rim 强度不统一时，**以代码为准**。

## 实现

| 文件 | 作用 |
|------|------|
| `src/scene/lighting.ts` | `LIGHTING` 常量 + `applyUnifiedLighting()` + `FACTION_COLORS` |
| `src/scene/boardScene.ts` | 调用统一灯光；棋子用玄青黑/红阵营色；中心 **0.85 格** 占位引导环 |

## 参数摘要

```
ambient:  #6a7a8c  intensity 0.42
key:      #fff0e0  intensity 1.05  pos (5, 14, 7)
fill:     #5a7aaa  intensity 0.38  pos (-7, 5, -4)
rim:      #6eb0ff  intensity 0.55  pos (-3, 6, -10)  ← 红黑同一 rim
hemi:     sky #2a3040 / ground #0a0a10  0.25
```

## 阵营色（禁止黑方纯黑）

| 阵营 | body | trim | ring |
|------|------|------|------|
| 红 | `#8b1a1a` | `#d4af37` | `#e53935` |
| 黑 | `#1a2838` 玄青黑 | `#b0bcc8` 银 | `#5a9fd4` |

黑方 `emissive #6eb0ff @ 0.06` 仅作极弱轮廓提示；主 rim 靠场景 DirectionalLight。

## 占位

```ts
OCCUPANCY_DIAMETER = 0.85 * CELL
```

示意图：`production/occupancy_0.85_guide.png`  
场景中心有半透明绿环（调试引导，后续可关）。
