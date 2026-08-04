/**
 * 中国象棋 3D — 本地双人可玩切片
 * 规则状态是唯一真相，Three.js 只负责呈现与输入拾取。
 */
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
const hud = new Hud(app, {
  onRestart: () => restartGame(),
  onToggleFullscreen: () => void toggleFullscreen(),
})
let simulationTime = 0

function syncView(): void {
  const state = controller.getState()
  scene.syncPieces(state)
  scene.setInteractionState(
    state,
    controller.getSelectedId(),
    controller.getLegalMoves(),
  )
  hud.update(
    state,
    controller.getSelectedPiece(),
    controller.getLegalMoves().length,
  )
}

function restartGame(): void {
  controller.reset()
  simulationTime = 0
  syncView()
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
  if (event.button !== 0) return
  const square = scene.pickSquare(event.clientX, event.clientY)
  if (!square) return
  controller.handleSquare(square.file, square.rank)
  syncView()
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
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    simulationTime += milliseconds
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

syncView()

function loop(): void {
  scene.render()
  requestAnimationFrame(loop)
}
loop()

console.info(
  '[xiangqi-3d] 本地双人版已就绪：点选棋子与高亮落点走棋；R 重开，F 全屏。',
)
