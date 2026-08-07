import { describe, expect, it } from 'vitest'
import { resolvePresentationProfile } from './presentationProfile'
import {
  DEFAULT_FRAME_BUDGET_CONFIG,
  advanceFrameBudget,
  createFrameBudget,
  nextHigherTier,
  nextLowerTier,
  parseQualityTier,
  resolveEffectiveQuality,
  type FrameBudgetState,
} from './qualityTier'

const DESKTOP = resolvePresentationProfile(1280, 720, 2)
const PHONE = resolvePresentationProfile(375, 667, 3)

/** 以固定帧率推进 n 毫秒。 */
function run(
  state: FrameBudgetState,
  fps: number,
  durationMs: number,
): FrameBudgetState {
  const frameMs = 1000 / fps
  let current = state
  for (let elapsed = 0; elapsed < durationMs; elapsed += frameMs) {
    current = advanceFrameBudget(current, frameMs)
  }
  return current
}

describe('resolveEffectiveQuality', () => {
  it('逐项取 profile 与档位的较严者', () => {
    const high = resolveEffectiveQuality(DESKTOP, 'high')
    expect(high.pixelRatio).toBe(DESKTOP.renderer.pixelRatio)
    expect(high.shadows).toBe(true)
    expect(high.shadowMapSize).toBe(2048)

    const lite = resolveEffectiveQuality(DESKTOP, 'lite')
    expect(lite.pixelRatio).toBe(1)
    expect(lite.shadows).toBe(false)
    expect(lite.shadowMapSize).toBe(512)
    expect(lite.impactLight).toBe(false)
    expect(lite.particleScale).toBeLessThan(0.5)
  })

  it('手机 profile 已经关阴影时，高档也不会把阴影打开', () => {
    expect(PHONE.renderer.shadows).toBe(false)
    expect(resolveEffectiveQuality(PHONE, 'high').shadows).toBe(false)
    // DPR 仍受 profile 上限约束。
    expect(resolveEffectiveQuality(PHONE, 'high').pixelRatio).toBe(
      PHONE.renderer.pixelRatio,
    )
  })

  it('角色辉光与光点按档位收紧，最低档只关辉光', () => {
    expect(resolveEffectiveQuality(DESKTOP, 'high').characterGlow).toBe(true)
    expect(resolveEffectiveQuality(DESKTOP, 'balanced').characterGlow).toBe(true)
    // 辉光是每棋子一个 draw call 且片元里做多点采样，低档必须关掉。
    expect(resolveEffectiveQuality(DESKTOP, 'lite').characterGlow).toBe(false)

    const high = resolveEffectiveQuality(DESKTOP, 'high').motesPerPiece
    const balanced = resolveEffectiveQuality(DESKTOP, 'balanced').motesPerPiece
    expect(balanced).toBeLessThan(high)
    expect(resolveEffectiveQuality(DESKTOP, 'lite').motesPerPiece).toBeLessThan(
      balanced,
    )
  })

  it('档位单调收紧：high ≥ balanced ≥ lite', () => {
    const high = resolveEffectiveQuality(DESKTOP, 'high')
    const balanced = resolveEffectiveQuality(DESKTOP, 'balanced')
    const lite = resolveEffectiveQuality(DESKTOP, 'lite')
    expect(balanced.pixelRatio).toBeLessThanOrEqual(high.pixelRatio)
    expect(lite.pixelRatio).toBeLessThanOrEqual(balanced.pixelRatio)
    expect(balanced.particleScale).toBeLessThan(high.particleScale)
    expect(lite.particleScale).toBeLessThan(balanced.particleScale)
    expect(lite.shakeScale).toBeLessThan(balanced.shakeScale)
  })
})

describe('advanceFrameBudget', () => {
  it('帧率充足时永不降档', () => {
    const state = run(createFrameBudget('high'), 60, 20_000)
    expect(state.tier).toBe('high')
    expect(state.downgrades).toBe(0)
    expect(state.lastWindowFps).toBeGreaterThan(55)
  })

  it('持续低帧率逐级降档，且受冷却约束不会一口气掉到底', () => {
    let state = run(createFrameBudget('high'), 24, DEFAULT_FRAME_BUDGET_CONFIG.windowMs * 2)
    expect(state.tier).toBe('balanced')
    expect(state.downgrades).toBe(1)

    // 冷却期内即使继续低帧也不再降。
    state = run(state, 24, DEFAULT_FRAME_BUDGET_CONFIG.windowMs * 2)
    expect(state.tier).toBe('balanced')

    // 冷却过后才允许下一级。
    state = run(state, 24, DEFAULT_FRAME_BUDGET_CONFIG.cooldownMs * 2)
    expect(state.tier).toBe('lite')
    expect(state.downgrades).toBe(2)

    // 最低档没有更低一级可降。
    state = run(state, 24, DEFAULT_FRAME_BUDGET_CONFIG.cooldownMs * 3)
    expect(state.tier).toBe('lite')
    expect(state.downgrades).toBe(2)
  })

  it('帧率充分回升后逐级回档，但要求更高阈值且连续多个窗口', () => {
    let state = run(createFrameBudget('high'), 20, DEFAULT_FRAME_BUDGET_CONFIG.windowMs * 2)
    expect(state.tier).toBe('balanced')

    // 卡在两阈值之间的「温吞」帧率不触发回升，否则就会在临界点抖动。
    const between =
      (DEFAULT_FRAME_BUDGET_CONFIG.minimumFps +
        DEFAULT_FRAME_BUDGET_CONFIG.recoveryFps) /
      2
    state = run(state, between, 30_000)
    expect(state.tier).toBe('balanced')
    expect(state.upgrades).toBe(0)

    // 真正跑顺了才逐级回来。
    state = run(state, 120, 30_000)
    expect(state.tier).toBe('high')
    expect(state.upgrades).toBeGreaterThan(0)
  })

  it('回升同样受冷却约束，不会一个窗口就弹回去', () => {
    let state = run(createFrameBudget('high'), 20, DEFAULT_FRAME_BUDGET_CONFIG.windowMs * 2)
    expect(state.tier).toBe('balanced')
    // 刚降档就满帧：冷却未过 + 连续窗口数不足，仍应停在 balanced。
    state = run(state, 120, DEFAULT_FRAME_BUDGET_CONFIG.windowMs * 2)
    expect(state.tier).toBe('balanced')
  })

  it('最低档也保留光点——它是全场一次 draw call，代价可忽略', () => {
    const lite = resolveEffectiveQuality(DESKTOP, 'lite')
    expect(lite.characterGlow).toBe(false)
    expect(lite.motesPerPiece).toBeGreaterThan(0)
  })

  it('切标签页/卡顿造成的超长帧不计入采样', () => {
    const initial = createFrameBudget('high')
    // 单帧 5 秒：这是停顿，不是持续低帧率。
    expect(advanceFrameBudget(initial, 5000)).toBe(initial)
    expect(advanceFrameBudget(initial, 0)).toBe(initial)
    expect(advanceFrameBudget(initial, Number.NaN)).toBe(initial)

    // 手动时钟的大步推进同样被挡在采样之外。
    let state = initial
    for (let index = 0; index < 20; index += 1) {
      state = advanceFrameBudget(state, 2000)
    }
    expect(state.tier).toBe('high')
    expect(state.downgrades).toBe(0)
  })
})

describe('档位工具', () => {
  it('nextLowerTier / nextHigherTier 在两端返回 null', () => {
    expect(nextLowerTier('high')).toBe('balanced')
    expect(nextLowerTier('balanced')).toBe('lite')
    expect(nextLowerTier('lite')).toBeNull()
    expect(nextHigherTier('lite')).toBe('balanced')
    expect(nextHigherTier('balanced')).toBe('high')
    expect(nextHigherTier('high')).toBeNull()
  })

  it('parseQualityTier 只接受已知档位', () => {
    expect(parseQualityTier('lite')).toBe('lite')
    expect(parseQualityTier('ultra')).toBeNull()
    expect(parseQualityTier(null)).toBeNull()
  })
})
