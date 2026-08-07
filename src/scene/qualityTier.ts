import type { PresentationProfile } from './presentationProfile'

/**
 * 运行时画质档。
 *
 * 它**不**修改 `resolvePresentationProfile`——那是一个只依赖视口的纯函数，
 * 混进运行时状态就再也无法在无 DOM 环境下断言。这里是一层正交的预算覆盖，
 * 最终生效值取两者的较严者。
 */
export type QualityTier = 'high' | 'balanced' | 'lite'

export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'balanced', 'lite']

export interface QualityBudget {
  /** DPR 上限；与 profile 的上限取较小者。 */
  pixelRatioCap: number
  shadows: boolean
  shadowMapCap: 512 | 1024 | 2048
  /** 命中火花数量比例 0–1。 */
  particleScale: number
  /** 命中瞬时点光是否启用。 */
  impactLight: boolean
  /** 震屏幅度系数。 */
  shakeScale: number
  /**
   * 角色轮廓辉光。每枚棋子多一个 draw call，且片元里要做多点采样模糊，
   * 低档必须能整体关掉。
   */
  characterGlow: boolean
  /** 每枚棋子的环绕光点数；0 表示关闭。全部棋子共用一个 Points，只有一次 draw。 */
  motesPerPiece: number
}

const TIER_BUDGETS: Record<QualityTier, QualityBudget> = {
  high: {
    pixelRatioCap: Number.POSITIVE_INFINITY,
    shadows: true,
    shadowMapCap: 2048,
    particleScale: 1,
    impactLight: true,
    shakeScale: 1,
    characterGlow: true,
    motesPerPiece: 10,
  },
  balanced: {
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapCap: 1024,
    particleScale: 0.6,
    impactLight: true,
    shakeScale: 0.75,
    characterGlow: true,
    motesPerPiece: 5,
  },
  lite: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapCap: 512,
    particleScale: 0.28,
    impactLight: false,
    shakeScale: 0.5,
    characterGlow: false,
    // 光点是全场共用的一次 draw call，几乎不花钱；真正贵的是辉光。
    // 最低档也保留一圈，免得整个角色识别度塌掉。
    motesPerPiece: 4,
  },
}

export interface EffectiveQuality extends QualityBudget {
  tier: QualityTier
  /** 与 profile 合成后真正下发给渲染器的 DPR。 */
  pixelRatio: number
  shadowMapSize: 512 | 1024 | 2048
}

/** profile ⊗ tier：逐项取较严者，任何一方要求降级都生效。 */
export function resolveEffectiveQuality(
  profile: PresentationProfile,
  tier: QualityTier,
): EffectiveQuality {
  const budget = TIER_BUDGETS[tier]
  return {
    ...budget,
    tier,
    pixelRatio: Math.min(profile.renderer.pixelRatio, budget.pixelRatioCap),
    shadows: profile.renderer.shadows && budget.shadows,
    shadowMapSize: Math.min(
      profile.renderer.shadowMapSize,
      budget.shadowMapCap,
    ) as 512 | 1024 | 2048,
  }
}

export function nextLowerTier(tier: QualityTier): QualityTier | null {
  const index = QUALITY_TIERS.indexOf(tier)
  return index >= 0 && index < QUALITY_TIERS.length - 1
    ? QUALITY_TIERS[index + 1]!
    : null
}

export function parseQualityTier(value: string | null): QualityTier | null {
  return QUALITY_TIERS.includes(value as QualityTier)
    ? (value as QualityTier)
    : null
}

// ------------------------------------------------------------- 运行时降档

export interface FrameBudgetConfig {
  /** 低于此帧率视为吃力。棋类游戏 40fps 完全够用，不值得为此砍掉画面。 */
  minimumFps: number
  /**
   * 回升阈值。与 `minimumFps` 拉开明显差距是**非对称滞回**的关键：
   * 阈值相同就会在临界点来回抖，不断重建阴影贴图与 DPR。
   */
  recoveryFps: number
  /** 需要连续多少个达标窗口才回升；配合冷却彻底杜绝抖动。 */
  recoveryWindows: number
  /** 采样窗口长度。 */
  windowMs: number
  /** 升降档后的冷却，避免连续几个窗口一路掉到底或一路弹回。 */
  cooldownMs: number
  /** 超过此值的帧间隔视为切标签页/卡顿，不计入采样。 */
  maxFrameDeltaMs: number
}

export const DEFAULT_FRAME_BUDGET_CONFIG: FrameBudgetConfig = {
  minimumFps: 38,
  recoveryFps: 56,
  recoveryWindows: 3,
  windowMs: 1500,
  cooldownMs: 6000,
  maxFrameDeltaMs: 100,
}

export interface FrameBudgetState {
  tier: QualityTier
  windowFrames: number
  windowElapsedMs: number
  /** 最近一个完整窗口的平均帧率；尚无完整窗口时为 null。 */
  lastWindowFps: number | null
  cooldownRemainingMs: number
  downgrades: number
  upgrades: number
  /** 连续达到回升阈值的窗口数。 */
  recoveryStreak: number
}

export function createFrameBudget(tier: QualityTier): FrameBudgetState {
  return {
    tier,
    windowFrames: 0,
    windowElapsedMs: 0,
    lastWindowFps: null,
    cooldownRemainingMs: 0,
    downgrades: 0,
    upgrades: 0,
    recoveryStreak: 0,
  }
}

export function nextHigherTier(tier: QualityTier): QualityTier | null {
  const index = QUALITY_TIERS.indexOf(tier)
  return index > 0 ? QUALITY_TIERS[index - 1]! : null
}

/**
 * 采样一帧并决定升降档。
 *
 * 用**非对称滞回**而不是单向只降：降档看 `minimumFps`，回升要求更高的
 * `recoveryFps` 且连续 `recoveryWindows` 个窗口达标，再叠加冷却。
 * 单向只降的代价是一次偶然的负载尖峰会**永久**拿掉画面表现——
 * 用户看到的就是「辉光和光点运行一会就没了」。
 */
export function advanceFrameBudget(
  state: FrameBudgetState,
  deltaMs: number,
  config: FrameBudgetConfig = DEFAULT_FRAME_BUDGET_CONFIG,
): FrameBudgetState {
  if (
    !Number.isFinite(deltaMs) ||
    deltaMs <= 0 ||
    deltaMs > config.maxFrameDeltaMs
  ) {
    return state
  }

  const cooldownRemainingMs = Math.max(0, state.cooldownRemainingMs - deltaMs)
  const windowFrames = state.windowFrames + 1
  const windowElapsedMs = state.windowElapsedMs + deltaMs
  if (windowElapsedMs < config.windowMs) {
    return { ...state, windowFrames, windowElapsedMs, cooldownRemainingMs }
  }

  const fps = (windowFrames * 1000) / windowElapsedMs
  const closed: FrameBudgetState = {
    ...state,
    windowFrames: 0,
    windowElapsedMs: 0,
    lastWindowFps: Math.round(fps * 10) / 10,
    cooldownRemainingMs,
  }

  const lower = nextLowerTier(state.tier)
  if (fps < config.minimumFps && lower !== null) {
    if (cooldownRemainingMs > 0) return { ...closed, recoveryStreak: 0 }
    return {
      ...closed,
      tier: lower,
      cooldownRemainingMs: config.cooldownMs,
      downgrades: state.downgrades + 1,
      recoveryStreak: 0,
    }
  }

  if (fps < config.recoveryFps) return { ...closed, recoveryStreak: 0 }

  const streak = state.recoveryStreak + 1
  const higher = nextHigherTier(state.tier)
  if (streak < config.recoveryWindows || higher === null || cooldownRemainingMs > 0) {
    return { ...closed, recoveryStreak: streak }
  }
  return {
    ...closed,
    tier: higher,
    cooldownRemainingMs: config.cooldownMs,
    upgrades: state.upgrades + 1,
    recoveryStreak: 0,
  }
}
