import { describe, expect, it } from 'vitest'
import type { GameState, Piece } from '../types/xiangqi'
import { GameController } from './controller'

describe('GameController', () => {
  it('选择当前行棋方棋子并暴露合法落点', () => {
    const controller = new GameController()
    expect(controller.handleSquare(0, 3).type).toBe('selected')
    expect(controller.getSelectedPiece()?.kind).toBe('pawn')
    expect(controller.getLegalMoves().map((move) => move.to)).toEqual([
      { file: 0, rank: 4 },
    ])
  })

  it('点击合法落点执行走子、切换阵营并清空选择', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    expect(controller.handleSquare(0, 4).type).toBe('moved')
    expect(controller.getState().sideToMove).toBe('black')
    expect(controller.getState().history).toHaveLength(1)
    expect(controller.getState().pieces.find((piece) => piece.file === 0 && piece.rank === 4)?.side).toBe('red')
    expect(controller.getSelectedId()).toBeNull()
  })

  it('生成结构化坐标棋谱，并能逐手回放后返回实时局面', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    controller.handleSquare(0, 4)
    controller.handleSquare(0, 6)
    controller.handleSquare(0, 5)

    expect(controller.getMoveLog().map((entry) => entry.text)).toEqual([
      '红兵 (1,4) → (1,5)',
      '黑卒 (1,7) → (1,6)',
    ])
    expect(controller.getTimelineSnapshot()).toMatchObject({
      cursorPly: 2,
      livePly: 2,
      isReviewing: false,
    })

    expect(controller.stepReplayBackward()).toBe(true)
    expect(controller.getState().history).toHaveLength(1)
    expect(controller.getState().sideToMove).toBe('black')
    expect(controller.handleSquare(2, 6).type).toBe('ignored')
    expect(controller.getSelectedId()).toBeNull()

    expect(controller.seekReplay(0)).toBe(true)
    expect(controller.getState().history).toHaveLength(0)
    expect(controller.stepReplayForward()).toBe(true)
    expect(controller.returnToLive()).toBe(true)
    expect(controller.getState().history).toHaveLength(2)
  })

  it('可切换己方选择，点击空白或对方非法目标会清空', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    controller.handleSquare(2, 3)
    expect(controller.getSelectedPiece()?.file).toBe(2)
    controller.handleSquare(1, 5)
    expect(controller.getSelectedId()).toBeNull()
  })

  it('返回可直接显示的选边、空点与棋子规则原因', () => {
    const controller = new GameController()
    expect(controller.handleSquare(0, 6)).toEqual({
      type: 'cleared',
      reason: 'wrong-side',
    })
    expect(controller.handleSquare(4, 4)).toEqual({
      type: 'cleared',
      reason: 'no-selection',
    })

    expect(controller.handleSquare(1, 0)).toEqual({ type: 'selected' })
    expect(controller.handleSquare(3, 1)).toEqual({
      type: 'cleared',
      reason: 'horse-leg-blocked',
    })
  })

  it('吃子由规则引擎结算且终局忽略输入', () => {
    const pieces: Piece[] = [
      { id: 'rk', kind: 'king', side: 'red', file: 4, rank: 0 },
      { id: 'bk', kind: 'king', side: 'black', file: 4, rank: 9 },
      { id: 'block', kind: 'pawn', side: 'red', file: 4, rank: 5 },
      { id: 'rook', kind: 'chariot', side: 'red', file: 0, rank: 0 },
      { id: 'target', kind: 'pawn', side: 'black', file: 0, rank: 3 },
    ]
    const state: GameState = {
      pieces,
      sideToMove: 'red',
      history: [],
      inCheck: false,
      winner: null,
      status: 'playing',
    }
    const controller = new GameController(state)
    controller.handleSquare(0, 0)
    expect(controller.handleSquare(0, 3).type).toBe('moved')
    expect(controller.getState().pieces.find((piece) => piece.id === 'target')?.captured).toBe(true)

    expect(controller.undoLastMove()).toBe(true)
    expect(controller.getState().pieces.find((piece) => piece.id === 'rook')).toMatchObject({ file: 0, rank: 0 })
    expect(controller.getState().pieces.find((piece) => piece.id === 'target')?.captured).toBeUndefined()
    expect(controller.getState().history).toHaveLength(0)

    const terminal = new GameController({
      ...state,
      status: 'checkmate',
      winner: 'red',
    })
    expect(terminal.handleSquare(4, 9)).toEqual({
      type: 'ignored',
      reason: 'terminal',
    })
  })

  it('重开恢复标准局面', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    controller.handleSquare(0, 4)
    controller.reset()
    expect(controller.getState().pieces).toHaveLength(32)
    expect(controller.getState().sideToMove).toBe('red')
    expect(controller.getState().history).toHaveLength(0)
    expect(controller.getTimelineSnapshot().canUndo).toBe(false)
  })

  it('程序化落子仍由权威规则校验，且支持原子撤销完整人机回合', () => {
    const controller = new GameController()
    expect(
      controller.tryCommitMove({
        pieceId: 'p12',
        from: { file: 0, rank: 3 },
        to: { file: 0, rank: 6 },
      }),
    ).toEqual({ type: 'ignored', reason: 'illegal' })

    expect(
      controller.tryCommitMove({
        pieceId: 'p12',
        from: { file: 0, rank: 3 },
        to: { file: 0, rank: 4 },
      }).type,
    ).toBe('moved')
    expect(
      controller.tryCommitMove({
        pieceId: 'p28',
        from: { file: 0, rank: 6 },
        to: { file: 0, rank: 5 },
      }).type,
    ).toBe('moved')

    expect(controller.undoToSide('red')).toBe(2)
    expect(controller.getState()).toMatchObject({
      sideToMove: 'red',
      history: [],
    })
  })
})
