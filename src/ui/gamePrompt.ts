import { pieceLabel } from '../engine/board'
import type {
  CycleAction,
  CycleBehavior,
  GameOutcome,
  GameState,
  Piece,
  Side,
} from '../types/xiangqi'

export const NATURAL_LIMIT_PLIES = 120
export const NATURAL_LIMIT_PROGRESS_PLIES = 100
export const NATURAL_LIMIT_WARNING_PLIES = 110

export type GamePromptTone = 'info' | 'warning' | 'danger' | 'success'

export type GamePromptCode =
  | InteractionFeedbackReason
  | 'animation'
  | 'ai-animation'
  | 'result-checkmate'
  | 'result-stalemate'
  | 'result-repetition-draw'
  | 'result-perpetual-check'
  | 'result-perpetual-mate'
  | 'result-perpetual-chase'
  | 'result-no-capture-limit'
  | 'result-bare-defenders'
  | 'result-draw'
  | 'result-adjudicated'
  | 'replay-playing'
  | 'replay-view'
  | 'match-settings'
  | 'rule-help'
  | 'ai-error'
  | 'must-answer-check'
  | 'repetition-warning'
  | 'natural-limit-progress'
  | 'natural-limit-warning'
  | 'ai-paused-history'
  | 'ai-thinking'
  | 'ai-turn'
  | 'piece-selected'
  | 'turn-human'
  | 'turn-local'

export interface GamePrompt {
  code: GamePromptCode
  tone: GamePromptTone
  title: string
  detail?: string
  action?: string
  secondary?: string
}

export type InteractionFeedbackReason =
  | 'wrong-side'
  | 'no-selection'
  | 'friendly-occupied'
  | 'outside-board'
  | 'fullscreen-unavailable'
  | 'fullscreen-failed'
  | 'illegal-pattern'
  | 'path-blocked'
  | 'horse-leg-blocked'
  | 'elephant-eye-blocked'
  | 'elephant-cross-river'
  | 'palace-bound'
  | 'cannon-screen'
  | 'pawn-direction'
  | 'must-answer-check'
  | 'exposes-own-king'
  | 'kings-facing'
  | 'terminal'
  | 'locked-animation'
  | 'locked-ai'
  | 'locked-replay'
  | 'locked-settings'

export interface InteractionFeedback {
  reason: InteractionFeedbackReason
  /** 违规或需要变着的一方；省略时使用当前行棋方。 */
  side?: Side
  /** 非法着所涉及的棋子；省略时使用当前选择。 */
  piece?: Pick<Piece, 'kind' | 'side'>
}

/** 公开别名让提示调用方无需重复声明局面类型。 */
export type PromptGameState = GameState

export interface GamePromptContext {
  state: PromptGameState
  selected?: Pick<Piece, 'kind' | 'side'> | null
  legalCount?: number
  animationBusy?: boolean
  replayPlaying?: boolean
  timeline?: {
    isReviewing: boolean
    cursorPly: number
    livePly: number
  }
  matchMode?: 'local' | 'ai'
  aiTurn?: boolean
  historyOpen?: boolean
  ai?: {
    phase: 'idle' | 'thinking' | 'animating' | 'error'
    error?: string | null
  }
  activeDialog?: 'match-settings' | 'rule-help' | null
  interaction?: InteractionFeedback | null
}

/**
 * 将规则事实和运行状态转换成唯一一份玩家提示。
 * HUD 与 render_game_to_text 应共同使用本函数，避免文案和状态漂移。
 */
export function deriveGamePrompt(context: GamePromptContext): GamePrompt {
  const interaction = context.interaction
  if (interaction) return interactionPrompt(context, interaction)

  const ruleNotices = getRuleNotices(context.state)
  const ruleSecondary = ruleNotices.map((notice) => notice.detail).join(' · ')

  if (context.animationBusy) {
    return {
      code: context.ai?.phase === 'animating' ? 'ai-animation' : 'animation',
      tone: 'warning',
      title:
        context.ai?.phase === 'animating'
          ? 'AI 已落子 · 战斗演出中'
          : '战斗演出中',
      detail: '棋盘输入已锁定',
    }
  }

  if (context.activeDialog === 'match-settings') {
    return {
      code: 'match-settings',
      tone: 'info',
      title: '对局设置已打开',
      detail: '棋盘输入已暂停',
      action: '应用并重开，或关闭设置返回对局',
    }
  }

  if (context.activeDialog === 'rule-help') {
    return {
      code: 'rule-help',
      tone: 'info',
      title: '规则说明已打开',
      detail: '棋盘输入已暂停',
      action: '阅读后关闭说明即可返回对局',
    }
  }

  const outcomePrompt = resolveOutcomePrompt(context.state)
  if (outcomePrompt) return outcomePrompt

  if (context.replayPlaying) {
    return {
      code: 'replay-playing',
      tone: 'info',
      title: `棋谱回放 · 第 ${context.timeline?.cursorPly ?? 0} / ${context.timeline?.livePly ?? 0} 手`,
      detail: '回放期间棋盘只读',
      action: '暂停或返回当前局面后才能行棋',
    }
  }

  if (context.timeline?.isReviewing) {
    return {
      code: 'replay-view',
      tone: 'info',
      title: `回放局面 · 第 ${context.timeline.cursorPly} / ${context.timeline.livePly} 手`,
      detail: '棋谱回放为只读',
      action: '返回当前局面后才能行棋',
    }
  }

  if (context.ai?.phase === 'error') {
    return {
      code: 'ai-error',
      tone: 'danger',
      title: 'AI 未能完成落子',
      detail: '黑方 AI 暂时无法行动',
      action: '可悔棋后重试、重开或切换本地双人',
      ...(context.ai.error ? { secondary: context.ai.error } : {}),
    }
  }

  if (context.state.inCheck) {
    if (context.aiTurn) {
      return {
        code: 'must-answer-check',
        tone: 'danger',
        title: '黑方 AI 正在应将',
        detail: 'AI 只能选择能够解除将军的着法',
        ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
      }
    }

    const side = sideName(context.state.sideToMove)
    const selectionDetail = context.selected
      ? `已选${pieceName(context.selected)} · ${context.legalCount ?? 0} 个应将落点`
      : '只能走能够解除将军的着法'
    return {
      code: 'must-answer-check',
      tone: 'danger',
      title: `${side}被将军`,
      detail: selectionDetail,
      action: '请选择高亮落点应将',
      ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
    }
  }

  if (context.historyOpen && context.aiTurn && context.ai?.phase === 'idle') {
    return {
      code: 'ai-paused-history',
      tone: 'info',
      title: 'AI 已暂停',
      detail: '正在查看棋谱',
      action: '关闭棋谱后 AI 会继续思考',
      ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
    }
  }

  if (context.ai?.phase === 'thinking') {
    return {
      code: 'ai-thinking',
      tone: 'info',
      title: '黑方 AI 正在思考',
      action: '思考期间可悔棋、重开或查看棋谱',
      ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
    }
  }

  if (context.aiTurn) {
    return {
      code: 'ai-turn',
      tone: 'info',
      title: '轮到黑方 AI',
      detail: '请稍候',
      action: '可悔棋、重开或查看棋谱',
      ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
    }
  }

  if (context.selected) {
    const legalCount = context.legalCount ?? 0
    const hasRuleWarning = ruleNotices.some(
      (notice) => notice.tone === 'warning',
    )
    return {
      code: 'piece-selected',
      tone: legalCount > 0 && !hasRuleWarning ? 'info' : 'warning',
      title: `已选${pieceName(context.selected)}`,
      detail:
        legalCount > 0 ? `${legalCount} 个合法落点` : '当前没有合法落点',
      action: legalCount > 0 ? '点击亮起的落点行棋' : '请选择其他棋子',
      ...(ruleSecondary ? { secondary: ruleSecondary } : {}),
    }
  }

  const primaryRuleNotice = ruleNotices[0]
  if (primaryRuleNotice) {
    return {
      ...primaryRuleNotice,
      ...(ruleNotices[1] ? { secondary: ruleNotices[1].detail } : {}),
    }
  }

  if (context.matchMode === 'ai') {
    return {
      code: 'turn-human',
      tone: 'info',
      title: '轮到你（红方）',
      detail: '点选棋子，再点亮起的合法落点',
    }
  }

  return {
    code: 'turn-local',
    tone: 'info',
    title: `${sideName(context.state.sideToMove)}行棋`,
    detail: '点选棋子，再点亮起的合法落点',
  }
}

function resolveOutcomePrompt(state: PromptGameState): GamePrompt | null {
  const outcome = state.outcome
  if (outcome) {
    const winner = outcome.winner ? sideName(outcome.winner) : null
    const offender = outcome.offender ? sideName(outcome.offender) : null
    const loser = outcome.winner ? sideName(oppositeSide(outcome.winner)) : null
    switch (outcome.reason) {
      case 'checkmate':
        return {
          code: 'result-checkmate',
          tone: 'success',
          title: `${winner ?? '胜方'}胜 · 将死`,
          detail: `${loser ?? '败方'}无法应将`,
          action: '可悔棋或重开新局',
        }
      case 'stalemate':
        return {
          code: 'result-stalemate',
          tone: 'success',
          title: `${winner ?? '胜方'}胜 · 困毙`,
          detail: `${loser ?? '败方'}无合法着`,
          action: '可悔棋或重开新局',
        }
      case 'repetition-draw':
        return {
          code: 'result-repetition-draw',
          tone: 'info',
          title: '和棋 · 循环局面',
          detail: repetitionDrawDetail(outcome),
          action: '可悔棋或重开新局',
        }
      case 'perpetual-check':
        return violationPrompt(
          'result-perpetual-check',
          'long-check',
          outcome,
          winner,
          offender,
        )
      case 'perpetual-mate':
        return violationPrompt(
          'result-perpetual-mate',
          'long-mate',
          outcome,
          winner,
          offender,
        )
      case 'perpetual-chase':
        return violationPrompt(
          'result-perpetual-chase',
          'long-chase',
          outcome,
          winner,
          offender,
        )
      case 'no-capture-limit':
        return {
          code: 'result-no-capture-limit',
          tone: 'info',
          title: '和棋 · 自然限着',
          detail: '达到 120 个有效未吃子着（60 回合）',
          action: '可悔棋或重开新局',
        }
      case 'bare-defenders':
        return {
          code: 'result-bare-defenders',
          tone: 'info',
          title: '和棋 · 死局',
          detail: '双方均无足够进攻子力取胜',
          action: '可悔棋或重开新局',
        }
    }
  }

  if (state.status === 'checkmate' || state.status === 'stalemate') {
    const reason = state.status === 'checkmate' ? '将死' : '困毙'
    const code =
      state.status === 'checkmate'
        ? 'result-checkmate'
        : 'result-stalemate'
    const winner = state.winner ? sideName(state.winner) : '胜方'
    const loser = state.winner ? sideName(oppositeSide(state.winner)) : '败方'
    return {
      code,
      tone: 'success',
      title: `${winner}胜 · ${reason}`,
      detail:
        state.status === 'checkmate' ? `${loser}无法应将` : `${loser}无合法着`,
      action: '可悔棋或重开新局',
    }
  }

  if (state.status === 'draw') {
    return {
      code: 'result-draw',
      tone: 'info',
      title: '和棋',
      detail: '对局已由规则引擎裁定结束',
      action: '可悔棋或重开新局',
    }
  }

  if (state.status === 'adjudicated') {
    return {
      code: 'result-adjudicated',
      tone: 'success',
      title: `${state.winner ? sideName(state.winner) : '胜方'}胜 · 规则裁定`,
      detail: '对局已结束',
      action: '可悔棋或重开新局',
    }
  }

  return null
}

function repetitionDrawDetail(outcome: GameOutcome): string {
  const cycle = outcome.cycle
  if (!cycle) return '三次同形，双方循环等级相同'
  if (cycle.red === 'allowed' && cycle.black === 'allowed') {
    return '三次同形，双方均属允许循环'
  }
  if (cycle.red === cycle.black) {
    return `三次同形，双方均为${cycleBehaviorName(cycle.red)}，等级相同`
  }
  return '三次同形，双方循环等级相同'
}

function cycleBehaviorName(behavior: CycleBehavior): string {
  switch (behavior) {
    case 'long-check':
      return '长将'
    case 'long-mate':
      return '长杀'
    case 'long-chase':
      return '长捉'
    case 'allowed':
      return '允许循环'
  }
}

const CYCLE_ACTION_NAMES: Record<CycleAction, string> = {
  check: '将',
  mate: '杀',
  chase: '捉',
  idle: '闲',
}

/**
 * 违规方的手段名称。
 *
 * 着着有威胁但手段混合时（一将一捉、一杀一捉），归档等级取最重威胁，
 * 但**文案不能直接叫「长将」**——那会让玩家对着棋谱找不到连续将军。
 * 因此混合时按实际出现过的手段拼出「一将一捉」这类说法。
 */
function violationName(
  behavior: CycleBehavior,
  actions: CycleAction[] | undefined,
): string {
  const kinds = new Set(actions ?? [])
  kinds.delete('idle')
  if (kinds.size <= 1) return cycleBehaviorName(behavior)
  const ordered: CycleAction[] = ['check', 'mate', 'chase']
  return ordered
    .filter((action) => kinds.has(action))
    .map((action) => `一${CYCLE_ACTION_NAMES[action]}`)
    .join('')
}

function violationPrompt(
  code:
    | 'result-perpetual-check'
    | 'result-perpetual-mate'
    | 'result-perpetual-chase',
  /** 缺少 cycle 明细时的兜底名称，直接来自终局原因，不做猜测。 */
  fallbackBehavior: CycleBehavior,
  outcome: GameOutcome,
  winner: string | null,
  offender: string | null,
): GamePrompt {
  const onRed = outcome.offender === 'red'
  const behavior = (onRed ? outcome.cycle?.red : outcome.cycle?.black) ??
    fallbackBehavior
  const actions = onRed
    ? outcome.cycle?.actions.red
    : outcome.cycle?.actions.black
  const violation = violationName(behavior, actions)
  return {
    code,
    tone: 'success',
    title: `${winner ?? '胜方'}胜 · ${violation}违规`,
    detail: `${offender ?? '违规方'}连续${violation}未变着，判负`,
    action: '可悔棋或重开新局',
  }
}

function interactionPrompt(
  context: GamePromptContext,
  feedback: InteractionFeedback,
): GamePrompt {
  const selected = feedback.piece ?? context.selected
  const selectedName = selected ? pieceName(selected) : '该棋子'
  const side = sideName(feedback.side ?? context.state.sideToMove)

  switch (feedback.reason) {
    case 'wrong-side':
      return warning(feedback.reason, `现在轮到${side}`, `请选择${side}棋子`)
    case 'no-selection':
      return warning(feedback.reason, '请先选择一枚己方棋子')
    case 'friendly-occupied':
      return warning(feedback.reason, '落点已有己方棋子', '请改选或另选落点')
    case 'outside-board':
      return warning(feedback.reason, '落点超出棋盘')
    case 'fullscreen-unavailable':
      return warning(
        feedback.reason,
        '当前浏览器不支持应用内全屏',
        '可使用浏览器自带的全屏或添加到主屏幕',
      )
    case 'fullscreen-failed':
      return warning(
        feedback.reason,
        '未能切换全屏',
        '请允许全屏权限，或使用浏览器自带的全屏',
      )
    case 'illegal-pattern':
      return warning(feedback.reason, `${selectedName}不能这样走`)
    case 'path-blocked':
      return warning(feedback.reason, '行棋路线被棋子阻挡')
    case 'horse-leg-blocked':
      return warning(feedback.reason, '马腿被别住', '不能落到这里')
    case 'elephant-eye-blocked':
      return warning(feedback.reason, '象眼被塞住', '不能落到这里')
    case 'elephant-cross-river':
      return warning(feedback.reason, '相／象不能过河')
    case 'palace-bound':
      return warning(feedback.reason, '帅、将、仕、士不能离开九宫')
    case 'cannon-screen':
      return warning(feedback.reason, '炮架不符合规则', '炮吃子必须隔且只能隔一个炮架')
    case 'pawn-direction':
      return warning(feedback.reason, '兵／卒不能这样走', '不能后退，未过河不能横走')
    case 'must-answer-check':
      return danger(feedback.reason, '这步没有解除将军', '请先应将')
    case 'exposes-own-king':
      return danger(feedback.reason, '这步会使己方帅／将受将')
    case 'kings-facing':
      return danger(feedback.reason, '这步会造成将帅照面')
    case 'terminal':
      return info(feedback.reason, '对局已经结束', '可悔棋或重开新局')
    case 'locked-animation':
      return info(feedback.reason, '走子演出进行中', '请稍候')
    case 'locked-ai':
      return info(feedback.reason, '轮到黑方 AI', '请稍候')
    case 'locked-replay':
      return info(feedback.reason, '棋谱回放为只读', '返回当前局面后才能行棋')
    case 'locked-settings':
      return info(feedback.reason, '请先完成或关闭对局设置')
  }
}

function getRuleNotices(state: PromptGameState): GamePrompt[] {
  if (state.status !== 'playing') return []
  const notices: GamePrompt[] = []
  if (state.ruleState?.currentPositionOccurrences === 2) {
    notices.push({
      code: 'repetition-warning',
      tone: 'warning',
      title: '循环警告',
      detail: '局面已第二次出现；再次重复将触发循环裁决',
      action: '请考虑变着',
    })
  }

  const countedPlies = state.ruleState?.naturalLimit.countedPlies ?? 0
  if (countedPlies >= NATURAL_LIMIT_PROGRESS_PLIES) {
    const remaining = Math.max(0, NATURAL_LIMIT_PLIES - countedPlies)
    const nearLimit = countedPlies >= NATURAL_LIMIT_WARNING_PLIES
    notices.push({
      code: nearLimit ? 'natural-limit-warning' : 'natural-limit-progress',
      tone: nearLimit ? 'warning' : 'info',
      title: nearLimit ? '自然限着警告' : '自然限着进度',
      detail: nearLimit
        ? `还剩 ${remaining} 个有效未吃子着；若仍未吃子，将判和`
        : `已累计 ${countedPlies} / ${NATURAL_LIMIT_PLIES} 个有效未吃子着`,
      action: '完成吃子后计数将归零',
    })
  }
  return notices
}

function warning(
  code: InteractionFeedbackReason,
  title: string,
  detail?: string,
): GamePrompt {
  return { code, tone: 'warning', title, ...(detail ? { detail } : {}) }
}

function danger(
  code: InteractionFeedbackReason,
  title: string,
  detail?: string,
): GamePrompt {
  return { code, tone: 'danger', title, ...(detail ? { detail } : {}) }
}

function info(
  code: InteractionFeedbackReason,
  title: string,
  detail?: string,
): GamePrompt {
  return { code, tone: 'info', title, ...(detail ? { detail } : {}) }
}

function pieceName(piece: Pick<Piece, 'kind' | 'side'>): string {
  return `${piece.side === 'red' ? '红' : '黑'}${pieceLabel(piece.kind, piece.side)}`
}

function sideName(side: Side): string {
  return side === 'red' ? '红方' : '黑方'
}

function oppositeSide(side: Side): Side {
  return side === 'red' ? 'black' : 'red'
}
