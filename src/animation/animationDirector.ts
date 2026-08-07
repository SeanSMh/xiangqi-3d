import type {
  BoardCoord,
  GameState,
  Move,
  PieceKind,
  Side,
} from '../types/xiangqi'
import {
  resolveCombatTimeline,
  type AttackStyle,
  type CombatTimeline,
  type CombatTimingOptions,
} from './combatProfile'

export interface PiecePose {
  file: number
  rank: number
  lift: number
  scale: number
  rotationY: number
}

export interface AnimationSurface {
  setPiecePose(pieceId: string, pose: PiecePose): boolean
  setMoveTrail(
    from: BoardCoord,
    to: BoardCoord,
    progress: number,
    opacity: number,
    side: Side,
  ): void
  setCaptureImpact(
    square: BoardCoord,
    whiteProgress: number,
    orangeProgress: number,
  ): void
  setCannonProjectile(
    pose: PiecePose,
    trailFrom: PiecePose,
    opacity: number,
  ): void
  /** 受击者的消散进度 0–1；1 表示完全散尽。 */
  setPieceDissolve(pieceId: string, progress: number): void
  /** 攻击者是否切到出手姿态立绘。 */
  setPieceAttackPose(pieceId: string, active: boolean): void
  /** 蓄力预兆：出手前在起点收紧的地面环，强度按棋种分档。 */
  setWindupTell(
    square: BoardCoord,
    progress: number,
    strength: number,
    side: Side,
  ): void
  /** 占领落点的地面脉冲：进位压住交点时的尘环与地面波。 */
  setClaimPulse(square: BoardCoord, progress: number, strength: number): void
  /**
   * 剧情镜头：向战斗点凑近。`amount` 在演出首尾必须精确为 0，否则每次吃子
   * 都会把镜头往外推一点，反复累积后漂移。传 null 表示立即复位。
   */
  setCombatFocus(
    square: BoardCoord | null,
    amount: number,
    strength: number,
  ): void
  /**
   * 语义事件订阅入口，用于**一次性**表现（落步扬尘、占领爆发）。
   * 与逐帧的 set* 方法互补：那些是连续量，这些是离散瞬间。
   */
  onAnimationEvent(event: AnimationEvent): void
  clearTransientEffects(): void
  snapTo(state: GameState): void
}

export type AnimationPhase =
  | 'windup'
  | 'travel'
  | 'projectile'
  | 'impact'
  | 'victim-exit'
  | 'occupy'
  | 'settle'

/**
 * 演出时间线上的语义事件。音效、粒子与震屏都订阅这些事件，而不是轮询
 * `phase`：轮询是闩锁语义，一旦某帧跨过多个阶段就无法还原发生顺序。
 */
export type AnimationEventType =
  | 'windup'
  | 'footfall'
  | 'projectile-release'
  | 'impact'
  | 'victim-dissolve'
  | 'claim'
  | 'settle'
  | 'complete'

export interface AnimationEvent {
  type: AnimationEventType
  /** 相对演出起点的确定性触发时刻（毫秒），与帧率和 delta 大小无关。 */
  atMs: number
  pieceId: string
  pieceKind: PieceKind
  side: Side
  /** 事件所在交点：命中与消散在受击点，其余在攻击者的目标点。 */
  square: BoardCoord
  /** 0–1 强度，驱动音量、震屏与尘环。 */
  strength: number
  /** footfall 序号，从 0 开始，可用于左右脚交替。 */
  index?: number
}

export interface AnimationAdvance {
  /** 本次推进是否让一个演出完成。 */
  completed: boolean
  /**
   * 推进区间 `(before, after]` 内按时间升序穿过的**全部**事件。
   * 单帧跨越多个阶段（手动时钟快进、掉帧）时不会丢事件，也不会重复。
   */
  events: AnimationEvent[]
}

export interface IdleAnimationSnapshot {
  active: false
  inputLocked: false
  phase: 'idle'
}

export interface ActiveAnimationSnapshot {
  active: true
  inputLocked: true
  kind: 'move' | 'capture'
  style: AttackStyle
  phase: AnimationPhase
  elapsedMs: number
  durationMs: number
  progress: number
  hitStop: {
    durationMs: number
    active: boolean
  }
  move: {
    pieceId: string
    pieceKind: PieceKind
    side: Side
    from: BoardCoord
    to: BoardCoord
    capturedId: string | null
  }
  attackerVisual: PiecePose
  projectile: null | {
    kind: 'cannonball'
    progress: number
    pose: PiecePose
  }
  victim: null | {
    id: string
    state: 'waiting' | 'hit' | 'exiting'
    pose: PiecePose
    /** 0–1 立绘消散进度。 */
    dissolve: number
  }
  vfx: null | {
    kind: 'white-cyan-impact' | 'orange-gold-blast'
    active: boolean
  }
  /** 占领落点的压点进度，仅在 occupy 阶段推进。 */
  claim: null | { progress: number; strength: number }
  /** 完整的确定性事件排期，供自动化验收比对节拍。 */
  timeline: {
    marks: Array<{ type: AnimationEventType; atMs: number }>
    emitted: number
    phases: {
      windupMs: number
      travelMs: number
      impactMs: number
      victimExitMs: number
      occupyMs: number
      settleMs: number
    }
  }
}

export type AnimationSnapshot = IdleAnimationSnapshot | ActiveAnimationSnapshot

interface ActiveAnimation {
  move: Move
  committedState: GameState
  pieceKind: PieceKind
  side: Side
  timeline: CombatTimeline
  /** barrage 只有在真的吃子时才发射弹丸；空着仍然滑行过去。 */
  useProjectile: boolean
  victimId: string | null
  victimSquare: BoardCoord | null
  elapsedMs: number
  phase: AnimationPhase
  attackerVisual: PiecePose
  projectileVisual: PiecePose | null
  projectileProgress: number
  victimVisual: PiecePose | null
  victimState: 'waiting' | 'hit' | 'exiting' | null
  victimDissolve: number
  claimProgress: number
  vfxActive: boolean
  /** 按 atMs 升序排列，`start()` 时一次性算好，推进过程中不再变动。 */
  marks: AnimationEvent[]
  /** 下一个尚未发出的标记下标；保证每个标记恰好发出一次。 */
  nextMarkIndex: number
}

const IDLE_SNAPSHOT: IdleAnimationSnapshot = {
  active: false,
  inputLocked: false,
  phase: 'idle',
}

const IDLE_ADVANCE: AnimationAdvance = { completed: false, events: [] }

export class AnimationDirector {
  private active: ActiveAnimation | null = null
  private timing: CombatTimingOptions

  constructor(
    private readonly surface: AnimationSurface,
    timing: CombatTimingOptions = {},
  ) {
    this.timing = { ...timing }
  }

  /** 运行时切换演出速度或 reduced-motion；只影响之后开始的演出。 */
  setTiming(timing: CombatTimingOptions): void {
    this.timing = { ...timing }
  }

  getTiming(): CombatTimingOptions {
    return { ...this.timing }
  }

  get isBusy(): boolean {
    return this.active !== null
  }

  start(move: Move, committedState: GameState): boolean {
    if (this.active) return false
    const movingPiece = committedState.pieces.find(
      (piece) => piece.id === move.pieceId,
    )
    if (!movingPiece) return false

    const victim = move.capturedId
      ? committedState.pieces.find((piece) => piece.id === move.capturedId)
      : undefined
    const distance = Math.hypot(
      move.to.file - move.from.file,
      move.to.rank - move.from.rank,
    )
    const timeline = resolveCombatTimeline(
      movingPiece.kind,
      distance,
      Boolean(victim),
      this.timing,
    )
    const useProjectile = timeline.style === 'barrage' && Boolean(victim)
    const victimSquare = victim
      ? { file: victim.file, rank: victim.rank }
      : null

    this.active = {
      move,
      committedState,
      pieceKind: movingPiece.kind,
      side: movingPiece.side,
      timeline,
      useProjectile,
      victimId: victim?.id ?? null,
      victimSquare,
      elapsedMs: 0,
      phase: timeline.windupMs > 0 ? 'windup' : travelPhase(useProjectile),
      attackerVisual: poseAt(move.from),
      projectileVisual: null,
      projectileProgress: 0,
      victimVisual: victim ? poseAt(victim) : null,
      victimState: victim ? 'waiting' : null,
      victimDissolve: 0,
      claimProgress: 0,
      vfxActive: false,
      marks: buildTimelineMarks({
        move,
        pieceKind: movingPiece.kind,
        side: movingPiece.side,
        victimSquare,
        timeline,
        useProjectile,
      }),
      nextMarkIndex: 0,
    }
    this.renderCurrentFrame()
    return true
  }

  /**
   * 推进演出，并返回本区间穿过的全部语义事件。
   *
   * 事件由 `start()` 排好的标记表驱动，只依赖推进前后的 elapsed，因此
   * `advanceTime(2000)` 一次跨完整场演出与 60fps 逐帧推进产生的事件流完全一致。
   */
  advance(deltaMs: number): AnimationAdvance {
    if (!this.active || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return IDLE_ADVANCE
    }

    const total = this.active.timeline.totalMs
    this.active.elapsedMs = Math.min(total, this.active.elapsedMs + deltaMs)
    this.renderCurrentFrame()

    const events: AnimationEvent[] = []
    const { marks } = this.active
    while (
      this.active.nextMarkIndex < marks.length &&
      marks[this.active.nextMarkIndex]!.atMs <= this.active.elapsedMs
    ) {
      events.push(marks[this.active.nextMarkIndex]!)
      this.active.nextMarkIndex += 1
    }

    // 事件同时推给表现层，一次性特效（扬尘、占领爆发）由它自行起停。
    for (const event of events) this.surface.onAnimationEvent(event)

    if (this.active.elapsedMs < total) {
      return { completed: false, events }
    }
    const committedState = this.active.committedState
    this.surface.clearTransientEffects()
    this.surface.snapTo(committedState)
    this.active = null
    return { completed: true, events }
  }

  cancelAndSnap(state: GameState): void {
    const active = this.active
    this.active = null
    // 消散与出手姿都是持久状态，取消时必须显式复位。
    if (active?.victimId) this.surface.setPieceDissolve(active.victimId, 0)
    if (active) this.surface.setPieceAttackPose(active.move.pieceId, false)
    this.surface.clearTransientEffects()
    this.surface.snapTo(state)
  }

  getSnapshot(): AnimationSnapshot {
    const active = this.active
    if (!active) return IDLE_SNAPSHOT
    const { timeline } = active
    return {
      active: true,
      inputLocked: true,
      kind: active.victimId ? 'capture' : 'move',
      style: timeline.style,
      phase: active.phase,
      elapsedMs: round(active.elapsedMs),
      durationMs: round(timeline.totalMs),
      progress: round(active.elapsedMs / timeline.totalMs),
      hitStop: {
        durationMs: active.victimId ? round(timeline.hitStopMs) : 0,
        active:
          Boolean(active.victimId) &&
          active.phase === 'impact' &&
          active.elapsedMs - timeline.impactAtMs < timeline.hitStopMs,
      },
      move: {
        pieceId: active.move.pieceId,
        pieceKind: active.pieceKind,
        side: active.side,
        from: active.move.from,
        to: active.move.to,
        capturedId: active.move.capturedId ?? null,
      },
      attackerVisual: roundPose(active.attackerVisual),
      projectile: active.projectileVisual
        ? {
            kind: 'cannonball',
            progress: round(active.projectileProgress),
            pose: roundPose(active.projectileVisual),
          }
        : null,
      victim:
        active.victimId && active.victimVisual && active.victimState
          ? {
              id: active.victimId,
              state: active.victimState,
              pose: roundPose(active.victimVisual),
              dissolve: round(active.victimDissolve),
            }
          : null,
      vfx: active.vfxActive
        ? {
            kind:
              active.phase === 'impact'
                ? 'white-cyan-impact'
                : 'orange-gold-blast',
            active: true,
          }
        : null,
      claim:
        active.claimProgress > 0
          ? {
              progress: round(active.claimProgress),
              strength: timeline.claimStrength,
            }
          : null,
      timeline: {
        marks: active.marks.map((mark) => ({
          type: mark.type,
          atMs: round(mark.atMs),
        })),
        emitted: active.nextMarkIndex,
        phases: {
          windupMs: round(timeline.windupMs),
          travelMs: round(timeline.travelMs),
          impactMs: round(timeline.impactMs),
          victimExitMs: round(timeline.victimExitMs),
          occupyMs: round(timeline.occupyMs),
          settleMs: round(timeline.settleMs),
        },
      },
    }
  }

  private renderCurrentFrame(): void {
    const active = this.active
    if (!active) return
    const { timeline, move } = active
    const elapsed = active.elapsedMs
    let projectileOpacity = 0
    let projectileTrailVisual = poseAt(move.from)
    let trailOpacity = 0
    let trailProgress = 1

    if (elapsed < timeline.windupMs) {
      // ---- 蓄力：沿出手反方向拉开，末段回弹发力。
      const t = elapsed / timeline.windupMs
      const pull = windupPull(t) * timeline.windupOffset
      const unit = unitTowards(move.from, move.to)
      active.phase = 'windup'
      active.attackerVisual = {
        file: move.from.file - unit.file * pull,
        rank: move.from.rank - unit.rank * pull,
        lift: 0,
        scale: 1 + (timeline.windupScale - 1) * Math.sin(Math.PI * t),
        rotationY: 0,
      }
      active.projectileVisual = null
      active.projectileProgress = 0
      active.victimState = active.victimId ? 'waiting' : null
      active.victimVisual = active.victimSquare
        ? poseAt(active.victimSquare)
        : null
      active.victimDissolve = 0
      active.claimProgress = 0
      active.vfxActive = false
      trailProgress = 0
    } else if (elapsed < timeline.impactAtMs) {
      // ---- 行进 / 弹道
      const t = timeline.travelMs > 0 ? (elapsed - timeline.travelAtMs) / timeline.travelMs : 1
      const eased = easeInOutCubic(t)
      if (active.useProjectile) {
        active.phase = 'projectile'
        active.attackerVisual = {
          ...poseAt(move.from),
          lift: Math.sin(Math.PI * t) * 0.025 * timeline.motionScale,
          scale: 1 - Math.sin(Math.PI * t) * 0.025 * timeline.motionScale,
          rotationY: 0,
        }
        active.projectileProgress = t
        active.projectileVisual = cannonProjectilePose(move, t, timeline.motionScale)
        projectileTrailVisual = cannonProjectilePose(
          move,
          Math.max(0, t - 0.075),
          timeline.motionScale,
        )
        projectileOpacity = clamp(Math.min(t / 0.08, (1 - t) / 0.1), 0, 1)
      } else if (timeline.style === 'leap') {
        active.phase = 'travel'
        active.attackerVisual = leapPose(move.from, move.to, t, timeline)
        active.projectileVisual = null
        active.projectileProgress = 0
      } else {
        active.phase = 'travel'
        active.attackerVisual = {
          file: lerp(move.from.file, move.to.file, eased),
          rank: lerp(move.from.rank, move.to.rank, eased),
          lift: Math.sin(Math.PI * t) * timeline.travelLift,
          scale: 1 + Math.sin(Math.PI * t) * (timeline.travelScale - 1),
          rotationY: 0,
        }
        active.projectileVisual = null
        active.projectileProgress = 0
      }
      active.victimState = active.victimId ? 'waiting' : null
      active.victimVisual = active.victimSquare
        ? poseAt(active.victimSquare)
        : null
      active.victimDissolve = 0
      active.claimProgress = 0
      active.vfxActive = false
      trailProgress = eased
      // 车的冲锋拖尾最亮；其余棋种不留直线尾迹。
      trailOpacity = timeline.style === 'charge' ? 0.86 * (1 - t * 0.3) : 0
    } else if (active.victimId && elapsed < timeline.victimExitAtMs) {
      // ---- 命中：先打击停顿，再把动作放出去。
      const captureElapsed = elapsed - timeline.impactAtMs
      const t = timeline.impactMs > 0 ? captureElapsed / timeline.impactMs : 1
      const motionSpan = Math.max(1, timeline.impactMs - timeline.hitStopMs)
      const motionT = clamp((captureElapsed - timeline.hitStopMs) / motionSpan, 0, 1)
      active.phase = 'impact'
      active.attackerVisual = active.useProjectile
        ? {
            ...poseAt(move.from),
            scale: 1 - Math.sin(Math.PI * motionT) * 0.04 * timeline.motionScale,
          }
        : {
            ...poseAt(move.to),
            lift: Math.sin(Math.PI * motionT) * 0.12 * timeline.motionScale,
            scale:
              1 +
              Math.sin(Math.PI * motionT) *
                0.1 *
                timeline.motionScale *
                timeline.impactStrength,
          }
      active.projectileVisual = null
      active.projectileProgress = 1
      active.victimVisual = active.victimSquare
        ? {
            ...poseAt(active.victimSquare),
            scale: 1 - Math.sin(Math.PI * motionT) * 0.12 * timeline.motionScale,
          }
        : null
      active.victimState = 'hit'
      active.victimDissolve = 0
      active.claimProgress = 0
      active.vfxActive = true
      trailOpacity = timeline.style === 'charge' ? 0.4 * (1 - t) : 0
    } else if (active.victimId && elapsed < timeline.occupyAtMs) {
      // ---- 受击消散：立绘自下而上散尽，攻击者按出手形态等待。
      const t =
        timeline.victimExitMs > 0
          ? (elapsed - timeline.victimExitAtMs) / timeline.victimExitMs
          : 1
      active.phase = 'victim-exit'
      active.attackerVisual = active.useProjectile
        ? poseAt(move.from)
        : poseAt(move.to)
      active.projectileVisual = null
      active.projectileProgress = 1
      active.victimVisual = active.victimSquare
        ? {
            ...poseAt(active.victimSquare),
            lift: (0.04 + 0.24 * t) * timeline.motionScale,
            scale: 1 - 0.22 * t * timeline.motionScale,
            rotationY: t * 0.35 * timeline.motionScale,
          }
        : null
      active.victimState = 'exiting'
      active.victimDissolve = easeInOutCubic(t)
      active.claimProgress = 0
      active.vfxActive = t < 0.72
    } else if (active.victimId && elapsed < timeline.settleAtMs) {
      // ---- 占领：清场之后才进位，并压住交点。
      const t =
        timeline.occupyMs > 0
          ? (elapsed - timeline.occupyAtMs) / timeline.occupyMs
          : 1
      const eased = easeInOutCubic(t)
      active.phase = 'occupy'
      active.attackerVisual = active.useProjectile
        ? {
            file: lerp(move.from.file, move.to.file, eased),
            rank: lerp(move.from.rank, move.to.rank, eased),
            lift: Math.sin(Math.PI * t) * 0.06 * timeline.motionScale,
            scale: 1,
            rotationY: 0,
          }
        : {
            ...poseAt(move.to),
            // 压点：向下沉一点再回来，读作把交点踩实。
            lift: -0.03 * timeline.motionScale * Math.sin(Math.PI * t),
            scale:
              1 +
              Math.sin(Math.PI * t) *
                0.06 *
                timeline.motionScale *
                timeline.claimStrength,
          }
      active.projectileVisual = null
      active.projectileProgress = active.useProjectile ? 1 : 0
      active.victimVisual = active.victimSquare
        ? { ...poseAt(active.victimSquare), scale: 0.02 }
        : null
      active.victimState = 'exiting'
      active.victimDissolve = 1
      // 投射棋种的尘环压后：炮身走到落点时才炸开，而不是在半空。
      active.claimProgress = active.useProjectile
        ? clamp((t - 0.55) / 0.45, 0, 1)
        : t
      active.vfxActive = false
    } else {
      // ---- 收势
      const t =
        timeline.settleMs > 0
          ? clamp((elapsed - timeline.settleAtMs) / timeline.settleMs, 0, 1)
          : 1
      active.phase = 'settle'
      active.attackerVisual = {
        ...poseAt(move.to),
        scale: 1 + Math.sin(Math.PI * t) * 0.055 * timeline.motionScale,
      }
      if (active.victimVisual) {
        active.victimVisual = { ...active.victimVisual, scale: 0.02 }
        active.victimDissolve = 1
      }
      active.victimState = active.victimId ? 'exiting' : null
      active.projectileVisual = null
      active.projectileProgress = active.useProjectile ? 1 : 0
      active.claimProgress = active.victimId ? 1 : 0
      active.vfxActive = false
    }

    this.surface.setMoveTrail(
      move.from,
      move.to,
      trailProgress,
      trailOpacity,
      active.side,
    )
    this.surface.setCannonProjectile(
      active.projectileVisual ?? poseAt(move.from),
      projectileTrailVisual,
      projectileOpacity,
    )
    // 只有吃子才摆出手姿：空着是行军，不该拔刀。
    // 窗口取「蓄力起 → 命中结束」，消散与占领回到待机。
    this.surface.setPieceAttackPose(
      move.pieceId,
      Boolean(active.victimId) && elapsed < timeline.victimExitAtMs,
    )
    this.surface.setPiecePose(move.pieceId, active.attackerVisual)
    if (active.victimId && active.victimVisual) {
      this.surface.setPiecePose(active.victimId, active.victimVisual)
      this.surface.setPieceDissolve(active.victimId, active.victimDissolve)
    }

    if (active.victimSquare) {
      const captureElapsed = elapsed - timeline.impactAtMs
      const whiteSpan = Math.max(1, timeline.impactMs)
      const orangeSpan = Math.max(1, timeline.impactMs + timeline.victimExitMs)
      const whiteProgress = clamp(captureElapsed / whiteSpan, 0, 1)
      const orangeProgress = clamp(
        (captureElapsed - whiteSpan * 0.24) / orangeSpan,
        0,
        1,
      )
      active.vfxActive =
        (whiteProgress > 0 && whiteProgress < 1) ||
        (orangeProgress > 0 && orangeProgress < 1)
      this.surface.setCaptureImpact(
        active.victimSquare,
        whiteProgress,
        orangeProgress,
      )
    } else {
      active.vfxActive = false
    }

    this.surface.setWindupTell(
      move.from,
      timeline.windupMs > 0 && elapsed < timeline.windupMs
        ? elapsed / timeline.windupMs
        : 0,
      timeline.impactStrength,
      active.side,
    )
    this.surface.setClaimPulse(
      move.to,
      active.claimProgress,
      timeline.claimStrength,
    )

    // 剧情镜头只在 命中 → 收势起点 之间起作用，包络两端恒为 0，
    // 因此演出结束时相机精确回到用户原视角，不会逐次累积漂移。
    const focusSpan = timeline.settleAtMs - timeline.impactAtMs
    if (
      active.victimId &&
      focusSpan > 0 &&
      elapsed > timeline.impactAtMs &&
      elapsed < timeline.settleAtMs
    ) {
      const cineT = (elapsed - timeline.impactAtMs) / focusSpan
      this.surface.setCombatFocus(
        active.victimSquare ?? move.to,
        Math.sin(Math.PI * cineT) * timeline.motionScale,
        timeline.impactStrength,
      )
    } else {
      this.surface.setCombatFocus(null, 0, 0)
    }
  }
}

interface TimelineMarkInput {
  move: Move
  pieceKind: PieceKind
  side: Side
  victimSquare: BoardCoord | null
  timeline: CombatTimeline
  useProjectile: boolean
}

/**
 * 排定一次演出的全部事件时刻。这里只做时间计算，不触碰表现层，因此
 * 同一着法在任何设备、任何帧率下都得到同一张表。
 */
function buildTimelineMarks(input: TimelineMarkInput): AnimationEvent[] {
  const { move, pieceKind, side, victimSquare, timeline } = input
  const base = { pieceId: move.pieceId, pieceKind, side }
  const marks: AnimationEvent[] = []

  if (timeline.windupMs > 0) {
    marks.push({
      ...base,
      type: 'windup',
      atMs: 0,
      square: move.from,
      strength: timeline.impactStrength,
    })
  }
  if (input.useProjectile) {
    marks.push({
      ...base,
      type: 'projectile-release',
      atMs: timeline.travelAtMs,
      square: move.from,
      strength: timeline.impactStrength,
    })
  }
  timeline.footfallsAtMs.forEach((atMs, index) => {
    marks.push({
      ...base,
      type: 'footfall',
      atMs,
      square: move.to,
      strength: 0.35 + 0.25 * (index % 2),
      index,
    })
  })

  if (victimSquare) {
    marks.push({
      ...base,
      type: 'impact',
      atMs: timeline.impactAtMs,
      square: victimSquare,
      strength: timeline.impactStrength,
    })
    marks.push({
      ...base,
      type: 'victim-dissolve',
      atMs: timeline.victimExitAtMs,
      square: victimSquare,
      strength: 0.75,
    })
    marks.push({
      ...base,
      type: 'claim',
      atMs: timeline.claimAtMs,
      square: move.to,
      strength: timeline.claimStrength,
    })
  }
  marks.push({
    ...base,
    type: 'settle',
    atMs: timeline.settleAtMs,
    square: move.to,
    strength: victimSquare ? 0.5 : 0.7,
  })
  marks.push({
    ...base,
    type: 'complete',
    atMs: timeline.totalMs,
    square: move.to,
    strength: 0,
  })
  return marks.sort((left, right) => left.atMs - right.atMs)
}

function travelPhase(useProjectile: boolean): AnimationPhase {
  return useProjectile ? 'projectile' : 'travel'
}

/** 先拉开到位（70%），再在末段回弹归零，把力量交接给行进阶段。 */
function windupPull(t: number): number {
  if (t <= 0.7) return easeOutCubic(t / 0.7)
  return 1 - easeInCubic((t - 0.7) / 0.3)
}

function unitTowards(from: BoardCoord, to: BoardCoord): BoardCoord {
  const file = to.file - from.file
  const rank = to.rank - from.rank
  const length = Math.hypot(file, rank)
  if (length < 0.000001) return { file: 0, rank: 0 }
  return { file: file / length, rank: rank / length }
}

function poseAt(coord: BoardCoord): PiecePose {
  return { file: coord.file, rank: coord.rank, lift: 0, scale: 1, rotationY: 0 }
}

function leapPose(
  from: BoardCoord,
  to: BoardCoord,
  progress: number,
  timeline: CombatTimeline,
): PiecePose {
  const fileDelta = to.file - from.file
  const rankDelta = to.rank - from.rank
  const leg =
    Math.abs(fileDelta) === 2
      ? { file: from.file + Math.sign(fileDelta), rank: from.rank }
      : { file: from.file, rank: from.rank + Math.sign(rankDelta) }
  const inverse = 1 - progress
  const fileTangent =
    2 * inverse * (leg.file - from.file) + 2 * progress * (to.file - leg.file)
  const rankTangent =
    2 * inverse * (leg.rank - from.rank) + 2 * progress * (to.rank - leg.rank)

  return {
    file:
      inverse ** 2 * from.file +
      2 * inverse * progress * leg.file +
      progress ** 2 * to.file,
    rank:
      inverse ** 2 * from.rank +
      2 * inverse * progress * leg.rank +
      progress ** 2 * to.rank,
    lift: 4 * timeline.travelLift * progress * (1 - progress),
    scale: 1 + Math.sin(Math.PI * progress) * (timeline.travelScale - 1),
    rotationY: Math.atan2(fileTangent, rankTangent),
  }
}

function cannonProjectilePose(
  move: Move,
  progress: number,
  motionScale: number,
): PiecePose {
  const arcHeight = clamp(0.35 + 0.09 * distanceBetween(move), 0.5, 0.9)
  return {
    file: lerp(move.from.file, move.to.file, progress),
    rank: lerp(move.from.rank, move.to.rank, progress),
    lift: 0.35 + 4 * arcHeight * progress * (1 - progress) * motionScale,
    scale: 1 + Math.sin(Math.PI * progress) * 0.08,
    rotationY: progress * Math.PI * 4,
  }
}

function distanceBetween(move: Move): number {
  return Math.hypot(
    move.to.file - move.from.file,
    move.to.rank - move.from.rank,
  )
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3
}

function easeInCubic(value: number): number {
  return value ** 3
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function roundPose(pose: PiecePose): PiecePose {
  return {
    file: round(pose.file),
    rank: round(pose.rank),
    lift: round(pose.lift),
    scale: round(pose.scale),
    rotationY: round(pose.rotationY),
  }
}
