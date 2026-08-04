import type {
  BoardCoord,
  GameState,
  Move,
  PieceKind,
  Side,
} from '../types/xiangqi'

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
  clearTransientEffects(): void
  snapTo(state: GameState): void
}

export type AnimationPhase =
  | 'travel'
  | 'projectile'
  | 'impact'
  | 'victim-exit'
  | 'settle'

export interface IdleAnimationSnapshot {
  active: false
  inputLocked: false
  phase: 'idle'
}

export interface ActiveAnimationSnapshot {
  active: true
  inputLocked: true
  kind: 'move' | 'capture'
  style: 'standard' | 'chariot' | 'horse' | 'cannon'
  phase: AnimationPhase
  elapsedMs: number
  durationMs: number
  progress: number
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
  }
  vfx: null | {
    kind: 'white-cyan-impact' | 'orange-gold-blast'
    active: boolean
  }
}

export type AnimationSnapshot =
  | IdleAnimationSnapshot
  | ActiveAnimationSnapshot

interface ActiveAnimation {
  move: Move
  committedState: GameState
  pieceKind: PieceKind
  side: Side
  style: ActiveAnimationSnapshot['style']
  cannonCapture: boolean
  victimId: string | null
  victimSquare: BoardCoord | null
  travelMs: number
  impactMs: number
  victimExitMs: number
  settleMs: number
  totalMs: number
  elapsedMs: number
  phase: AnimationPhase
  attackerVisual: PiecePose
  projectileVisual: PiecePose | null
  projectileProgress: number
  victimVisual: PiecePose | null
  victimState: 'waiting' | 'hit' | 'exiting' | null
  vfxActive: boolean
}

const IDLE_SNAPSHOT: IdleAnimationSnapshot = {
  active: false,
  inputLocked: false,
  phase: 'idle',
}

export class AnimationDirector {
  private active: ActiveAnimation | null = null

  constructor(private readonly surface: AnimationSurface) {}

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
    const cannonCapture = movingPiece.kind === 'cannon' && Boolean(victim)
    const style: ActiveAnimationSnapshot['style'] =
      movingPiece.kind === 'horse'
        ? 'horse'
        : cannonCapture
          ? 'cannon'
          : movingPiece.kind === 'chariot'
            ? 'chariot'
            : 'standard'
    const travelMs =
      style === 'horse'
        ? 480
        : cannonCapture
          ? clamp(220 + distance * 45, 300, 560)
          : clamp(distance * 120, 350, 900)
    const impactMs = victim ? 170 : 0
    const victimExitMs = victim ? 260 : 0
    const settleMs = 90
    const attackerVisual = poseAt(move.from)

    this.active = {
      move,
      committedState,
      pieceKind: movingPiece.kind,
      side: movingPiece.side,
      style,
      cannonCapture,
      victimId: victim?.id ?? null,
      victimSquare: victim
        ? { file: victim.file, rank: victim.rank }
        : null,
      travelMs,
      impactMs,
      victimExitMs,
      settleMs,
      totalMs: travelMs + impactMs + victimExitMs + settleMs,
      elapsedMs: 0,
      phase: cannonCapture ? 'projectile' : 'travel',
      attackerVisual,
      projectileVisual: null,
      projectileProgress: 0,
      victimVisual: victim ? poseAt(victim) : null,
      victimState: victim ? 'waiting' : null,
      vfxActive: false,
    }
    this.renderCurrentFrame()
    return true
  }

  /** 返回本次推进是否让一个动画完成。 */
  advance(deltaMs: number): boolean {
    if (!this.active || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return false
    }

    this.active.elapsedMs = Math.min(
      this.active.totalMs,
      this.active.elapsedMs + deltaMs,
    )
    this.renderCurrentFrame()

    if (this.active.elapsedMs < this.active.totalMs) return false
    const committedState = this.active.committedState
    this.surface.clearTransientEffects()
    this.surface.snapTo(committedState)
    this.active = null
    return true
  }

  cancelAndSnap(state: GameState): void {
    this.surface.clearTransientEffects()
    this.active = null
    this.surface.snapTo(state)
  }

  getSnapshot(): AnimationSnapshot {
    const active = this.active
    if (!active) return IDLE_SNAPSHOT
    return {
      active: true,
      inputLocked: true,
      kind: active.victimId ? 'capture' : 'move',
      style: active.style,
      phase: active.phase,
      elapsedMs: round(active.elapsedMs),
      durationMs: round(active.totalMs),
      progress: round(active.elapsedMs / active.totalMs),
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
    }
  }

  private renderCurrentFrame(): void {
    const active = this.active
    if (!active) return
    const elapsed = active.elapsedMs
    const captureElapsed = elapsed - active.travelMs
    let projectileOpacity = 0
    let projectileTrailVisual = poseAt(active.move.from)

    if (elapsed < active.travelMs) {
      const t = elapsed / active.travelMs
      const eased = easeInOutCubic(t)
      if (active.cannonCapture) {
        active.phase = 'projectile'
        active.attackerVisual = {
          ...poseAt(active.move.from),
          lift: Math.sin(Math.PI * t) * 0.025,
          scale: 1 - Math.sin(Math.PI * t) * 0.025,
        }
        active.projectileProgress = t
        active.projectileVisual = cannonProjectilePose(active.move, t)
        projectileTrailVisual = cannonProjectilePose(
          active.move,
          Math.max(0, t - 0.075),
        )
        projectileOpacity = clamp(
          Math.min(t / 0.08, (1 - t) / 0.1),
          0,
          1,
        )
      } else if (active.style === 'horse') {
        active.phase = 'travel'
        active.attackerVisual = horsePose(active.move.from, active.move.to, t)
        active.projectileVisual = null
        active.projectileProgress = 0
      } else {
        active.phase = 'travel'
        active.attackerVisual = {
          file: lerp(active.move.from.file, active.move.to.file, eased),
          rank: lerp(active.move.from.rank, active.move.to.rank, eased),
          lift:
            Math.sin(Math.PI * t) *
            (active.pieceKind === 'chariot' ? 0.045 : 0.12),
          scale:
            1 +
            Math.sin(Math.PI * t) *
              (active.pieceKind === 'chariot' ? 0.08 : 0.04),
          rotationY: 0,
        }
        active.projectileVisual = null
        active.projectileProgress = 0
      }
      active.victimState = active.victimId ? 'waiting' : null
      active.vfxActive = false
      this.surface.setMoveTrail(
        active.move.from,
        active.move.to,
        eased,
        active.style === 'chariot' ? 0.78 * (1 - t * 0.35) : 0,
        active.side,
      )
    } else if (active.victimId && captureElapsed < active.impactMs) {
      const t = captureElapsed / active.impactMs
      active.phase = 'impact'
      active.attackerVisual = active.cannonCapture
        ? {
            ...poseAt(active.move.from),
            scale: 1 - Math.sin(Math.PI * t) * 0.04,
          }
        : {
            ...poseAt(active.move.to),
            lift: Math.sin(Math.PI * t) * 0.12,
            scale: 1 + Math.sin(Math.PI * t) * 0.1,
          }
      active.projectileVisual = null
      active.projectileProgress = 1
      active.victimVisual = active.victimSquare
        ? {
            ...poseAt(active.victimSquare),
            scale: 1 - Math.sin(Math.PI * t) * 0.12,
          }
        : null
      active.victimState = 'hit'
      active.vfxActive = true
      this.surface.setMoveTrail(
        active.move.from,
        active.move.to,
        1,
        active.style === 'chariot' ? 0.35 * (1 - t) : 0,
        active.side,
      )
    } else if (
      active.victimId &&
      captureElapsed < active.impactMs + active.victimExitMs
    ) {
      const t =
        (captureElapsed - active.impactMs) / active.victimExitMs
      active.phase = 'victim-exit'
      active.attackerVisual = active.cannonCapture
        ? {
            file: lerp(
              active.move.from.file,
              active.move.to.file,
              easeInOutCubic(t),
            ),
            rank: lerp(
              active.move.from.rank,
              active.move.to.rank,
              easeInOutCubic(t),
            ),
            lift: Math.sin(Math.PI * t) * 0.06,
            scale: 1,
            rotationY: 0,
          }
        : {
            ...poseAt(active.move.to),
          }
      active.projectileVisual = null
      active.projectileProgress = 1
      active.victimVisual = active.victimSquare
        ? {
            ...poseAt(active.victimSquare),
            lift: 0.05 + 0.55 * t,
            scale: Math.max(0.02, (1 - t) ** 2),
            rotationY: t * Math.PI * 1.6,
          }
        : null
      active.victimState = 'exiting'
      active.vfxActive = captureElapsed < 470
      this.surface.setMoveTrail(
        active.move.from,
        active.move.to,
        1,
        0,
        active.side,
      )
    } else {
      const settleStart =
        active.travelMs + active.impactMs + active.victimExitMs
      const t = clamp(
        (elapsed - settleStart) / active.settleMs,
        0,
        1,
      )
      active.phase = 'settle'
      active.attackerVisual = {
        ...poseAt(active.move.to),
        scale: 1 + Math.sin(Math.PI * t) * 0.055,
      }
      if (active.victimVisual) {
        active.victimVisual = {
          ...active.victimVisual,
          scale: 0.02,
        }
      }
      active.victimState = active.victimId ? 'exiting' : null
      active.projectileVisual = null
      active.projectileProgress = active.cannonCapture ? 1 : 0
      active.vfxActive = false
      this.surface.setMoveTrail(
        active.move.from,
        active.move.to,
        1,
        0,
        active.side,
      )
    }

    this.surface.setCannonProjectile(
      active.projectileVisual ?? poseAt(active.move.from),
      projectileTrailVisual,
      projectileOpacity,
    )

    this.surface.setPiecePose(active.move.pieceId, active.attackerVisual)
    if (active.victimId && active.victimVisual) {
      this.surface.setPiecePose(active.victimId, active.victimVisual)
    }

    if (active.victimSquare) {
      const whiteProgress = clamp(captureElapsed / 170, 0, 1)
      const orangeProgress = clamp((captureElapsed - 40) / 430, 0, 1)
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
  }
}

function poseAt(coord: BoardCoord): PiecePose {
  return {
    file: coord.file,
    rank: coord.rank,
    lift: 0,
    scale: 1,
    rotationY: 0,
  }
}

function horsePose(
  from: BoardCoord,
  to: BoardCoord,
  progress: number,
): PiecePose {
  const fileDelta = to.file - from.file
  const rankDelta = to.rank - from.rank
  const leg =
    Math.abs(fileDelta) === 2
      ? {
          file: from.file + Math.sign(fileDelta),
          rank: from.rank,
        }
      : {
          file: from.file,
          rank: from.rank + Math.sign(rankDelta),
        }
  const inverse = 1 - progress
  const fileTangent =
    2 * inverse * (leg.file - from.file) +
    2 * progress * (to.file - leg.file)
  const rankTangent =
    2 * inverse * (leg.rank - from.rank) +
    2 * progress * (to.rank - leg.rank)

  return {
    file:
      inverse ** 2 * from.file +
      2 * inverse * progress * leg.file +
      progress ** 2 * to.file,
    rank:
      inverse ** 2 * from.rank +
      2 * inverse * progress * leg.rank +
      progress ** 2 * to.rank,
    lift: 4 * 0.48 * progress * (1 - progress),
    scale: 1 + Math.sin(Math.PI * progress) * 0.04,
    rotationY: Math.atan2(fileTangent, rankTangent),
  }
}

function cannonProjectilePose(move: Move, progress: number): PiecePose {
  const arcHeight = clamp(
    0.35 + 0.09 * distanceBetween(move),
    0.5,
    0.9,
  )
  return {
    file: lerp(move.from.file, move.to.file, progress),
    rank: lerp(move.from.rank, move.to.rank, progress),
    lift: 0.35 + 4 * arcHeight * progress * (1 - progress),
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
  return value < 0.5
    ? 4 * value ** 3
    : 1 - (-2 * value + 2) ** 3 / 2
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
