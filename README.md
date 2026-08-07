# 中国象棋 3D（Xiangqi Battle）

复刻 [3D Chess Battle](https://x.com/cellinlab/status/2084507607713116460) 风格的 **中国象棋 3D 对战**：固定斜俯视、人偶棋子、走子动画、吃子战斗特效、战果 HUD。

## 项目路径

```
/Users/bril/projects/xiangqi-3d
```

## 目录结构

```
xiangqi-3d/
├── package.json              # 项目依赖与脚本
├── tsconfig.json
├── vite.config.ts
├── index.html                # 应用入口
├── public/                   # 运行时静态资源（构建会拷贝）
├── src/                      # 源码
│   ├── main.ts               # 启动
│   ├── animation/            # 确定性演出时间线
│   │   ├── combatProfile.ts  #   七棋种战斗档案（纯数据，不依赖 three）
│   │   └── animationDirector.ts # 蓄力→行进→命中→消散→占领→收势
│   ├── engine/               # 中国象棋规则引擎（纯逻辑）
│   ├── scene/                # Three.js 表现层
│   │   ├── boardScene.ts     #   组合根：棋盘本体、标记、拾取
│   │   ├── cameraDirector.ts #   相机三层合成（轨道／剧情／震动）
│   │   ├── piecePresenter.ts #   棋子、角色卡、广告牌、消散
│   │   ├── combatEffects.ts  #   拖尾、弹道、冲击、占领尘环
│   │   └── textureLibrary.ts #   纹理缓存与画质档切换
│   ├── ui/                   # HUD：行棋方、将军、战果
│   ├── audio/                # Web Audio 原创合成音效
│   └── types/                # 类型定义
├── resources/                # 设计与参考资源（不进运行时打包）
│   ├── README.md
│   └── reference/            # 原版视频逐帧 / UI / VFX / 规格文档
│       ├── 00_source_video.mp4
│       ├── 01_all_frames*
│       ├── 02_ui_crops/
│       ├── 03_vfx_battle/
│       ├── 04_pieces_selection/
│       ├── 05_board_scene/
│       ├── 06_audio/
│       ├── docs/VISUAL_SPEC.md
│       ├── docs/XIANGQI_REMAKE_PLAN.md
│       └── index.html
└── scripts/                  # 工具脚本
```

## 开发

```bash
cd /Users/bril/projects/xiangqi-3d
npm install
npm run dev
```

## 操作

- 点选棋子，再点击亮起的合法落点完成走棋。
- 触控端在抬指时提交点按；移动超过 `10px`、多指或系统取消手势都不会误走棋。
- `M`：选择本地双人或人机对弈；人机模式固定玩家执红、AI 执黑，可选入门 / 标准 / 挑战。
- `U` 或 `Cmd/Ctrl + Z`：双人模式悔棋一手；人机模式回到上一个玩家决策点。`R`：重开；`F`：全屏。
- `H`：打开棋谱；棋谱中可点击任意着法，也可用 `← / →`、`Home / End` 逐手定位，`Space` 播放或暂停，`Enter` 返回当前局面。
- `T`：战术俯视——隐藏角色立绘、只留底座汉字，每个交点都不被遮挡。
- `C`：录制模式——收起全部 HUD，只留右下角一个恢复按钮。
- `?`：打开本局规则说明；再次按 `?` 或按 `Esc` 关闭。
- 棋谱坐标使用用户可读的 1-based `(路, 横线)`，范围为 `(1,1)` 至 `(9,10)`。

## 规则档案

- 对局采用可确定执行的 `program-competition-2023` 自动裁判档案。
- 终局优先级为：将死／困毙 → 三次同形循环 → 120 个有效未吃子着 → 仅剩将士象。
- 循环按“长将 `2`、长捉 `1`、允许循环 `0`”比较；等级高的一方判负，等级相同判和。
- 这不是对中国象棋协会 2020 版线下人工裁判棋例的完整复刻；详细边界、提示代码与依据见 [`RULES_AND_PROMPTS.md`](./RULES_AND_PROMPTS.md)。

打开参考资源：

```bash
npm run open:reference
# 或
open resources/reference/index.html
```

## 资源说明

详见 [`resources/README.md`](./resources/README.md)。

画面规格与复刻计划：

- `resources/reference/docs/VISUAL_SPEC.md`
- `resources/reference/docs/XIANGQI_REMAKE_PLAN.md`

## 技术栈

- TypeScript + Vite
- Three.js（3D 场景）
- Web Worker 确定性 AI（固定节点预算、三级难度）
- 规则引擎与渲染分离

## 阶段

1. **Phase 0 ✅**：完整基础规则引擎与测试
2. **Phase 1 ✅**：本地双人 3D 可玩版
3. **Phase 2 ✅**：车直线拖尾、炮弹道、马日字跃迁，以及通用吃子冲击与退场
4. **Phase 3 ✅**：接入 production v3 七棋种剪影，红黑共用造型并由阵营材质着色
5. **Phase 4 ✅**：坐标棋谱、单步悔棋、逐手定位及确定性自动回放
6. **Phase 5 ✅**：本地双人 / 人机模式、三级 AI、Worker 失效保护与整回合悔棋
7. **Phase 6 ✅**：程序竞赛循环规则、自然限着、死局裁定、规则感知 AI 与统一中文提示
8. **Phase 7 ✅**：production v3 全彩角色、竞技场环境、战斗反馈、原创音效与战果展示
9. **Phase 8 ✅**：竖屏／窄横屏相机、响应式 HUD、可靠触控与移动渲染分级
10. **Phase 9 ✅**：统一战斗演出时间线、七棋种战斗档案、立绘消散与剧情镜头
11. **Phase 10**：按棋种逐步试点并替换为 GLB 角色

## 战斗演出

一次着法固定走完同一条时间线，各阶段时长由棋种的 `CombatProfile` 决定：

```
蓄力 windup → 行进 travel / 弹道 projectile → 命中 impact（含打击停顿）
          → 受击消散 victim-exit → 占领 occupy → 收势 settle
```

- 规则先结算并提交，表现层只负责演出并锁输入；结束后吸附回权威局面。
- 时间线在 `start()` 时一次性排定，`advance()` 返回区间内穿过的**全部**语义事件
  （`windup / footfall / projectile-release / impact / victim-dissolve / claim / settle / complete`）。
  因此 `advanceTime(2000)` 一次跨完整场演出与 60fps 逐帧推进产生完全相同的事件流。
- 音效、尘环与镜头都订阅这些事件，而不是轮询阶段：炮响落在弹丸出膛帧，
  占领闷响落在炮身真正进位的那一刻。
- 单次吃子演出硬上限 `1.6s`；超限时各阶段等比压缩，占比不变。
- 相机按「用户轨道 → 剧情构图 → 命中震动」三层合成。剧情层是相对轨道层的纯偏移，
  包络两端恒为 `0`，因此演出结束时精确回到用户原视角；规则拾取与角色朝向只读轨道层。
- 遵循 `prefers-reduced-motion`：压缩时长与位移幅度，但**保留全部阶段**，
  以免事件流与常规模式不可比。

## 画质档

设备档（`PresentationProfile`，只依赖视口的纯函数）与运行时档
（`QualityTier`：`high / balanced / lite`）**正交合成**，逐项取较严者。

- 帧率持续低于 `45fps` 满一个 `1.5s` 窗口即降一级，降级后进入 `6s` 冷却。
- **只降不升**：帧率在阈值附近来回时自动升降会不断重建阴影贴图与 DPR，
  比一直停在低档更糟。想回到高档由用户显式选择。
- 手动时钟（`?clock=manual`）下完全不采样，超过 `100ms` 的帧间隔也不计入——
  否则一次 `advanceTime(2000)` 就会被误读成 `0.5fps`。
- `?quality=lite` 可固定档位以验收低档表现；固定后不再自动降档。
