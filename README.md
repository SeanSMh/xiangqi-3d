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
│   ├── animation/            # 确定性走子 / 冲击 / 退场状态机
│   ├── engine/               # 中国象棋规则引擎（纯逻辑）
│   ├── scene/                # Three.js 棋盘 / 棋子 / 相机
│   ├── ui/                   # HUD：行棋方、将军、战果
│   ├── vfx/                  # 选中环、走子、吃子特效
│   ├── audio/                # 音效
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
- `M`：选择本地双人或人机对弈；人机模式固定玩家执红、AI 执黑，可选入门 / 标准 / 挑战。
- `U` 或 `Cmd/Ctrl + Z`：双人模式悔棋一手；人机模式回到上一个玩家决策点。`R`：重开；`F`：全屏。
- `H`：打开棋谱；棋谱中可点击任意着法，也可用 `← / →`、`Home / End` 逐手定位，`Space` 播放或暂停，`Enter` 返回当前局面。
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
8. **Phase 7**：将剪影逐步升级为 GLB 角色，并完成竖屏适配
