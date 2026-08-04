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
    _whiteProgress: number,
    _orangeProgress: number,
  ): void {
    this.impacts += 1
  }

  clearTransientEffects(): void {
    this.clears += 1
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
    director.advance(350)
    expect(director.getSnapshot()).toMatchObject({
      active: true,
      kind: 'capture',
      phase: 'impact',
      victim: { id: 'victim', state: 'hit' },
      vfx: { active: true },
    })

    director.advance(250)
    const snapshot = director.getSnapshot()
    expect(snapshot).toMatchObject({
      active: true,
      phase: 'victim-exit',
      victim: { id: 'victim', state: 'exiting' },
    })
    expect(surface.poses.get('victim')!.scale).toBeLessThan(1)
    expect(surface.impacts).toBeGreaterThan(0)

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
})
