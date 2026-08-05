import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GameAudio,
  INITIAL_GAME_AUDIO_STATE,
  moveCueFor,
  reduceGameAudioSignal,
  type GameAudioEventState,
} from './gameAudio'

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
      type: 'animation-phase',
      phase: 'settle',
    })
    expect(settled.cues).toEqual([])
    const finished = reduceGameAudioSignal(settled.state, {
      type: 'animation-phase',
      phase: 'idle',
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
    const travel = reduceGameAudioSignal(state, {
      type: 'animation-phase',
      phase: 'travel',
    })
    expect(travel.cues).toEqual([])
    state = travel.state

    const impact = reduceGameAudioSignal(state, {
      type: 'animation-phase',
      phase: 'impact',
    })
    expect(impact.cues).toEqual(['impact'])
    state = impact.state

    const exit = reduceGameAudioSignal(state, {
      type: 'animation-phase',
      phase: 'victim-exit',
    })
    expect(exit.cues).toEqual([])
    expect(exit.state.impactPending).toBe(false)
  })

  it('单次大步推进直接结束时仍补发命中和终局音', () => {
    const started = reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
      type: 'move-start',
      pieceKind: 'cannon',
      capture: true,
      givesCheck: true,
      terminal: true,
    })
    expect(started.cues).toEqual(['cannon-fire'])
    expect(started.state.completionPending).toBe('terminal')

    const finished = reduceGameAudioSignal(started.state, {
      type: 'animation-phase',
      phase: 'idle',
    })
    expect(finished.cues).toEqual(['impact', 'terminal'])
    expect(finished.state).toBe(INITIAL_GAME_AUDIO_STATE)
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
        type: 'animation-phase',
        phase: 'idle',
      }).cues,
    ).toEqual([])
  })

  it('无活动走子时动画阶段事件不会产生幽灵音效', () => {
    expect(
      reduceGameAudioSignal(INITIAL_GAME_AUDIO_STATE, {
        type: 'animation-phase',
        phase: 'impact',
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
