import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/board'
import { applyMove } from '../engine/moves'
import type { GameState, Piece } from '../types/xiangqi'
import { GameTimeline } from './timeline'

describe('GameTimeline', () => {
  it('逐手保存局面，并可前后回放而不改动实时分支', () => {
    const root = createInitialState()
    const afterRed = applyMove(root, {
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    const afterBlack = applyMove(afterRed, {
      pieceId: 'p28',
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    })
    const timeline = new GameTimeline(root)
    timeline.commitMove({
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    timeline.commitMove({
      pieceId: 'p28',
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    })

    expect(timeline.getSnapshot()).toMatchObject({
      revision: 2,
      cursorPly: 2,
      livePly: 2,
      isReviewing: false,
      canUndo: true,
      canStepBackward: true,
      canStepForward: false,
    })

    expect(timeline.stepBackward()).toBe(true)
    expect(timeline.getState().history).toHaveLength(1)
    expect(timeline.getState().sideToMove).toBe('black')
    expect(timeline.getLiveState().history).toHaveLength(2)
    expect(timeline.getSnapshot()).toMatchObject({
      revision: 3,
      cursorPly: 1,
      livePly: 2,
      isReviewing: true,
      canUndo: false,
      canStepForward: true,
    })

    expect(timeline.seek(0)).toBe(true)
    expect(timeline.getState().history).toHaveLength(0)
    expect(timeline.returnToLive()).toBe(true)
    expect(timeline.getState()).toEqual(afterBlack)
  })

  it('悔棋移除实时分支最后一手并恢复被吃棋子', () => {
    const root = captureFixture()
    const timeline = new GameTimeline(root)
    timeline.commitMove({
      pieceId: 'rook',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 3 },
    })

    expect(timeline.getState().pieces.find((piece) => piece.id === 'target')?.captured).toBe(true)
    expect(timeline.undo()).toBe(true)
    expect(timeline.getState()).toEqual(root)
    expect(timeline.getState().pieces.find((piece) => piece.id === 'target')?.captured).toBeUndefined()
    expect(timeline.undo()).toBe(false)

    timeline.commitMove({
      pieceId: 'rook',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 3 },
    })
    timeline.reset()
    expect(timeline.getState()).toEqual(root)
  })

  it('绝杀着撤销后恢复 playing、行棋方与胜负字段', () => {
    const root = checkmateFixture()
    const terminal = applyMove(root, {
      pieceId: 'attack',
      from: { file: 4, rank: 7 },
      to: { file: 4, rank: 8 },
    })
    expect(terminal.status).toBe('checkmate')

    const timeline = new GameTimeline(root)
    timeline.commitMove({
      pieceId: 'attack',
      from: { file: 4, rank: 7 },
      to: { file: 4, rank: 8 },
    })
    expect(timeline.undo()).toBe(true)
    expect(timeline.getState()).toEqual(root)
    expect(timeline.getState()).toMatchObject({
      status: 'playing',
      winner: null,
      inCheck: false,
      sideToMove: 'red',
    })
  })

  it('回放中拒绝提交新分支，重置后清空可访问时间线', () => {
    const root = createInitialState()
    const timeline = new GameTimeline(root)
    timeline.commitMove({
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    timeline.stepBackward()

    expect(() =>
      timeline.commitMove({
        pieceId: 'p12',
        from: { file: 0, rank: 3 },
        to: { file: 0, rank: 4 },
      }),
    ).toThrow('回放中不能提交新着法')
    timeline.reset()
    expect(timeline.getSnapshot()).toMatchObject({
      cursorPly: 0,
      livePly: 0,
      canUndo: false,
      canStepBackward: false,
      canStepForward: false,
      canReplay: false,
    })
  })

  it('对外返回副本，外部修改不会污染时间线或重开基线', () => {
    const root = createInitialState()
    const timeline = new GameTimeline(root)
    const exposed = timeline.getState()
    exposed.pieces[0]!.file = 8
    exposed.history.push({
      pieceId: 'fake',
      side: 'red',
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 1 },
      givesCheck: false,
    })

    expect(timeline.getState()).toEqual(root)
    timeline.commitMove({
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    timeline.reset()
    expect(timeline.getState()).toEqual(root)
  })

  it('人机悔棋可原子回到人类决策点且 revision 只递增一次', () => {
    const root = createInitialState()
    const timeline = new GameTimeline(root)
    timeline.commitMove({
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    timeline.commitMove({
      pieceId: 'p28',
      from: { file: 0, rank: 6 },
      to: { file: 0, rank: 5 },
    })

    expect(timeline.undoToSide('red')).toBe(2)
    expect(timeline.getState()).toEqual(root)
    expect(timeline.getSnapshot()).toMatchObject({
      revision: 3,
      cursorPly: 0,
      livePly: 0,
    })

    timeline.commitMove({
      pieceId: 'p12',
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    expect(timeline.undoToSide('red')).toBe(1)
    expect(timeline.getSnapshot()).toMatchObject({ revision: 5, livePly: 0 })
  })
})

function captureFixture(): GameState {
  const pieces: Piece[] = [
    { id: 'rk', kind: 'king', side: 'red', file: 4, rank: 0 },
    { id: 'bk', kind: 'king', side: 'black', file: 4, rank: 9 },
    { id: 'block', kind: 'pawn', side: 'red', file: 4, rank: 5 },
    { id: 'rook', kind: 'chariot', side: 'red', file: 0, rank: 0 },
    { id: 'target', kind: 'pawn', side: 'black', file: 0, rank: 3 },
  ]
  return game(pieces)
}

function checkmateFixture(): GameState {
  return game([
    { id: 'rk', kind: 'king', side: 'red', file: 4, rank: 0 },
    { id: 'bk', kind: 'king', side: 'black', file: 4, rank: 9 },
    { id: 'attack', kind: 'chariot', side: 'red', file: 4, rank: 7 },
    { id: 'left', kind: 'chariot', side: 'red', file: 3, rank: 8 },
    { id: 'right', kind: 'chariot', side: 'red', file: 5, rank: 8 },
  ])
}

function game(pieces: Piece[]): GameState {
  return {
    pieces,
    sideToMove: 'red',
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
  }
}
