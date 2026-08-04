/**
 * 中国象棋 3D — 本地双人可玩切片
 * 规则状态是唯一真相，Three.js 只负责呈现、演出与输入拾取。
 */
import { AnimationDirector } from './animation/animationDirector'
import { pieceAt, pieceLabel } from './engine/board'
import { GameController } from './game/controller'
import { BoardScene } from './scene/boardScene'
import type { GameState } from './types/xiangqi'
import { Hud } from './ui/hud'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('#app not found')
const app: HTMLDivElement = appElement

const controller = new GameController()
const scene = new BoardScene(app)
const animations = new AnimationDirector(scene)
const hud = new Hud(app, {
  onRestart: () => restartGame(),
  onToggleFullscreen: () => void toggleFullscreen(),
})
let simulationTime = 0
let manualClock =
  new URLSearchParams(window.location.search).get('clock') === 'manual'
let lastFrameTime = performance.now()

function syncUiAndMarkers(): void {
  const state = controller.getState()
  const inputLocked = animations.isBusy
  scene.setInteractionState(
    state,
    inputLocked ? null : controller.getSelectedId(),
    inputLocked ? [] : controller.getLegalMoves(),
  )
  hud.update(
    state,
    inputLocked ? undefined : controller.getSelectedPiece(),
    inputLocked ? 0 : controller.getLegalMoves().length,
    inputLocked,
  )
}

function snapEntireView(): void {
  scene.snapTo(controller.getState())
  syncUiAndMarkers()
}

function restartGame(): void {
  controller.reset()
  simulationTime = 0
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function advanceSimulation(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  simulationTime += milliseconds
  if (animations.advance(milliseconds)) syncUiAndMarkers()
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await app.requestFullscreen()
    }
  } catch (error) {
    console.warn('[xiangqi-3d] 无法切换全屏', error)
  }
}

scene.renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || animations.isBusy) return
  const square = scene.pickSquare(event.clientX, event.clientY)
  if (!square) return

  const result = controller.handleSquare(square.file, square.rank)
  if (result.type !== 'moved') {
    snapEntireView()
    return
  }

  const committedState = controller.getState()
  // 不在此处 snap：旧 Mesh 必须保留给移动和受击退场演出。
  scene.setInteractionState(committedState, null, [])
  if (!animations.start(result.move, committedState)) {
    snapEntireView()
    return
  }
  syncUiAndMarkers()
})

window.addEventListener('keydown', (event) => {
  if (event.repeat) return
  if (event.key.toLowerCase() === 'r') restartGame()
  if (event.key.toLowerCase() === 'f') void toggleFullscreen()
})

window.render_game_to_text = () => {
  const state = controller.getState()
  const selected = controller.getSelectedPiece()
  const lastMove = state.history.at(-1)
  return JSON.stringify(
    {
      coordinateSystem:
        '红方视角下 file 0 在画面右侧、file 8 在左侧；rank 0 为红方底线，rank 9 为黑方底线',
      status: state.status,
      sideToMove: state.sideToMove,
      inCheck: state.inCheck,
      winner: state.winner,
      fullscreen: Boolean(document.fullscreenElement),
      inputLocked: animations.isBusy,
      animation: animations.getSnapshot(),
      manualClock,
      ply: state.history.length,
      selected: selected
        ? {
            id: selected.id,
            label: pieceLabel(selected.kind, selected.side),
            side: selected.side,
            file: selected.file,
            rank: selected.rank,
          }
        : null,
      legalTargets: controller.getLegalMoves().map((move) => ({
        file: move.to.file,
        rank: move.to.rank,
        capture: Boolean(move.capturedId),
      })),
      boardRows: describeBoard(state),
      captured: state.pieces
        .filter((piece) => piece.captured)
        .map((piece) => `${piece.side}:${pieceLabel(piece.kind, piece.side)}`),
      lastMove: lastMove
        ? {
            side: lastMove.side,
            pieceId: lastMove.pieceId,
            from: lastMove.from,
            to: lastMove.to,
            capturedId: lastMove.capturedId ?? null,
            givesCheck: lastMove.givesCheck,
          }
        : null,
      simulationTime,
    },
    null,
    2,
  )
}

window.advanceTime = (milliseconds: number) => {
  manualClock = true
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    advanceSimulation(milliseconds)
    scene.render()
  }
  return simulationTime
}

function describeBoard(state: GameState): string[] {
  const rows: string[] = []
  for (let rank = 9; rank >= 0; rank--) {
    const cells: string[] = []
    for (let file = 0; file <= 8; file++) {
      const piece = pieceAt(state.pieces, file, rank)
      cells.push(
        piece
          ? `${piece.side === 'red' ? 'R' : 'B'}${pieceLabel(piece.kind, piece.side)}`
          : '..',
      )
    }
    rows.push(`rank ${rank}: ${cells.join(' ')}`)
  }
  return rows
}

snapEntireView()

function loop(now: number): void {
  const delta = Math.min(50, Math.max(0, now - lastFrameTime))
  lastFrameTime = now
  if (!manualClock) advanceSimulation(delta)
  scene.render()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

console.info(
  '[xiangqi-3d] 动画切片已就绪：走子期间锁输入；车带直线拖尾，吃子播放冲击与退场。',
)
