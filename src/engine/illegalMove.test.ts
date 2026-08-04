import { describe, expect, it } from 'vitest'
import type {
  BoardCoord,
  GameState,
  Piece,
  PieceKind,
  Side,
} from '../types/xiangqi'
import { createInitialState } from './board'
import { explainIllegalMove } from './illegalMove'

function piece(
  id: string,
  kind: PieceKind,
  side: Side,
  file: number,
  rank: number,
): Piece {
  return { id, kind, side, file, rank }
}

function game(
  movingPiece: Piece,
  extraPieces: Piece[] = [],
  sideToMove: Side = movingPiece.side,
): GameState {
  return {
    pieces: [
      piece('red-king', 'king', 'red', 4, 0),
      piece('black-king', 'king', 'black', 3, 9),
      movingPiece,
      ...extraPieces,
    ],
    sideToMove,
    history: [],
    inCheck: false,
    winner: null,
    status: 'playing',
  }
}

function explain(
  movingPiece: Piece,
  target: BoardCoord,
  extraPieces: Piece[] = [],
): ReturnType<typeof explainIllegalMove> {
  return explainIllegalMove(game(movingPiece, extraPieces), movingPiece, target)
}

describe('explainIllegalMove 棋子几何与阻挡', () => {
  it('优先识别己方棋子占据目标点', () => {
    const rook = piece('rook', 'chariot', 'red', 0, 1)
    expect(
      explain(rook, { file: 0, rank: 4 }, [
        piece('friend', 'pawn', 'red', 0, 4),
      ]),
    ).toBe('friendly-occupied')
  })

  it('识别棋盘外坐标与普通走法形状错误', () => {
    const rook = piece('rook', 'chariot', 'red', 0, 1)
    expect(explain(rook, { file: -1, rank: 1 })).toBe('outside-board')
    expect(explain(rook, { file: 1, rank: 2 })).toBe('illegal-pattern')
  })

  it('车直线路径有子时返回 path-blocked', () => {
    const rook = piece('rook', 'chariot', 'red', 0, 1)
    expect(
      explain(rook, { file: 0, rank: 5 }, [
        piece('blocker', 'pawn', 'black', 0, 3),
      ]),
    ).toBe('path-blocked')
  })

  it('马按目标方向识别对应马腿', () => {
    const horse = piece('horse', 'horse', 'red', 2, 2)
    expect(
      explain(horse, { file: 4, rank: 3 }, [
        piece('leg-horizontal', 'pawn', 'black', 3, 2),
      ]),
    ).toBe('horse-leg-blocked')
    expect(
      explain(horse, { file: 3, rank: 4 }, [
        piece('leg-vertical', 'pawn', 'black', 2, 3),
      ]),
    ).toBe('horse-leg-blocked')
  })

  it('相分别识别象眼与不可过河', () => {
    const elephant = piece('elephant', 'elephant', 'red', 2, 2)
    expect(
      explain(elephant, { file: 0, rank: 4 }, [
        piece('eye', 'pawn', 'black', 1, 3),
      ]),
    ).toBe('elephant-eye-blocked')

    const riverElephant = piece('river-elephant', 'elephant', 'red', 2, 4)
    expect(explain(riverElephant, { file: 4, rank: 6 })).toBe(
      'elephant-cross-river',
    )
  })

  it.each([
    ['advisor', 4, 2, 5, 3],
    ['king', 5, 1, 6, 1],
  ] as const)('%s 走法形状正确但离开九宫时返回 palace-bound', (
    kind,
    fromFile,
    fromRank,
    toFile,
    toRank,
  ) => {
    const movingPiece = piece('palace-piece', kind, 'red', fromFile, fromRank)
    expect(explain(movingPiece, { file: toFile, rank: toRank })).toBe(
      'palace-bound',
    )
  })

  it('炮不吃子不能越炮架，吃子必须恰隔一个炮架', () => {
    const cannon = piece('cannon', 'cannon', 'red', 0, 1)
    const screen = piece('screen', 'pawn', 'red', 0, 2)

    expect(explain(cannon, { file: 0, rank: 4 }, [screen])).toBe(
      'cannon-screen',
    )
    expect(
      explain(cannon, { file: 0, rank: 4 }, [
        piece('target', 'horse', 'black', 0, 4),
      ]),
    ).toBe('cannon-screen')
    expect(
      explain(cannon, { file: 0, rank: 5 }, [
        screen,
        piece('screen-2', 'pawn', 'black', 0, 3),
        piece('target', 'horse', 'black', 0, 5),
      ]),
    ).toBe('cannon-screen')
    expect(
      explain(cannon, { file: 0, rank: 4 }, [
        screen,
        piece('target', 'horse', 'black', 0, 4),
      ]),
    ).toBeNull()
  })

  it('兵卒把横走过早、后退、跨格统一解释为 pawn-direction', () => {
    expect(
      explain(piece('red-before', 'pawn', 'red', 2, 4), {
        file: 3,
        rank: 4,
      }),
    ).toBe('pawn-direction')
    expect(
      explain(piece('red-after', 'pawn', 'red', 2, 5), {
        file: 2,
        rank: 4,
      }),
    ).toBe('pawn-direction')
    expect(
      explain(piece('black-before', 'pawn', 'black', 2, 5), {
        file: 3,
        rank: 5,
      }),
    ).toBe('pawn-direction')
  })

  it('几何错误优先于当前被将状态', () => {
    const horse = piece('horse', 'horse', 'red', 0, 2)
    const state = game(horse, [
      piece('checking-rook', 'chariot', 'black', 4, 5),
    ])
    expect(explainIllegalMove(state, horse, { file: 0, rank: 4 })).toBe(
      'illegal-pattern',
    )
  })
})

describe('explainIllegalMove 王安全优先级', () => {
  it('伪合法着移开唯一遮挡时返回 kings-facing', () => {
    const blocker = piece('blocker', 'chariot', 'red', 4, 5)
    const state: GameState = {
      pieces: [
        piece('red-king', 'king', 'red', 4, 0),
        piece('black-king', 'king', 'black', 4, 9),
        blocker,
      ],
      sideToMove: 'red',
      history: [],
      inCheck: false,
      winner: null,
      status: 'playing',
    }
    expect(explainIllegalMove(state, blocker, { file: 5, rank: 5 })).toBe(
      'kings-facing',
    )
  })

  it('将帅照面原因优先于当前被将未解除', () => {
    const blocker = piece('blocker', 'chariot', 'red', 4, 5)
    const state: GameState = {
      pieces: [
        piece('red-king', 'king', 'red', 4, 0),
        piece('black-king', 'king', 'black', 4, 9),
        blocker,
        piece('checking-rook', 'chariot', 'black', 0, 0),
      ],
      sideToMove: 'red',
      history: [],
      inCheck: true,
      winner: null,
      status: 'playing',
    }
    expect(explainIllegalMove(state, blocker, { file: 5, rank: 5 })).toBe(
      'kings-facing',
    )
  })

  it('当前被将且走无关伪合法着时返回 must-answer-check', () => {
    const rook = piece('rook', 'chariot', 'red', 0, 1)
    const state = game(rook, [
      piece('checking-rook', 'chariot', 'black', 4, 5),
    ])
    expect(explainIllegalMove(state, rook, { file: 0, rank: 2 })).toBe(
      'must-answer-check',
    )
  })

  it('原本未被将但移开护帅棋子时返回 exposes-own-king', () => {
    const blocker = piece('blocker', 'chariot', 'red', 4, 2)
    const state = game(blocker, [
      piece('attacking-rook', 'chariot', 'black', 4, 5),
    ])
    expect(explainIllegalMove(state, blocker, { file: 5, rank: 2 })).toBe(
      'exposes-own-king',
    )
  })

  it('完整合法着返回 null 且不修改输入状态', () => {
    const state = createInitialState()
    const pawn = state.pieces.find(
      (candidate) =>
        candidate.side === 'red' &&
        candidate.kind === 'pawn' &&
        candidate.file === 0,
    )!
    const before = structuredClone(state)

    expect(explainIllegalMove(state, pawn, { file: 0, rank: 4 })).toBeNull()
    expect(state).toEqual(before)
  })

  it('非当前方与已结束棋局返回可直接映射的交互原因', () => {
    const blackPawn = piece('black-pawn', 'pawn', 'black', 0, 6)
    const state = game(blackPawn, [], 'red')
    expect(explainIllegalMove(state, blackPawn, { file: 0, rank: 5 })).toBe(
      'wrong-side',
    )
    expect(
      explainIllegalMove(
        { ...state, status: 'draw' },
        blackPawn,
        { file: 0, rank: 5 },
      ),
    ).toBe('terminal')
  })
})
