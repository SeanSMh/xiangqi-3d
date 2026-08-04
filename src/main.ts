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

const REPLAY_STEP_MS = 700
const controller = new GameController()
const scene = new BoardScene(app)
const animations = new AnimationDirector(scene)
const hud = new Hud(app, {
  onRestart: () => restartGame(),
  onToggleFullscreen: () => void toggleFullscreen(),
  onUndo: () => undoLastMove(),
  onToggleHistory: () => toggleHistory(),
  onSeekReplay: (ply) => seekReplay(ply),
  onReplayFirst: () => replayFirst(),
  onReplayPrevious: () => replayPrevious(),
  onToggleReplay: () => toggleReplay(),
  onReplayNext: () => replayNext(),
  onReturnToLive: () => returnToLive(),
})
let simulationTime = 0
let replayPlaying = false
let replayElapsedMs = 0
let manualClock =
  new URLSearchParams(window.location.search).get('clock') === 'manual'
let lastFrameTime = performance.now()

function syncUiAndMarkers(): void {
  const state = controller.getState()
  const timeline = controller.getTimelineSnapshot()
  const inputLocked =
    animations.isBusy || replayPlaying || timeline.isReviewing
  scene.setInteractionState(
    state,
    inputLocked ? null : controller.getSelectedId(),
    inputLocked ? [] : controller.getLegalMoves(),
  )
  hud.update(
    state,
    inputLocked ? undefined : controller.getSelectedPiece(),
    inputLocked ? 0 : controller.getLegalMoves().length,
    {
      animationBusy: animations.isBusy,
      replayPlaying,
      timeline,
      moveLog: controller.getMoveLog(),
    },
  )
}

function snapEntireView(): void {
  scene.snapTo(controller.getState())
  syncUiAndMarkers()
}

function restartGame(): void {
  stopReplay()
  controller.reset()
  simulationTime = 0
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function advanceSimulation(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  simulationTime += milliseconds
  let changed = animations.advance(milliseconds)

  if (replayPlaying) {
    replayElapsedMs += milliseconds
    while (replayPlaying && replayElapsedMs >= REPLAY_STEP_MS) {
      replayElapsedMs -= REPLAY_STEP_MS
      if (controller.stepReplayForward()) {
        scene.snapTo(controller.getState())
        changed = true
      }
      if (!controller.getTimelineSnapshot().canStepForward) {
        stopReplay()
        changed = true
      }
    }
  }

  if (changed) syncUiAndMarkers()
}

function undoLastMove(): void {
  if (!controller.undoLastMove()) return
  stopReplay()
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function toggleHistory(): void {
  const opening = !hud.isHistoryOpen
  if (!opening) {
    stopReplay()
    if (!animations.isBusy) {
      controller.returnToLive()
      animations.cancelAndSnap(controller.getState())
    }
  }
  hud.setHistoryOpen(opening)
  syncUiAndMarkers()
}

function seekReplay(ply: number): void {
  if (animations.isBusy || replayPlaying) return
  if (!controller.seekReplay(ply)) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function replayFirst(): void {
  const firstPly = controller.getTimelineSnapshot().firstAvailablePly
  seekReplay(firstPly)
}

function replayPrevious(): void {
  if (animations.isBusy || replayPlaying) return
  if (!controller.stepReplayBackward()) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function replayNext(): void {
  if (animations.isBusy || replayPlaying) return
  if (!controller.stepReplayForward()) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function returnToLive(): void {
  if (animations.isBusy) return
  stopReplay()
  if (controller.returnToLive()) {
    animations.cancelAndSnap(controller.getState())
  }
  syncUiAndMarkers()
}

function toggleReplay(): void {
  const timeline = controller.getTimelineSnapshot()
  if (animations.isBusy || !timeline.canReplay) return
  if (replayPlaying) {
    stopReplay()
    syncUiAndMarkers()
    return
  }

  hud.setHistoryOpen(true)
  if (!timeline.isReviewing) {
    controller.seekReplay(timeline.firstAvailablePly)
  }
  animations.cancelAndSnap(controller.getState())
  replayPlaying = true
  replayElapsedMs = 0
  syncUiAndMarkers()
}

function stopReplay(): void {
  replayPlaying = false
  replayElapsedMs = 0
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
  const timeline = controller.getTimelineSnapshot()
  if (
    event.button !== 0 ||
    animations.isBusy ||
    replayPlaying ||
    timeline.isReviewing
  ) {
    return
  }
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
  if (event.repeat || event.defaultPrevented || isEditableTarget(event.target)) {
    return
  }
  const key = event.key.toLowerCase()
  const plainUndo =
    key === 'u' && !event.metaKey && !event.ctrlKey && !event.altKey
  const undoShortcut =
    key === 'z' && (event.metaKey || event.ctrlKey) && !event.altKey
  if (plainUndo || undoShortcut) {
    event.preventDefault()
    undoLastMove()
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (key === 'r') {
    event.preventDefault()
    restartGame()
    return
  }
  if (key === 'f') {
    event.preventDefault()
    void toggleFullscreen()
    return
  }
  if (key === 'h') {
    event.preventDefault()
    toggleHistory()
    return
  }
  if (!hud.isHistoryOpen) return
  if (
    (event.key === ' ' || event.key === 'Enter') &&
    event.target instanceof HTMLButtonElement
  ) {
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    replayPrevious()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    replayNext()
  } else if (event.key === 'Home') {
    event.preventDefault()
    replayFirst()
  } else if (event.key === 'End' || event.key === 'Enter') {
    event.preventDefault()
    returnToLive()
  } else if (event.key === ' ') {
    event.preventDefault()
    toggleReplay()
  }
})

window.render_game_to_text = () => {
  const state = controller.getState()
  const timeline = controller.getTimelineSnapshot()
  const moveLog = controller.getMoveLog()
  const selected = controller.getSelectedPiece()
  const lastMove = state.history.at(-1)
  const inputLocked =
    animations.isBusy || replayPlaying || timeline.isReviewing
  const historyWindowStart = Math.max(
    0,
    Math.min(
      Math.max(0, timeline.cursorPly - 4),
      Math.max(0, moveLog.length - 8),
    ),
  )
  return JSON.stringify(
    {
      coordinateSystem:
        '红方视角下 file 0 在画面右侧、file 8 在左侧；rank 0 为红方底线，rank 9 为黑方底线',
      status: state.status,
      sideToMove: state.sideToMove,
      inCheck: state.inCheck,
      winner: state.winner,
      fullscreen: Boolean(document.fullscreenElement),
      inputLocked,
      inputLockedReason: animations.isBusy
        ? 'animation'
        : replayPlaying
          ? 'replay-playing'
          : timeline.isReviewing
            ? 'replay-view'
            : null,
      boardInputEnabled: state.status === 'playing' && !inputLocked,
      animation: animations.getSnapshot(),
      presentation: scene.getPresentationSnapshot(state),
      timeline: {
        mode: timeline.isReviewing ? 'replay' : 'live',
        ...timeline,
      },
      replay: {
        panelOpen: hud.isHistoryOpen,
        playing: replayPlaying,
        stepMs: REPLAY_STEP_MS,
      },
      history: {
        coordinateSystem:
          'text 使用 1-based (路,横线)；from/to 结构字段保留内部 0-based 坐标',
        totalPlies: timeline.livePly,
        visibleEntries: moveLog.slice(
          historyWindowStart,
          historyWindowStart + 8,
        ),
      },
      manualClock,
      ply: timeline.cursorPly,
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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.matches('input, textarea, select') || target.isContentEditable
  )
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
  '[xiangqi-3d] 棋谱时间线已就绪：支持单步悔棋、逐手定位与确定性自动回放。',
)
