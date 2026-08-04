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

  it('可切换己方选择，点击空白或对方非法目标会清空', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    controller.handleSquare(2, 3)
    expect(controller.getSelectedPiece()?.file).toBe(2)
    controller.handleSquare(1, 5)
    expect(controller.getSelectedId()).toBeNull()
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

    const terminal = new GameController({
      ...controller.getState(),
      status: 'checkmate',
      winner: 'red',
    })
    expect(terminal.handleSquare(4, 9).type).toBe('ignored')
  })

  it('重开恢复标准局面', () => {
    const controller = new GameController()
    controller.handleSquare(0, 3)
    controller.handleSquare(0, 4)
    controller.reset()
    expect(controller.getState().pieces).toHaveLength(32)
    expect(controller.getState().sideToMove).toBe('red')
    expect(controller.getState().history).toHaveLength(0)
  })
})
