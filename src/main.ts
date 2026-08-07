/**
 * 中国象棋 3D — 本地双人 / 人机可玩切片
 * 规则状态是唯一真相，Three.js 只负责呈现、演出与输入拾取。
 */
import { AnimationDirector } from './animation/animationDirector'
import {
  COMBAT_PROFILES,
  MAX_CAPTURE_DURATION_MS,
} from './animation/combatProfile'
import { GameAudio } from './audio/gameAudio'
import { pieceAt, pieceLabel } from './engine/board'
import { AiCoordinator } from './game/aiCoordinator'
import {
  GameController,
  type InteractionResult,
} from './game/controller'
import {
  DEFAULT_MATCH_CONFIG,
  AI_SIDE,
  HUMAN_SIDE,
  isAiTurn,
  type MatchConfig,
} from './game/match'
import {
  BOARD_TAP_MOVE_THRESHOLD_PX,
  BoardTapGesture,
} from './input/boardTapGesture'
import { BoardScene } from './scene/boardScene'
import {
  QUALITY_TIERS,
  advanceFrameBudget,
  createFrameBudget,
  parseQualityTier,
} from './scene/qualityTier'
import type { GameState, Move } from './types/xiangqi'
import {
  deriveGamePrompt,
  type GamePrompt,
  type InteractionFeedback,
} from './ui/gamePrompt'
import { Hud } from './ui/hud'

const appElement = document.querySelector<HTMLDivElement>('#app')
if (!appElement) throw new Error('#app not found')
const app: HTMLDivElement = appElement

const REPLAY_STEP_MS = 700
const INTERACTION_FEEDBACK_MS = 1800
const controller = new GameController()
const scene = new BoardScene(app)
// 系统降低动效偏好只压缩时长与位移幅度，绝不裁掉任何演出阶段——
// 否则事件流与常规模式不一致，自动化验收就失去可比性。
const reducedMotionQuery =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
const animations = new AnimationDirector(scene, {
  reducedMotion: reducedMotionQuery?.matches === true,
})
reducedMotionQuery?.addEventListener('change', (event) => {
  animations.setTiming({ reducedMotion: event.matches })
})
const gameAudio = new GameAudio()
const boardTapGesture = new BoardTapGesture()
let matchConfig: MatchConfig = { ...DEFAULT_MATCH_CONFIG }
const hud = new Hud(app, {
  onToggleMatchSettings: () => toggleMatchSettings(),
  onApplyMatchConfig: (config) => applyMatchConfig(config),
  onToggleRuleHelp: () => toggleRuleHelp(),
  onRestart: () => restartGame(),
  onToggleFullscreen: () => void toggleFullscreen(),
  onUndo: () => undoLastMove(),
  onToggleHistory: () => toggleHistory(),
  onToggleCinema: () => toggleCinemaMode(),
  onSeekReplay: (ply) => seekReplay(ply),
  onReplayFirst: () => replayFirst(),
  onReplayPrevious: () => replayPrevious(),
  onToggleReplay: () => toggleReplay(),
  onReplayNext: () => replayNext(),
  onReturnToLive: () => returnToLive(),
})
const aiCoordinator = new AiCoordinator(undefined, () => syncUiAndMarkers())
let simulationTime = 0
let interactionFeedback: InteractionFeedback | null = null
let interactionFeedbackExpiresAt = 0
let replayPlaying = false
let replayElapsedMs = 0
const launchParams = new URLSearchParams(window.location.search)
let manualClock = launchParams.get('clock') === 'manual'
// `?quality=lite` 固定档位，便于在高性能机器上验收低档表现；固定后不再自动降档。
const forcedQualityTier = parseQualityTier(launchParams.get('quality'))
const qualityTierLocked = forcedQualityTier !== null
if (forcedQualityTier) scene.setQualityTier(forcedQualityTier)
let frameBudget = createFrameBudget(scene.getQualityTier())
let lastFrameTime = performance.now()
const fullscreenAvailable =
  document.fullscreenEnabled && typeof app.requestFullscreen === 'function'
app.dataset.fullscreenAvailable = String(fullscreenAvailable)

function unlockGameAudio(): void {
  gameAudio.unlock()
}

window.addEventListener('pointerdown', unlockGameAudio, { capture: true })
window.addEventListener('keydown', unlockGameAudio, { capture: true })
function handlePageHide(event: PageTransitionEvent): void {
  if (event.persisted) {
    // BFCache 返回时模块不会重跑；保留手势监听，清掉离页前的旧音源即可。
    gameAudio.reset()
    return
  }
  window.removeEventListener('pointerdown', unlockGameAudio, { capture: true })
  window.removeEventListener('keydown', unlockGameAudio, { capture: true })
  window.removeEventListener('pagehide', handlePageHide)
  window.removeEventListener('pageshow', handlePageShow)
  document.removeEventListener('fullscreenchange', refitSceneToViewport)
  window.visualViewport?.removeEventListener('resize', refitSceneToViewport)
  gameAudio.dispose()
}

window.addEventListener('pagehide', handlePageHide)

function refitSceneToViewport(): void {
  hud.resize()
  hud.setFullscreenState(Boolean(document.fullscreenElement))
  scene.resize(app.clientWidth, app.clientHeight, window.devicePixelRatio)
}

function handlePageShow(event: PageTransitionEvent): void {
  if (!event.persisted) return
  // BFCache 会保留 Three 场景和手势状态；恢复时丢弃离页前的旧时钟/触点。
  lastFrameTime = performance.now()
  boardTapGesture.cancel()
  scene.setViewDragging(false)
  refitSceneToViewport()
  scene.setPresentationTime(simulationTime)
  syncUiAndMarkers()
  scene.render()
}

window.addEventListener('pageshow', handlePageShow)
document.addEventListener('fullscreenchange', refitSceneToViewport)
window.visualViewport?.addEventListener('resize', refitSceneToViewport, {
  passive: true,
})

function syncUiAndMarkers(): void {
  const state = controller.getState()
  const timeline = controller.getTimelineSnapshot()
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  const animation = animations.getSnapshot()
  const pendingCaptureId = animation.active
    ? animation.move.capturedId
    : null
  const inputLocked = isBoardInputLocked(state)
  const selected = inputLocked ? undefined : controller.getSelectedPiece()
  const legalCount = inputLocked ? 0 : controller.getLegalMoves().length
  const prompt = createCurrentPrompt(state, selected, legalCount)
  scene.setInteractionState(
    state,
    inputLocked ? null : controller.getSelectedId(),
    inputLocked ? [] : controller.getLegalMoves(),
  )
  hud.update(
    state,
    selected,
    legalCount,
    {
      animationBusy: animations.isBusy,
      pendingCaptureId,
      replayPlaying,
      timeline,
      moveLog: controller.getMoveLog(),
      matchConfig,
      ai,
      prompt,
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
  gameAudio.reset()
  aiCoordinator.cancel(true)
  stopReplay()
  controller.reset()
  simulationTime = 0
  scene.setPresentationTime(simulationTime)
  clearInteractionFeedback()
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
  clearInteractionFeedback()
  hud.setMatchSettingsOpen(opening, matchConfig)
  syncUiAndMarkers()
}

function applyMatchConfig(config: MatchConfig): void {
  matchConfig = { ...config }
  hud.setMatchSettingsOpen(false, matchConfig)
  restartGame()
}

/** 战术俯视只是备用构图，不是自由俯角；立绘随之隐藏，改用底座汉字读盘。 */
function toggleTacticalView(): void {
  scene.setTacticalView(!scene.isTacticalView())
  clearInteractionFeedback()
  syncUiAndMarkers()
}

/** 录制模式：收起全部 HUD，只留一个恢复入口，便于出片。 */
function toggleCinemaMode(): void {
  hud.setCinemaMode(!hud.isCinemaMode)
  clearInteractionFeedback()
  syncUiAndMarkers()
}

function toggleRuleHelp(): void {
  const opening = !hud.isRuleHelpOpen
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
  clearInteractionFeedback()
  hud.setRuleHelpOpen(opening)
  syncUiAndMarkers()
}

function advanceSimulation(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return
  simulationTime += milliseconds
  scene.setPresentationTime(simulationTime)
  const animationWasBusy = animations.isBusy
  const advanced = animations.advance(milliseconds)
  let changed = advanced.completed
  // 事件按时间序转发；大 delta 一次跨完整场演出时也不会漏发命中或收尾。
  for (const event of advanced.events) {
    gameAudio.dispatch({ type: 'animation-event', event })
  }
  if (
    interactionFeedback &&
    simulationTime >= interactionFeedbackExpiresAt
  ) {
    clearInteractionFeedback()
    changed = true
  }
  if (animationWasBusy && !animations.isBusy) {
    clearInteractionFeedback()
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
    !hud.isMatchSettingsOpen &&
    !hud.isRuleHelpOpen

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
    hud.isMatchSettingsOpen ||
    hud.isRuleHelpOpen
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
  gameAudio.reset()
  clearInteractionFeedback()
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function toggleHistory(): void {
  clearInteractionFeedback()
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
  gameAudio.reset()
  clearInteractionFeedback()
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
  gameAudio.reset()
  clearInteractionFeedback()
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function replayNext(): void {
  if (animations.isBusy || replayPlaying) return
  aiCoordinator.cancel()
  if (!controller.stepReplayForward()) return
  gameAudio.reset()
  clearInteractionFeedback()
  animations.cancelAndSnap(controller.getState())
  syncUiAndMarkers()
}

function returnToLive(): void {
  if (animations.isBusy) return
  aiCoordinator.cancel()
  stopReplay()
  gameAudio.reset()
  clearInteractionFeedback()
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
    clearInteractionFeedback()
    syncUiAndMarkers()
    return
  }

  aiCoordinator.cancel()
  gameAudio.reset()
  clearInteractionFeedback()
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
  clearInteractionFeedback()
}

async function toggleFullscreen(): Promise<void> {
  if (!fullscreenAvailable) {
    showInteractionFeedback({ reason: 'fullscreen-unavailable' })
    return
  }
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await app.requestFullscreen()
    }
  } catch (error) {
    console.warn('[xiangqi-3d] 无法切换全屏', error)
    showInteractionFeedback({ reason: 'fullscreen-failed' })
  }
}

const boardCanvas = scene.renderer.domElement

boardCanvas.addEventListener('pointerdown', (event) => {
  if (!boardTapGesture.begin(event)) {
    scene.setViewDragging(boardTapGesture.isDragging)
    return
  }
  scene.setViewDragging(false)
  event.preventDefault()
  boardCanvas.setPointerCapture(event.pointerId)
})

boardCanvas.addEventListener('pointermove', (event) => {
  const movement = boardTapGesture.trackMove(event)
  if (!movement.tracked) return
  event.preventDefault()
  if (movement.drag) {
    scene.setViewDragging(true)
    scene.rotateViewByCssDelta(movement.drag.deltaXCss)
  }
})

boardCanvas.addEventListener('pointercancel', (event) => {
  boardTapGesture.cancel(event.pointerId)
  scene.setViewDragging(boardTapGesture.isDragging)
})

boardCanvas.addEventListener('lostpointercapture', (event) => {
  boardTapGesture.cancel(event.pointerId)
  scene.setViewDragging(boardTapGesture.isDragging)
})

boardCanvas.addEventListener('pointerup', (event) => {
  const movement = boardTapGesture.trackMove(event)
  if (movement.drag) {
    scene.rotateViewByCssDelta(movement.drag.deltaXCss)
  }
  const tap = boardTapGesture.end(event)
  if (boardCanvas.hasPointerCapture(event.pointerId)) {
    boardCanvas.releasePointerCapture(event.pointerId)
  }
  scene.setViewDragging(boardTapGesture.isDragging)
  if (!tap) return
  event.preventDefault()
  handleBoardTap(tap.clientX, tap.clientY)
})

function handleBoardTap(clientX: number, clientY: number): void {
  const state = controller.getState()
  const lockedReason = getInputLockedReason(state)
  if (lockedReason) {
    const feedback = feedbackForInputLock(lockedReason)
    if (feedback) showInteractionFeedback(feedback)
    return
  }
  const square = scene.pickSquare(clientX, clientY)
  if (!square) {
    showInteractionFeedback({ reason: 'outside-board' })
    return
  }

  const selectedBefore = controller.getSelectedPiece()
  const result = controller.handleSquare(square.file, square.rank)
  if (result.type !== 'moved') {
    if (result.type === 'selected') {
      gameAudio.dispatch({ type: 'select' })
    }
    scene.snapTo(controller.getState())
    const feedback = feedbackForInteraction(result, selectedBefore)
    if (feedback) {
      showInteractionFeedback(feedback)
    } else {
      clearInteractionFeedback()
      syncUiAndMarkers()
    }
    return
  }

  startMoveAnimation(result.move)
}

function startMoveAnimation(move: Move): void {
  clearInteractionFeedback()
  const committedState = controller.getState()
  // 不在此处 snap：旧 Mesh 必须保留给移动和受击退场演出。
  scene.setInteractionState(committedState, null, [])
  const started = animations.start(move, committedState)
  const movingPiece = committedState.pieces.find(
    (piece) => piece.id === move.pieceId,
  )
  const moveRecord = committedState.history.at(-1)
  if (movingPiece) {
    gameAudio.dispatch({
      type: 'move-start',
      pieceKind: movingPiece.kind,
      capture: Boolean(move.capturedId),
      givesCheck: moveRecord?.givesCheck ?? false,
      terminal: committedState.status !== 'playing',
    })
  }
  if (!started) {
    gameAudio.dispatch({ type: 'animation-finished' })
    snapEntireView()
    aiCoordinator.finishAnimation()
    return
  }
  syncUiAndMarkers()
}

function isBoardInputLocked(state: GameState): boolean {
  return getInputLockedReason(state) !== null
}

type InputLockedReason =
  | 'animation'
  | 'replay-playing'
  | 'replay-view'
  | 'match-settings'
  | 'rule-help'
  | 'terminal'
  | 'ai-error'
  | 'ai-thinking'
  | 'ai-paused-history'
  | 'ai-turn'

function getInputLockedReason(state: GameState): InputLockedReason | null {
  const timeline = controller.getTimelineSnapshot()
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  if (animations.isBusy) return 'animation'
  if (replayPlaying) return 'replay-playing'
  if (timeline.isReviewing) return 'replay-view'
  if (hud.isMatchSettingsOpen) return 'match-settings'
  if (hud.isRuleHelpOpen) return 'rule-help'
  if (state.status !== 'playing') return 'terminal'
  if (ai.phase === 'error') return 'ai-error'
  if (hud.isHistoryOpen && isAiTurn(matchConfig, state)) {
    return 'ai-paused-history'
  }
  if (ai.phase === 'thinking') return 'ai-thinking'
  if (isAiTurn(matchConfig, state)) return 'ai-turn'
  return null
}

function feedbackForInputLock(
  reason: InputLockedReason,
): InteractionFeedback | null {
  switch (reason) {
    case 'animation':
      return { reason: 'locked-animation' }
    case 'replay-playing':
    case 'replay-view':
      return { reason: 'locked-replay' }
    case 'match-settings':
    case 'rule-help':
      return { reason: 'locked-settings' }
    case 'terminal':
      return { reason: 'terminal' }
    case 'ai-thinking':
    case 'ai-paused-history':
    case 'ai-turn':
      return { reason: 'locked-ai' }
    case 'ai-error':
      return null
  }
}

function feedbackForInteraction(
  result: Exclude<InteractionResult, { type: 'moved' }>,
  selected: ReturnType<GameController['getSelectedPiece']>,
): InteractionFeedback | null {
  if (result.type === 'selected') return null
  if (result.type === 'cleared') {
    if (result.reason === 'cancelled') return null
    return {
      reason: result.reason,
      ...(selected
        ? { piece: { kind: selected.kind, side: selected.side } }
        : {}),
    }
  }

  switch (result.reason) {
    case 'reviewing':
      return { reason: 'locked-replay' }
    case 'terminal':
      return { reason: 'terminal' }
    case 'outside-board':
      return { reason: 'outside-board' }
    case 'illegal':
      return { reason: 'illegal-pattern' }
  }
}

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.defaultPrevented) {
    return
  }
  const key = event.key.toLowerCase()
  if (hud.isMatchSettingsOpen) {
    if (key === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      toggleMatchSettings()
    }
    return
  }
  if (isEditableTarget(event.target)) return
  if (hud.isRuleHelpOpen) {
    if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      toggleRuleHelp()
    }
    return
  }
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
  if (event.key === '?') {
    event.preventDefault()
    toggleRuleHelp()
    return
  }
  if (key === 'h') {
    event.preventDefault()
    toggleHistory()
    return
  }
  if (key === 't') {
    event.preventDefault()
    toggleTacticalView()
    return
  }
  if (key === 'c') {
    event.preventDefault()
    toggleCinemaMode()
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
  const animation = animations.getSnapshot()
  const pendingCaptureId = animation.active
    ? animation.move.capturedId
    : null
  const inputLocked = isBoardInputLocked(state)
  const effectiveSelected = inputLocked ? undefined : selected
  const effectiveLegalMoves = inputLocked ? [] : controller.getLegalMoves()
  const prompt = createCurrentPrompt(
    state,
    effectiveSelected,
    effectiveLegalMoves.length,
  )
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
        '棋盘内部 file/rank 固定：rank 0 为红方底线、rank 9 为黑方底线；旋转后屏幕左右由 presentation.cameraView 决定',
      status: state.status,
      sideToMove: state.sideToMove,
      inCheck: state.inCheck,
      winner: state.winner,
      outcome: state.outcome ?? null,
      prompt,
      fullscreen: Boolean(document.fullscreenElement),
      inputLocked,
      inputLockedReason: getInputLockedReason(state),
      boardInputEnabled: !inputLocked,
      input: {
        boardPointerCommit: 'primary-pointerup-tap',
        cameraOrbit: 'primary-drag-horizontal',
        dragThresholdCssPx: BOARD_TAP_MOVE_THRESHOLD_PX,
        activePointerId: boardTapGesture.activePointerId,
        viewDragging: boardTapGesture.isDragging,
        fullscreenAvailable,
      },
      rules: {
        profile: state.ruleState?.ruleset ?? 'program-competition-2023',
        positionOccurrences:
          state.ruleState?.currentPositionOccurrences ?? 1,
        recordedFrames: state.ruleState?.frames.length ?? 0,
        naturalLimit: state.ruleState?.naturalLimit ?? null,
      },
      match: {
        ...matchConfig,
        humanSide: HUMAN_SIDE,
        aiSide: AI_SIDE,
        settingsOpen: hud.isMatchSettingsOpen,
        ruleHelpOpen: hud.isRuleHelpOpen,
      },
      view: {
        tactical: scene.isTacticalView(),
        cinema: hud.isCinemaMode,
      },
      quality: {
        tier: scene.getQualityTier(),
        locked: qualityTierLocked,
        lastWindowFps: frameBudget.lastWindowFps,
        downgrades: frameBudget.downgrades,
        upgrades: frameBudget.upgrades,
        recoveryStreak: frameBudget.recoveryStreak,
      },
      ai,
      audio: gameAudio.getSnapshot(),
      animation,
      animationTiming: {
        ...animations.getTiming(),
        reducedMotionPreferred: reducedMotionQuery?.matches === true,
        maxCaptureDurationMs: MAX_CAPTURE_DURATION_MS,
        profiles: Object.fromEntries(
          (
            [
              'king',
              'advisor',
              'elephant',
              'horse',
              'chariot',
              'cannon',
              'pawn',
            ] as const
          ).map((kind) => [kind, COMBAT_PROFILES[kind].style]),
        ),
      },
      presentation: {
        ...scene.getPresentationSnapshot(state),
        pendingCaptureId,
        presentedCapturedCount: state.pieces.filter(
          (piece) => piece.captured && piece.id !== pendingCaptureId,
        ).length,
      },
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
      selected: effectiveSelected
        ? {
            id: effectiveSelected.id,
            label: pieceLabel(effectiveSelected.kind, effectiveSelected.side),
            side: effectiveSelected.side,
            file: effectiveSelected.file,
            rank: effectiveSelected.rank,
          }
        : null,
      legalTargets: effectiveLegalMoves.map((move) => ({
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
      interactionFeedback,
    },
    null,
    2,
  )
}

function createCurrentPrompt(
  state: GameState,
  selected: ReturnType<GameController['getSelectedPiece']>,
  legalCount: number,
): GamePrompt {
  const timeline = controller.getTimelineSnapshot()
  const ai = aiCoordinator.getSnapshot(matchConfig.difficulty)
  return deriveGamePrompt({
    state,
    selected,
    legalCount,
    animationBusy: animations.isBusy,
    replayPlaying,
    timeline,
    matchMode: matchConfig.mode,
    aiTurn: isAiTurn(matchConfig, state),
    historyOpen: hud.isHistoryOpen,
    ai,
    activeDialog: hud.isMatchSettingsOpen
      ? 'match-settings'
      : hud.isRuleHelpOpen
        ? 'rule-help'
        : null,
    interaction: interactionFeedback,
  })
}

function clearInteractionFeedback(): void {
  interactionFeedback = null
  interactionFeedbackExpiresAt = 0
}

function showInteractionFeedback(feedback: InteractionFeedback): void {
  interactionFeedback = feedback
  interactionFeedbackExpiresAt = simulationTime + INTERACTION_FEEDBACK_MS
  syncUiAndMarkers()
}

window.projectSquare = (file: number, rank: number) => {
  if (!Number.isInteger(file) || !Number.isInteger(rank)) return null
  if (file < 0 || file > 8 || rank < 0 || rank > 9) return null
  return scene.projectSquare(file, rank)
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
  if (!manualClock) {
    advanceSimulation(delta)
    // 手动时钟下绝不采样：advanceTime(2000) 会被误读成 0.5fps，
    // 一次快进就把画质打到最低档，自动化验收随即失去可比性。
    sampleFrameBudget(delta)
  }
  scene.render()
  requestAnimationFrame(loop)
}

function sampleFrameBudget(deltaMs: number): void {
  if (qualityTierLocked) return
  const next = advanceFrameBudget(frameBudget, deltaMs)
  if (next === frameBudget) return
  const previousTier = scene.getQualityTier()
  frameBudget = next
  if (next.tier === previousTier) return
  scene.setQualityTier(next.tier)
  // 用档位序号判断方向。直接比字符串会踩坑：'balanced' < 'high' 恒为 true。
  const recovered =
    QUALITY_TIERS.indexOf(next.tier) < QUALITY_TIERS.indexOf(previousTier)
  console.info(
    recovered
      ? `[xiangqi-3d] 帧率回升（${next.lastWindowFps} fps），画质恢复到 ${next.tier}`
      : `[xiangqi-3d] 帧率偏低（${next.lastWindowFps} fps），画质降至 ${next.tier}`,
  )
  syncUiAndMarkers()
}
requestAnimationFrame(loop)

console.info(
  '[xiangqi-3d] 对局系统已就绪：支持拖动环绕、本地双人、三级 AI、整回合悔棋与棋谱回放。',
)
