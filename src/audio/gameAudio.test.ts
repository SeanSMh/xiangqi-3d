import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AnimationEvent,
  AnimationEventType,
} from '../animation/animationDirector'
import {
  GameAudio,
  INITIAL_GAME_AUDIO_STATE,
  moveCueFor,
  reduceGameAudioSignal,
  type GameAudioEventState,
} from './gameAudio'

function animationEvent(type: AnimationEventType): AnimationEvent {
  return {
    type,
    atMs: 0,
    pieceId: 'p1',
    pieceKind: 'chariot',
    side: 'red',
    square: { file: 0, rank: 0 },
    strength: 1,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('moveCueFor', () => {
  it('按棋种和吃子事实映射移动起音', () => {
    expect(moveCueFor('chariot', false)).toBe('chariot-charge')
    expect(moveCueFor('horse', false)).toBe('horse-leap')
    expect(moveCueFor('cannon', true)).toBe('cannon-fire')
    expect(moveCueFor('cannon', false)).toBe('move')
    expect(moveCueFor('pawn', true)).toBe('move')
    expect(moveCueFor('king', false)).toBe('move')
  })
})

describe('reduceGameAudioSignal', () => {
  it('选择棋子发出独立选择音且不污染走子状态', () => {
    const result = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'select',
    })
    expect(result.cues).toEqual(['select'])
    expect(result.state).toBe(INITIAL_GAME_AUDIO_STATE)
  })

  it('普通走子在起步发音，动画结束后播将军提示', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'pawn',
      capture: false,
      givesCheck: true,
      terminal: false,
    })
    expect(started.cues).toEqual(['move'])
    expect(started.state.completionPending).toBe('check')

    const settled = reduceGameAudioSignal(started.state, {
      type: 'animation-event',
      event: animationEvent('settle'),
    })
    expect(settled.cues).toEqual([])
    const finished = reduceGameAudioSignal(settled.state, {
      type: 'animation-event',
      event: animationEvent('complete'),
    })
    expect(finished.cues).toEqual(['check'])
    expect(finished.state).toBe(INITIAL_GAME_AUDIO_STATE)
  })

  it('命中音只在首次到达 impact 后触发一次', () => {
    let state: GameAudioEventState = reduceGameAudioSignal(
      INITIAL_GAME_AUDIO_STATE,
      {
        type: 'move-start',
        pieceKind: 'chariot',
        capture: true,
        givesCheck: false,
        terminal: false,
      },
    ).state
    const windup = reduceGameAudioSignal(state, {
      type: 'animation-event',
      event: animationEvent('windup'),
    })
    expect(windup.cues).toEqual([])
    state = windup.state

    const impact = reduceGameAudioSignal(state, {
      type: 'animation-event',
      event: animationEvent('impact'),
    })
    expect(impact.cues).toEqual(['impact'])
    state = impact.state

    // 同类事件重复到达（例如取消后重放）不得二次发声。
    const repeated = reduceGameAudioSignal(state, {
      type: 'animation-event',
      event: animationEvent('impact'),
    })
    expect(repeated.cues).toEqual([])

    const exit = reduceGameAudioSignal(state, {
      type: 'animation-event',
      event: animationEvent('victim-dissolve'),
    })
    expect(exit.cues).toEqual([])
    expect(exit.state.impactPending).toBe(false)
  })

  it('炮吃子的起音推迟到弹丸出膛，蓄能期间保持安静', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'cannon',
      capture: true,
      givesCheck: false,
      terminal: false,
    })
    expect(started.cues).toEqual([])
    expect(started.state.launchPending).toBe(true)

    const released = reduceGameAudioSignal(started.state, {
      type: 'animation-event',
      event: animationEvent('projectile-release'),
    })
    expect(released.cues).toEqual(['cannon-fire'])
    expect(released.state.launchPending).toBe(false)
    // 出膛只响一次。
    expect(
      reduceGameAudioSignal(released.state, {
        type: 'animation-event',
        event: animationEvent('projectile-release'),
      }).cues,
    ).toEqual([])

    // 不吃子的炮仍在起手就发声，走的是普通走子音。
    expect(
      reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
        type: 'move-start',
        pieceKind: 'cannon',
        capture: false,
        givesCheck: false,
        terminal: false,
      }).cues,
    ).toEqual(['move'])
  })

  it('单次大步推进直接结束时补发出膛、命中和终局音', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'cannon',
      capture: true,
      givesCheck: true,
      terminal: true,
    })
    expect(started.cues).toEqual([])
    expect(started.state.completionPending).toBe('terminal')

    const finished = reduceGameAudioSignal(started.state, {
      type: 'animation-event',
      event: animationEvent('complete'),
    })
    expect(finished.cues).toEqual(['cannon-fire', 'impact', 'terminal'])
    expect(finished.state).toBe(INITIAL_GAME_AUDIO_STATE)
  })

  it('落步与占领各自发声，且不影响命中与收尾状态', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'chariot',
      capture: true,
      givesCheck: false,
      terminal: false,
    })
    const stepped = reduceGameAudioSignal(started.state, {
      type: 'animation-event',
      event: animationEvent('footfall'),
    })
    expect(stepped.cues).toEqual(['footstep'])
    expect(stepped.state).toBe(started.state)

    const hit = reduceGameAudioSignal(stepped.state, {
      type: 'animation-event',
      event: animationEvent('impact'),
    })
    const claimed = reduceGameAudioSignal(hit.state, {
      type: 'animation-event',
      event: animationEvent('claim'),
    })
    expect(claimed.cues).toEqual(['claim'])
    expect(
      reduceGameAudioSignal(claimed.state, {
        type: 'animation-event',
        event: animationEvent('complete'),
      }).cues,
    ).toEqual([])
  })

  it('演出未能启动时 animation-finished 同样补齐命中与终局', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'chariot',
      capture: true,
      givesCheck: false,
      terminal: true,
    })
    const finished = reduceGameAudioSignal(started.state, {
      type: 'animation-finished',
    })
    expect(finished.cues).toEqual(['impact', 'terminal'])
    expect(finished.state).toBe(INITIAL_GAME_AUDIO_STATE)
    // 已收尾后重复调用不再发声。
    expect(
      reduceGameAudioSignal(finished.state, { type: 'animation-finished' })
        .cues,
    ).toEqual([])
  })

  it('终局优先于将军提示，避免同时叠播', () => {
    const result = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'horse',
      capture: false,
      givesCheck: true,
      terminal: true,
    })
    expect(result.cues).toEqual(['horse-leap'])
    expect(result.state.completionPending).toBe('terminal')
  })

  it('reset 清空待播命中和终局，之后 idle 不再发声', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'cannon',
      capture: true,
      givesCheck: false,
      terminal: true,
    })
    const reset = reduceGameAudioSignal(started.state, { type: 'reset' })
    expect(reset.cues).toEqual([])
    expect(reset.state).toBe(INITIAL_GAME_AUDIO_STATE)
    expect(
      reduceGameAudioSignal(reset.state, {
        type: 'animation-event',
        event: animationEvent('complete'),
      }).cues,
    ).toEqual([])
  })

  it('无活动走子时动画事件不会产生幽灵音效', () => {
    expect(
      reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
        type: 'animation-event',
        event: animationEvent('impact'),
      }),
    ).toEqual({ state: INITIAL_GAME_AUDIO_STATE, cues: [] })
  })
})

describe('GameAudio 生命周期', () => {
  it('AudioContext 暂停或恢复失败时不积压音源，并允许后续手势重试', async () => {
    class FakeAudioParam {
      value = 0
    }
    class FakeNode {
      connect(): this {
        return this
      }
      disconnect(): void {}
    }
    class FakeAudioContext {
      static instance: FakeAudioContext | null = null
      state: AudioContextState = 'suspended'
      destination = new FakeNode()
      resumeShouldFail = true
      resumeCalls = 0
      oscillatorCreations = 0

      constructor() {
        FakeAudioContext.instance = this
      }

      createGain() {
        return Object.assign(new FakeNode(), { gain: new FakeAudioParam() })
      }

      createDynamicsCompressor() {
        return Object.assign(new FakeNode(), {
          threshold: new FakeAudioParam(),
          knee: new FakeAudioParam(),
          ratio: new FakeAudioParam(),
          attack: new FakeAudioParam(),
          release: new FakeAudioParam(),
        })
      }

      createOscillator(): never {
        this.oscillatorCreations += 1
        throw new Error('暂停状态不应创建音源')
      }

      async resume(): Promise<void> {
        this.resumeCalls += 1
        if (this.resumeShouldFail) throw new Error('autoplay denied')
        this.state = 'running'
      }

      async close(): Promise<void> {
        this.state = 'closed'
      }
    }

    vi.stubGlobal('window', {
      AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    })
    const audio = new GameAudio()
    audio.unlock()
    audio.dispatch({ type: 'select' })
    await Promise.resolve()
    await Promise.resolve()

    const context = FakeAudioContext.instance
    expect(context).not.toBeNull()
    expect(context?.resumeCalls).toBe(1)
    expect(context?.oscillatorCreations).toBe(0)
    expect(audio.getSnapshot()).toMatchObject({
      unlocked: false,
      activeVoices: 0,
      lastCue: 'select',
    })

    if (!context) throw new Error('FakeAudioContext 未创建')
    context.resumeShouldFail = false
    await Promise.resolve()
    audio.unlock()
    await Promise.resolve()
    await Promise.resolve()

    expect(context.resumeCalls).toBe(2)
    expect(audio.getSnapshot().unlocked).toBe(true)
    audio.dispose()
  })
})
