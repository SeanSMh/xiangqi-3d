import { describe, expect, it } from 'vitest'
import type { BoardCoord, GameState, Move, Piece, Side } from '../types/xiangqi'
import {
  AnimationDirector,
  type AnimationSurface,
  type PiecePose,
} from './animationDirector'

class FakeSurface implements AnimationSurface {
  poses = new Map<string, PiecePose>()
  snaps: GameState[] = []
  trailOpacity = 0
  projectileOpacity = 0
  projectilePose: PiecePose | null = null
  whiteImpactProgress = 0
  orangeImpactProgress = 0
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

describe('AnimationDirector', () => {
  it('普通车移动在半程产生直线插值并在结束时吸附权威局面', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const state = committedState([
      { id: 'rook', kind: 'chariot', side: 'red', file: 0, rank: 2 },
    ])
    const move: Move = {
      pieceId: 'rook',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 2 },
    }

    expect(director.start(move, state)).toBe(true)
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      inputLocked: true,
      kind: 'move',
      phase: 'travel',
    })

    director.advance(175)
    const halfway = surface.poses.get('rook')!
    expect(halfway.file).toBe(0)
    expect(halfway.rank).toBeGreaterThan(0)
    expect(halfway.rank).toBeLessThan(2)
    expect(surface.trailOpacity).toBeGreaterThan(0)

    expect(director.advance(1000)).toBe(true)
    expect(director.isBusy).toBe(false)
    expect(surface.snaps).toEqual([state])
    expect(director.getSnapshot()).toEqual({
      active: false,
      inputLocked: false,
      phase: 'idle',
    })
  })

  it('吃子依次进入冲击和受害者退场并允许大步长跨阶段', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const state = committedState([
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
    const move: Move = {
      pieceId: 'rook',
      from: { file: 1, rank: 1 },
      to: { file: 1, rank: 0 },
      capturedId: 'victim',
    }

    director.start(move, state)
    director.advance(349)
    const beforeImpact = surface.poses.get('rook')!
    expect(director.getSnapshot()).toMatchObject({ phase: 'travel' })

    director.advance(1)
    const atImpact = surface.poses.get('rook')!
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      kind: 'capture',
      phase: 'impact',
      victim: { id: 'victim', state: 'hit' },
      vfx: null,
    })
    expect(Math.abs(atImpact.lift - beforeImpact.lift)).toBeLessThan(0.001)
    expect(surface.whiteImpactProgress).toBe(0)

    director.advance(1)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      hitStop: { durationMs: 65, active: true },
      vfx: { kind: 'white-cyan-impact', active: true },
    })
    expect(surface.whiteImpactProgress).toBeGreaterThan(0)

    const frozenAttacker = surface.poses.get('rook')!
    const frozenVictim = surface.poses.get('victim')!
    director.advance(60)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      hitStop: { active: true },
    })
    expect(surface.poses.get('rook')).toEqual(frozenAttacker)
    expect(surface.poses.get('victim')).toEqual(frozenVictim)

    director.advance(189)
    const snapshot = director.getSnapshot()
    expect(snapshot).toMatchObject({
      active: true,
      phase: 'victim-exit',
      victim: { id: 'victim', state: 'exiting' },
    })
    expect(surface.poses.get('victim')!.scale).toBeLessThan(1)
    expect(surface.impacts).toBeGreaterThan(0)
    expect(surface.orangeImpactProgress).toBeGreaterThan(0)

    expect(director.advance(1000)).toBe(true)
    expect(surface.snaps).toEqual([state])
  })

  it('忙碌时拒绝覆盖动画，重开可取消并恢复指定局面', () => {
    const surface = new FakeSurface()
    const director = new AnimationDirector(surface)
    const state = committedState([
      { id: 'rook', kind: 'chariot', side: 'red', file: 0, rank: 1 },
    ])
    const move: Move = {
      pieceId: 'rook',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 1 },
    }

    expect(director.start(move, state)).toBe(true)
    expect(director.start(move, state)).toBe(false)
    director.cancelAndSnap(state)
    expect(director.isBusy).toBe(false)
    expect(surface.clears).toBe(1)
    expect(surface.snaps).toEqual([state])
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
    const splitSurface = new FakeSurface()
    const split = new AnimationDirector(splitSurface)
    const singleSurface = new FakeSurface()
    const single = new AnimationDirector(singleSurface)

    split.start(move, state)
    split.advance(80)
    split.advance(160)
    single.start(move, state)
    single.advance(240)

    expect(split.getSnapshot()).toEqual(single.getSnapshot())
    expect(split.getSnapshot()).toMatchObject({
      active: true,
      style: 'horse',
      phase: 'travel',
      attackerVisual: {
        file: 1.25,
        rank: 1,
        lift: 0.48,
        rotationY: 0.464,
      },
      projectile: null,
    })
    const halfway = splitSurface.poses.get('horse')!
    expect(halfway.file).toBeGreaterThan(1)
    expect(halfway.file).toBeLessThan(2)
    expect(halfway.rank).toBeCloseTo(1)
    expect(halfway.lift).toBeCloseTo(0.48)
    expect(halfway.rotationY).toBeCloseTo(Math.atan2(1, 2))
    expect(splitSurface.projectileOpacity).toBe(0)

    expect(split.advance(1000)).toBe(true)
    expect(splitSurface.snaps).toEqual([state])
  })

  it('炮吃子时炮身留在原位等待弹道命中，再随受害者退场入位', () => {
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

    expect(director.start(move, state)).toBe(true)
    director.advance(267.5)
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      style: 'cannon',
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
    expect(surface.projectilePose?.lift).toBeCloseTo(1.25)

    director.advance(267.5)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      attackerVisual: { rank: 2 },
      projectile: null,
      victim: { state: 'hit' },
      vfx: null,
    })
    expect(surface.projectileOpacity).toBe(0)
    expect(surface.whiteImpactProgress).toBe(0)

    director.advance(1)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'impact',
      vfx: { kind: 'white-cyan-impact', active: true },
    })
    expect(surface.whiteImpactProgress).toBeGreaterThan(0)

    director.advance(299)
    expect(director.getSnapshot()).toMatchObject({
      phase: 'victim-exit',
      attackerVisual: { file: 1, rank: 5.5 },
      victim: { state: 'exiting' },
      vfx: { kind: 'orange-gold-blast', active: true },
    })
    expect(surface.poses.get('victim')!.scale).toBeLessThan(1)

    expect(director.advance(1000)).toBe(true)
    expect(surface.projectileOpacity).toBe(0)
    expect(surface.snaps).toEqual([state])
  })
})
