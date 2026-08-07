import { describe, expect, it } from 'vitest'
import type { PieceKind } from '../types/xiangqi'
import {
  COMBAT_PROFILES,
  MAX_CAPTURE_DURATION_MS,
  resolveCombatTimeline,
} from './combatProfile'

const ALL_KINDS: PieceKind[] = [
  'king',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'pawn',
]

describe('resolveCombatTimeline', () => {
  it('阶段起点严格顺序排列，总时长等于各段之和', () => {
    for (const kind of ALL_KINDS) {
      const timeline = resolveCombatTimeline(kind, 3, true)
      expect(timeline.travelAtMs).toBe(timeline.windupMs)
      expect(timeline.impactAtMs).toBeCloseTo(
        timeline.travelAtMs + timeline.travelMs,
        6,
      )
      expect(timeline.victimExitAtMs).toBeCloseTo(
        timeline.impactAtMs + timeline.impactMs,
        6,
      )
      expect(timeline.occupyAtMs).toBeCloseTo(
        timeline.victimExitAtMs + timeline.victimExitMs,
        6,
      )
      expect(timeline.settleAtMs).toBeCloseTo(
        timeline.occupyAtMs + timeline.occupyMs,
        6,
      )
      // 占领脉冲必须落在占领段内。
      expect(timeline.claimAtMs).toBeGreaterThanOrEqual(timeline.occupyAtMs)
      expect(timeline.claimAtMs).toBeLessThan(timeline.settleAtMs)
      expect(timeline.totalMs).toBeCloseTo(
        timeline.settleAtMs + timeline.settleMs,
        6,
      )
    }
  })

  it('任何棋种、任何距离的吃子演出都不超过 1.6 秒硬上限', () => {
    for (const kind of ALL_KINDS) {
      for (const distance of [1, 2, 3, 5, 9, 12]) {
        const timeline = resolveCombatTimeline(kind, distance, true)
        expect(timeline.totalMs).toBeLessThanOrEqual(MAX_CAPTURE_DURATION_MS)
      }
    }
  })

  it('超限时等比压缩，阶段占比保持不变', () => {
    // 半速会把车的吃子演出推到 2.29 秒，必须被压回上限。
    const normal = resolveCombatTimeline('chariot', 1, true)
    const slow = resolveCombatTimeline('chariot', 1, true, { speed: 0.5 })
    expect(slow.totalMs).toBeCloseTo(MAX_CAPTURE_DURATION_MS, 3)
    const ratio = slow.totalMs / normal.totalMs
    // 各段独立取整到 0.001ms，占比只在这个量级上相等。
    expect(slow.windupMs / normal.windupMs).toBeCloseTo(ratio, 4)
    expect(slow.travelMs / normal.travelMs).toBeCloseTo(ratio, 4)
    expect(slow.occupyMs / normal.occupyMs).toBeCloseTo(ratio, 4)
  })

  it('空着不产生命中、消散与占领节拍', () => {
    const timeline = resolveCombatTimeline('chariot', 4, false)
    expect(timeline.impactMs).toBe(0)
    expect(timeline.hitStopMs).toBe(0)
    expect(timeline.victimExitMs).toBe(0)
    expect(timeline.occupyMs).toBe(0)
    expect(timeline.totalMs).toBeCloseTo(
      timeline.windupMs + timeline.travelMs + timeline.settleMs,
      6,
    )
  })

  it('七棋种拉开层次：帅将最重最慢，仕士与兵卒最轻最快', () => {
    const captures = ALL_KINDS.map((kind) => ({
      kind,
      timeline: resolveCombatTimeline(kind, 1, true),
    }))
    const byKind = new Map(captures.map((entry) => [entry.kind, entry.timeline]))

    expect(byKind.get('king')!.windupMs).toBeGreaterThan(
      byKind.get('pawn')!.windupMs,
    )
    expect(byKind.get('king')!.totalMs).toBeGreaterThan(
      byKind.get('advisor')!.totalMs,
    )
    expect(byKind.get('king')!.impactStrength).toBeGreaterThan(
      byKind.get('pawn')!.impactStrength,
    )
    // 象是重型落地：占领强度不低于任何其他棋种。
    for (const kind of ALL_KINDS) {
      expect(byKind.get('elephant')!.claimStrength).toBeGreaterThanOrEqual(
        byKind.get(kind)!.claimStrength,
      )
    }
  })

  it('马固定 480ms 腾跃，不随距离变化；车炮随距离变化但受上下限约束', () => {
    expect(resolveCombatTimeline('horse', 2.236, false).travelMs).toBe(480)
    expect(resolveCombatTimeline('horse', 9, false).travelMs).toBe(480)

    const shortChariot = resolveCombatTimeline('chariot', 1, false)
    const longChariot = resolveCombatTimeline('chariot', 9, false)
    expect(shortChariot.travelMs).toBe(COMBAT_PROFILES.chariot.travelMinMs)
    expect(longChariot.travelMs).toBe(COMBAT_PROFILES.chariot.travelMaxMs)
    expect(longChariot.travelMs).toBeGreaterThan(shortChariot.travelMs)
  })

  it('近战棋种在占领起点就压点，投射棋种要等炮身进位', () => {
    const chariot = resolveCombatTimeline('chariot', 3, true)
    expect(chariot.claimAtMs).toBe(chariot.occupyAtMs)

    const cannon = resolveCombatTimeline('cannon', 7, true)
    expect(cannon.claimAtMs).toBeGreaterThan(cannon.occupyAtMs)
    expect(cannon.claimAtMs).toBeLessThan(cannon.settleAtMs)
  })

  it('落步按行进段均匀铺开，腾空与投射棋种不产生落步', () => {
    const chariot = resolveCombatTimeline('chariot', 4, false)
    expect(chariot.footfallsAtMs.length).toBe(4)
    for (const atMs of chariot.footfallsAtMs) {
      expect(atMs).toBeGreaterThan(chariot.travelAtMs)
      expect(atMs).toBeLessThan(chariot.impactAtMs)
    }
    expect(resolveCombatTimeline('horse', 2, false).footfallsAtMs).toEqual([])
    expect(resolveCombatTimeline('cannon', 5, true).footfallsAtMs).toEqual([])
  })

  it('reduced-motion 压缩时长并显著降低位移幅度，但保留全部阶段', () => {
    const normal = resolveCombatTimeline('chariot', 3, true)
    const reduced = resolveCombatTimeline('chariot', 3, true, {
      reducedMotion: true,
    })
    expect(reduced.totalMs).toBeLessThan(normal.totalMs)
    expect(reduced.motionScale).toBeLessThan(0.5)
    expect(reduced.travelLift).toBeLessThan(normal.travelLift)
    expect(reduced.windupOffset).toBeLessThan(normal.windupOffset)
    // 阶段不能被裁掉，否则事件流与常规模式不可比。
    expect(reduced.impactMs).toBeGreaterThan(0)
    expect(reduced.victimExitMs).toBeGreaterThan(0)
    expect(reduced.occupyMs).toBeGreaterThan(0)
  })

  it('非法输入退化为安全默认值，不产生 NaN 时间线', () => {
    const timeline = resolveCombatTimeline('pawn', Number.NaN, true, {
      speed: Number.NaN,
    })
    expect(Number.isFinite(timeline.totalMs)).toBe(true)
    expect(timeline.totalMs).toBeGreaterThan(0)
    expect(timeline.travelMs).toBe(COMBAT_PROFILES.pawn.travelMinMs)
  })
})
