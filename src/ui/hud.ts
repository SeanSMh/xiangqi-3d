import { pieceLabel } from '../engine/board'
import type { AiRuntimeSnapshot } from '../game/aiCoordinator'
import type { MoveLogEntry } from '../game/controller'
import {
  aiDifficultyLabel,
  isAiTurn,
  matchModeLabel,
  type MatchConfig,
} from '../game/match'
import type { TimelineSnapshot } from '../game/timeline'
import type { GameState, Piece, Side } from '../types/xiangqi'
import './hud.css'

interface HudActions {
  onToggleMatchSettings: () => void
  onApplyMatchConfig: (config: MatchConfig) => void
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
  matchConfig: MatchConfig
  ai: AiRuntimeSnapshot
}

/** 左上局面、右上战果、底部操作、棋谱抽屉与终局提示。 */
export class Hud {
  private turnLabelEl: HTMLSpanElement
  private checkEl: HTMLSpanElement
  private spoilsEl: HTMLDivElement
  private selectionEl: HTMLDivElement
  private gameStatusEl: HTMLDivElement
  private undoButton: HTMLButtonElement
  private gameModeButton: HTMLButtonElement
  private historyToggleButton: HTMLButtonElement
  private settingsDialog: HTMLDialogElement
  private modeLocalRadio: HTMLInputElement
  private modeAiRadio: HTMLInputElement
  private difficultyFieldset: HTMLFieldSetElement
  private difficultyRadios: Record<MatchConfig['difficulty'], HTMLInputElement>
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

    this.gameModeButton = makeButton(
      'game-mode-btn',
      '本地双人 M',
      actions.onToggleMatchSettings,
    )
    this.gameModeButton.setAttribute('aria-haspopup', 'dialog')
    this.gameModeButton.setAttribute('aria-controls', 'game-settings-dialog')
    this.gameModeButton.setAttribute('aria-expanded', 'false')
    this.gameModeButton.setAttribute('aria-keyshortcuts', 'M')
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
      this.gameModeButton,
      this.undoButton,
      this.historyToggleButton,
      restartButton,
      fullscreenButton,
    )

    this.settingsDialog = document.createElement('dialog')
    this.settingsDialog.id = 'game-settings-dialog'
    this.settingsDialog.setAttribute('aria-labelledby', 'settings-heading')
    this.settingsDialog.setAttribute(
      'aria-describedby',
      'settings-description settings-ai-note',
    )
    const settingsHeader = document.createElement('div')
    settingsHeader.className = 'settings-header'
    const settingsHeading = document.createElement('h2')
    settingsHeading.id = 'settings-heading'
    settingsHeading.textContent = '开始新对局'
    const settingsCloseButton = makeButton(
      'settings-close-btn',
      '关闭',
      actions.onToggleMatchSettings,
    )
    settingsCloseButton.classList.add('settings-close')
    settingsHeader.append(settingsHeading, settingsCloseButton)

    const settingsIntro = document.createElement('p')
    settingsIntro.id = 'settings-description'
    settingsIntro.className = 'settings-intro'
    settingsIntro.textContent = '选择模式后将重置当前棋局与棋谱。'

    const modeFieldset = document.createElement('fieldset')
    modeFieldset.className = 'settings-fieldset'
    modeFieldset.appendChild(makeLegend('对局模式'))
    this.modeLocalRadio = makeRadio('mode-local-radio', 'match-mode', 'local')
    this.modeAiRadio = makeRadio('mode-ai-radio', 'match-mode', 'ai')
    modeFieldset.append(
      makeRadioCard(this.modeLocalRadio, '本地双人', '红黑双方在同一设备操作'),
      makeRadioCard(this.modeAiRadio, '人机对弈', '你执红先行，AI 执黑'),
    )

    this.difficultyFieldset = document.createElement('fieldset')
    this.difficultyFieldset.className = 'settings-fieldset'
    this.difficultyFieldset.appendChild(makeLegend('AI 难度（仅人机）'))
    this.difficultyRadios = {
      easy: makeRadio('difficulty-easy-radio', 'ai-difficulty', 'easy'),
      normal: makeRadio('difficulty-normal-radio', 'ai-difficulty', 'normal'),
      hard: makeRadio('difficulty-hard-radio', 'ai-difficulty', 'hard'),
    }
    this.difficultyFieldset.append(
      makeRadioCard(this.difficultyRadios.easy, '入门', '会观察局面，也会留下机会'),
      makeRadioCard(this.difficultyRadios.normal, '标准', '稳定选择当前最优着法'),
      makeRadioCard(this.difficultyRadios.hard, '挑战', '额外预判你的下一手回应'),
    )

    const settingsNote = document.createElement('p')
    settingsNote.id = 'settings-ai-note'
    settingsNote.className = 'settings-note'
    settingsNote.textContent = '首版人机模式固定玩家执红、AI 执黑。'
    const settingsFooter = document.createElement('div')
    settingsFooter.className = 'settings-actions'
    const settingsCancelButton = makeButton(
      'settings-cancel-btn',
      '取消',
      actions.onToggleMatchSettings,
    )
    const settingsApplyButton = makeButton(
      'settings-apply-btn',
      '应用并重开',
      () => actions.onApplyMatchConfig(this.readDraftMatchConfig()),
    )
    settingsApplyButton.classList.add('is-primary')
    settingsFooter.append(settingsCancelButton, settingsApplyButton)
    this.settingsDialog.append(
      settingsHeader,
      settingsIntro,
      modeFieldset,
      this.difficultyFieldset,
      settingsNote,
      settingsFooter,
    )
    this.modeLocalRadio.addEventListener('change', () =>
      this.syncDifficultyAvailability(),
    )
    this.modeAiRadio.addEventListener('change', () =>
      this.syncDifficultyAvailability(),
    )
    this.settingsDialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      actions.onToggleMatchSettings()
    })

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
      this.settingsDialog,
      this.historyPanel,
    )
    container.appendChild(root)
  }

  get isHistoryOpen(): boolean {
    return this.historyOpen
  }

  get isMatchSettingsOpen(): boolean {
    return this.settingsDialog.open
  }

  setMatchSettingsOpen(open: boolean, config: MatchConfig): void {
    if (open === this.settingsDialog.open) return
    this.gameModeButton.setAttribute('aria-expanded', String(open))
    if (open) {
      this.modeLocalRadio.checked = config.mode === 'local'
      this.modeAiRadio.checked = config.mode === 'ai'
      this.difficultyRadios[config.difficulty].checked = true
      this.syncDifficultyAvailability()
      this.settingsDialog.showModal()
      const selected = this.settingsDialog.querySelector<HTMLInputElement>(
        'input:checked',
      )
      selected?.focus({ preventScroll: true })
    } else {
      this.settingsDialog.close()
      this.gameModeButton.focus({ preventScroll: true })
    }
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
    const {
      animationBusy,
      replayPlaying,
      timeline,
      moveLog,
      matchConfig,
      ai,
    } = view
    const aiTurn = isAiTurn(matchConfig, state)
    const sideLabel = state.sideToMove === 'red' ? '红方' : '黑方'
    const sideColor = state.sideToMove === 'red' ? '#ff665c' : '#80bfff'
    this.turnLabelEl.textContent = timeline.isReviewing
      ? `回放 ${timeline.cursorPly} / ${timeline.livePly} · ${sideLabel}`
      : aiTurn
        ? `第 ${timeline.livePly + 1} 手 · 黑方 AI 行棋`
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
    this.gameStatusEl.classList.toggle('is-ai-thinking', ai.phase === 'thinking')
    if (animationBusy) {
      this.gameStatusEl.textContent =
        ai.phase === 'animating'
          ? 'AI 已落子 · 战斗演出中'
          : '战斗演出中 · 棋盘输入已锁定'
      this.gameStatusEl.style.color = '#ffcc80'
    } else if (replayPlaying) {
      this.gameStatusEl.textContent = `棋谱回放 · 第 ${timeline.cursorPly} / ${timeline.livePly} 手`
      this.gameStatusEl.style.color = '#ffe082'
    } else if (timeline.isReviewing) {
      this.gameStatusEl.textContent = `回放局面 · 第 ${timeline.cursorPly} / ${timeline.livePly} 手`
      this.gameStatusEl.style.color = '#b9dcff'
    } else if (ai.phase === 'error') {
      this.gameStatusEl.textContent = 'AI 暂时无法行动，请重开或切换模式'
      this.gameStatusEl.style.color = '#ff8a80'
    } else if (this.historyOpen && aiTurn && ai.phase === 'idle') {
      this.gameStatusEl.textContent = 'AI 已暂停 · 关闭棋谱后继续'
      this.gameStatusEl.style.color = '#b9dcff'
    } else if (ai.phase === 'thinking' || aiTurn) {
      this.gameStatusEl.textContent = `黑方 AI 正在思考 · ${aiDifficultyLabel(matchConfig.difficulty)}`
      this.gameStatusEl.style.color = '#ffe082'
    } else if (state.status === 'playing') {
      this.gameStatusEl.textContent = state.inCheck
        ? `${sideLabel}正在被将军，请应将`
        : matchConfig.mode === 'ai'
          ? '人机对弈 · 轮到你（红方）'
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
    } else if (ai.phase === 'error') {
      this.selectionEl.textContent = ai.error ?? 'AI Worker 运行失败'
    } else if (this.historyOpen && aiTurn && ai.phase === 'idle') {
      this.selectionEl.textContent = '正在查看棋谱；关闭棋谱后 AI 会重新思考'
    } else if (ai.phase === 'thinking' || aiTurn) {
      this.selectionEl.textContent = 'AI 执黑，思考期间可悔棋、重开或查看棋谱'
    } else if (state.status !== 'playing') {
      this.selectionEl.textContent = '对局结束，可悔棋或点击“重开”'
    } else if (selected) {
      const faction = selected.side === 'red' ? '红' : '黑'
      this.selectionEl.textContent = `已选 ${faction}${pieceLabel(selected.kind, selected.side)} · ${legalCount} 个合法落点`
    } else {
      this.selectionEl.textContent = '点选棋子，再点亮起的合法落点'
    }

    this.gameModeButton.textContent = `${matchModeLabel(matchConfig)} M`
    this.gameModeButton.disabled =
      animationBusy || replayPlaying || timeline.isReviewing || ai.phase === 'thinking'
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
    this.renderMoveLog(
      moveLog,
      timeline,
      animationBusy || replayPlaying || ai.phase === 'thinking',
      matchConfig,
    )
  }

  private renderMoveLog(
    entries: readonly MoveLogEntry[],
    timeline: TimelineSnapshot,
    navigationLocked: boolean,
    matchConfig: MatchConfig,
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
      const actor =
        matchConfig.mode === 'ai' && entry.side === 'black' ? 'AI · ' : ''
      rows.push(
        makeHistoryRow(
          entry.ply,
          `${entry.ply}. ${actor}${entry.text}`,
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

  private readDraftMatchConfig(): MatchConfig {
    const difficulty = (
      Object.entries(this.difficultyRadios) as Array<
        [MatchConfig['difficulty'], HTMLInputElement]
      >
    ).find(([, radio]) => radio.checked)?.[0]
    return {
      mode: this.modeAiRadio.checked ? 'ai' : 'local',
      difficulty: difficulty ?? 'normal',
    }
  }

  private syncDifficultyAvailability(): void {
    this.difficultyFieldset.disabled = !this.modeAiRadio.checked
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

function makeLegend(label: string): HTMLLegendElement {
  const legend = document.createElement('legend')
  legend.textContent = label
  return legend
}

function makeRadio(
  id: string,
  name: string,
  value: string,
): HTMLInputElement {
  const radio = document.createElement('input')
  radio.id = id
  radio.type = 'radio'
  radio.name = name
  radio.value = value
  return radio
}

function makeRadioCard(
  radio: HTMLInputElement,
  title: string,
  description: string,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'settings-option'
  label.htmlFor = radio.id
  const copy = document.createElement('span')
  copy.className = 'settings-option-copy'
  const titleEl = document.createElement('strong')
  titleEl.textContent = title
  const descriptionEl = document.createElement('small')
  descriptionEl.textContent = description
  copy.append(titleEl, descriptionEl)
  label.append(radio, copy)
  return label
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
