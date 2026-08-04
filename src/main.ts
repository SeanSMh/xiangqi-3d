/**
 * 中国象棋 3D — 本地双人 / 人机可玩切片
 * 规则状态是唯一真相，Three.js 只负责呈现、演出与输入拾取。
 */
import { AnimationDirector } from './animation/animationDirector'
import { pieceAt, pieceLabel } from './engine/board'
import { AiCoordinator } from './game/aiCoordinator'
import { GameController } from './game/controller'
import {
  DEFAULT_MATCH_CONFIG,
  AI_SIDE,
  HUMAN_SIDE,
  isAiTurn,
  type MatchConfig,
} from './game/match'
import { BoardScene } from './scene/boardScene'
import type { GameState, Move } from './types/xiangqi'
import { Hud } from './ui/hud'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('#app not found')
const app: HTMLDivElement = appElement

const REPLAY_STEP_MS = 700
const controller = new GameController()
const scene = new BoardScene(app)
const animations = new AnimationDirector(scene)
let matchConfig: MatchConfig = { ...DEFAULT_MATCH_CONFIG }
const hud = new Hud(app, {
  onToggleMatchSettings: () => toggleMatchSettings(),
  onApplyMatchConfig: (config) => applyMatchConfig(config),
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
const aiCoordinator = new AiCoordinator(undefined, () => syncUiAndMarkers())
let simulationTime = 0
let replayPlaying = false
let replayElapsedMs = 0
let manualClock =
  new URLSearchParams(window.location.search).get('clock') === 'manual'
let lastFrameTime = performance.now()

function syncUiAndMarkers(): void {
  const state = controller.getState()
  const timeline = controller.getTimelineSnapshot()
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  const inputLocked = isBoardInputLocked(state)
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
      matchConfig,
      ai,
    },
  )
  scene.renderer.domElement.setAttribute(
    'aria-busy',
    String(animations.isBusy || ai.pending),
  )
}

function snapEntireView(): void {
  scene.snapTo(controller.getState())
  syncUiAndMarkers()
}

function restartGame(): void {
  aiCoordinator.cancel(true)
  stopReplay()
  controller.reset()
  simulationTime = 0
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function toggleMatchSettings(): void {
  const opening = !hud.isMatchSettingsOpen
  if (
    opening &&
    (animations.isBusy ||
      replayPlaying ||
      controller.getTimelineSnapshot().isReviewing ||
      aiCoordinator.getSnapshot(matchConfig.difficulty).phase === 'thinking')
  ) {
    return
  }
  if (opening && hud.isHistoryOpen) {
    hud.setHistoryOpen(false)
  }
  hud.setMatchSettingsOpen(opening, matchConfig)
  syncUiAndMarkers()
}

function applyMatchConfig(config: MatchConfig): void {
  matchConfig = { ...config }
  hud.setMatchSettingsOpen(false, matchConfig)
  restartGame()
}

function advanceSimulation(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  simulationTime += milliseconds
  const animationWasBusy = animations.isBusy
  let changed = animations.advance(milliseconds)
  if (animationWasBusy && !animations.isBusy) {
    aiCoordinator.finishAnimation()
    changed = true
  }

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

  if (advanceAi(animationWasBusy ? 0 : milliseconds)) {
    changed = true
  }

  if (changed) syncUiAndMarkers()
}

function advanceAi(milliseconds: number): boolean {
  const state = controller.getState()
  const timeline = controller.getTimelineSnapshot()
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  const eligible =
    isAiTurn(matchConfig, state) &&
    !animations.isBusy &&
    !replayPlaying &&
    !timeline.isReviewing &&
    !hud.isHistoryOpen &&
    !hud.isMatchSettingsOpen

  if (!eligible) return false
  if (ai.phase === 'error' || ai.phase === 'animating') return false
  if (ai.phase === 'idle') {
    aiCoordinator.begin(state, matchConfig.difficulty, timeline.revision)
    return true
  }

  const result = aiCoordinator.advance(milliseconds, timeline.revision)
  if (!result) return false
  if (!result.move) {
    aiCoordinator.fail('AI 没有返回可执行着法')
    return true
  }
  const currentState = controller.getState()
  const currentTimeline = controller.getTimelineSnapshot()
  if (
    currentTimeline.revision !== timeline.revision ||
    currentTimeline.isReviewing ||
    !isAiTurn(matchConfig, currentState) ||
    animations.isBusy ||
    replayPlaying ||
    hud.isHistoryOpen ||
    hud.isMatchSettingsOpen
  ) {
    aiCoordinator.cancel()
    return true
  }

  const committed = controller.tryCommitMove(result.move)
  if (committed.type !== 'moved') {
    aiCoordinator.fail(`AI 候选未通过权威规则校验：${committed.reason}`)
    return true
  }
  aiCoordinator.markCommitted(result)
  startMoveAnimation(committed.move)
  return true
}

function undoLastMove(): void {
  if (controller.getTimelineSnapshot().isReviewing) return
  aiCoordinator.cancel(true)
  stopReplay()
  const undone =
    matchConfig.mode === 'ai'
      ? controller.undoToSide(HUMAN_SIDE)
      : controller.undoLastMove()
        ? 1
        : 0
  if (undone === 0) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function toggleHistory(): void {
  const opening = !hud.isHistoryOpen
  if (opening) aiCoordinator.cancel()
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
  aiCoordinator.cancel()
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
  aiCoordinator.cancel()
  if (!controller.stepReplayBackward()) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function replayNext(): void {
  if (animations.isBusy || replayPlaying) return
  aiCoordinator.cancel()
  if (!controller.stepReplayForward()) return
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function returnToLive(): void {
  if (animations.isBusy) return
  aiCoordinator.cancel()
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

  aiCoordinator.cancel()
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
  if (event.button !== 0 || isBoardInputLocked(controller.getState())) {
    return
  }
  const square = scene.pickSquare(event.clientX, event.clientY)
  if (!square) return

  const result = controller.handleSquare(square.file, square.rank)
  if (result.type !== 'moved') {
    snapEntireView()
    return
  }

  startMoveAnimation(result.move)
})

function startMoveAnimation(move: Move): void {
  const committedState = controller.getState()
  // 不在此处 snap：旧 Mesh 必须保留给移动和受击退场演出。
  scene.setInteractionState(committedState, null, [])
  if (!animations.start(move, committedState)) {
    snapEntireView()
    aiCoordinator.finishAnimation()
    return
  }
  syncUiAndMarkers()
}

function isBoardInputLocked(state: GameState): boolean {
  const timeline = controller.getTimelineSnapshot()
  return (
    animations.isBusy ||
    replayPlaying ||
    timeline.isReviewing ||
    hud.isMatchSettingsOpen ||
    isAiTurn(matchConfig, state)
  )
}

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.defaultPrevented || isEditableTarget(event.target)) {
    return
  }
  if (hud.isMatchSettingsOpen) return
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
  if (key === 'm') {
    event.preventDefault()
    toggleMatchSettings()
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
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  const inputLocked = isBoardInputLocked(state)
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
            : hud.isMatchSettingsOpen
              ? 'match-settings'
              : ai.phase === 'error'
                ? 'ai-error'
                : ai.phase === 'thinking'
                  ? 'ai-thinking'
                  : isAiTurn(matchConfig, state)
                    ? 'ai-turn'
                    : null,
      boardInputEnabled: state.status === 'playing' && !inputLocked,
      match: {
        ...matchConfig,
        humanSide: HUMAN_SIDE,
        aiSide: AI_SIDE,
        settingsOpen: hud.isMatchSettingsOpen,
      },
      ai,
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
  '[xiangqi-3d] 对局系统已就绪：支持本地双人、三级 AI、整回合悔棋与棋谱回放。',
)
