import type { AnimationEvent } from '../animation/animationDirector'
import type { PieceKind } from '../types/xiangqi'

export type GameAudioCue =
  | 'select'
  | 'move'
  | 'chariot-charge'
  | 'horse-leap'
  | 'cannon-fire'
  | 'footstep'
  | 'impact'
  | 'claim'
  | 'check'
  | 'terminal'

export type GameAudioSignal =
  | { type: 'select' }
  | {
      type: 'move-start'
      pieceKind: PieceKind
      capture: boolean
      givesCheck: boolean
      terminal: boolean
    }
  | { type: 'animation-event'; event: AnimationEvent }
  /** 演出未能启动或被强制结束时补齐待播 cue，等价于收到 `complete`。 */
  | { type: 'animation-finished' }
  | { type: 'reset' }

export interface GameAudioEventState {
  moveActive: boolean
  impactPending: boolean
  /** 炮响属于出膛帧，不属于起手帧；蓄能期间先不发声。 */
  launchPending: boolean
  completionPending: 'check' | 'terminal' | null
}

export interface GameAudioTransition {
  state: GameAudioEventState
  cues: GameAudioCue[]
}

export interface GameAudioSnapshot {
  supported: boolean
  unlocked: boolean
  activeVoices: number
  lastCue: GameAudioCue | null
  emittedCueCount: number
  moveActive: boolean
  impactPending: boolean
  completionPending: 'check' | 'terminal' | null
}

export const INITIAL_GAME_AUDIO_STATE: GameAudioEventState = {
  moveActive: false,
  impactPending: false,
  launchPending: false,
  completionPending: null,
}

/**
 * 纯事件状态机：将棋局/动画事实映射成音效 cue。
 * 它不读取时间，也不依赖 Web Audio，因而手动时钟、暂停和测试都不会漂移。
 */
export function reduceGameAudioSignal(
  state: GameAudioEventState,
  signal: GameAudioSignal,
): GameAudioTransition {
  switch (signal.type) {
    case 'select':
      return { state, cues: ['select'] }
    case 'move-start': {
      // 炮吃子的起音要等到弹丸出膛；其余棋种在起手时就该有声音。
      const launchPending = signal.pieceKind === 'cannon' && signal.capture
      return {
        state: {
          moveActive: true,
          impactPending: signal.capture,
          launchPending,
          completionPending: signal.terminal
            ? 'terminal'
            : signal.givesCheck
              ? 'check'
              : null,
        },
        cues: launchPending
          ? []
          : [moveCueFor(signal.pieceKind, signal.capture)],
      }
    }
    case 'animation-event': {
      if (!state.moveActive) return { state, cues: [] }
      switch (signal.event.type) {
        case 'complete':
          return finishMove(state)
        case 'projectile-release':
          if (!state.launchPending) return { state, cues: [] }
          return {
            state: { ...state, launchPending: false },
            cues: ['cannon-fire'],
          }
        case 'footfall':
          return { state, cues: ['footstep'] }
        case 'claim':
          return { state, cues: ['claim'] }
        case 'impact':
          if (!state.impactPending) return { state, cues: [] }
          return { state: { ...state, impactPending: false }, cues: ['impact'] }
        default:
          return { state, cues: [] }
      }
    }
    case 'animation-finished': {
      if (!state.moveActive) return { state, cues: [] }
      return finishMove(state)
    }
    case 'reset':
      return { state: INITIAL_GAME_AUDIO_STATE, cues: [] }
  }
}

/** 收尾：补发未播的出膛与命中音，再播将军或终局，最后清空。 */
function finishMove(state: GameAudioEventState): GameAudioTransition {
  const cues: GameAudioCue[] = []
  if (state.launchPending) cues.push('cannon-fire')
  if (state.impactPending) cues.push('impact')
  if (state.completionPending) cues.push(state.completionPending)
  return { state: INITIAL_GAME_AUDIO_STATE, cues }
}

export function moveCueFor(
  pieceKind: PieceKind,
  capture: boolean,
): GameAudioCue {
  if (pieceKind === 'chariot') return 'chariot-charge'
  if (pieceKind === 'horse') return 'horse-leap'
  if (pieceKind === 'cannon' && capture) return 'cannon-fire'
  return 'move'
}

type AudioContextConstructor = new () => AudioContext
type TrackedSource = OscillatorNode | AudioBufferSourceNode

/**
 * 零外部资源的原创合成音效。
 * AudioContext 只会在用户手势触发 unlock() 后创建；不支持或被浏览器拒绝时静默降级。
 */
export class GameAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private readonly voices = new Map<TrackedSource, AudioNode[]>()
  private eventState: GameAudioEventState = INITIAL_GAME_AUDIO_STATE
  private disposed = false
  private unlocked = false
  private resumePromise: Promise<void> | null = null
  private lastCue: GameAudioCue | null = null
  private emittedCueCount = 0

  unlock(): void {
    if (this.disposed) return
    const context = this.ensureContext()
    if (!context) return
    if (context.state === 'running') {
      this.unlocked = true
      return
    }
    if (context.state === 'closed' || this.resumePromise) return
    try {
      const resumePromise = context
        .resume()
        .then(() => {
          if (!this.disposed && context.state === 'running') {
            this.unlocked = true
          }
        })
        .catch(() => {
          this.unlocked = false
          this.stopVoices()
          // 自动播放策略或设备拒绝音频时保持静默，后续手势仍可重试。
        })
      this.resumePromise = resumePromise
      void resumePromise.finally(() => {
        if (this.resumePromise === resumePromise) this.resumePromise = null
      })
    } catch {
      this.unlocked = false
      this.stopVoices()
    }
  }

  dispatch(signal: GameAudioSignal): void {
    if (this.disposed) return
    const transition = reduceGameAudioSignal(this.eventState, signal)
    this.eventState = transition.state
    for (const cue of transition.cues) {
      this.lastCue = cue
      this.emittedCueCount += 1
      this.playCue(cue)
    }
  }

  /** 清空待播棋局事件，并立即释放当前发声节点。 */
  reset(): void {
    const transition = reduceGameAudioSignal(this.eventState, { type: 'reset' })
    this.eventState = transition.state
    this.lastCue = null
    this.emittedCueCount = 0
    this.stopVoices()
  }

  getSnapshot(): GameAudioSnapshot {
    return {
      supported: Boolean(getAudioContextConstructor()),
      unlocked:
        this.unlocked && this.context !== null && this.context.state === 'running',
      activeVoices: this.voices.size,
      lastCue: this.lastCue,
      emittedCueCount: this.emittedCueCount,
      ...this.eventState,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.disposed = true
    const context = this.context
    this.context = null
    this.master = null
    this.noiseBuffer = null
    this.resumePromise = null
    this.unlocked = false
    if (context && context.state !== 'closed') {
      void context.close().catch(() => {
        // 页面卸载时关闭失败无需影响用户。
      })
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    const Context = getAudioContextConstructor()
    if (!Context) return null
    try {
      const context = new Context()
      const master = context.createGain()
      const compressor = context.createDynamicsCompressor()
      master.gain.value = 0.2
      compressor.threshold.value = -16
      compressor.knee.value = 18
      compressor.ratio.value = 8
      compressor.attack.value = 0.003
      compressor.release.value = 0.2
      master.connect(compressor)
      compressor.connect(context.destination)
      this.context = context
      this.master = master
      this.unlocked = context.state === 'running'
      return context
    } catch {
      return null
    }
  }

  private playCue(cue: GameAudioCue): void {
    const context = this.context
    // suspended/interrupted 的 currentTime 可能不推进；此时直接丢弃 cue，
    // 避免旧音源累积并在恢复后集中播放。
    if (!context || !this.master || context.state !== 'running') return
    try {
      switch (cue) {
        case 'select':
          this.tone(620, 880, 0, 0.085, 0.11, 'sine')
          this.tone(980, 760, 0.035, 0.075, 0.055, 'triangle')
          break
        case 'move':
          this.noise(0, 0.075, 0.075, 760, 'bandpass')
          this.tone(175, 92, 0, 0.12, 0.16, 'triangle')
          break
        case 'chariot-charge':
          this.noise(0, 0.22, 0.13, 520, 'lowpass')
          this.tone(138, 48, 0, 0.28, 0.17, 'sawtooth')
          this.tone(78, 45, 0.09, 0.22, 0.1, 'square')
          break
        case 'horse-leap':
          this.tone(245, 520, 0, 0.19, 0.12, 'triangle')
          this.tone(210, 105, 0.18, 0.105, 0.16, 'triangle')
          this.noise(0.19, 0.075, 0.075, 900, 'bandpass')
          break
        case 'cannon-fire':
          this.noise(0, 0.36, 0.3, 680, 'lowpass')
          this.tone(92, 34, 0, 0.42, 0.24, 'sine')
          this.tone(310, 72, 0.012, 0.19, 0.11, 'sawtooth')
          break
        case 'footstep':
          // 一次落步：短促、低频、刻意压得很轻，密集出现也不会盖住走子音。
          this.noise(0, 0.048, 0.055, 430, 'lowpass')
          this.tone(96, 58, 0, 0.06, 0.045, 'triangle')
          break
        case 'impact':
          this.noise(0, 0.24, 0.25, 980, 'lowpass')
          this.tone(132, 46, 0, 0.23, 0.25, 'square')
          this.tone(920, 260, 0.008, 0.12, 0.08, 'sawtooth')
          break
        case 'claim':
          // 占领落点：一声压实的闷响，与命中的锐利爆音区分开。
          this.noise(0, 0.16, 0.13, 320, 'lowpass')
          this.tone(112, 64, 0, 0.22, 0.15, 'sine')
          this.tone(258, 196, 0.03, 0.14, 0.06, 'triangle')
          break
        case 'check':
          this.tone(392, 392, 0, 0.2, 0.1, 'triangle')
          this.tone(523, 523, 0.065, 0.2, 0.1, 'triangle')
          this.tone(784, 659, 0.13, 0.3, 0.11, 'triangle')
          break
        case 'terminal':
          this.tone(110, 82, 0, 0.72, 0.17, 'sine')
          this.tone(220, 196, 0.04, 0.65, 0.1, 'triangle')
          this.tone(277, 247, 0.11, 0.62, 0.085, 'triangle')
          this.tone(330, 294, 0.18, 0.58, 0.075, 'triangle')
          break
      }
    } catch {
      // 节点创建/调度失败时静默；视觉和规则循环不能受音频影响。
    }
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    delaySeconds: number,
    durationSeconds: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const start = context.currentTime + delaySeconds
    const end = start + durationSeconds
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(Math.max(1, startFrequency), start)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      end,
    )
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume),
      start + Math.min(0.012, durationSeconds * 0.2),
    )
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain)
    gain.connect(master)
    this.track(oscillator, [oscillator, gain])
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }

  private noise(
    delaySeconds: number,
    durationSeconds: number,
    volume: number,
    filterFrequency: number,
    filterType: BiquadFilterType,
  ): void {
    const context = this.context
    const master = this.master
    if (!context || !master) return
    const start = context.currentTime + delaySeconds
    const end = start + durationSeconds
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = this.getNoiseBuffer(context)
    filter.type = filterType
    filter.frequency.setValueAtTime(filterFrequency, start)
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(90, filterFrequency * 0.38),
      end,
    )
    filter.Q.value = filterType === 'bandpass' ? 1.5 : 0.7
    gain.gain.setValueAtTime(Math.max(0.0001, volume), start)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    this.track(source, [source, filter, gain])
    source.start(start)
    source.stop(end + 0.02)
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer
    const frameCount = Math.max(1, Math.floor(context.sampleRate * 0.5))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const samples = buffer.getChannelData(0)
    let seed = 0x584951
    for (let index = 0; index < samples.length; index++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      samples[index] = (seed / 0xffffffff) * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private track(source: TrackedSource, nodes: AudioNode[]): void {
    this.voices.set(source, nodes)
    source.addEventListener(
      'ended',
      () => {
        this.release(source)
      },
      { once: true },
    )
  }

  private release(source: TrackedSource): void {
    const nodes = this.voices.get(source)
    if (!nodes) return
    this.voices.delete(source)
    for (const node of nodes) {
      try {
        node.disconnect()
      } catch {
        // 已释放节点可忽略。
      }
    }
  }

  private stopVoices(): void {
    const sources = [...this.voices.keys()]
    for (const source of sources) {
      try {
        source.stop()
      } catch {
        // 尚未启动或已经结束的节点可忽略。
      }
      this.release(source)
    }
  }
}

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null
  const audioWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor
  }
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null
}
