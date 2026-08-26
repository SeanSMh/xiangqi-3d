/**
 * 一分钟自动对弈演示片 —— 供 HUD 的「演示」按钮调用，用于录屏出片。
 *
 * ## 棋盘输入走真实通道
 *
 * 落子与转视角一律往画布派发 `PointerEvent`——和真人操作走同一条路径。
 * 于是拾取、输入锁、演出时间线、音效派发全都照常发生，录下来的就是产品
 * 真实行为，不存在“演示专用捷径”。代价是要自己处理拾取遮挡之类的现实问题
 * （见 `playMove` 的重试）；这个代价值得付：一段会骗人的演示片没有意义。
 *
 * 重开、录制模式、战术俯视这类**应用级命令**则由调用方以回调传入，不合成按键：
 * 演示期间键盘是锁着的（免得用户中途悔棋把局面走岔），合成的按键会被这把锁
 * 一并吞掉。而且这些命令与“棋盘交互是否可信”无关，直接调用反而更稳。
 *
 * ## 为什么单独成模块
 *
 * 它只在用户点「演示」时才被 `import()`，因此在生产构建里是一个独立 chunk，
 * 不点就不下载，正常对局一个字节都不多付。
 */

/** 演示片里读到的局面快照，只声明用得到的字段。 */
interface DemoSnapshot {
  status: string
  ply: number
  manualClock: boolean
  match: { mode: string }
  animation: { active: boolean }
  prompt: { title: string }
  selected: { file: number; rank: number } | null
  presentation: { cameraView: { yawOffsetDegrees: number } }
}

export interface DemoReelOptions {
  /** 整体节奏倍率：>1 更慢更从容，<1 更紧凑。 */
  pace?: number
  /** 录制模式：演出期间收起全部 HUD，结束后恢复。 */
  cinema?: boolean
  /** 插入一段战术俯视。默认关闭：它会隐藏立绘，与“展示棋子动效”相冲。 */
  showTacticalView?: boolean
  /** 开录倒数秒数；0 表示立即开始。 */
  countdown?: number
  /** 中途取消。按钮再次点击、或用户按 Esc 时由调用方触发。 */
  signal?: AbortSignal
  /** 进度回调，用于打印或做字幕。 */
  onLog?: (message: string) => void
  /** 应用级命令。演示期间键盘被锁，这些只能由调用方直接执行。 */
  commands: DemoCommands
}

export interface DemoCommands {
  restart: () => void
  toggleCinema: () => void
  toggleTacticalView: () => void
}

export interface DemoReelResult {
  completed: boolean
  durationMs: number
  /** 未能跑完时的原因，可直接展示给用户。 */
  reason?: string
}

export class DemoAbortedError extends Error {
  constructor() {
    super('演示已取消')
    this.name = 'DemoAbortedError'
  }
}

interface DemoStep {
  uci: string
  from: [number, number]
  to: [number, number]
  note: string
}

/**
 * 对局线：由引擎离线搜出并逐手复验——14 手、6 次吃子、以绝杀收尾，
 * 炮的弹道、车的冲锋拖尾、马的日字腾跃三种演出都拍得到。
 *
 * 改动这里必须重跑 `src/engine/demoReel.test.ts`：它直接读本文件取着法，
 * 校验整条线仍然合法且仍以将死收尾。规则一改就会红，不必等到真去录片子。
 */
const LINE: DemoStep[] = [
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

type Beat =
  | ['hold', number]
  | ['orbit', number, number]
  | ['move', number, { orbitDeg?: number; orbitMs?: number }?]
  | ['tactical', number]

/**
 * 镜头编排。走子时给 `orbitDeg` 就是「一边打一边转」——
 * 演出期间棋盘输入锁着，但相机拖动照常生效，这一幕最能说明它是个真 3D 场景。
 */
const STORYBOARD: Beat[] = [
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

/** 选中与落子之间的停顿：太快看不清是「先选后走」。 */
const SELECT_PAUSE = 420
/** 相机拖动每 CSS 像素对应 0.5°，与 `cameraOrbit.ts` 的常量一致。 */
const DEGREES_PER_PX = 0.5

export async function runDemoReel(
  options: DemoReelOptions,
): Promise<DemoReelResult> {
  const pace = options.pace && options.pace > 0 ? options.pace : 1
  const cinema = options.cinema === true
  const showTacticalView = options.showTacticalView === true
  const countdown = Math.max(0, Math.round(options.countdown ?? 3))
  const signal = options.signal
  const log = options.onLog ?? (() => undefined)

  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
  if (!canvas || typeof window.render_game_to_text !== 'function') {
    return { completed: false, durationMs: 0, reason: '没找到棋盘或验收钩子' }
  }

  const snapshot = (): DemoSnapshot =>
    JSON.parse(window.render_game_to_text()) as DemoSnapshot

  const initial = snapshot()
  if (initial.match.mode !== 'local') {
    return {
      completed: false,
      durationMs: 0,
      reason: '请先按 M 切换到「本地双人」，人机模式下电脑对手会和演示抢着走棋',
    }
  }
  if (initial.manualClock) {
    return {
      completed: false,
      durationMs: 0,
      reason: '页面处于手动时钟模式，演出不会自己推进；刷新后重试',
    }
  }

  const abortIfCancelled = () => {
    if (signal?.aborted) throw new DemoAbortedError()
  }
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms * pace)
      const onAbort = () => {
        window.clearTimeout(timer)
        reject(new DemoAbortedError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const easeInOut = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

  // 合成 PointerEvent 带的 pointerId 在浏览器看来并不存在，`setPointerCapture`
  // 会抛 NotFoundError。演示期间把这三个方法临时短路掉，免得控制台被异常刷屏；
  // 真实用户路径不受影响，结束后原样还回去。
  const savedCapture = {
    set: canvas.setPointerCapture,
    release: canvas.releasePointerCapture,
    has: canvas.hasPointerCapture,
  }
  canvas.setPointerCapture = () => undefined
  canvas.releasePointerCapture = () => undefined
  canvas.hasPointerCapture = () => false
  const restoreCapture = () => {
    canvas.setPointerCapture = savedCapture.set
    canvas.releasePointerCapture = savedCapture.release
    canvas.hasPointerCapture = savedCapture.has
  }

  let pointerId = 7300

  function emit(type: string, clientX: number, clientY: number, id: number) {
    canvas!.dispatchEvent(
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

  /** 交点 → 视口坐标。`projectSquare` 给的是画布内坐标，要加上画布位置。 */
  function squareToClient(file: number, rank: number) {
    const point = window.projectSquare(file, rank)
    if (!point) throw new Error(`交点越界: (${file},${rank})`)
    const rect = canvas!.getBoundingClientRect()
    return { x: rect.left + point.x, y: rect.top + point.y }
  }

  async function tapSquare(file: number, rank: number) {
    abortIfCancelled()
    // 必须「临点击时」再投影：相机一直在转，坐标随时在变。
    const { x, y } = squareToClient(file, rank)
    const id = ++pointerId
    emit('pointerdown', x, y, id)
    await frame()
    emit('pointerup', x, y, id)
    await frame()
  }

  /**
   * 水平环绕。参数是**拖动距离**折算的角度：正数相当于把画面往右拖，
   * 使 yaw 变化 `-degrees` 度。
   */
  async function orbit(degrees: number, durationMs: number) {
    abortIfCancelled()
    const totalPx = degrees / DEGREES_PER_PX
    const rect = canvas!.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const id = ++pointerId
    emit('pointerdown', startX, y, id)

    const duration = durationMs * pace
    const began = performance.now()
    let lastX = startX
    try {
      for (;;) {
        abortIfCancelled()
        const t = Math.min(1, (performance.now() - began) / duration)
        // 缓入缓出，避免起手和收尾像被人拽了一把。
        const x = startX + totalPx * easeInOut(t)
        if (x !== lastX) {
          emit('pointermove', x, y, id)
          lastX = x
        }
        if (t >= 1) break
        await frame()
      }
    } finally {
      // 取消时也要抬指，否则手势会一直挂在拖动态上。
      emit('pointerup', lastX, y, id)
    }
    await frame()
  }

  /**
   * 把镜头转回默认方位。
   *
   * 重开（`R`）不复位相机——那是用户自己的视角，规则层无权动它。
   * 但录制要的是每条片子起手都一样，所以这里显式转回去。
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
      if (!snapshot().animation.active) return
      await sleep(80)
    }
  }

  /**
   * 选中起点、再点落点，失败会重试。
   *
   * 立绘有一格多高，拾取又刻意让棋子碰撞体优先于地面——于是某些方位下，
   * 目标交点正好被前排某枚棋子挡住，点下去会选中那枚棋子而不是落子。
   * 这是产品该有的行为（所见即所点），但对录制脚本是致命的：一次没中，
   * 整条片子就废了。所以失败就把镜头挪一点再试，而不是硬点同一个位置。
   */
  async function playMove(
    index: number,
    beatOptions: { orbitDeg?: number; orbitMs?: number } = {},
  ) {
    const step = LINE[index]!
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

    if (beatOptions.orbitDeg) {
      await orbit(beatOptions.orbitDeg, beatOptions.orbitMs ?? 1300)
    }
    await waitForIdle()
    log(`${String(index + 1).padStart(2)}. ${step.uci}  ${step.note}`)
  }

  // ---------------------------------------------------------------- 主流程
  const began = performance.now()
  let cinemaEngaged = false
  try {
    options.commands.restart()
    if (cinema) {
      options.commands.toggleCinema()
      cinemaEngaged = true
    }
    await sleep(300)
    await resetCamera()

    for (let n = countdown; n > 0; n -= 1) {
      log(`${n}…`)
      await sleep(1000)
    }
    log('开始')

    for (const beat of STORYBOARD) {
      abortIfCancelled()
      if (beat[0] === 'hold') await sleep(beat[1])
      else if (beat[0] === 'orbit') await orbit(beat[1], beat[2])
      else if (beat[0] === 'move') await playMove(beat[1], beat[2])
      else if (beat[0] === 'tactical' && showTacticalView) {
        options.commands.toggleTacticalView()
        await sleep(beat[1])
        options.commands.toggleTacticalView()
        await sleep(400)
      }
    }

    const final = snapshot()
    const durationMs = performance.now() - began
    log(`完成 · ${(durationMs / 1000).toFixed(1)}s · ${final.prompt.title}`)
    return { completed: true, durationMs }
  } catch (error) {
    const durationMs = performance.now() - began
    if (error instanceof DemoAbortedError) {
      return { completed: false, durationMs, reason: '演示已停止' }
    }
    return {
      completed: false,
      durationMs,
      reason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    restoreCapture()
    if (cinemaEngaged) options.commands.toggleCinema()
  }
}
