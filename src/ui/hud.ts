import { pieceLabel } from '../engine/board'
import type { AiRuntimeSnapshot } from '../game/aiCoordinator'
import type { MoveLogEntry } from '../game/controller'
import {
  isAiTurn,
  matchModeLabel,
  type MatchConfig,
} from '../game/match'
import type { TimelineSnapshot } from '../game/timeline'
import type {
  GameState,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import type { GamePrompt } from './gamePrompt'
import { resolveHudLayout } from './responsiveHud'
import './hud.css'

interface HudActions {
  onToggleMatchSettings: () => void
  onApplyMatchConfig: (config: MatchConfig) => void
  onToggleRuleHelp: () => void
  onRestart: () => void
  onToggleFullscreen: () => void
  onUndo: () => void
  onToggleHistory: () => void
  onToggleCinema: () => void
  onSeekReplay: (ply: number) => void
  onReplayFirst: () => void
  onReplayPrevious: () => void
  onToggleReplay: () => void
  onReplayNext: () => void
  onReturnToLive: () => void
}

interface HudViewState {
  animationBusy: boolean
  pendingCaptureId: string | null
  replayPlaying: boolean
  timeline: TimelineSnapshot
  moveLog: readonly MoveLogEntry[]
  matchConfig: MatchConfig
  ai: AiRuntimeSnapshot
  prompt: GamePrompt
}

interface SpoilsRowElements {
  root: HTMLDivElement
  list: HTMLDivElement
  count: HTMLSpanElement
}

export interface SpoilsBadgeViewModel {
  kind: PieceKind
  side: Side
  label: string
  count: number
  assetUrl: string
}

export interface SpoilsSideViewModel {
  captor: Side
  capturedSide: Side
  total: number
  badges: SpoilsBadgeViewModel[]
  accessibleLabel: string
}

export interface SpoilsViewModel {
  scoreLabel: string
  total: number
  red: SpoilsSideViewModel
  black: SpoilsSideViewModel
  signature: string
}

/** 左上局面、右上战果、底部操作、棋谱抽屉与终局提示。 */
export class Hud {
  private rootEl: HTMLDivElement
  private turnLabelEl: HTMLSpanElement
  private checkEl: HTMLSpanElement
  private spoilsEl: HTMLDivElement
  private spoilsScoreEl: HTMLSpanElement
  private spoilsTotalEl: HTMLSpanElement
  private spoilsLiveEl: HTMLSpanElement
  private spoilsRows: Record<Side, SpoilsRowElements>
  private spoilsSignature = ''
  private selectionEl: HTMLDivElement
  private gameStatusEl: HTMLDivElement
  private gameStatusVisibleEl: HTMLSpanElement
  private gameStatusCompactEl: HTMLSpanElement
  private gameStatusLiveEl: HTMLSpanElement
  private undoButton: HTMLButtonElement
  private gameModeButton: HTMLButtonElement
  private historyToggleButton: HTMLButtonElement
  private ruleHelpButton: HTMLButtonElement
  private fullscreenButton: HTMLButtonElement
  private settingsDialog: HTMLDialogElement
  private ruleHelpDialog: HTMLDialogElement
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
  private cinemaExitButton: HTMLButtonElement
  private historyOpen = false
  private cinemaMode = false
  private readonly actions: HudActions
  private readonly container: HTMLElement
  private readonly handleViewportResize = () => this.resize()

  constructor(container: HTMLElement, actions: HudActions) {
    this.container = container
    this.actions = actions
    const root = document.createElement('div')
    root.id = 'xiangqi-hud'
    this.rootEl = root

    const turnPanel = makePanel('turn-panel')
    this.turnLabelEl = document.createElement('span')
    this.checkEl = document.createElement('span')
    this.checkEl.id = 'check-indicator'
    this.checkEl.textContent = '将军'
    turnPanel.append(this.turnLabelEl, this.checkEl)

    this.spoilsEl = makePanel('spoils-panel')
    this.spoilsEl.setAttribute('role', 'region')
    this.spoilsEl.setAttribute('aria-labelledby', 'spoils-heading')
    const spoilsHeader = document.createElement('div')
    spoilsHeader.className = 'spoils-header'
    const spoilsTitleBlock = document.createElement('div')
    spoilsTitleBlock.className = 'spoils-title-block'
    const spoilsHeading = document.createElement('span')
    spoilsHeading.id = 'spoils-heading'
    spoilsHeading.className = 'spoils-caption'
    spoilsHeading.textContent = '战果 SPOILS'
    this.spoilsTotalEl = document.createElement('span')
    this.spoilsTotalEl.className = 'spoils-total'
    spoilsTitleBlock.append(spoilsHeading, this.spoilsTotalEl)
    this.spoilsScoreEl = document.createElement('span')
    this.spoilsScoreEl.className = 'spoils-score'
    spoilsHeader.append(spoilsTitleBlock, this.spoilsScoreEl)
    const redSpoils = makeSpoilsRow('red')
    const blackSpoils = makeSpoilsRow('black')
    this.spoilsRows = { red: redSpoils, black: blackSpoils }
    this.spoilsLiveEl = document.createElement('span')
    this.spoilsLiveEl.className = 'xq-sr-only'
    this.spoilsLiveEl.setAttribute('role', 'status')
    this.spoilsLiveEl.setAttribute('aria-live', 'polite')
    this.spoilsLiveEl.setAttribute('aria-atomic', 'true')
    this.spoilsEl.append(
      spoilsHeader,
      redSpoils.root,
      blackSpoils.root,
      this.spoilsLiveEl,
    )

    this.gameStatusEl = document.createElement('div')
    this.gameStatusEl.id = 'game-status'
    this.gameStatusVisibleEl = document.createElement('span')
    this.gameStatusVisibleEl.className = 'game-status-title'
    this.gameStatusVisibleEl.setAttribute('aria-hidden', 'true')
    this.gameStatusCompactEl = document.createElement('span')
    this.gameStatusCompactEl.className = 'game-status-compact'
    this.gameStatusCompactEl.setAttribute('aria-hidden', 'true')
    this.gameStatusLiveEl = document.createElement('span')
    this.gameStatusLiveEl.className = 'xq-sr-only'
    this.gameStatusLiveEl.setAttribute('role', 'status')
    this.gameStatusLiveEl.setAttribute('aria-live', 'polite')
    this.gameStatusLiveEl.setAttribute('aria-atomic', 'true')
    this.gameStatusEl.append(
      this.gameStatusVisibleEl,
      this.gameStatusCompactEl,
      this.gameStatusLiveEl,
    )

    const controls = document.createElement('div')
    controls.className = 'xq-controls'
    controls.setAttribute('role', 'toolbar')
    controls.setAttribute('aria-label', '棋局操作')

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
    this.gameModeButton.dataset.shortLabel = '模式'
    this.undoButton = makeButton('undo-btn', '悔棋 U', actions.onUndo)
    this.undoButton.dataset.shortLabel = '悔棋'
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
    this.historyToggleButton.dataset.shortLabel = '棋谱'
    this.ruleHelpButton = makeButton(
      'rule-help-btn',
      '规则 ?',
      actions.onToggleRuleHelp,
    )
    this.ruleHelpButton.setAttribute('aria-haspopup', 'dialog')
    this.ruleHelpButton.setAttribute('aria-controls', 'rule-help-dialog')
    this.ruleHelpButton.setAttribute('aria-expanded', 'false')
    this.ruleHelpButton.setAttribute('aria-keyshortcuts', '?')
    this.ruleHelpButton.dataset.shortLabel = '规则'
    const restartButton = makeButton('restart-btn', '重开 R', actions.onRestart)
    restartButton.dataset.shortLabel = '重开'
    this.fullscreenButton = makeButton(
      'fullscreen-btn',
      '全屏 F',
      actions.onToggleFullscreen,
    )
    this.fullscreenButton.setAttribute('aria-pressed', 'false')
    this.fullscreenButton.dataset.shortLabel = '全屏'
    controls.append(
      this.selectionEl,
      this.gameModeButton,
      this.undoButton,
      this.historyToggleButton,
      this.ruleHelpButton,
      restartButton,
      this.fullscreenButton,
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

    this.ruleHelpDialog = document.createElement('dialog')
    this.ruleHelpDialog.id = 'rule-help-dialog'
    this.ruleHelpDialog.setAttribute('aria-labelledby', 'rule-help-heading')
    this.ruleHelpDialog.setAttribute('aria-describedby', 'rule-help-summary')
    const ruleHelpHeader = document.createElement('div')
    ruleHelpHeader.className = 'settings-header'
    const ruleHelpHeading = document.createElement('h2')
    ruleHelpHeading.id = 'rule-help-heading'
    ruleHelpHeading.textContent = '本局规则与提示'
    const ruleHelpCloseButton = makeButton(
      'rule-help-close-btn',
      '关闭',
      actions.onToggleRuleHelp,
    )
    ruleHelpCloseButton.classList.add('settings-close')
    ruleHelpHeader.append(ruleHelpHeading, ruleHelpCloseButton)

    const ruleHelpContent = document.createElement('div')
    ruleHelpContent.className = 'rule-help-content'
    const ruleHelpSummary = document.createElement('p')
    ruleHelpSummary.id = 'rule-help-summary'
    ruleHelpSummary.textContent =
      '本作采用适合网页自动裁决的程序棋规；复杂循环按确定性等级处理，与需要裁判介入的线下竞赛细则可能存在差异。'
    ruleHelpContent.append(
      ruleHelpSummary,
      makeRuleSection('基础胜负', [
        '红方先行；走棋后不能让己方帅／将受将，也不能造成将帅照面。',
        '将死判负；未被将军但无任何合法着法时，困毙同样判负。',
        '盘面只剩帅／将、仕／士、相／象时，自动判和。',
      ]),
      makeRuleSection('循环与限着', [
        '同色同类棋子布局且同一方行棋第三次出现时，立即进行循环裁决。',
        '循环内先给每一着定性：将、杀、捉、闲。着着有威胁即为违规，哪怕手段混合（如一将一捉）；只要出现一步闲着，该方整体算允许循环。',
        '被将后的应将是被迫的，不判为捉。',
        '违规等级为：长将 3、长杀 2、长捉 1、允许循环 0；等级较高的一方判负，等级相同判和。',
        '自然限着为 120 个有效未吃子着；双方各自仅前 10 次将军计数，超额将军及直接应将不计。',
        '裁决优先级：将死／困毙、循环、自然限着、仅剩将士象。',
      ]),
      makeRuleSection('界面提示', [
        '点错棋子或落点时会说明具体原因；被将军时必须先应将。',
        '第二次形成同一局面会提醒双方避免重复；第三次同形立即裁决。',
        '棋谱回放只读；返回当前局面后才能继续对局。',
      ]),
    )
    this.ruleHelpDialog.append(ruleHelpHeader, ruleHelpContent)
    this.ruleHelpDialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      actions.onToggleRuleHelp()
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

    const topRegion = document.createElement('div')
    topRegion.className = 'xq-top-region'
    topRegion.append(turnPanel, this.spoilsEl, this.gameStatusEl)

    this.cinemaExitButton = makeButton('cinema-exit-btn', '退出录制 C', () =>
      actions.onToggleCinema(),
    )
    this.cinemaExitButton.dataset.shortLabel = '退出'
    this.cinemaExitButton.setAttribute('aria-keyshortcuts', 'C')
    this.cinemaExitButton.hidden = true

    root.dataset.cinema = 'false'
    root.append(
      topRegion,
      controls,
      this.cinemaExitButton,
      this.settingsDialog,
      this.ruleHelpDialog,
      this.historyPanel,
    )
    container.appendChild(root)

    this.resize()
    window.addEventListener('resize', this.handleViewportResize, {
      passive: true,
    })
  }

  /** BFCache、动态 viewport 与全屏切换后重算 HUD 预留和触控尺寸。 */
  resize(): void {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    const profile = resolveHudLayout(width, height)
    this.rootEl.dataset.layout = profile.mode
    this.rootEl.dataset.orientation = profile.orientation
    this.rootEl.style.setProperty(
      '--xq-hud-top-reserved',
      `${profile.topReservedPx}px`,
    )
    this.rootEl.style.setProperty(
      '--xq-hud-bottom-reserved',
      `${profile.bottomReservedPx}px`,
    )
    this.rootEl.style.setProperty(
      '--xq-hud-left-reserved',
      `${profile.leftReservedPx}px`,
    )
    this.rootEl.style.setProperty(
      '--xq-hud-right-reserved',
      `${profile.rightReservedPx}px`,
    )
    this.rootEl.style.setProperty(
      '--xq-touch-target',
      `${profile.minimumTouchTargetPx}px`,
    )
  }

  get isCinemaMode(): boolean {
    return this.cinemaMode
  }

  /**
   * 录制模式：收起全部面板，只留一个恢复入口。
   * 恢复按钮必须留着——不能让用户只能靠猜快捷键退出。
   */
  setCinemaMode(active: boolean): void {
    if (this.cinemaMode === active) return
    this.cinemaMode = active
    this.rootEl.dataset.cinema = String(active)
    this.cinemaExitButton.hidden = !active
    if (active) this.setHistoryOpen(false)
  }

  setFullscreenState(active: boolean): void {
    this.fullscreenButton.textContent = active ? '退出全屏 F' : '全屏 F'
    this.fullscreenButton.dataset.shortLabel = active ? '退出' : '全屏'
    this.fullscreenButton.setAttribute('aria-pressed', String(active))
  }

  get isHistoryOpen(): boolean {
    return this.historyOpen
  }

  get isMatchSettingsOpen(): boolean {
    return this.settingsDialog.open
  }

  get isRuleHelpOpen(): boolean {
    return this.ruleHelpDialog.open
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

  setRuleHelpOpen(open: boolean): void {
    if (open === this.ruleHelpDialog.open) return
    this.ruleHelpButton.setAttribute('aria-expanded', String(open))
    if (open) {
      this.ruleHelpDialog.showModal()
      this.ruleHelpDialog
        .querySelector<HTMLButtonElement>('#rule-help-close-btn')
        ?.focus({ preventScroll: true })
    } else {
      this.ruleHelpDialog.close()
      this.ruleHelpButton.focus({ preventScroll: true })
    }
  }

  setHistoryOpen(open: boolean): void {
    const panelHadFocus = this.historyPanel.contains(document.activeElement)
    this.historyOpen = open
    this.historyPanel.hidden = !open
    this.historyToggleButton.setAttribute('aria-expanded', String(open))
    this.historyToggleButton.textContent = open ? '收起 H' : '棋谱 H'
    this.historyToggleButton.dataset.shortLabel = open ? '收起' : '棋谱'
    if (open) {
      this.historyPanel.focus({ preventScroll: true })
    } else if (panelHadFocus) {
      this.historyToggleButton.focus({ preventScroll: true })
    }
  }

  update(
    state: GameState,
    _selected: Piece | undefined,
    _legalCount: number,
    view: HudViewState,
  ): void {
    const {
      animationBusy,
      pendingCaptureId,
      replayPlaying,
      timeline,
      moveLog,
      matchConfig,
      ai,
      prompt,
    } = view
    const aiTurn = isAiTurn(matchConfig, state)
    const sideLabel = state.sideToMove === 'red' ? '红方' : '黑方'
    const sideColor = state.sideToMove === 'red' ? '#ff665c' : '#80bfff'
    this.turnLabelEl.textContent = timeline.isReviewing
      ? `回放 ${timeline.cursorPly} / ${timeline.livePly} · ${sideLabel}`
      : state.status !== 'playing'
        ? `第 ${timeline.livePly} 手 · 对局结束`
        : aiTurn
          ? `第 ${timeline.livePly + 1} 手 · 黑方 AI 行棋`
          : `第 ${timeline.livePly + 1} 手 · ${sideLabel}行棋`
    this.turnLabelEl.style.color = sideColor
    this.turnLabelEl.style.fontWeight = '700'
    this.checkEl.textContent = `${sideLabel}被将`
    this.checkEl.style.display = state.inCheck ? 'inline-block' : 'none'

    this.renderSpoils(state, pendingCaptureId)

    this.gameStatusEl.dataset.tone = prompt.tone
    this.gameStatusEl.dataset.promptCode = prompt.code
    this.gameStatusEl.classList.toggle('is-ai-thinking', prompt.code === 'ai-thinking')
    if (this.gameStatusVisibleEl.textContent !== prompt.title) {
      this.gameStatusVisibleEl.textContent = prompt.title
    }
    const compactPromptLabel = createCompactPromptLabel(prompt)
    if (this.gameStatusCompactEl.textContent !== compactPromptLabel) {
      this.gameStatusCompactEl.textContent = compactPromptLabel
    }
    const promptDetails = [
      prompt.detail,
      prompt.action,
      prompt.secondary,
    ]
      .filter(Boolean)
      .join(' · ')
    const accessiblePrompt = [prompt.title, promptDetails]
      .filter(Boolean)
      .join('。')
    if (this.gameStatusLiveEl.textContent !== accessiblePrompt) {
      this.gameStatusLiveEl.textContent = accessiblePrompt
    }
    if (this.selectionEl.textContent !== promptDetails) {
      this.selectionEl.textContent = promptDetails
    }

    this.gameModeButton.textContent = `${matchModeLabel(matchConfig)} M`
    this.gameModeButton.disabled =
      animationBusy || replayPlaying || timeline.isReviewing || ai.phase === 'thinking'
    this.ruleHelpButton.disabled = this.gameModeButton.disabled
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

  private renderSpoils(
    state: GameState,
    pendingCaptureId: string | null,
  ): void {
    const view = createSpoilsViewModel(state, pendingCaptureId)
    if (view.signature === this.spoilsSignature) return
    this.spoilsSignature = view.signature

    this.spoilsEl.dataset.capturedTotal = String(view.total)
    this.spoilsEl.dataset.redSpoils = String(view.red.total)
    this.spoilsEl.dataset.blackSpoils = String(view.black.total)
    this.spoilsScoreEl.textContent = view.scoreLabel
    this.spoilsTotalEl.textContent = `共 ${view.total} 子`

    for (const side of ['red', 'black'] as const) {
      const group = view[side]
      const row = this.spoilsRows[side]
      row.count.textContent = `${group.total} 子`
      row.list.setAttribute('aria-label', group.accessibleLabel)
      row.list.replaceChildren(
        ...(group.badges.length > 0
          ? group.badges.map(makeSpoilsBadge)
          : [makeEmptySpoilsItem()]),
      )
    }

    this.spoilsLiveEl.textContent = [
      '战果更新',
      view.scoreLabel,
      view.red.accessibleLabel,
      view.black.accessibleLabel,
    ].join('。')
  }
}

function makePanel(id: string): HTMLDivElement {
  const panel = document.createElement('div')
  panel.id = id
  panel.className = 'xq-panel'
  return panel
}

function makeSpoilsRow(side: Side): SpoilsRowElements {
  const root = document.createElement('div')
  root.className = 'spoils-row'
  root.dataset.side = side

  const heading = document.createElement('div')
  heading.className = 'spoils-side-heading'
  const label = document.createElement('span')
  label.id = `spoils-${side}-label`
  label.className = 'spoils-side-label'
  label.textContent = side === 'red' ? '红方已吃' : '黑方已吃'
  const count = document.createElement('span')
  count.className = 'spoils-side-count'
  heading.append(label, count)

  const list = document.createElement('div')
  list.className = 'spoils-badges'
  list.setAttribute('role', 'list')
  root.append(heading, list)
  return { root, list, count }
}

function makeSpoilsBadge(view: SpoilsBadgeViewModel): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = 'spoils-badge'
  badge.dataset.side = view.side
  badge.dataset.kind = view.kind
  badge.setAttribute('role', 'listitem')
  badge.setAttribute('aria-label', `${view.label} ${view.count} 枚`)

  const image = document.createElement('img')
  image.className = 'spoils-badge-image'
  image.src = view.assetUrl
  image.alt = ''
  image.draggable = false
  image.decoding = 'async'
  image.setAttribute('aria-hidden', 'true')

  const glyph = document.createElement('span')
  glyph.className = 'spoils-badge-fallback'
  glyph.textContent = view.label
  glyph.setAttribute('aria-hidden', 'true')
  image.addEventListener(
    'error',
    () => {
      image.hidden = true
      badge.classList.add('is-missing')
    },
    { once: true },
  )

  const count = document.createElement('span')
  count.className = 'spoils-badge-count'
  count.textContent = `×${view.count}`
  count.setAttribute('aria-hidden', 'true')
  badge.append(image, glyph, count)
  return badge
}

function makeEmptySpoilsItem(): HTMLSpanElement {
  const empty = document.createElement('span')
  empty.className = 'spoils-empty'
  empty.setAttribute('role', 'listitem')
  empty.textContent = '暂无'
  return empty
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

function makeRuleSection(title: string, items: string[]): HTMLElement {
  const section = document.createElement('section')
  const heading = document.createElement('h3')
  heading.textContent = title
  const list = document.createElement('ul')
  for (const item of items) {
    const row = document.createElement('li')
    row.textContent = item
    list.appendChild(row)
  }
  section.append(heading, list)
  return section
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

const SPOILS_KIND_ORDER: readonly PieceKind[] = [
  'chariot',
  'horse',
  'cannon',
  'elephant',
  'advisor',
  'pawn',
  'king',
]

/**
 * 将权威局面的 captured 标记投影成纯展示模型。
 * `red` 表示红方所得战果，因此其中展示的是被吃掉的黑方棋子。
 */
export function createSpoilsViewModel(
  state: Pick<GameState, 'pieces'>,
  pendingCaptureId: string | null = null,
): SpoilsViewModel {
  const buildSide = (captor: Side): SpoilsSideViewModel => {
    const capturedSide: Side = captor === 'red' ? 'black' : 'red'
    const captured = state.pieces.filter(
      (piece) =>
        piece.captured &&
        piece.id !== pendingCaptureId &&
        piece.side === capturedSide,
    )
    const badges = SPOILS_KIND_ORDER.flatMap((kind) => {
      const count = captured.filter((piece) => piece.kind === kind).length
      if (count === 0) return []
      const label = pieceLabel(kind, capturedSide)
      return [
        {
          kind,
          side: capturedSide,
          label,
          count,
          assetUrl: `/assets/badges/badge_${capturedSide}_${label}.png`,
        },
      ]
    })
    const detail =
      badges.length > 0
        ? badges.map((badge) => `${badge.label} ${badge.count}`).join('、')
        : '暂无'
    const captorLabel = captor === 'red' ? '红方' : '黑方'
    const capturedSideLabel = capturedSide === 'red' ? '红方' : '黑方'
    return {
      captor,
      capturedSide,
      total: captured.length,
      badges,
      accessibleLabel: `${captorLabel}已吃${capturedSideLabel} ${captured.length} 子：${detail}`,
    }
  }

  const red = buildSide('red')
  const black = buildSide('black')
  const scoreLabel = formatSpoils(state, pendingCaptureId)
  const signature = [
    scoreLabel,
    ...red.badges.map((badge) => `r:${badge.kind}:${badge.count}`),
    ...black.badges.map((badge) => `b:${badge.kind}:${badge.count}`),
  ].join('|')
  return {
    scoreLabel,
    total: red.total + black.total,
    red,
    black,
    signature,
  }
}

function formatSpoils(
  state: Pick<GameState, 'pieces'>,
  pendingCaptureId: string | null,
): string {
  const score = (side: Side) =>
    state.pieces
      .filter(
        (piece) =>
          piece.side === side &&
          (!piece.captured || piece.id === pendingCaptureId),
      )
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

/** 手机竖屏只容纳一行提示；异常信息保持权威标题，不截断成含糊短句。 */
export function createCompactPromptLabel(prompt: GamePrompt): string {
  if (prompt.code === 'turn-local' || prompt.code === 'turn-human') {
    return '点按走棋 · 拖动旋转视角'
  }
  if (prompt.code === 'piece-selected') {
    const followUp = prompt.detail?.includes('没有合法落点')
      ? prompt.action
      : prompt.detail
    return [prompt.title, followUp].filter(Boolean).join(' · ')
  }
  return prompt.title
}
