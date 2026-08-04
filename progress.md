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

- 增加 `AnimationDirector`：规则先结算，表现层锁输入并播放移动/受击/退场，完成后 `snapTo(nextState)`。
- 先做车直线移动与通用近战吃子，再做炮弹道和马弧线，形成三类演出垂直切片。
- 把共享棋种剪影或后续 GLB 角色接到底座上；红黑继续共用造型，仅切换材质与阵营色。
- 增加棋谱回放、悔棋和 AI；长将、长捉、循环局面作为独立竞赛规则阶段处理。
