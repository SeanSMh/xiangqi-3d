# 角色制作简报（Production）

> v3 红黑双色交付 + 同源剪影 + 引擎统一灯光。

## 验收总表

| 棋 | 红 | 黑 | 剪影同源 | 三视图 |
|----|----|----|----------|--------|
| 帅/将 | 通过 | 通过 | 通过 | `king_turnaround_v3.jpg` |
| 仕/士 | 通过 | 通过 | 通过 | `advisor_turnaround_v3.jpg` |
| 相/象 | 通过* 拟人象 | 通过* | 通过 | `elephant_turnaround_v3.jpg` |
| 马 | 通过 半身 | 通过 | 通过 | `horse_turnaround_v3.jpg` |
| 车 | 通过 | 通过 | 通过 | `chariot_turnaround_v3.jpg` |
| 炮 | 通过 | 通过 非红缨 | 通过 | `cannon_turnaround_v3.jpg` |
| 兵/卒 | **通过** 短标枪 | **通过** | 通过 | `pawn_turnaround_v3.jpg` |

## 本轮收口

1. **兵/卒短矛**：改为胸高短标枪姿态，红黑同步，剪影同源 → 取消 WARN  
2. **引擎灯光**：`src/scene/lighting.ts` 统一 ambient/key/fill/rim；黑方玄青黑材质  
3. **Turnaround**：帅仕相马车炮兵 均有 v3 三视图  
4. **0.85 格**：`occupancy_0.85_guide.png` + 场景引导环 + `OCCUPANCY_DIAMETER`  

## 权威路径

```
redesign/red_*_v3.jpg
redesign/black_*_v3.jpg    # 无 black/ 子目录
silhouettes/sil_* (+ alpha)
turnarounds/*_turnaround_v3.jpg
ENGINE_LIGHTING.md
occupancy_0.85_guide.png
```

## 仍可选

- 关闭场景占位绿环的正式开关  
- 黑方三视图（可 recolor 红三视图，非必须）  
- 真实低模建模  
