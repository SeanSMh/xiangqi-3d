import { pieceLabel } from '../engine/board'
import type { MoveLogEntry } from '../game/controller'
import type { TimelineSnapshot } from '../game/timeline'
import type { GameState, Piece, Side } from '../types/xiangqi'
import './hud.css'

interface HudActions {
  onRestart: () => void
  onToggleFullscreen: () => void
  onUndo: () => void
  onToggleHistory: () => void
  onSeekReplay: (ply: number) => void
  onReplayFirst: () => void
  onReplayPrevious: () => void
  onToggleReplay: () => void
  onReplayNext: () => void
  onReturnToLive: () => void
}

interface HudViewState {
  animationBusy: boolean
  replayPlaying: boolean
  timeline: TimelineSnapshot
  moveLog: readonly MoveLogEntry[]
}

/** 左上局面、右上战果、底部操作、棋谱抽屉与终局提示。 */
export class Hud {
  private turnLabelEl: HTMLSpanElement
  private checkEl: HTMLSpanElement
  private spoilsEl: HTMLDivElement
  private selectionEl: HTMLDivElement
  private gameStatusEl: HTMLDivElement
  private undoButton: HTMLButtonElement
  private historyToggleButton: HTMLButtonElement
  private historyPanel: HTMLElement
  private historyHeading: HTMLHeadingElement
  private historyList: HTMLOListElement
  private historyCursorLabel: HTMLDivElement
  private replayFirstButton: HTMLButtonElement
  private replayPreviousButton: HTMLButtonElement
  private replayPlayButton: HTMLButtonElement
  private replayNextButton: HTMLButtonElement
  private returnLiveButton: HTMLButtonElement
  private historyOpen = false
  private readonly actions: HudActions

  constructor(container: HTMLElement, actions: HudActions) {
    this.actions = actions
    const root = document.createElement('div')
    root.id = 'xiangqi-hud'

    const turnPanel = makePanel('turn-panel')
    this.turnLabelEl = document.createElement('span')
    this.checkEl = document.createElement('span')
    this.checkEl.id = 'check-indicator'
    this.checkEl.textContent = '将军'
    turnPanel.append(this.turnLabelEl, this.checkEl)

    this.spoilsEl = makePanel('spoils-panel')

    this.gameStatusEl = document.createElement('div')
    this.gameStatusEl.id = 'game-status'
    this.gameStatusEl.setAttribute('role', 'status')
    this.gameStatusEl.setAttribute('aria-live', 'polite')
    this.gameStatusEl.setAttribute('aria-atomic', 'true')

    const controls = document.createElement('div')
    controls.className = 'xq-controls'

    this.selectionEl = document.createElement('div')
    this.selectionEl.id = 'selection-status'

    this.undoButton = makeButton('undo-btn', '悔棋 U', actions.onUndo)
    this.historyToggleButton = makeButton(
      'history-toggle-btn',
      '棋谱 H',
      actions.onToggleHistory,
    )
    this.historyToggleButton.setAttribute(
      'aria-controls',
      'move-history-panel',
    )
    this.historyToggleButton.setAttribute('aria-expanded', 'false')
    const restartButton = makeButton('restart-btn', '重开 R', actions.onRestart)
    const fullscreenButton = makeButton(
      'fullscreen-btn',
      '全屏 F',
      actions.onToggleFullscreen,
    )
    controls.append(
      this.selectionEl,
      this.undoButton,
      this.historyToggleButton,
      restartButton,
      fullscreenButton,
    )

    this.historyPanel = document.createElement('aside')
    this.historyPanel.id = 'move-history-panel'
    this.historyPanel.setAttribute('aria-labelledby', 'history-heading')
    this.historyPanel.tabIndex = -1
    this.historyPanel.hidden = true

    const historyHeader = document.createElement('div')
    historyHeader.className = 'history-header'
    this.historyHeading = document.createElement('h2')
    this.historyHeading.id = 'history-heading'
    this.historyHeading.className = 'history-heading'
    const closeButton = makeButton(
      'history-close-btn',
      '关闭',
      actions.onToggleHistory,
    )
    closeButton.classList.add('history-close')
    historyHeader.append(this.historyHeading, closeButton)

    this.historyList = document.createElement('ol')
    this.historyList.id = 'history-list'

    const historyFooter = document.createElement('div')
    historyFooter.className = 'history-footer'
    this.historyCursorLabel = document.createElement('div')
    this.historyCursorLabel.id = 'history-cursor-label'
    const historyNav = document.createElement('div')
    historyNav.className = 'history-nav'
    this.replayFirstButton = makeButton(
      'replay-first-btn',
      '开局',
      actions.onReplayFirst,
    )
    this.replayPreviousButton = makeButton(
      'replay-prev-btn',
      '上一步',
      actions.onReplayPrevious,
    )
    this.replayPlayButton = makeButton(
      'replay-play-btn',
      '播放',
      actions.onToggleReplay,
    )
    this.replayNextButton = makeButton(
      'replay-next-btn',
      '下一步',
      actions.onReplayNext,
    )
    this.returnLiveButton = makeButton(
      'return-live-btn',
      '返回当前 Enter',
      actions.onReturnToLive,
    )
    historyNav.append(
      this.replayFirstButton,
      this.replayPreviousButton,
      this.replayPlayButton,
      this.replayNextButton,
      this.returnLiveButton,
    )
    historyFooter.append(this.historyCursorLabel, historyNav)
    this.historyPanel.append(historyHeader, this.historyList, historyFooter)

    root.append(
      turnPanel,
      this.spoilsEl,
      this.gameStatusEl,
      controls,
      this.historyPanel,
    )
    container.appendChild(root)
  }

  get isHistoryOpen(): boolean {
    return this.historyOpen
  }

  setHistoryOpen(open: boolean): void {
    const panelHadFocus = this.historyPanel.contains(document.activeElement)
    this.historyOpen = open
    this.historyPanel.hidden = !open
    this.historyToggleButton.setAttribute('aria-expanded', String(open))
    this.historyToggleButton.textContent = open ? '收起 H' : '棋谱 H'
    if (open) {
      this.historyPanel.focus({ preventScroll: true })
    } else if (panelHadFocus) {
      this.historyToggleButton.focus({ preventScroll: true })
    }
  }

  update(
    state: GameState,
    selected: Piece | undefined,
    legalCount: number,
    view: HudViewState,
  ): void {
    const { animationBusy, replayPlaying, timeline, moveLog } = view
    const sideLabel = state.sideToMove === 'red' ? '红方' : '黑方'
    const sideColor = state.sideToMove === 'red' ? '#ff665c' : '#80bfff'
    this.turnLabelEl.textContent = timeline.isReviewing
      ? `回放 ${timeline.cursorPly} / ${timeline.livePly} · ${sideLabel}`
      : `第 ${timeline.livePly + 1} 手 · ${sideLabel}行棋`
    this.turnLabelEl.style.color = sideColor
    this.turnLabelEl.style.fontWeight = '700'
    this.checkEl.style.display = state.inCheck ? 'inline-block' : 'none'

    this.spoilsEl.innerHTML = `
      <div class="spoils-caption" style="opacity:.58;font-size:10px;letter-spacing:.14em;margin-bottom:5px">战果 SPOILS</div>
      <div style="font-weight:700;color:#f5d76e">${formatSpoils(state)}</div>
      <div class="spoils-count" style="opacity:.5;font-size:10px;margin-top:5px">已吃 ${capturedCount(state)} 子</div>
    `

    this.gameStatusEl.style.borderColor = 'rgba(212,175,55,.35)'
    if (animationBusy) {
      this.gameStatusEl.textContent = '战斗演出中 · 棋盘输入已锁定'
      this.gameStatusEl.style.color = '#ffcc80'
    } else if (replayPlaying) {
      this.gameStatusEl.textContent = `棋谱回放 · 第 ${timeline.cursorPly} / ${timeline.livePly} 手`
      this.gameStatusEl.style.color = '#ffe082'
    } else if (timeline.isReviewing) {
      this.gameStatusEl.textContent = `回放局面 · 第 ${timeline.cursorPly} / ${timeline.livePly} 手`
      this.gameStatusEl.style.color = '#b9dcff'
    } else if (state.status === 'playing') {
      this.gameStatusEl.textContent = state.inCheck
        ? `${sideLabel}正在被将军，请应将`
        : '本地双人对局'
      this.gameStatusEl.style.color = state.inCheck ? '#ff8a80' : '#f4df91'
    } else {
      const winner = state.winner === 'red' ? '红方' : '黑方'
      const reason = state.status === 'checkmate' ? '绝杀' : '困毙'
      this.gameStatusEl.textContent = `${winner}获胜 · ${reason}`
      this.gameStatusEl.style.color = '#ffd45a'
      this.gameStatusEl.style.borderColor = 'rgba(255,188,45,.8)'
    }

    if (animationBusy) {
      this.selectionEl.textContent = '正在执行走子演出；可悔棋或重开'
    } else if (replayPlaying) {
      this.selectionEl.textContent = '正在自动回放棋谱…'
    } else if (timeline.isReviewing) {
      this.selectionEl.textContent = `正在查看第 ${timeline.cursorPly} / ${timeline.livePly} 手，返回当前后可继续行棋`
    } else if (state.status !== 'playing') {
      this.selectionEl.textContent = '对局结束，可悔棋或点击“重开”'
    } else if (selected) {
      const faction = selected.side === 'red' ? '红' : '黑'
      this.selectionEl.textContent = `已选 ${faction}${pieceLabel(selected.kind, selected.side)} · ${legalCount} 个合法落点`
    } else {
      this.selectionEl.textContent = '点选棋子，再点亮起的合法落点'
    }

    this.undoButton.disabled = !timeline.canUndo
    this.replayFirstButton.disabled =
      animationBusy || replayPlaying || timeline.cursorPly === timeline.firstAvailablePly
    this.replayPreviousButton.disabled =
      animationBusy || replayPlaying || !timeline.canStepBackward
    this.replayPlayButton.disabled = animationBusy || !timeline.canReplay
    this.replayPlayButton.textContent = replayPlaying ? '暂停' : '播放'
    this.replayPlayButton.setAttribute(
      'aria-pressed',
      String(replayPlaying),
    )
    this.replayNextButton.disabled =
      animationBusy || replayPlaying || !timeline.canStepForward
    this.returnLiveButton.disabled =
      animationBusy || (!replayPlaying && !timeline.canReturnToLive)

    this.historyHeading.textContent = `棋谱 · ${timeline.livePly} 手`
    this.historyCursorLabel.textContent = timeline.isReviewing
      ? `回放第 ${timeline.cursorPly} / ${timeline.livePly} 手`
      : `当前局面 · ${timeline.livePly} 手`
    this.renderMoveLog(moveLog, timeline, animationBusy || replayPlaying)
  }

  private renderMoveLog(
    entries: readonly MoveLogEntry[],
    timeline: TimelineSnapshot,
    navigationLocked: boolean,
  ): void {
    const activeElement = document.activeElement
    const focusedPly =
      activeElement instanceof HTMLButtonElement &&
      this.historyList.contains(activeElement)
        ? activeElement.dataset.ply
        : undefined
    const rows: HTMLLIElement[] = []
    rows.push(
      makeHistoryRow(
        0,
        '0. 开局',
        null,
        timeline.cursorPly === 0,
        navigationLocked || timeline.firstAvailablePly > 0,
        this.actions.onSeekReplay,
      ),
    )
    for (const entry of entries) {
      rows.push(
        makeHistoryRow(
          entry.ply,
          `${entry.ply}. ${entry.text}`,
          entry.side,
          timeline.cursorPly === entry.ply,
          navigationLocked || entry.ply < timeline.firstAvailablePly,
          this.actions.onSeekReplay,
        ),
      )
    }
    this.historyList.replaceChildren(...rows)
    if (focusedPly !== undefined) {
      this.historyList
        .querySelector<HTMLButtonElement>(`[data-ply="${focusedPly}"]`)
        ?.focus({ preventScroll: true })
    }
    const current = this.historyList.querySelector<HTMLElement>(
      '[aria-current="step"]',
    )
    if (this.historyOpen && current) {
      current.scrollIntoView({ block: 'nearest' })
    }
  }
}

function makePanel(id: string): HTMLDivElement {
  const panel = document.createElement('div')
  panel.id = id
  panel.className = 'xq-panel'
  return panel
}

function makeButton(
  id: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.id = id
  button.className = 'xq-button'
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function makeHistoryRow(
  ply: number,
  label: string,
  side: Side | null,
  current: boolean,
  disabled: boolean,
  onSeek: (ply: number) => void,
): HTMLLIElement {
  const row = document.createElement('li')
  const button = document.createElement('button')
  button.className = 'history-entry'
  button.type = 'button'
  button.textContent = label
  button.dataset.ply = String(ply)
  if (side) button.dataset.side = side
  if (current) button.setAttribute('aria-current', 'step')
  button.disabled = disabled
  button.addEventListener('click', () => onSeek(ply))
  row.appendChild(button)
  return row
}

function capturedCount(state: GameState): number {
  return state.pieces.filter((piece) => piece.captured).length
}

function formatSpoils(state: GameState): string {
  const score = (side: Side) =>
    state.pieces
      .filter((piece) => piece.side === side && !piece.captured)
      .reduce((sum, piece) => sum + pieceValue(piece.kind), 0)

  const difference = score('red') - score('black')
  if (difference === 0) return '均势 EVEN'
  return difference > 0 ? `红方 +${difference}` : `黑方 +${-difference}`
}

function pieceValue(kind: Piece['kind']): number {
  switch (kind) {
    case 'chariot':
      return 9
    case 'cannon':
      return 5
    case 'horse':
      return 4
    case 'elephant':
    case 'advisor':
      return 2
    case 'pawn':
      return 1
    case 'king':
      return 0
  }
}
