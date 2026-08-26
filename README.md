# 中国象棋 3D（Xiangqi Battle）

一款基于 Three.js 的中国象棋 3D 对战游戏，包含角色棋子、走子动画、吃子特效和完整规则判定。

- 在线体验：[xq.prodpass.net](https://xq.prodpass.net/)
- 作者：**Bril**

## 功能

- 本地双人和三级电脑对手
- 完整中国象棋走子、将军与终局判定
- 3D 棋盘旋转、战术俯视和移动端适配
- 棋谱、回放、悔棋与自动演示
- 棋种专属移动、吃子演出和原创合成音效
- 自动画质分级与减少动态效果支持

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## 操作

- 点选棋子，再点击亮起的合法落点
- 拖动棋盘旋转视角
- `M` 对局设置 · `U` 悔棋 · `H` 棋谱 · `R` 重开
- `T` 战术俯视 · `C` 录制模式 · `D` 自动演示 · `F` 全屏
- `?` 查看规则说明

## 技术栈

TypeScript · Vite · Three.js · Web Worker · Vitest

规则细节见 [`RULES_AND_PROMPTS.md`](./RULES_AND_PROMPTS.md)，开发记录见
[`progress.md`](./progress.md)，资源说明见 [`resources/README.md`](./resources/README.md)。

大体积参考视频与逐帧素材仅在本地留存，不包含在远端仓库中。

## 版权

© 2026 Bril。当前未附开源许可证。
