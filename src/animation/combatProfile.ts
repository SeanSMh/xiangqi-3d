import type { PieceKind } from '../types/xiangqi'

/**
 * 一次出手的形态。它只描述**怎么打**，不描述规则——规则永远由引擎决定，
 * 这里拿到的着法已经是合法的。
 *
 * - `strike` 走过去出手（帅、仕、相、兵）
 * - `charge` 沿直线冲锋，先后拉再压上（车）
 * - `leap`   日字腾跃，全程离地（马）
 * - `barrage` 原地后坐并投射，清场后才进位（炮）
 */
export type AttackStyle = 'strike' | 'charge' | 'leap' | 'barrage'

export interface CombatProfile {
  style: AttackStyle
  /** 蓄力时长；0 表示直接起步。 */
  windupMs: number
  /** 蓄力位移（格）：charge/barrage 沿出手反方向后拉，其余为下蹲深度。 */
  windupOffset: number
  /** 蓄力缩放脉冲峰值。 */
  windupScale: number
  /** 行进：每格毫秒与上下限；leap 固定使用 travelMinMs。 */
  travelMsPerCell: number
  travelMinMs: number
  travelMaxMs: number
  travelLift: number
  travelScale: number
  /** 每格落步数；0 表示不产生 footfall（腾空或不移动）。 */
  footfallsPerCell: number
  impactMs: number
  hitStopMs: number
  victimExitMs: number
  /** 占领：清场后压住交点的进位节拍。 */
  occupyMs: number
  settleMs: number
  /** 0–1 命中强度：驱动震屏、冲击波与命中音量。 */
  impactStrength: number
  /** 0–1 占领强度：驱动落点尘环与地面波。 */
  claimStrength: number
}

/**
 * 单次吃子演出的硬上限。参考项目的过场是给录制看的，可以跑好几秒；
 * 人类连下四十手时超过这个长度就会明显发黏。
 */
export const MAX_CAPTURE_DURATION_MS = 1600

/**
 * 七棋种的出手档案。
 *
 * 刻意拉开层次：帅将最慢最重、仕士与兵卒短促轻量，避免所有棋子都像放大招。
 * 纯数据、不 import three，因此每条时间线都能在无 DOM 环境下断言。
 */
export const COMBAT_PROFILES: Record<PieceKind, CombatProfile> = {
  king: {
    style: 'strike',
    windupMs: 240,
    windupOffset: 0.05,
    windupScale: 1.06,
    travelMsPerCell: 180,
    travelMinMs: 320,
    travelMaxMs: 520,
    travelLift: 0.08,
    travelScale: 1.03,
    footfallsPerCell: 2,
    impactMs: 200,
    hitStopMs: 80,
    victimExitMs: 300,
    occupyMs: 170,
    settleMs: 110,
    impactStrength: 1,
    claimStrength: 1,
  },
  advisor: {
    style: 'strike',
    windupMs: 70,
    windupOffset: 0.02,
    windupScale: 1.03,
    travelMsPerCell: 150,
    travelMinMs: 260,
    travelMaxMs: 380,
    travelLift: 0.1,
    travelScale: 1.03,
    footfallsPerCell: 2,
    impactMs: 130,
    hitStopMs: 45,
    victimExitMs: 220,
    occupyMs: 90,
    settleMs: 80,
    impactStrength: 0.5,
    claimStrength: 0.45,
  },
  elephant: {
    style: 'strike',
    windupMs: 150,
    windupOffset: 0.045,
    windupScale: 1.05,
    travelMsPerCell: 130,
    travelMinMs: 320,
    travelMaxMs: 460,
    travelLift: 0.14,
    travelScale: 1.05,
    footfallsPerCell: 1.2,
    impactMs: 185,
    hitStopMs: 70,
    victimExitMs: 275,
    occupyMs: 190,
    settleMs: 100,
    impactStrength: 0.85,
    // 象是重型落地：地面波比命中本身更响。
    claimStrength: 1,
  },
  horse: {
    style: 'leap',
    windupMs: 90,
    windupOffset: 0.06,
    windupScale: 1.04,
    travelMsPerCell: 0,
    travelMinMs: 480,
    travelMaxMs: 480,
    travelLift: 0.48,
    travelScale: 1.04,
    // 全程腾空，落地由 claim 一次性给出双重反馈。
    footfallsPerCell: 0,
    impactMs: 165,
    hitStopMs: 60,
    victimExitMs: 250,
    occupyMs: 140,
    settleMs: 95,
    impactStrength: 0.8,
    claimStrength: 0.9,
  },
  chariot: {
    style: 'charge',
    windupMs: 130,
    windupOffset: 0.12,
    windupScale: 1.06,
    travelMsPerCell: 105,
    travelMinMs: 300,
    travelMaxMs: 620,
    travelLift: 0.045,
    travelScale: 1.08,
    footfallsPerCell: 1,
    impactMs: 195,
    hitStopMs: 75,
    victimExitMs: 265,
    occupyMs: 160,
    settleMs: 95,
    impactStrength: 1,
    claimStrength: 0.95,
  },
  cannon: {
    style: 'barrage',
    windupMs: 175,
    windupOffset: 0.08,
    windupScale: 1.07,
    travelMsPerCell: 42,
    travelMinMs: 280,
    travelMaxMs: 520,
    travelLift: 0,
    travelScale: 1,
    footfallsPerCell: 0,
    impactMs: 190,
    hitStopMs: 70,
    victimExitMs: 280,
    // 炮在占领阶段才走完全程：先炸、再等尸体散尽、最后进位。
    occupyMs: 210,
    settleMs: 90,
    impactStrength: 1,
    claimStrength: 0.7,
  },
  pawn: {
    style: 'strike',
    windupMs: 55,
    windupOffset: 0.02,
    windupScale: 1.03,
    travelMsPerCell: 150,
    travelMinMs: 250,
    travelMaxMs: 360,
    travelLift: 0.11,
    travelScale: 1.04,
    footfallsPerCell: 2.2,
    impactMs: 125,
    hitStopMs: 40,
    victimExitMs: 210,
    occupyMs: 85,
    settleMs: 75,
    impactStrength: 0.45,
    claimStrength: 0.4,
  },
}

export interface CombatTimingOptions {
  /** 演出速度倍率，>1 更快；用于「快速模式」。 */
  speed?: number
  /**
   * `prefers-reduced-motion`：压到最短可读节拍并抑制位移幅度，但**保留全部
   * 阶段**——否则事件流会与常规模式不一致，自动化验收就失去可比性。
   */
  reducedMotion?: boolean
}

export interface CombatTimeline {
  style: AttackStyle
  windupMs: number
  travelMs: number
  impactMs: number
  hitStopMs: number
  victimExitMs: number
  occupyMs: number
  settleMs: number
  totalMs: number
  /** 各阶段起点，便于渲染层与测试直接比对。 */
  travelAtMs: number
  impactAtMs: number
  victimExitAtMs: number
  occupyAtMs: number
  /**
   * 占领脉冲触发时刻。近战棋种在占领起点就已站在落点上；投射棋种要等炮身
   * 真正走完全程，否则尘环会在飞行途中先响，读起来像打偏了。
   */
  claimAtMs: number
  settleAtMs: number
  /** 落步时刻（绝对毫秒），已按最终时长缩放。 */
  footfallsAtMs: number[]
  windupOffset: number
  windupScale: number
  travelLift: number
  travelScale: number
  impactStrength: number
  claimStrength: number
  /** 位移与缩放幅度的整体系数；reduced-motion 下显著变小。 */
  motionScale: number
}

const REDUCED_MOTION_SPEED = 2.2
const REDUCED_MOTION_AMPLITUDE = 0.25

/** 投射棋种在占领段走到这个比例时才算真正进位。 */
export const BARRAGE_CLAIM_RATIO = 0.775

/**
 * 把棋种档案解析成一条确定性时间线。
 *
 * 同一着法在任何设备、任何帧率下都得到同一张表：它只依赖棋种、直线距离、
 * 是否吃子和显式选项，不读时钟、不读随机数。
 */
export function resolveCombatTimeline(
  kind: PieceKind,
  distanceCells: number,
  hasVictim: boolean,
  options: CombatTimingOptions = {},
): CombatTimeline {
  const profile = COMBAT_PROFILES[kind]
  const reducedMotion = options.reducedMotion === true
  const requestedSpeed =
    Number.isFinite(options.speed) && (options.speed ?? 0) > 0
      ? (options.speed as number)
      : 1
  const speed = requestedSpeed * (reducedMotion ? REDUCED_MOTION_SPEED : 1)
  const distance = Number.isFinite(distanceCells) ? Math.max(0, distanceCells) : 0

  const rawTravel =
    profile.style === 'leap'
      ? profile.travelMinMs
      : clamp(
          profile.travelMsPerCell * distance +
            (profile.style === 'barrage' ? 200 : 0),
          profile.travelMinMs,
          profile.travelMaxMs,
        )

  let windupMs = profile.windupMs
  let travelMs = rawTravel
  let impactMs = hasVictim ? profile.impactMs : 0
  let hitStopMs = hasVictim ? profile.hitStopMs : 0
  let victimExitMs = hasVictim ? profile.victimExitMs : 0
  let occupyMs = hasVictim ? profile.occupyMs : 0
  let settleMs = profile.settleMs

  // 先按速度压缩，再对吃子演出施加硬上限；两者都是等比缩放，
  // 因此阶段占比恒定，节拍手感不随时长变化。
  const scale =
    (1 / speed) *
    captureCap(
      (windupMs + travelMs + impactMs + victimExitMs + occupyMs + settleMs) /
        speed,
      hasVictim,
    )
  windupMs = round(windupMs * scale)
  travelMs = round(travelMs * scale)
  impactMs = round(impactMs * scale)
  hitStopMs = round(Math.min(hitStopMs, profile.impactMs * 0.65) * scale)
  victimExitMs = round(victimExitMs * scale)
  occupyMs = round(occupyMs * scale)
  settleMs = round(settleMs * scale)

  const travelAtMs = windupMs
  const impactAtMs = travelAtMs + travelMs
  const victimExitAtMs = impactAtMs + impactMs
  const occupyAtMs = victimExitAtMs + victimExitMs
  const settleAtMs = occupyAtMs + occupyMs
  const totalMs = settleAtMs + settleMs

  const footfallCount =
    profile.footfallsPerCell > 0
      ? Math.max(1, Math.round(profile.footfallsPerCell * Math.max(1, distance)))
      : 0
  const footfallsAtMs: number[] = []
  for (let index = 0; index < footfallCount; index += 1) {
    footfallsAtMs.push(
      round(travelAtMs + ((index + 0.5) / footfallCount) * travelMs),
    )
  }

  const motionScale = reducedMotion ? REDUCED_MOTION_AMPLITUDE : 1
  return {
    style: profile.style,
    windupMs,
    travelMs,
    impactMs,
    hitStopMs,
    victimExitMs,
    occupyMs,
    settleMs,
    totalMs,
    travelAtMs,
    impactAtMs,
    victimExitAtMs,
    occupyAtMs,
    claimAtMs: round(
      profile.style === 'barrage'
        ? occupyAtMs + occupyMs * BARRAGE_CLAIM_RATIO
        : occupyAtMs,
    ),
    settleAtMs,
    footfallsAtMs,
    windupOffset: profile.windupOffset * motionScale,
    windupScale: 1 + (profile.windupScale - 1) * motionScale,
    travelLift: profile.travelLift * motionScale,
    travelScale: 1 + (profile.travelScale - 1) * motionScale,
    impactStrength: profile.impactStrength,
    claimStrength: profile.claimStrength,
    motionScale,
  }
}

function captureCap(durationMs: number, hasVictim: boolean): number {
  if (!hasVictim || durationMs <= MAX_CAPTURE_DURATION_MS) return 1
  return MAX_CAPTURE_DURATION_MS / durationMs
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
