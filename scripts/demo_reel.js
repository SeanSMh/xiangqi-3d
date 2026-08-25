/**
 * 一分钟自动对弈演示片 —— 用于录屏出片。
 *
 * ## 用法
 *
 * 1. `npm run dev`，浏览器打开 http://localhost:5173
 * 2. 确认是**本地双人**模式（按 `M` 查看）。人机模式下 AI 会和脚本抢着走棋。
 * 3. **在棋盘外的页面空白处点一下**——浏览器只在真实用户手势后才允许出声，
 *    合成事件解锁不了 AudioContext。不点就是一部默片。
 * 4. 想要满屏就按 `F` 进全屏。
 * 5. 打开 DevTools 控制台，运行：
 *
 *        await import('/scripts/demo_reel.js?v=' + Date.now())
 *
 *    （`?v=` 是必要的：模块会被缓存，不加就只有第一次会跑。
 *    也可以直接把本文件全部内容粘进控制台。）
 * 6. 控制台会倒数 3 秒，趁这时候开录屏。
 *
 * 想改节奏、要不要隐藏 HUD，见下面的 `CONFIG`。
 *
 * ## 时长
 *
 * 默认 `pace: 1` 实测约 55–58 秒（取决于机器帧率与演出节拍）。
 * 脚本跑完会在控制台打印**实际秒数**：想卡准 60 秒，按
 * `pace = 60 / 实测秒数` 调一次再跑一遍即可。
 *
 * ## 它为什么走真实输入通道
 *
 * 脚本不直接调用内部 API，而是往 canvas 派发 PointerEvent、往 window 派发
 * KeyboardEvent——和真人操作走同一条路径。这样录下来的就是产品真实行为：
 * 拾取、锁输入、演出时间线、音效派发全都照常发生，不存在"演示专用捷径"。
 */

/* eslint-disable no-console */
;(async () => {
  const CONFIG = {
    /** 整体节奏倍率：>1 更慢更从容，<1 更紧凑。 */
    pace: 1,
    /** 录制模式：收起全部 HUD。默认保留——行棋方与战果本身也是要展示的界面。 */
    cinema: false,
    /** 插入一段战术俯视（`T`）。默认关闭：它会隐藏立绘，与"展示棋子动效"相冲。 */
    showTacticalView: false,
    /** 开录倒数秒数。 */
    countdown: 3,
  }

  // ---------------------------------------------------------------- 对局线
  // 由引擎离线搜出并逐手复验：14 手、6 次吃子、以绝杀收尾，
  // 炮的弹道、车的拖尾、马的腾跃三种演出都拍得到。
  // 复验见提交记录；改动这里必须重新验证合法性，否则脚本会中途停在非法着上。
  const LINE = [
    { uci: 'h2h9', from: [7, 2], to: [7, 9], note: '红炮跨全盘吃马 · 弹道' },
    { uci: 'i9h9', from: [8, 9], to: [7, 9], note: '黑车反吃 · 冲锋拖尾' },
    { uci: 'b2b9', from: [1, 2], to: [1, 9], note: '红另一门炮再吃马' },
    { uci: 'a9b9', from: [0, 9], to: [1, 9], note: '黑车再反吃' },
    { uci: 'h0g2', from: [7, 0], to: [6, 2], note: '红马起跳' },
    { uci: 'h7h3', from: [7, 7], to: [7, 3], note: '黑炮进兵林线' },
    { uci: 'g2e1', from: [6, 2], to: [4, 1], note: '红马回防' },
    { uci: 'h3e3', from: [7, 3], to: [4, 3], note: '黑炮吃兵并将军' },
    { uci: 'e1f3', from: [4, 1], to: [5, 3], note: '红移开炮架解将' },
    { uci: 'b7b4', from: [1, 7], to: [1, 4], note: '黑炮调位' },
    { uci: 'f3g5', from: [5, 3], to: [6, 5], note: '红马过河' },
    { uci: 'h9h0', from: [7, 9], to: [7, 0], note: '黑车长驱直入' },
    { uci: 'g5e6', from: [6, 5], to: [4, 6], note: '红马跃吃卒' },
    { uci: 'b4e4', from: [1, 4], to: [4, 4], note: '黑炮绝杀' },
  ]

  // ------------------------------------------------------------ 镜头编排
  // ['hold', ms] 静止 | ['orbit', 度数, ms] 环绕 | ['move', 序号, 选项] 走一手
  // 走子时给 orbitDeg，就是"一边打一边转"——最能体现这是个真 3D 场景。
  const STORYBOARD = [
    ['hold', 1600],
    ['orbit', 75, 4800],
    ['move', 0, { orbitDeg: -30 }],
    ['hold', 600],
    ['move', 1],
    ['orbit', -55, 2600],
    ['move', 2, { orbitDeg: 30 }],
    ['hold', 500],
    ['move', 3],
    ['orbit', 80, 3400],
    ['move', 4],
    ['move', 5],
    ['tactical', 3000],
    ['move', 6],
    ['move', 7, { orbitDeg: -22 }],
    ['hold', 1000],
    ['orbit', -65, 3000],
    ['move', 8],
    ['move', 9],
    ['move', 10],
    ['orbit', 60, 2800],
    ['move', 11],
    ['move', 12, { orbitDeg: -32 }],
    ['hold', 700],
    ['orbit', 45, 2200],
    ['move', 13],
    ['hold', 2600],
    ['orbit', 150, 7500],
    ['hold', 2000],
  ]

  /** 选中与落子之间的停顿：太快看不清是"先选后走"。 */
  const SELECT_PAUSE = 420
  /** 相机拖动每 CSS 像素对应 0.5°，与 cameraOrbit.ts 的常量一致。 */
  const DEGREES_PER_PX = 0.5

  // ------------------------------------------------------------------ 工具
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * CONFIG.pace))
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  const easeInOut = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

  const canvas = document.querySelector('#game-canvas')
  const snapshot = () => JSON.parse(window.render_game_to_text())

  function abort(message, hint) {
    console.error(`%c[演示片] ${message}`, 'color:#ff5c5c;font-weight:bold')
    if (hint) console.info(`         ${hint}`)
  }

  // ---------------------------------------------------------------- 前置检查
  if (!canvas || typeof window.render_game_to_text !== 'function') {
    return abort('没找到棋盘或验收钩子', '确认打开的是 dev server 的页面并已加载完成')
  }
  const initial = snapshot()
  if (initial.match.mode !== 'local') {
    return abort(
      `当前是「${initial.match.mode}」模式，AI 会和脚本抢着走棋`,
      '按 M 切换到「本地双人」后重试',
    )
  }
  if (initial.manualClock) {
    return abort('页面处于手动时钟模式，演出不会自己推进', '刷新页面后重试')
  }

  // 合成 PointerEvent 带的 pointerId 在浏览器看来并不存在，
  // setPointerCapture 会抛 NotFoundError。演示期间把这三个方法临时短路掉，
  // 免得控制台被异常刷屏（真实用户路径不受影响，结束后原样还回去）。
  const savedCapture = {
    set: canvas.setPointerCapture,
    release: canvas.releasePointerCapture,
    has: canvas.hasPointerCapture,
  }
  canvas.setPointerCapture = () => {}
  canvas.releasePointerCapture = () => {}
  canvas.hasPointerCapture = () => false

  const restore = () => {
    canvas.setPointerCapture = savedCapture.set
    canvas.releasePointerCapture = savedCapture.release
    canvas.hasPointerCapture = savedCapture.has
  }

  // ------------------------------------------------------------ 输入驱动
  let pointerId = 7300

  function emit(type, clientX, clientY, id) {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  function pressKey(key) {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  }

  /** 交点 → 视口坐标。projectSquare 给的是画布内坐标，要加上画布位置。 */
  function squareToClient(file, rank) {
    const point = window.projectSquare(file, rank)
    if (!point) throw new Error(`交点越界: (${file},${rank})`)
    const rect = canvas.getBoundingClientRect()
    return { x: rect.left + point.x, y: rect.top + point.y }
  }

  async function tapSquare(file, rank) {
    // 必须"临点击时"再投影：相机一直在转，坐标随时在变。
    const { x, y } = squareToClient(file, rank)
    const id = ++pointerId
    emit('pointerdown', x, y, id)
    await frame()
    emit('pointerup', x, y, id)
    await frame()
  }

  /**
   * 水平环绕。参数是**拖动距离**折算的角度：正数相当于把画面往右拖。
   * 每 CSS 像素 0.5°，与 `cameraOrbit.ts` 的 `CAMERA_ORBIT_RADIANS_PER_CSS_PIXEL` 对齐。
   */
  async function orbit(degrees, durationMs) {
    const totalPx = degrees / DEGREES_PER_PX
    const rect = canvas.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const id = ++pointerId
    emit('pointerdown', startX, y, id)

    const duration = durationMs * CONFIG.pace
    const began = performance.now()
    let lastX = startX
    for (;;) {
      const t = Math.min(1, (performance.now() - began) / duration)
      // 缓入缓出，避免起手和收尾像被人拽了一把
      const x = startX + totalPx * easeInOut(t)
      if (x !== lastX) {
        emit('pointermove', x, y, id)
        lastX = x
      }
      if (t >= 1) break
      await frame()
    }
    emit('pointerup', lastX, y, id)
    await frame()
  }

  /**
   * 把镜头转回默认方位。
   *
   * 重开（`R`）不会复位相机——那是用户自己的视角，规则层无权动它。
   * 但录制要的是每条片子起手都一样，所以这里显式转回去。
   * `orbit(d)` 使 yaw 变化 `-d` 度，因此直接按当前 yaw 转一次即可归零。
   */
  async function resetCamera() {
    const yaw = snapshot().presentation.cameraView.yawOffsetDegrees
    if (Math.abs(yaw) < 1) return
    await orbit(yaw, 700)
  }

  /** 等演出结束。演出期间棋盘输入是锁着的，不等会点空。 */
  async function waitForIdle(timeoutMs = 8000) {
    const began = performance.now()
    while (performance.now() - began < timeoutMs) {
      if (!snapshot().animation.active) return true
      await sleep(80)
    }
    return false
  }

  // ------------------------------------------------------------ 走一手棋
  /**
   * 选中起点、再点落点。
   *
   * 会重试：立绘有一格多高，拾取又刻意让棋子碰撞体优先于地面——于是某些
   * 方位下，目标交点正好被前排某枚棋子挡住，点下去会选中那枚棋子而不是落子。
   * 这是产品该有的行为（所见即所点），但对录制脚本是致命的：一次没中，
   * 整条片子就废了。所以失败就把镜头挪一点再试，而不是硬点同一个位置。
   */
  async function playMove(index, options = {}) {
    const step = LINE[index]
    const before = snapshot()
    if (before.status !== 'playing') {
      throw new Error(`第 ${index + 1} 手时对局已结束（${before.status}）`)
    }

    let committed = false
    for (let attempt = 0; attempt < 3 && !committed; attempt += 1) {
      if (attempt > 0) await orbit(attempt % 2 === 1 ? 14 : -26, 360)

      await tapSquare(step.from[0], step.from[1])
      const picked = snapshot().selected
      if (
        !picked ||
        picked.file !== step.from[0] ||
        picked.rank !== step.from[1]
      ) {
        continue
      }
      await sleep(SELECT_PAUSE)

      await tapSquare(step.to[0], step.to[1])
      committed = snapshot().ply === before.ply + 1
    }
    if (!committed) {
      throw new Error(`第 ${index + 1} 手 ${step.uci}：三次都没能落子`)
    }

    // 边打边转：演出期间棋盘输入锁着，但相机拖动照常生效——
    // 这正是最能说明"这是个真 3D 场景"的一幕。
    if (options.orbitDeg) {
      await orbit(options.orbitDeg, options.orbitMs ?? 1300)
    }
    await waitForIdle()
    console.log(
      `%c  ${String(index + 1).padStart(2)}. ${step.uci}  ${step.note}`,
      'color:#8fd0ff',
    )
  }

  // ---------------------------------------------------------------- 主流程
  console.log('%c[演示片] 准备中…', 'color:#ffcf6a;font-weight:bold')
  pressKey('r')
  if (CONFIG.cinema) pressKey('c')
  await sleep(300)
  await resetCamera()

  for (let n = CONFIG.countdown; n > 0; n -= 1) {
    console.log(`%c${n}…`, 'color:#ffcf6a;font-size:16px')
    await sleep(1000)
  }
  console.log('%c[演示片] 开始', 'color:#7CFF9B;font-weight:bold')

  const began = performance.now()
  try {
    for (const beat of STORYBOARD) {
      const [kind] = beat
      if (kind === 'hold') await sleep(beat[1])
      else if (kind === 'orbit') await orbit(beat[1], beat[2])
      else if (kind === 'move') await playMove(beat[1], beat[2])
      else if (kind === 'tactical') {
        if (!CONFIG.showTacticalView) continue
        pressKey('t')
        await sleep(beat[1])
        pressKey('t')
        await sleep(400)
      }
    }
    const final = snapshot()
    console.log(
      `%c[演示片] 完成 · ${((performance.now() - began) / 1000).toFixed(1)}s · ${final.prompt.title}`,
      'color:#7CFF9B;font-weight:bold',
    )
    if (final.status === 'playing') {
      console.warn('[演示片] 对局没走到终局，检查 LINE 是否被改动过')
    }
  } catch (error) {
    abort(error.message, '棋盘可能已被手动操作过；刷新页面后重试')
  } finally {
    restore()
    if (CONFIG.cinema) pressKey('c')
  }
})()
