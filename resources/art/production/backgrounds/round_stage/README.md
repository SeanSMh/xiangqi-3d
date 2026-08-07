# 圆台竞技场贴图（可进游戏）

专为当前 `ArenaEnvironment` 几何绘制，**中心不画假棋盘**。

| 文件 | 用途 | 对应 mesh |
|------|------|-----------|
| `arena_ground_circle.jpg` | 大圆地面 | `CircleGeometry` ground |
| `arena_stage_top.jpg` | 上下圆台顶面 | Cylinder **top** material |
| `arena_sky_equirect.jpg` | 天空穹顶 | `SphereGeometry` BackSide equirect |
| `arena_gold_rim.jpg` | 金环装饰 | `RingGeometry` inlay |

运行时副本：`public/assets/arena/`（同源）。

代码：`src/scene/arenaEnvironment.ts` 自动加载上述 URL。
