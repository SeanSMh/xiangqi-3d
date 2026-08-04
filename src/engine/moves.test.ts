import { describe, expect, it } from 'vitest'
import type { GameState, Piece, PieceKind, Side } from '../types/xiangqi'
import { createInitialState } from './board'
import {
  applyMove,
  evaluateGameState,
  generateAllLegalMoves,
  generateLegalMoves,
  generatePseudoLegalMoves,
  isInCheck,
  kingsFace,
} from './moves'

function piece(
  id: string,
  kind: PieceKind,
  side: Side,
  file: number,
  rank: number,
): Piece {
  return { id, kind, side, file, rank }
}

function game(pieces: Piece[], sideToMove: Side = 'red'): GameState {
  return {
    pieces,
    sideToMove,
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
  }
}

function targets(moves: ReturnType<typeof generatePseudoLegalMoves>): string[] {
  return moves.map((move) => `${move.to.file},${move.to.rank}`).sort()
}

describe('标准开局', () => {
  it('创建32枚唯一棋子且红方先行', () => {
    const state = createInitialState()
    expect(state.pieces).toHaveLength(32)
    expect(new Set(state.pieces.map((candidate) => candidate.id)).size).toBe(32)
    expect(state.pieces.filter((candidate) => candidate.side === 'red')).toHaveLength(16)
    expect(state.pieces.filter((candidate) => candidate.side === 'black')).toHaveLength(16)
    expect(state.sideToMove).toBe('red')
    expect(state.status).toBe('playing')
  })

  it('双方开局均未被将，红方共有44个合法着', () => {
    const state = createInitialState()
    expect(isInCheck(state.pieces, 'red')).toBe(false)
    expect(isInCheck(state.pieces, 'black')).toBe(false)
    expect(generateAllLegalMoves(state)).toHaveLength(44)
  })
})

describe('七类棋子的伪合法着', () => {
  it('车沿直线行走并被首枚棋子截断', () => {
    const rook = piece('r', 'chariot', 'red', 4, 4)
    const pieces = [
      rook,
      piece('friend', 'pawn', 'red', 4, 6),
      piece('enemy', 'pawn', 'black', 2, 4),
    ]
    const result = targets(generatePseudoLegalMoves(pieces, rook))
    expect(result).toContain('3,4')
    expect(result).toContain('2,4')
    expect(result).not.toContain('1,4')
    expect(result).toContain('4,5')
    expect(result).not.toContain('4,6')
  })

  it('炮只有隔一枚炮架时才能吃子', () => {
    const cannon = piece('c', 'cannon', 'red', 4, 2)
    const pieces = [
      cannon,
      piece('screen', 'pawn', 'red', 4, 4),
      piece('target', 'chariot', 'black', 4, 7),
      piece('beyond', 'pawn', 'black', 4, 8),
    ]
    const moves = generatePseudoLegalMoves(pieces, cannon)
    expect(moves.find((move) => move.to.rank === 7)?.capturedId).toBe('target')
    expect(moves.some((move) => move.to.rank === 5)).toBe(false)
    expect(moves.some((move) => move.to.rank === 8)).toBe(false)
  })

  it('马腿被堵时只禁对应的两个方向', () => {
    const horse = piece('h', 'horse', 'red', 4, 4)
    const pieces = [horse, piece('leg', 'pawn', 'red', 4, 5)]
    const result = targets(generatePseudoLegalMoves(pieces, horse))
    expect(result).not.toContain('3,6')
    expect(result).not.toContain('5,6')
    expect(result).toContain('6,5')
    expect(result).toHaveLength(6)
  })

  it('相受象眼和河界限制', () => {
    const elephant = piece('e', 'elephant', 'red', 2, 4)
    const pieces = [elephant, piece('eye', 'pawn', 'red', 1, 3)]
    const result = targets(generatePseudoLegalMoves(pieces, elephant))
    expect(result).not.toContain('0,2')
    expect(result).not.toContain('4,6')
    expect(result).toContain('4,2')
  })

  it('仕与帅都不能离开九宫', () => {
    const advisor = piece('a', 'advisor', 'red', 4, 1)
    const king = piece('k', 'king', 'red', 3, 0)
    expect(targets(generatePseudoLegalMoves([advisor], advisor))).toEqual([
      '3,0',
      '3,2',
      '5,0',
      '5,2',
    ])
    expect(targets(generatePseudoLegalMoves([king], king))).toEqual(['3,1', '4,0'])
  })

  it('兵过河前只前进，过河后可横走且永不后退', () => {
    const before = piece('p1', 'pawn', 'red', 4, 4)
    const after = piece('p2', 'pawn', 'red', 4, 5)
    expect(targets(generatePseudoLegalMoves([before], before))).toEqual(['4,5'])
    expect(targets(generatePseudoLegalMoves([after], after))).toEqual([
      '3,5',
      '4,6',
      '5,5',
    ])

    const blackBefore = piece('bp1', 'pawn', 'black', 4, 5)
    const blackAfter = piece('bp2', 'pawn', 'black', 4, 4)
    expect(targets(generatePseudoLegalMoves([blackBefore], blackBefore))).toEqual(['4,4'])
    expect(targets(generatePseudoLegalMoves([blackAfter], blackAfter))).toEqual([
      '3,4',
      '4,3',
      '5,4',
    ])
  })
})

describe('将军与合法着过滤', () => {
  it('识别将帅照面', () => {
    const pieces = [
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 4, 9),
    ]
    expect(kingsFace(pieces)).toBe(true)
    expect(isInCheck(pieces, 'red')).toBe(true)
    expect(isInCheck(pieces, 'black')).toBe(true)
  })

  it('禁止移走将帅之间唯一的遮挡棋子', () => {
    const blocker = piece('blocker', 'chariot', 'red', 4, 5)
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 4, 9),
      blocker,
    ])
    const result = targets(generateLegalMoves(state, blocker))
    expect(result.some((target) => target.endsWith(',5') && !target.startsWith('4,'))).toBe(false)
    expect(result).toContain('4,6')
  })

  it('帅不能走入车、炮、马或过河兵的攻击点', () => {
    const attackers: Piece[][] = [
      [piece('rook', 'chariot', 'black', 4, 5)],
      [
        piece('cannon', 'cannon', 'black', 4, 5),
        piece('screen', 'pawn', 'red', 4, 3),
      ],
      [piece('horse', 'horse', 'black', 2, 2)],
      [piece('pawn', 'pawn', 'black', 3, 1)],
    ]

    for (const extraPieces of attackers) {
      const king = piece('rk', 'king', 'red', 4, 0)
      const state = game([
        king,
        piece('bk', 'king', 'black', 3, 9),
        ...extraPieces,
      ])
      expect(targets(generateLegalMoves(state, king))).not.toContain('4,1')
    }
  })

  it('被将时过滤无法应将的无关着法', () => {
    const unrelated = piece('unrelated', 'chariot', 'red', 0, 0)
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('checking-rook', 'chariot', 'black', 4, 5),
      unrelated,
    ])
    expect(generateLegalMoves(state, unrelated)).toEqual([])
  })

  it('炮对将恰好一个炮架时才构成将军', () => {
    const base = [
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('cannon', 'cannon', 'black', 4, 5),
    ]
    expect(isInCheck(base, 'red')).toBe(false)
    expect(
      isInCheck([...base, piece('screen-1', 'pawn', 'red', 4, 3)], 'red'),
    ).toBe(true)
    expect(
      isInCheck(
        [
          ...base,
          piece('screen-1', 'pawn', 'red', 4, 3),
          piece('screen-2', 'pawn', 'black', 4, 2),
        ],
        'red',
      ),
    ).toBe(false)
  })

  it('马腿阻挡会解除对应的将军', () => {
    const base = [
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 3, 9),
      piece('horse', 'horse', 'black', 2, 1),
    ]
    expect(isInCheck(base, 'red')).toBe(true)
    expect(
      isInCheck([...base, piece('leg', 'pawn', 'red', 3, 1)], 'red'),
    ).toBe(false)
  })

  it('传入过期棋子引用时仍按权威局面坐标生成着法', () => {
    const state = createInitialState()
    const current = state.pieces.find(
      (candidate) =>
        candidate.side === 'red' &&
        candidate.kind === 'pawn' &&
        candidate.file === 0,
    )!
    const stale = { ...current, file: 4, rank: 5 }
    const moves = generateLegalMoves(state, stale)
    expect(moves).toHaveLength(1)
    expect(moves[0]?.from).toEqual({ file: 0, rank: 3 })
    expect(moves[0]?.to).toEqual({ file: 0, rank: 4 })
  })
})

describe('执行着法与终局', () => {
  it('走子后切换行棋方、记录历史并标记被吃棋子', () => {
    const rook = piece('r', 'chariot', 'red', 0, 0)
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 4, 9),
      piece('screen', 'pawn', 'red', 4, 5),
      rook,
      piece('target', 'pawn', 'black', 0, 3),
    ])
    const next = applyMove(state, {
      pieceId: rook.id,
      from: { file: 0, rank: 0 },
      to: { file: 0, rank: 3 },
    })
    expect(next.sideToMove).toBe('black')
    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.capturedId).toBe('target')
    expect(next.pieces.find((candidate) => candidate.id === 'target')?.captured).toBe(true)
  })

  it('执行着法不修改输入局面，并拒绝来源坐标已经过期的着法', () => {
    const state = createInitialState()
    const pawn = state.pieces.find(
      (candidate) =>
        candidate.side === 'red' &&
        candidate.kind === 'pawn' &&
        candidate.file === 0,
    )!
    const next = applyMove(state, {
      pieceId: pawn.id,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    })
    expect(state.sideToMove).toBe('red')
    expect(state.history).toHaveLength(0)
    expect(state.pieces.find((candidate) => candidate.id === pawn.id)?.rank).toBe(3)
    expect(next.pieces).not.toBe(state.pieces)

    expect(() =>
      applyMove(state, {
        pieceId: pawn.id,
        from: { file: 0, rank: 2 },
        to: { file: 0, rank: 4 },
      }),
    ).toThrow('非法着法')
  })

  it('识别绝杀', () => {
    const attackingRook = piece('attack', 'chariot', 'red', 4, 7)
    const state = game([
      piece('rk', 'king', 'red', 4, 0),
      piece('bk', 'king', 'black', 4, 9),
      attackingRook,
      piece('left', 'chariot', 'red', 3, 8),
      piece('right', 'chariot', 'red', 5, 8),
    ])
    const next = applyMove(state, {
      pieceId: attackingRook.id,
      from: { file: 4, rank: 7 },
      to: { file: 4, rank: 8 },
    })
    expect(next.status).toBe('checkmate')
    expect(next.winner).toBe('red')
    expect(next.inCheck).toBe(true)
  })

  it('中国象棋困毙判对方获胜', () => {
    const state = game(
      [
        piece('rk', 'king', 'red', 4, 0),
        piece('bk', 'king', 'black', 4, 9),
        piece('block', 'pawn', 'red', 4, 5),
        piece('left', 'chariot', 'red', 3, 8),
        piece('right', 'chariot', 'red', 5, 8),
      ],
      'black',
    )
    const result = evaluateGameState(state)
    expect(result.inCheck).toBe(false)
    expect(result.status).toBe('stalemate')
    expect(result.winner).toBe('red')
  })

  it('已裁决终局再次评估时保持终局，不会被重新打开', () => {
    const terminal: GameState = {
      ...createInitialState(),
      status: 'draw',
      outcome: {
        reason: 'no-capture-limit',
        winner: null,
        offender: null,
      },
    }

    expect(evaluateGameState(terminal)).toBe(terminal)
    expect(evaluateGameState(terminal)).toMatchObject({
      status: 'draw',
      winner: null,
      outcome: { reason: 'no-capture-limit' },
    })
  })
})
