Original prompt: 那你设计开发方案，开始开发吧，合理利用资源

## 当前里程碑

- [x] 完整基础象棋规则引擎与测试
- [x] 本地双人点选、合法落点、走棋与吃子
- [x] 将军、绝杀、困毙与重开
- [x] `render_game_to_text` / `advanceTime` / 全屏验收钩子
- [x] Playwright 可玩验证与截图检查

## 约束

- 规则状态是唯一真相，Three.js 仅负责呈现。
- 七棋种共享造型，红黑使用不同材质；当前先保留轻量占位模型。
- 美术资源只从 `public/assets/` 读取，禁止使用 `archive_*`。

## 2026-08-04 首个可玩里程碑

- `src/engine/moves.ts` 已实现帅/将、仕/士、相/象、马、车、炮、兵/卒，包含九宫、河界、象眼、马腿、炮架、将帅照面、自将过滤、将军、绝杀和困毙判负。
- `src/game/controller.ts` 负责选择、切换选择、合法着、走棋、吃子与重开；规则状态保持为唯一真相。
- `src/scene/boardScene.ts` 已接入 production 红黑底座 PNG，以及金色选择圈、白色合法圈、红色吃子圈；补全楚河断线和双方九宫线。
- HUD 已显示行棋方、将军、战果、终局、选择提示，并提供“重开 R”和“全屏 F”。
- 浏览器验收钩子已提供：`window.render_game_to_text()` 与 `window.advanceTime(ms)`。

## 验收记录

- `npm test`：2 个测试文件、19 个测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，Vite 生产包已生成。
- Playwright：验证初始局面、红兵选择与合法圈、红黑各一步、红色吃子圈、兵吃卒、重开、全屏；最终吃子状态为 `ply=3`、`captured=["black:卒"]`，无控制台错误。

## 下一阶段 TODO

- [x] 增加 `AnimationDirector`：规则先结算，表现层锁输入并播放移动/受击/退场，完成后 `snapTo(nextState)`。
- [x] 完成车直线移动、阵营拖尾与通用吃子退场垂直切片。
- [x] 实现炮弹道和马日字跃迁，补齐三类演出差异。
- [ ] 把共享棋种剪影或后续 GLB 角色接到底座上；红黑继续共用造型，仅切换材质与阵营色。
- [ ] 增加棋谱回放、悔棋和 AI；长将、长捉、循环局面作为独立竞赛规则阶段处理。

## 2026-08-04 第二阶段：走子与吃子演出

- 第一阶段已提交：`bd18e37 feat: 完成中国象棋本地双人可玩基线`。
- 新增 `src/animation/animationDirector.ts`，使用确定性 `travel → impact → victim-exit → settle` 状态机；权威局面先提交，动画期间只锁表现层输入。
- `BoardScene` 新增棋子浮点姿态、车阵营色拖尾、白青冲击核、橙金爆炸、受害者缩小抬升旋转，以及结束后的权威局面吸附。
- `window.advanceTime(ms)` 现在真实推进动画；`render_game_to_text()` 增加 `inputLocked`、`manualClock` 和完整动画快照。
- 重开可在任意动画阶段执行 `cancelAndSnap`；被吃 Mesh 删除时释放 geometry/material，缓存 Texture 保留复用。
- 修复过期 `Piece` 引用可能按错误坐标生成着法的问题，并补齐帅受攻击、被将应对、炮架将军和马腿将军测试。

### 第二阶段验收

- `npm test`：3 个测试文件、27 个测试全部通过。
- Playwright 半程：红车 `(0,0) → (0,1)` 在 `elapsedMs=183.333` 时视觉位置 `rank=0.568`，`inputLocked=true`；动画期间点击黑炮未产生新着法。
- Playwright 吃子：5 ply 合法序列触发红车吃黑炮，已截取 `impact` 与 `victim-exit`；最终 `captured=["red:马","black:炮"]`、动画回到 `idle`。
- Playwright 动画中重开：恢复 `ply=0`、32 子、`inputLocked=false`；全部场景无控制台错误。

## 2026-08-04 第三阶段：炮弹道与马跃迁

- 第二阶段已提交：`79bf8b9 feat: 增加走子与吃子演出状态机`。
- `AnimationDirector` 新增 `standard / chariot / horse / cannon` 演出类型；状态快照增加 `style` 与可观测的 `projectile` 姿态。
- 马使用固定 `480ms` 的日字贝塞尔路线：以马腿方向的相邻格作为控制点，并按曲线切线转向；半程最高抬升 `0.48` 格距。
- 炮吃子时炮身留在起点发射，炮弹以确定性抛物线飞向目标；命中后复用白青冲击与橙金爆炸，炮身在受害者退场阶段滑入目标格。
- `BoardScene` 新增炮弹亮核、橙色外焰和锥形短尾迹；结束或重开统一由 `clearTransientEffects()` 清理。
- 红黑双方共用棋种逻辑与特效参数，不依赖阵营专属贴图。

### 第三阶段验收

- `npm test`：3 个测试文件、29 个测试全部通过；新增马分步确定性、炮弹半程、命中和炮身入位断言。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留 Three.js 单包超过 `500 kB` 的非阻断提示。
- Playwright 马跃半程：`elapsedMs=250`，视觉位置 `(1.271, 1.042)`、抬升 `0.479`、切线朝向 `0.48rad`；最终落在 `(2,2)` 并回到 `idle`。
- Playwright 炮弹半程：`elapsedMs=266.667`，炮身仍在 `(1,2)`，炮弹进度 `0.498`、位置 `(1,5.489)`、抬升 `1.25`。
- Playwright 炮击退场：`elapsedMs=833.333`，炮身已滑至 `rank=5.367`，受害者缩至 `0.256`，橙金爆炸生效。
- Playwright 最终局面：红炮完成 `(1,2) × (1,9)`，`captured=["black:马"]`、动画回到 `idle`；所有场景无控制台错误。
