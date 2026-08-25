import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/board'
import type { Piece, RuleState } from '../types/xiangqi'
import {
  deriveGamePrompt,
  type GamePromptContext,
  type InteractionFeedbackReason,
  type PromptGameState,
} from './gamePrompt'

const redHorse: Pick<Piece, 'kind' | 'side'> = {
  kind: 'horse',
  side: 'red',
}

function makeContext(
  overrides: Partial<GamePromptContext> = {},
): GamePromptContext {
  return {
    state: createInitialState(),
    legalCount: 0,
    animationBusy: false,
    replayPlaying: false,
    timeline: { isReviewing: false, cursorPly: 0, livePly: 0 },
    matchMode: 'local',
    aiTurn: false,
    historyOpen: false,
    ai: { phase: 'idle', error: null },
    ...overrides,
  }
}

function stateWith(
  overrides: Partial<PromptGameState>,
): PromptGameState {
  return { ...createInitialState(), ...overrides }
}

function ruleState(
  currentPositionOccurrences = 1,
  countedPlies = 0,
): RuleState {
  return {
    ruleset: 'program-competition-2023',
    frames: [],
    currentPositionOccurrences,
    naturalLimit: {
      countedPlies,
      checkCounts: { red: 0, black: 0 },
      skipNextReply: false,
    },
  }
}

describe('deriveGamePrompt', () => {
  it('兼容旧局面的将死与困毙结果', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          state: stateWith({ status: 'checkmate', winner: 'red' }),
        }),
      ),
    ).toMatchObject({
      code: 'result-checkmate',
      tone: 'success',
      title: '红方胜 · 将死',
      detail: '黑方无法应将',
    })

    expect(
      deriveGamePrompt(
        makeContext({
          state: stateWith({ status: 'stalemate', winner: 'black' }),
        }),
      ),
    ).toMatchObject({
      code: 'result-stalemate',
      title: '黑方胜 · 困毙',
      detail: '红方无合法着',
    })
  })

  it.each([
    ['repetition-draw', null, null, 'result-repetition-draw', '和棋 · 循环局面'],
    ['perpetual-check', 'red', 'black', 'result-perpetual-check', '红方胜 · 长将违规'],
    ['perpetual-chase', 'black', 'red', 'result-perpetual-chase', '黑方胜 · 长捉违规'],
    ['no-capture-limit', null, null, 'result-no-capture-limit', '和棋 · 自然限着'],
    ['bare-defenders', null, null, 'result-bare-defenders', '和棋 · 死局'],
  ] as const)(
    '将结构化终局 %s 转成明确裁决文案',
    (reason, winner, offender, code, title) => {
      const prompt = deriveGamePrompt(
        makeContext({
          state: stateWith({
            status: winner ? 'adjudicated' : 'draw',
            winner,
            outcome: { reason, winner, offender },
          }),
        }),
      )
      expect(prompt).toMatchObject({ code, title })
      expect(prompt.action).toBe('可悔棋或重开新局')
    },
  )

  it('长杀违规给出自己的文案，不混进长将', () => {
    const prompt = deriveGamePrompt(
      makeContext({
        state: stateWith({
          status: 'adjudicated',
          winner: 'black',
          outcome: {
            reason: 'perpetual-mate',
            winner: 'black',
            offender: 'red',
            cycle: {
              startPly: 0,
              endPly: 8,
              periodPlies: 4,
              red: 'long-mate',
              black: 'allowed',
              actions: {
                red: ['mate', 'mate', 'mate', 'mate'],
                black: ['idle', 'idle', 'idle', 'idle'],
              },
            },
          },
        }),
      }),
    )
    expect(prompt).toMatchObject({
      code: 'result-perpetual-mate',
      title: '黑方胜 · 长杀违规',
    })
  })

  it('手段混合时按实际着法命名，不谎称长将', () => {
    // 一将一捉的等级与长将同档，但玩家对着棋谱是找不到「连续将军」的。
    const prompt = deriveGamePrompt(
      makeContext({
        state: stateWith({
          status: 'adjudicated',
          winner: 'black',
          outcome: {
            reason: 'perpetual-check',
            winner: 'black',
            offender: 'red',
            cycle: {
              startPly: 0,
              endPly: 8,
              periodPlies: 4,
              red: 'long-check',
              black: 'allowed',
              actions: {
                red: ['check', 'chase', 'check', 'chase'],
                black: ['idle', 'idle', 'idle', 'idle'],
              },
            },
          },
        }),
      }),
    )
    expect(prompt.title).toBe('黑方胜 · 一将一捉违规')
    expect(prompt.detail).toBe('红方连续一将一捉未变着，判负')
  })

  it('循环和棋会区分双方允许循环与同级违规', () => {
    const allowed = deriveGamePrompt(
      makeContext({
        state: stateWith({
          status: 'draw',
          winner: null,
          outcome: {
            reason: 'repetition-draw',
            winner: null,
            offender: null,
            cycle: {
              startPly: 0,
              endPly: 8,
              periodPlies: 4,
              red: 'allowed',
              black: 'allowed',
              actions: { red: ['idle'], black: ['idle'] },
            },
          },
        }),
      }),
    )
    expect(allowed.detail).toBe('三次同形，双方均属允许循环')

    const equalViolation = deriveGamePrompt(
      makeContext({
        state: stateWith({
          status: 'draw',
          winner: null,
          outcome: {
            reason: 'repetition-draw',
            winner: null,
            offender: null,
            cycle: {
              startPly: 0,
              endPly: 8,
              periodPlies: 4,
              red: 'long-chase',
              black: 'long-chase',
              actions: { red: ['chase'], black: ['chase'] },
            },
          },
        }),
      }),
    )
    expect(equalViolation.detail).toBe('三次同形，双方均为长捉，等级相同')
  })

  it('演出覆盖已经由规则结算的终局，演出结束后再显示结果', () => {
    const state = stateWith({
      status: 'checkmate',
      winner: 'red',
      outcome: { reason: 'checkmate', winner: 'red', offender: null },
    })
    expect(
      deriveGamePrompt(makeContext({ state, animationBusy: true })).code,
    ).toBe('animation')
    expect(deriveGamePrompt(makeContext({ state })).code).toBe(
      'result-checkmate',
    )
  })

  it('区分自动回放与只读回放局面', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          replayPlaying: true,
          timeline: { isReviewing: true, cursorPly: 2, livePly: 8 },
        }),
      ),
    ).toMatchObject({
      code: 'replay-playing',
      title: '棋谱回放 · 第 2 / 8 手',
    })

    expect(
      deriveGamePrompt(
        makeContext({
          timeline: { isReviewing: true, cursorPly: 3, livePly: 8 },
        }),
      ),
    ).toMatchObject({
      code: 'replay-view',
      title: '回放局面 · 第 3 / 8 手',
    })
  })

  it('弹窗打开时提示与棋盘锁定原因保持一致', () => {
    expect(
      deriveGamePrompt(
        makeContext({ activeDialog: 'match-settings' }),
      ),
    ).toMatchObject({
      code: 'match-settings',
      title: '对局设置已打开',
    })
    expect(
      deriveGamePrompt(makeContext({ activeDialog: 'rule-help' })),
    ).toMatchObject({
      code: 'rule-help',
      title: '规则说明已打开',
    })
  })

  it('覆盖 AI 错误、棋谱暂停、思考与等待落子的状态', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          aiTurn: true,
          ai: { phase: 'error', error: 'worker crashed' },
        }),
      ),
    ).toMatchObject({
      code: 'ai-error',
      title: 'AI 未能完成落子',
      secondary: 'worker crashed',
    })

    expect(
      deriveGamePrompt(
        makeContext({ aiTurn: true, historyOpen: true }),
      ).code,
    ).toBe('ai-paused-history')
    expect(
      deriveGamePrompt(
        makeContext({ aiTurn: true, ai: { phase: 'thinking' } }),
      ).code,
    ).toBe('ai-thinking')
    expect(deriveGamePrompt(makeContext({ aiTurn: true })).code).toBe(
      'ai-turn',
    )
  })

  it('被将时给出应将提示，并把第二次同形作为次要警告', () => {
    const prompt = deriveGamePrompt(
      makeContext({
        state: stateWith({
          inCheck: true,
          sideToMove: 'red',
          ruleState: ruleState(2),
        }),
        selected: redHorse,
        legalCount: 1,
      }),
    )
    expect(prompt).toMatchObject({
      code: 'must-answer-check',
      title: '红方被将军',
      detail: '已选红马 · 1 个应将落点',
      secondary: '局面已第二次出现；再次重复将触发循环裁决',
    })
  })

  it('AI 被将时显示正在应将，而不是普通思考', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          state: stateWith({ inCheck: true, sideToMove: 'black' }),
          aiTurn: true,
          ai: { phase: 'thinking' },
        }),
      ),
    ).toMatchObject({
      code: 'must-answer-check',
      title: '黑方 AI 正在应将',
    })
  })

  it('第二次同形只给中性循环警告，不提前判定责任方', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          state: stateWith({
            ruleState: ruleState(2),
          }),
        }),
      ),
    ).toMatchObject({
      code: 'repetition-warning',
      title: '循环警告',
      detail: '局面已第二次出现；再次重复将触发循环裁决',
    })
  })

  it('自然限着在 100 着展示进度、110 着升级为警告', () => {
    expect(
      deriveGamePrompt(
        makeContext({ state: stateWith({ ruleState: ruleState(1, 100) }) }),
      ),
    ).toMatchObject({
      code: 'natural-limit-progress',
      tone: 'info',
      detail: '已累计 100 / 120 个有效未吃子着',
    })

    expect(
      deriveGamePrompt(
        makeContext({ state: stateWith({ ruleState: ruleState(1, 110) }) }),
      ),
    ).toMatchObject({
      code: 'natural-limit-warning',
      tone: 'warning',
      detail: '还剩 10 个有效未吃子着；若仍未吃子，将判和',
    })
  })

  it('循环和限着同时预警时保留两条规则信息', () => {
    expect(
      deriveGamePrompt(
        makeContext({ state: stateWith({ ruleState: ruleState(2, 110) }) }),
      ),
    ).toMatchObject({
      code: 'repetition-warning',
      secondary: '还剩 10 个有效未吃子着；若仍未吃子，将判和',
    })
  })

  it('选择棋子时区分有合法落点和无合法落点', () => {
    expect(
      deriveGamePrompt(
        makeContext({ selected: redHorse, legalCount: 3 }),
      ),
    ).toMatchObject({
      code: 'piece-selected',
      title: '已选红马',
      detail: '3 个合法落点',
    })
    expect(
      deriveGamePrompt(
        makeContext({ selected: redHorse, legalCount: 0 }),
      ),
    ).toMatchObject({
      tone: 'warning',
      detail: '当前没有合法落点',
      action: '请选择其他棋子',
    })
  })

  it('选择棋子时保留操作提示，并把规则预警放在次要信息', () => {
    const prompt = deriveGamePrompt(
      makeContext({
        state: stateWith({
          ruleState: {
            ...createInitialState().ruleState!,
            currentPositionOccurrences: 2,
          },
        }),
        selected: redHorse,
        legalCount: 2,
      }),
    )
    expect(prompt).toMatchObject({
      code: 'piece-selected',
      tone: 'warning',
      title: '已选红马',
      detail: '2 个合法落点',
      secondary: '局面已第二次出现；再次重复将触发循环裁决',
    })
  })

  it.each([
    ['wrong-side', '现在轮到红方', '请选择红方棋子'],
    ['no-selection', '请先选择一枚己方棋子', undefined],
    ['friendly-occupied', '落点已有己方棋子', '请改选或另选落点'],
    ['outside-board', '落点超出棋盘', undefined],
    [
      'fullscreen-unavailable',
      '当前浏览器不支持应用内全屏',
      '可使用浏览器自带的全屏或添加到主屏幕',
    ],
    [
      'fullscreen-failed',
      '未能切换全屏',
      '请允许全屏权限，或使用浏览器自带的全屏',
    ],
    ['illegal-pattern', '红马不能这样走', undefined],
    ['path-blocked', '行棋路线被棋子阻挡', undefined],
    ['horse-leg-blocked', '马腿被别住', '不能落到这里'],
    ['elephant-eye-blocked', '象眼被塞住', '不能落到这里'],
    ['elephant-cross-river', '相／象不能过河', undefined],
    ['palace-bound', '帅、将、仕、士不能离开九宫', undefined],
    ['cannon-screen', '炮架不符合规则', '炮吃子必须隔且只能隔一个炮架'],
    ['pawn-direction', '兵／卒不能这样走', '不能后退，未过河不能横走'],
    ['must-answer-check', '这步没有解除将军', '请先应将'],
    ['exposes-own-king', '这步会使己方帅／将受将', undefined],
    ['kings-facing', '这步会造成将帅照面', undefined],
    ['terminal', '对局已经结束', '可悔棋或重开新局'],
    ['locked-animation', '走子演出进行中', '请稍候'],
    ['locked-ai', '轮到黑方 AI', '请稍候'],
    ['locked-replay', '棋谱回放为只读', '返回当前局面后才能行棋'],
    ['locked-settings', '请先完成或关闭对局设置', undefined],
  ] as const)(
    '将交互原因 %s 映射成可行动中文提示',
    (reason, title, detail) => {
      expect(
        deriveGamePrompt(
          makeContext({
            interaction: {
              reason: reason as InteractionFeedbackReason,
              piece: redHorse,
            },
          }),
        ),
      ).toMatchObject({
        code: reason,
        title,
        ...(detail ? { detail } : {}),
      })
    },
  )

  it('交互反馈优先于运行状态，便于解释刚被拒绝的操作', () => {
    expect(
      deriveGamePrompt(
        makeContext({
          replayPlaying: true,
          interaction: { reason: 'locked-replay' },
        }),
      ).code,
    ).toBe('locked-replay')
  })

  it('无选择时区分人机玩家回合和本地双人回合', () => {
    expect(deriveGamePrompt(makeContext({ matchMode: 'ai' }))).toMatchObject({
      code: 'turn-human',
      title: '轮到你（红方）',
    })
    expect(
      deriveGamePrompt(
        makeContext({ state: stateWith({ sideToMove: 'black' }) }),
      ),
    ).toMatchObject({ code: 'turn-local', title: '黑方行棋' })
  })
})
