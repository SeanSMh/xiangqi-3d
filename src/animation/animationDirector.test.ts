import { describe, expect, it } from 'vitest'
import type { BoardCoord, GameState, Move, Piece, Side } from '../types/xiangqi'
import {
  AnimationDirector,
  type AnimationEvent,
  type AnimationSurface,
  type PiecePose,
} from './animationDirector'
import { resolveCombatTimeline } from './combatProfile'

class FakeSurface implements AnimationSurface {
  poses = new Map<string, PiecePose>()
  dissolves = new Map<string, number>()
  attackPoses = new Map<string, boolean>()
  sawAttackPose = false
  snaps: GameState[] = []
  trailOpacity = 0
  projectileOpacity = 0
  projectilePose: PiecePose | null = null
  whiteImpactProgress = 0
  orangeImpactProgress = 0
  claimProgress = 0
  claimStrength = 0
  focusSquare: BoardCoord | null = null
  focusAmount = 0
  peakFocusAmount = 0
  windupTellProgress = 0
  peakWindupTell = 0
  observedEvents: AnimationEvent[] = []
  impacts = 0
  clears = 0

  setPiecePose(pieceId: string, pose: PiecePose): boolean {
    this.poses.set(pieceId, pose)
    return true
  }

  setMoveTrail(
    _from: BoardCoord,
    _to: BoardCoord,
    _progress: number,
    opacity: number,
    _side: Side,
  ): void {
    this.trailOpacity = opacity
  }

  setCaptureImpact(
    _square: BoardCoord,
    whiteProgress: number,
    orangeProgress: number,
  ): void {
    this.impacts += 1
    this.whiteImpactProgress = whiteProgress
    this.orangeImpactProgress = orangeProgress
  }

  setCannonProjectile(
    pose: PiecePose,
    _trailFrom: PiecePose,
    opacity: number,
  ): void {
    this.projectilePose = pose
    this.projectileOpacity = opacity
  }

  setPieceDissolve(pieceId: string, progress: number): void {
    this.dissolves.set(pieceId, progress)
  }

  setPieceAttackPose(pieceId: string, active: boolean): void {
    this.attackPoses.set(pieceId, active)
    if (active) this.sawAttackPose = true
  }

  setWindupTell(
    _square: BoardCoord,
    progress: number,
    strength: number,
    _side: Side,
  ): void {
    this.windupTellProgress = progress
    this.peakWindupTell = Math.max(this.peakWindupTell, progress * strength)
  }

  setClaimPulse(
    _square: BoardCoord,
    progress: number,
    strength: number,
  ): void {
    this.claimProgress = progress
    this.claimStrength = strength
  }

  setCombatFocus(
    square: BoardCoord | null,
    amount: number,
    strength: number,
  ): void {
    this.focusSquare = square
    this.focusAmount = amount * strength
    this.peakFocusAmount = Math.max(this.peakFocusAmount, this.focusAmount)
  }

  onAnimationEvent(event: AnimationEvent): void {
    this.observedEvents.push(event)
  }

  clearTransientEffects(): void {
    this.clears += 1
    this.projectileOpacity = 0
  }

  snapTo(state: GameState): void {
    this.snaps.push(state)
  }
}

function committedState(pieces: Piece[]): GameState {
  return {
    pieces,
    sideToMove: 'black',
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
  }
}

const CHARIOT_MOVE_STATE = committedState([
  { id: 'rook', kind: 'chariot', side: 'red', file: 0, rank: 2 },
])
const CHARIOT_MOVE: Move = {
  pieceId: 'rook',
  from: { file: 0, rank: 0 },
  to: { file: 0, rank: 2 },
}

const CHARIOT_CAPTURE_STATE = committedState([
  { id: 'rook', kind: 'chariot', side: 'red', file: 1, rank: 0 },
  {
    id: 'victim',
    kind: 'cannon',
    side: 'black',
    file: 1,
    rank: 0,
    captured: true,
  },
])
const CHARIOT_CAPTURE: Move = {
  pieceId: 'rook',
  from: { file: 1, rank: 1 },
  to: { file: 1, rank: 0 },
  capturedId: 'victim',
}

describe('AnimationDirector', () => {
  it('空着按 蓄力 → 行进 → 收势 推进，并在结束时吸附权威局面', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const timeline = resolveCombatTimeline('chariot', 2, false)

    expect(director.start(CHARIOT_MOVE, CHARIOT_MOVE_STATE)).toBe(true)
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      inputLocked: true,
      kind: 'move',
      style: 'charge',
      phase: 'windup',
    })

    // 蓄力：沿出手反方向拉开，尚未离开起点一侧。
    director.advance(timeline.windupMs * 0.6)
    const drawnBack = surface.poses.get('rook')!
    expect(drawnBack.rank).toBeLessThan(0)

    director.advance(timeline.windupMs * 0.4 + timeline.travelMs / 2)
    expect(director.getSnapshot()).toMatchObject({ phase: 'travel' })
    const halfway = surface.poses.get('rook')!
    expect(halfway.file).toBe(0)
    expect(halfway.rank).toBeGreaterThan(0)
    expect(halfway.rank).toBeLessThan(2)
    expect(surface.trailOpacity).toBeGreaterThan(0)

    expect(director.advance(5000).completed).toBe(true)
    expect(director.isBusy).toBe(false)
    expect(surface.snaps).toEqual([CHARIOT_MOVE_STATE])
    expect(director.getSnapshot()).toEqual({
      active: false,
      inputLocked: false,
      phase: 'idle',
    })
  })

  it('吃子依次经过 命中 → 消散 → 占领 → 收势，占领只在清场后开始', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const timeline = resolveCombatTimeline('chariot', 1, true)

    director.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    director.advance(timeline.impactAtMs - 1)
    expect(director.getSnapshot()).toMatchObject({ phase: 'travel' })
    const beforeImpact = surface.poses.get('rook')!

    director.advance(1)
    const atImpact = surface.poses.get('rook')!
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      kind: 'capture',
      phase: 'impact',
      victim: { id: 'victim', state: 'hit', dissolve: 0 },
      vfx: null,
    })
    expect(Math.abs(atImpact.lift - beforeImpact.lift)).toBeLessThan(0.2)
    expect(surface.whiteImpactProgress).toBe(0)

    // 打击停顿：VFX 起跑，但两个演员都被冻住。
    director.advance(1)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      hitStop: { durationMs: timeline.hitStopMs, active: true },
      vfx: { kind: 'white-cyan-impact', active: true },
    })
    expect(surface.whiteImpactProgress).toBeGreaterThan(0)
    const frozenAttacker = surface.poses.get('rook')!
    const frozenVictim = surface.poses.get('victim')!
    director.advance(timeline.hitStopMs - 10)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      hitStop: { active: true },
    })
    expect(surface.poses.get('rook')).toEqual(frozenAttacker)
    expect(surface.poses.get('victim')).toEqual(frozenVictim)

    // 消散：立绘自下而上散尽。
    director.advance(timeline.impactMs)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'victim-exit',
      victim: { id: 'victim', state: 'exiting' },
    })
    expect(surface.dissolves.get('victim')).toBeGreaterThan(0)
    expect(surface.dissolves.get('victim')).toBeLessThan(1)
    expect(surface.orangeImpactProgress).toBeGreaterThan(0)
    // 占领尚未开始。
    expect(surface.claimProgress).toBe(0)

    // 占领：目标已散尽，才压住交点。
    director.advance(timeline.victimExitMs)
    expect(director.getSnapshot()).toMatchObject({ phase: 'occupy' })
    expect(surface.dissolves.get('victim')).toBe(1)
    expect(surface.claimProgress).toBeGreaterThan(0)
    expect(surface.claimStrength).toBe(timeline.claimStrength)

    director.advance(timeline.occupyMs)
    expect(director.getSnapshot()).toMatchObject({ phase: 'settle' })

    expect(director.advance(5000).completed).toBe(true)
    expect(surface.snaps).toEqual([CHARIOT_CAPTURE_STATE])
  })

  it('单帧跨完整场演出时按时间序补齐全部事件，且与逐帧推进一致', () => {
    const jump = new AnimationDirector(new FakeSurface())
    jump.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    const jumped = jump.advance(5000)
    expect(jumped.completed).toBe(true)
    expect(jumped.events.map((event) => event.type)).toEqual([
      'windup',
      'footfall',
      'impact',
      'victim-dissolve',
      'claim',
      'settle',
      'complete',
    ])

    const timeline = resolveCombatTimeline('chariot', 1, true)
    expect(jumped.events.find((event) => event.type === 'impact')).toMatchObject(
      {
        atMs: timeline.impactAtMs,
        square: { file: 1, rank: 0 },
        pieceId: 'rook',
        pieceKind: 'chariot',
        side: 'red',
        strength: timeline.impactStrength,
      },
    )
    // 占领事件落在**落点**上，不是受击点——两者在炮的场景里并不相同。
    expect(jumped.events.find((event) => event.type === 'claim')).toMatchObject({
      atMs: timeline.occupyAtMs,
      square: { file: 1, rank: 0 },
      strength: timeline.claimStrength,
    })

    const steppedSurface = new FakeSurface()
    const stepped = new AnimationDirector(steppedSurface)
    stepped.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    const collected = []
    for (let frame = 0; frame < 400; frame += 1) {
      const result = stepped.advance(16)
      collected.push(...result.events)
      if (result.completed) break
    }
    expect(collected).toEqual(jumped.events)
    // 表现层订阅到的事件流必须与返回值完全一致，否则粒子会与音效错位。
    expect(steppedSurface.observedEvents).toEqual(collected)
  })

  it('每个事件只发出一次，推进到终点后不再补发', () => {
    const director = new AnimationDirector(new FakeSurface())
    const timeline = resolveCombatTimeline('pawn', 1, false)
    director.start(
      { pieceId: 'pawn', from: { file: 0, rank: 3 }, to: { file: 0, rank: 4 } },
      committedState([{ id: 'pawn', kind: 'pawn', side: 'red', file: 0, rank: 4 }]),
    )

    const snapshot = director.getSnapshot()
    expect(snapshot.active && snapshot.timeline.marks[0]).toEqual({
      type: 'windup',
      atMs: 0,
    })
    expect(snapshot.active && snapshot.timeline.emitted).toBe(0)

    expect(director.advance(1).events.map((e) => e.type)).toEqual(['windup'])
    expect(director.advance(timeline.settleAtMs - 1).events.at(-1)?.type).toBe(
      'settle',
    )
    expect(director.advance(1).events).toEqual([])
    const final = director.advance(5000)
    expect(final.completed).toBe(true)
    expect(final.events.map((e) => e.type)).toEqual(['complete'])
    expect(director.advance(1000)).toEqual({ completed: false, events: [] })
  })

  it('忙碌时拒绝覆盖动画，取消会复位消散并恢复指定局面', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)

    expect(director.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)).toBe(true)
    expect(director.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)).toBe(false)
    // 推进到消散中段后取消：残留的 uniform 必须被清掉。
    director.advance(
      resolveCombatTimeline('chariot', 1, true).victimExitAtMs + 40,
    )
    expect(surface.dissolves.get('victim')).toBeGreaterThan(0)

    director.cancelAndSnap(CHARIOT_CAPTURE_STATE)
    expect(director.isBusy).toBe(false)
    expect(surface.dissolves.get('victim')).toBe(0)
    expect(surface.clears).toBe(1)
    expect(surface.snaps).toEqual([CHARIOT_CAPTURE_STATE])
  })

  it('马在固定 480ms 内沿日字贝塞尔弧线跃起，分步推进结果保持确定', () => {
    const state = committedState([
      { id: 'horse', kind: 'horse', side: 'red', file: 2, rank: 2 },
    ])
    const move: Move = {
      pieceId: 'horse',
      from: { file: 1, rank: 0 },
      to: { file: 2, rank: 2 },
    }
    const timeline = resolveCombatTimeline('horse', Math.hypot(1, 2), false)
    const midTravel = timeline.windupMs + timeline.travelMs / 2

    const splitSurface = new FakeSurface()
    const split = new AnimationDirector(splitSurface)
    const singleSurface = new FakeSurface()
    const single = new AnimationDirector(singleSurface)

    split.start(move, state)
    split.advance(midTravel * 0.3)
    split.advance(midTravel * 0.7)
    single.start(move, state)
    single.advance(midTravel)

    expect(split.getSnapshot()).toEqual(single.getSnapshot())
    expect(split.getSnapshot()).toMatchObject({
      active: true,
      style: 'leap',
      phase: 'travel',
      attackerVisual: { file: 1.25, rank: 1, lift: 0.48, rotationY: 0.464 },
      projectile: null,
    })
    const halfway = splitSurface.poses.get('horse')!
    expect(halfway.rotationY).toBeCloseTo(Math.atan2(1, 2))
    expect(splitSurface.projectileOpacity).toBe(0)

    expect(split.advance(5000).completed).toBe(true)
    expect(splitSurface.snaps).toEqual([state])
  })

  it('炮吃子：原地蓄能后坐 → 弹道 → 爆炸 → 目标消散 → 占领阶段才进位', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const state = committedState([
      { id: 'cannon', kind: 'cannon', side: 'red', file: 1, rank: 9 },
      { id: 'screen', kind: 'cannon', side: 'black', file: 1, rank: 7 },
      {
        id: 'victim',
        kind: 'horse',
        side: 'black',
        file: 1,
        rank: 9,
        captured: true,
      },
    ])
    const move: Move = {
      pieceId: 'cannon',
      from: { file: 1, rank: 2 },
      to: { file: 1, rank: 9 },
      capturedId: 'victim',
    }
    const timeline = resolveCombatTimeline('cannon', 7, true)

    expect(director.start(move, state)).toBe(true)
    expect(director.getSnapshot()).toMatchObject({
      style: 'barrage',
      phase: 'windup',
    })
    // 后坐：沿出手反方向退，rank 小于起点。
    director.advance(timeline.windupMs * 0.6)
    expect(surface.poses.get('cannon')!.rank).toBeLessThan(2)

    director.advance(timeline.windupMs * 0.4 + timeline.travelMs / 2)
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      phase: 'projectile',
      attackerVisual: { file: 1, rank: 2 },
      projectile: {
        kind: 'cannonball',
        progress: 0.5,
        pose: { file: 1, rank: 5.5, lift: 1.25 },
      },
      victim: { state: 'waiting' },
    })
    expect(surface.projectileOpacity).toBe(1)

    director.advance(timeline.travelMs / 2)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      attackerVisual: { rank: 2 },
      projectile: null,
      victim: { state: 'hit' },
    })
    expect(surface.projectileOpacity).toBe(0)

    // 消散期间炮身仍留在原位。消散在本阶段起点恰好为 0（与命中阶段连续），
    // 因此推进到段内 40% 处再断言。
    director.advance(timeline.impactMs + timeline.victimExitMs * 0.4)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'victim-exit',
      attackerVisual: { file: 1, rank: 2 },
      victim: { state: 'exiting' },
    })
    expect(surface.dissolves.get('victim')).toBeGreaterThan(0)

    // 占领阶段才开始进位。
    director.advance(timeline.victimExitMs * 0.6 + timeline.occupyMs / 2)
    const occupying = director.getSnapshot()
    expect(occupying).toMatchObject({ phase: 'occupy' })
    const rank =
      occupying.active && occupying.attackerVisual.rank
    expect(rank).toBeGreaterThan(2)
    expect(rank).toBeLessThan(9)

    expect(director.advance(5000).completed).toBe(true)
    expect(surface.projectileOpacity).toBe(0)
    expect(surface.snaps).toEqual([state])
  })

  it('剧情镜头在命中段拉起，收势前精确归零，逐次演出不累积漂移', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const timeline = resolveCombatTimeline('chariot', 1, true)

    director.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    // 行进阶段不应有任何剧情偏移。
    director.advance(timeline.impactAtMs - 5)
    expect(surface.focusSquare).toBeNull()
    expect(surface.focusAmount).toBe(0)

    director.advance(
      5 + (timeline.settleAtMs - timeline.impactAtMs) / 2,
    )
    expect(surface.focusSquare).toEqual({ file: 1, rank: 0 })
    expect(surface.focusAmount).toBeGreaterThan(0)

    // 进入收势：必须已经完全复位。
    director.advance(timeline.settleAtMs - timeline.impactAtMs)
    expect(surface.focusSquare).toBeNull()
    expect(surface.focusAmount).toBe(0)

    director.advance(5000)
    expect(surface.focusAmount).toBe(0)
    expect(surface.peakFocusAmount).toBeGreaterThan(0)

    // 空着全程不产生剧情偏移。
    const plainSurface = new FakeSurface()
    const plain = new AnimationDirector(plainSurface)
    plain.start(CHARIOT_MOVE, CHARIOT_MOVE_STATE)
    plain.advance(5000)
    expect(plainSurface.peakFocusAmount).toBe(0)
  })

  it('蓄力预兆强度按棋种分档：重子明显、轻子几乎不可见，收尾归零', () => {
    const peakTellFor = (kind: Piece['kind'], id: string) => {
      const surface = new FakeSurface()
      const director = new AnimationDirector(surface)
      const state = committedState([
        { id, kind, side: 'red', file: 4, rank: 1 },
      ])
      director.start(
        { pieceId: id, from: { file: 4, rank: 0 }, to: { file: 4, rank: 1 } },
        state,
      )
      // 逐帧推进，才能采到蓄力段中间的峰值。
      for (let frame = 0; frame < 400; frame += 1) {
        if (director.advance(8).completed) break
      }
      return { peak: surface.peakWindupTell, final: surface.windupTellProgress }
    }

    const king = peakTellFor('king', 'k')
    const pawn = peakTellFor('pawn', 'p')
    const chariot = peakTellFor('chariot', 'r')

    expect(king.peak).toBeGreaterThan(pawn.peak)
    expect(chariot.peak).toBeGreaterThan(pawn.peak)
    // 蓄力结束后预兆必须回到 0，否则环会留在起点。
    expect(king.final).toBe(0)
    expect(pawn.final).toBe(0)
  })

  it('出手姿只在吃子的 蓄力→命中 窗口内启用，空着与取消都回到待机', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const timeline = resolveCombatTimeline('chariot', 1, true)

    director.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    expect(surface.attackPoses.get('rook')).toBe(true)

    director.advance(timeline.impactAtMs + timeline.impactMs - 5)
    expect(surface.attackPoses.get('rook')).toBe(true)

    // 进入消散：收势回待机，让位给占领节拍。
    director.advance(10)
    expect(surface.attackPoses.get('rook')).toBe(false)

    director.advance(5000)
    expect(surface.attackPoses.get('rook')).toBe(false)

    // 空着全程不拔刀。
    const plainSurface = new FakeSurface()
    const plain = new AnimationDirector(plainSurface)
    plain.start(CHARIOT_MOVE, CHARIOT_MOVE_STATE)
    plain.advance(5000)
    expect(plainSurface.sawAttackPose).toBe(false)

    // 演出中途取消也必须复位。
    const cancelSurface = new FakeSurface()
    const cancelled = new AnimationDirector(cancelSurface)
    cancelled.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    cancelled.advance(timeline.windupMs + 10)
    expect(cancelSurface.attackPoses.get('rook')).toBe(true)
    cancelled.cancelAndSnap(CHARIOT_CAPTURE_STATE)
    expect(cancelSurface.attackPoses.get('rook')).toBe(false)
  })

  it('reduced-motion 保留全部事件类型，只压缩时长与幅度', () => {
    const normal = new AnimationDirector(new FakeSurface())
    const reduced = new AnimationDirector(new FakeSurface(), {
      reducedMotion: true,
    })
    normal.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)
    reduced.start(CHARIOT_CAPTURE, CHARIOT_CAPTURE_STATE)

    const normalEvents = normal.advance(5000).events.map((e) => e.type)
    const reducedEvents = reduced.advance(5000).events.map((e) => e.type)
    expect(reducedEvents).toEqual(normalEvents)
    expect(reduced.getTiming()).toEqual({ reducedMotion: true })
  })
})
